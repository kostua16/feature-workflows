import { AGENT_TIMEOUT_MS_DEFAULT, AGENT_MAX_OUTPUT_CHARS_DEFAULT, IDENTICAL_FAILURE_LIMIT, GATE_FALLBACKS } from './config.mjs'
import { detectNonEnglish } from './text-utils.mjs'
import { extractJson } from './json-repair.mjs'
import { main } from './main.mjs'

// Bounded backoff retry for transient provider/network errors. A transient error
// (network timeout, 429, 503, connection reset) is inherently retryable — treating
// it as immediately fatal hard-blocks every blocking design gate on a single
// blip. These constants bound the retry loop so it cannot spin indefinitely.
const TRANSIENT_RETRY_MAX = 3
const TRANSIENT_BACKOFF_BASE_MS = 500

// Classify an agent error message as transient, schema, or fatal.
// Transient errors are retryable (network/provider). Schema errors use the
// existing plain-text JSON fallback path. Fatal errors are non-retryable.
// Pure: no side effects, deterministic for the same input.
function classifyAgentError(errorMsg) {
  const msg = String(errorMsg || '')
  if (/StructuredOutput|schema|valid output/i.test(msg)) return 'schema'
  if (/network|timeout|connection|ECONNRESET|ENOTFOUND|ETIMEDOUT|429|503|502|rate.?limit|overloaded|service.unavailable|temporarily/i.test(msg)) return 'transient'
  return 'fatal'
}

// Retry a failed agent call with bounded exponential backoff. Only called when
// classifyAgentError returns 'transient'. Returns the raw output from
// callAgentWithWatchdog on success, or null if all retries are exhausted.
// Each attempt is journaled via recordDegradationEvent for durable inspection.
async function retryTransientError(prompt, opts, result, originalError) {
  for (let attempt = 1; attempt <= TRANSIENT_RETRY_MAX; attempt++) {
    const delayMs = TRANSIENT_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} for "${opts && opts.label}" after ${delayMs}ms backoff`)
    }
    bumpGateTelemetry(result, opts, 'retry')
    recordDegradationEvent(result, 'retry', opts && opts.phase, opts && opts.label, `transient error retry ${attempt}/${TRANSIENT_RETRY_MAX}: ${originalError}`)
    try {
      const out = await callAgentWithWatchdog(prompt, opts, result)
      if (out) {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} succeeded for "${opts && opts.label}"`)
        }
        return out
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      const errorClass = classifyAgentError(msg)
      if (errorClass !== 'transient') {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} stopped for "${opts && opts.label}": error reclassified as ${errorClass}`)
        }
        return null
      }
    }
  }
  return null
}


// agent() contract: returns null on user-skip or terminal API error. But a StructuredOutput
// retry-cap throw (TelemetrySafeError) escapes that contract and propagates uncaught — killing
// the workflow. safeAgent converts ANY throw into a null + log line so gate logic's existing
// null-handling (convergence gate, fail-forward) degrades gracefully instead of crashing.
// Use for the critical-path schema-gated calls whose throw would otherwise escape main().
async function safeAgent(prompt, opts, result) {
  return flexibleAgent(prompt, opts, result)
}

// Some non-standard providers fail to satisfy a forced-StructuredOutput schema with certain
// custom subagent types (e.g. task-definition-architect), even though the emitted JSON is
// syntactically valid. flexibleAgent tries the schema path first; on a schema-specific failure
// it falls back to a plain-text agent call with explicit JSON-only instructions and parses the
// response ourselves. This keeps the gate-enforcing pipeline intact on providers where forced
// tool-use is unreliable.
async function flexibleAgent(prompt, opts, result) {
  const callOpts = escalateAgentOpts(opts, result)
  if (agentCircuitOpen(callOpts, result)) {
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`WARNING: agent "${callOpts && callOpts.label}" skipped because circuit is open`)
    }
    return fallbackForAgent(callOpts)
  }
  bumpGateTelemetry(result, callOpts, 'call', callOpts && callOpts.model)
  if (callOpts && callOpts.escalatedFrom) bumpGateTelemetry(result, callOpts, 'escalation')
  const effectivePrompt = hardenForModel(prompt, callOpts && callOpts.schema, callOpts && callOpts.model)
  let out = null
  let schemaFailed = false
  let originalError = ''
  try {
    out = await callAgentWithWatchdog(effectivePrompt, callOpts, result)
  } catch (e) {
    originalError = String(e && e.message ? e.message : e)
    schemaFailed = /StructuredOutput|schema|valid output/i.test(originalError)
    if (!schemaFailed) {
      const errorClass = classifyAgentError(originalError)
      if (errorClass === 'transient') {
        const recovered = await retryTransientError(effectivePrompt, callOpts, result, originalError)
        if (recovered !== null) {
          out = recovered
        } else {
          if (result && Array.isArray(result.logLines)) {
            result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (transient retries exhausted): ${originalError}`)
          }
          log(`Agent "${opts && opts.label}" threw — transient retries exhausted, converting to null: ${originalError}`)
          return null
        }
      } else {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (caught): ${originalError}`)
        }
        log(`Agent "${opts && opts.label}" threw — converting to null (graceful degradation): ${originalError}`)
        return null
      }
    } else {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
      }
      log(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
    }
  }
  if (out) {
    if (typeof out === 'object') {
      const normalized = normalizeAgentOutput(callOpts, out, result)
      if (normalized) return normalized
    }
    const parsed = extractJson(out)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      }
      log(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      const normalized = normalizeAgentOutput(callOpts, parsed, result)
      if (normalized) return normalized
    }
    // Not a valid object response — fall through to JSON-only retry.
  }

  const jsonPrompt = `${effectivePrompt}\n\nIMPORTANT: Return ONLY a single JSON object matching the expected structure. Do NOT include markdown fences, explanations, or prose. The JSON must be parseable by JSON.parse().`
  bumpGateTelemetry(result, callOpts, 'retry')
  try {
    // Strip the schema property entirely so the fallback call is treated as plain text.
    const { schema: _unused, ...plainOpts } = callOpts
    const raw = await callAgentWithWatchdog(jsonPrompt, plainOpts, result)
    const parsed = extractJson(raw)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      }
      log(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      return normalizeAgentOutput(callOpts, parsed, result)
    }
  } catch (e2) {
    const msg2 = String(e2 && e2.message ? e2.message : e2)
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
    }
    log(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
  }
  recordAgentFailure(result, callOpts, 'unavailable verdict')
  return fallbackForAgent(callOpts)
}

function normalizeAgentOutput(opts, value, result) {
  const normalized = normalizeVerdict(opts && opts.schema, value)
  if (outputLanguageViolation(normalized)) {
    recordAgentFailure(result, opts, 'non-English verdict')
    return null
  }
  const contradiction = verdictContradiction(normalized)
  if (!contradiction) return normalized
  if (result && Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" returned contradictory verdict: ${contradiction}`)
  }
  log(`Agent "${opts && opts.label}" returned contradictory verdict — rejecting: ${contradiction}`)
  recordAgentFailure(result, opts, contradiction)
  return null
}

function fallbackForAgent(opts) {
  const label = String(opts && opts.label || '')
  const key = Object.keys(GATE_FALLBACKS).find((candidate) => label.includes(candidate))
  const fallback = key ? GATE_FALLBACKS[key] : null
  if (!fallback || typeof fallback !== 'object') return fallback
  return JSON.parse(JSON.stringify(fallback))
}

function escalateAgentOpts(opts, result) {
  if (!opts || !result || !result.agentFailures) return opts
  const key = agentFailureKey(opts)
  const failures = result.agentFailures[key]
  if (!failures || failures.count < 2) return opts
  const model = String(opts.model || '').toLowerCase()
  if (model === 'opus' || model.includes('claude-opus')) return opts
  return { ...opts, model: 'opus', escalatedFrom: opts.model || '(default)' }
}

function agentCircuitOpen(opts, result) {
  if (!opts || !result || !result.agentFailures) return false
  const failures = result.agentFailures[agentFailureKey(opts)]
  return !!(failures && failures.circuitOpen)
}

// Record a degradation event into the durable journal (DHIST-01).
// Types: 'fail-forward' | 'retry' | 'escalation' | 'fallback'.
// Each entry is sequentially numbered for inspection through handoff/status.
function recordDegradationEvent(result, type, gate, label, reason) {
  if (!result) return
  if (!result._degradationLog) result._degradationLog = []
  var seq = result._degradationLog.length + 1
  result._degradationLog.push({ seq: seq, type: type, gate: gate || 'unknown', label: label || 'agent', reason: reason || '' })
}

// Summarize the degradation log for handoff/status display. Pure helper.
function degradationLogSummary(log) {
  if (!log || !log.length) return ''
  var byType = {}
  for (var i = 0; i < log.length; i++) {
    var t = log[i].type
    byType[t] = (byType[t] || 0) + 1
  }
  return Object.keys(byType).map(function (t) { return t + '=' + byType[t] }).join(', ')
}

function recordAgentFailure(result, opts, reason) {
  if (!result) return 0
  const key = agentFailureKey(opts)
  if (!result.agentFailures) result.agentFailures = {}
  const current = result.agentFailures[key] || { count: 0, reason: '', circuitOpen: false }
  current.count += 1
  current.reason = reason
  current.circuitOpen = current.count >= IDENTICAL_FAILURE_LIMIT
  result.agentFailures[key] = current
  if (!result.degradationTelemetry) result.degradationTelemetry = { fallbacks: 0, escalations: 0, languageViolations: 0, circuitBreakers: 0 }
  result.degradationTelemetry.fallbacks += 1
  bumpGateTelemetry(result, opts, 'fallback')
  // Journal each degradation event for durable attempt-history inspection (DHIST-01)
  recordDegradationEvent(result, 'fallback', opts && opts.phase, opts && opts.label, reason)
  if (reason === 'non-English verdict') result.degradationTelemetry.languageViolations += 1
  if (current.count === 2) {
    result.degradationTelemetry.escalations += 1
    recordDegradationEvent(result, 'escalation', opts && opts.phase, opts && opts.label, 'model escalated after 2 failures')
  }
  if (current.circuitOpen) result.degradationTelemetry.circuitBreakers += 1
  if (Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" failure ${current.count}/${IDENTICAL_FAILURE_LIMIT}: ${reason}${current.circuitOpen ? ' (circuit open)' : ''}`)
  }
  return current.count
}

function agentFailureKey(opts) {
  return `${(opts && opts.phase) || 'unknown'}:${(opts && opts.label) || 'agent'}`
}

// Per-gate telemetry: counts agent calls, plain-JSON retries, model escalations, and
// fallback verdicts under the gate (opts.phase) that made the call, plus a per-model call
// histogram. Turns "the pipeline is slow/expensive" into per-gate data. Buckets are created
// lazily so results hydrated from older pipeline-state.json files (no gateTelemetry field)
// pick up counting mid-run without a migration.
function bumpGateTelemetry(result, opts, event, model) {
  if (!result) return
  if (!result.gateTelemetry || typeof result.gateTelemetry !== 'object') result.gateTelemetry = {}
  const gate = (opts && opts.phase) || 'unknown'
  const bucket = result.gateTelemetry[gate] || { calls: 0, retries: 0, escalations: 0, fallbacks: 0, models: {} }
  if (event === 'call') {
    bucket.calls += 1
    const modelName = String(model || '(default)')
    if (!bucket.models || typeof bucket.models !== 'object') bucket.models = {}
    bucket.models[modelName] = (bucket.models[modelName] || 0) + 1
  } else if (event === 'retry') {
    bucket.retries += 1
  } else if (event === 'escalation') {
    bucket.escalations += 1
  } else if (event === 'fallback') {
    bucket.fallbacks += 1
  }
  result.gateTelemetry[gate] = bucket
}

// Render per-gate telemetry as log lines plus a degradation trailer (degradationTelemetry
// counters were previously recorded but never surfaced). Returns [] when nothing was
// recorded so call sites can print unconditionally.
function renderTelemetrySummary(gateTelemetry, degradationTelemetry) {
  const lines = []
  const gates = Object.keys(gateTelemetry || {})
  if (gates.length) {
    lines.push('Telemetry (per gate):')
    for (const gate of gates) {
      const b = gateTelemetry[gate] || {}
      const models = Object.keys(b.models || {}).map((m) => `${m} x${b.models[m]}`).join(', ') || '(default)'
      lines.push(`  ${gate}: calls=${b.calls || 0} retries=${b.retries || 0} escalations=${b.escalations || 0} fallbacks=${b.fallbacks || 0} models=[${models}]`)
    }
  }
  const d = degradationTelemetry
  if (d && ((d.fallbacks || 0) + (d.escalations || 0) + (d.languageViolations || 0) + (d.circuitBreakers || 0) > 0)) {
    lines.push(`Degradations: fallbacks=${d.fallbacks || 0} escalations=${d.escalations || 0} languageViolations=${d.languageViolations || 0} circuitBreakers=${d.circuitBreakers || 0}`)
  }
  return lines
}

function outputLanguageViolation(value) {
  if (!value || typeof value !== 'object') return false
  const text = JSON.stringify(value)
  const lang = detectNonEnglish(text)
  return lang.ratio > 0.30
}

async function callAgentWithWatchdog(prompt, opts, result) {
  const timeoutMs = Number(opts && opts.timeoutMs) || AGENT_TIMEOUT_MS_DEFAULT
  const maxOutputChars = Number(opts && opts.maxOutputChars) || AGENT_MAX_OUTPUT_CHARS_DEFAULT
  const timeoutSentinel = { __agentTimeout: true }
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeoutSentinel), timeoutMs)
  })
  try {
    const out = await Promise.race([agent(prompt, opts), timeout])
    if (out === timeoutSentinel) {
      recordAgentWatchdog(result, 'timeouts', opts, `timed out after ${timeoutMs}ms`)
      return null
    }
    if (typeof out === 'string' && out.length > maxOutputChars) {
      recordAgentWatchdog(result, 'oversized', opts, `returned ${out.length} chars (limit ${maxOutputChars})`)
      return null
    }
    return out
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function recordAgentWatchdog(result, key, opts, detail) {
  if (!result) return
  if (!result.agentWatchdog) result.agentWatchdog = { timeouts: 0, oversized: 0 }
  result.agentWatchdog[key] = (result.agentWatchdog[key] || 0) + 1
  if (Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" ${detail}`)
  }
}

function hardenForModel(prompt, schema, model) {
  if (!schema) return prompt
  const modelName = String(model || '').toLowerCase()
  const isStrong = modelName === 'opus' || modelName.includes('claude-opus')
  if (isStrong) return prompt
  if (String(prompt).includes('WEAK-MODEL OUTPUT CONTRACT')) return prompt
  return `${prompt}

WEAK-MODEL OUTPUT CONTRACT:
- Return English only.
- Return one JSON object only: no markdown fences, no prose, no comments.
- Use the exact field names and primitive types from this example.
- If a field is unknown, use the schema-safe empty value shown by the example.

Example JSON:
${JSON.stringify(schemaExample(schema), null, 2)}`
}

function schemaExample(schema) {
  if (!schema) return null
  if (schema.enum && schema.enum.length) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return 0
  if (type === 'array') return []
  if (type === 'object') {
    const out = {}
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      out[key] = schemaExample(propSchema)
    }
    return out
  }
  return ''
}

function normalizeVerdict(schema, value) {
  if (!schema || value == null) return value
  if (schema.type === 'array') {
    const values = Array.isArray(value) ? value : [value]
    return values.map((item) => normalizeVerdict(schema.items || {}, item))
  }
  if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    const normalized = { ...value }
    const properties = schema.properties || {}
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = normalizeVerdict(propSchema, normalized[key])
      }
    }
    return normalized
  }
  if (schema.type === 'object' && typeof value === 'string') {
    return { text: value }
  }
  if (schema.enum && typeof value === 'string') {
    const mapped = normalizeEnum(value)
    const match = schema.enum.find((item) => String(item).toLowerCase() === mapped)
    return match === undefined ? value : match
  }
  if (schema.type === 'boolean') {
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase()
      if (lowered === 'true' || lowered === 'yes' || lowered === '1') return true
      if (lowered === 'false' || lowered === 'no' || lowered === '0') return false
    }
    if (value === 1) return true
    if (value === 0) return false
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return schema.type === 'integer' ? Math.trunc(numeric) : numeric
  }
  return value
}

function normalizeEnum(value) {
  const lowered = value.trim().toLowerCase()
  const synonyms = {
    critical: 'blocker',
    warn: 'low',
    warning: 'low',
    ok: 'accepted',
    approve: 'accepted',
    approved: 'accepted',
    retrying: 'retry',
    halt: 'stop',
  }
  return synonyms[lowered] || lowered
}

function verdictContradiction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const blockers = countItems(value.blockers) + countItems(value.gaps)
  if (value.accepted === true && blockers > 0) return 'accepted=true with blockers/gaps'
  if (value.accepted === false && blockers === 0) return 'accepted=false with no blockers/gaps'
  const files = countItems(value.files)
  if (value.completed === true && Number(value.stepsDone || 0) === 0 && files === 0) {
    return 'completed=true with no stepsDone and no files'
  }
  if (value.completed === true && files === 0 && /no changes|nothing (to )?(change|do|modify)|unchanged/i.test(String(value.summary || ''))) {
    return 'completed=true while summary says no work was done'
  }
  if (value.passed === true && /(failed|failures|error|exit\s*1|exit status\s*1|non-zero)/i.test(String(value.summary || value.command || ''))) {
    return 'passed=true while test summary/command reports failure'
  }
  if (value.fixed === true && !value.summary && !value.changeSummary && countItems(value.files) === 0) {
    return 'fixed=true without summary, changeSummary, or files'
  }
  if (value.decision === 'retry' && reasoningSaysStop(String(value.reasoning || ''))) {
    return 'decision=retry while reasoning says stop'
  }
  return ''
}

function countItems(value) {
  return Array.isArray(value) ? value.length : 0
}

function reasoningSaysStop(text) {
  const lowered = String(text || '').toLowerCase()
  const stopPattern = /\b(stop|halt|cancel|give up)\b/g
  let stopMatch
  while ((stopMatch = stopPattern.exec(lowered)) !== null) {
    const before = lowered.slice(0, stopMatch.index)
    const clauseStart = Math.max(
      before.lastIndexOf('.'),
      before.lastIndexOf(';'),
      before.lastIndexOf(':'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
      before.lastIndexOf(','),
      before.lastIndexOf('\n')
    )
    const clauseBeforeStop = before.slice(clauseStart + 1)
    const negated = /\b(do\s+not|don't|dont|never|should\s+not|must\s+not|not\s+to|will\s+not|won't|cannot|can't|can\s+not)\b/.test(clauseBeforeStop)
    if (!negated) return true
  }
  return false
}

export { safeAgent, flexibleAgent, normalizeAgentOutput, fallbackForAgent, escalateAgentOpts, agentCircuitOpen, recordAgentFailure, agentFailureKey, bumpGateTelemetry, renderTelemetrySummary, outputLanguageViolation, callAgentWithWatchdog, recordAgentWatchdog, hardenForModel, schemaExample, normalizeVerdict, normalizeEnum, verdictContradiction, countItems, reasoningSaysStop, recordDegradationEvent, degradationLogSummary, classifyAgentError, retryTransientError, TRANSIENT_RETRY_MAX, TRANSIENT_BACKOFF_BASE_MS }
