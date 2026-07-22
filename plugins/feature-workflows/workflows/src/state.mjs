import { ENGINE_VERSION } from './engine-version.mjs'
import { TODO_ACK, FILE_ACK, PIPELINE_STATE_READ, ARTIFACT_CHECK } from './schemas.mjs'
import { nsAgent, retryState, decisionState, gm } from './config.mjs'
import { safeAgent, renderTelemetrySummary } from './agent-core.mjs'
import { computeContentDigest } from './revision.mjs'

// Maps artifact path keys to their checkpoint gate names so digest-driven
// verification can look up the durable checkpoint recorded at gate completion.
const ARTIFACT_CHECKPOINT_GATE_MAP = {
  definitionPath: 'define',
  requirementsPath: 'requirements',
  archPath: 'architecture',
  designPath: 'detailed-design',
  planPath: 'plan',
}

// Deterministic artifact verification using the durable digest/revision
// contract. When a gate was durably checkpointed and its artifact digest was
// recorded, the artifact is verified without trusting an LLM self-report.
// Pure: no I/O, no side effects.
function verifyArtifactDigest(result, pathKey) {
  if (!result || !pathKey) return { verified: false, reason: 'no-path-key', digest: null }
  const checkpoints = result._designCheckpoints || {}
  const digests = result._artifactDigests || {}
  const gateName = ARTIFACT_CHECKPOINT_GATE_MAP[pathKey]
  if (!gateName) return { verified: false, reason: 'no-gate-mapping', digest: null }
  const cp = checkpoints[gateName]
  const digest = digests[pathKey]
  if (!cp || !cp.acknowledged) return { verified: false, reason: 'no-checkpoint', digest: null }
  if (!digest) return { verified: false, reason: 'no-digest', digest: null }
  return { verified: true, reason: 'checkpoint-verified', digest }
}


// Consolidate the full pipeline result into ONE durable todo-store record.
// R4 replaces ~16 per-gate checkpoint() calls with this single write: gate
// verdicts (with their self-summarizing notes/evidence fields) already carry
// everything each stage decided, so we persist the whole result object once on
// success and once per hard-block exit. Prior context is passed between gates
// in-prompt from the in-memory `result`, not via todo-store reads.
async function consolidate(slug, result, config) {
  // IM-2: stamp BOTH live budget counters at the single persist boundary so every
  // consolidate captures them, independent of where they were last spent. retryUsed is
  // also set ad hoc at each gate, but decisionUsed was only touched at the two decision
  // spend sites — centralizing here guarantees a --resume that never spent a decision
  // (or spent one long before the exit) still round-trips the true decision budget.
  result.retryUsed = retryState.used
  result.decisionUsed = decisionState.used
  // R5/R6: flush the in-memory pipeline log to <planDir>/pipeline.log AND the
  // durable pipeline-state.json alongside the todo-store write, so every
  // consolidate point (success + each hard-block exit) persists the run log and
  // the resumable state. All three are non-fatal if they fail.
  if (result.planPath) {
    const planDir = result.planPath.replace(/plan\.md$/, '')
    await flushPipelineLog(planDir, result)
    await flushPipelineState(planDir, result, config)
  }
  return safeAgent(
    `You are the todo-store agent. Write ONE consolidated record for task slug "${slug}"
under .planning/todos/. Capture the full pipeline result (JSON) verbatim as the durable task record:

${JSON.stringify(result, null, 2)}

Create or replace the todo entry for this task slug. Do NOT read or modify unrelated tasks.
Return ok=true once written.`,
    { label: 'todo-store:consolidate', phase: 'Checkpoint', agentType: nsAgent('todo-store'), schema: TODO_ACK, model: gm('todo') },
    result
  )
}

// R5: flush the in-memory pipeline log to <planDir>/pipeline.log via a
// file-writing agent (workflow scripts have no direct FS access). Called at the
// same durable boundaries as consolidate() — on success and once per hard-block
// exit — so the log reflects the run's final state. Non-blocking: a flush
// failure never gates the pipeline.
//
// CHUNKING: a single file-writer call embeds the whole body in its prompt,
// which can exceed a subagent's context window on a long run. writeChunkedFile()
// splits the body at a char budget (~12k chars, safe margin under subagent
// limits) at line boundaries and writes sequentially: chunk 0 overwrites the
// file, chunks 1..N append. Each agent call carries only one chunk. On any chunk
// failure it stops and warns in the log. Shared by flushPipelineState too.
async function writeChunkedFile(filePath, body, labelPrefix, result, successNote) {
  const MAX_CHUNK_CHARS = 12000
  const lines = body.split('\n')
  const chunks = []
  let cur = ''
  for (const line of lines) {
    if (cur.length + line.length + 1 > MAX_CHUNK_CHARS && cur) {
      chunks.push(cur)
      cur = ''
    }
    cur += (cur ? '\n' : '') + line
  }
  if (cur) chunks.push(cur)

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0
    const total = chunks.length
    try {
      await safeAgent(
        `You are a file-writer agent. ${isFirst ? `Write (create/overwrite) the file at ${filePath}. Create the parent directory if needed.` : `APPEND to the existing file ${filePath} (do not overwrite what is already there).`}
This is chunk ${i + 1} of ${total}. Write the body below verbatim, then return ok=true.

${chunks[i]}`,
        { label: `${labelPrefix}(${i + 1}/${total})`, phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
        result
      )
    } catch (e) {
      result.logLines.push(`WARNING: ${filePath} chunk ${i + 1}/${total} write failed: ${String(e)}`)
      return filePath // stop on first failure — partial file is better than a corrupt one
    }
  }
  if (successNote && chunks.length > 1) result.logLines.push(successNote(chunks.length, MAX_CHUNK_CHARS))
  return filePath
}

async function flushPipelineLog(planDir, result) {
  const logPath = planDir.replace(/\/$/, '') + '/pipeline.log'
  const header = `Pipeline run log for task: ${result.task}\n`
  const rawLines = result.logLines && result.logLines.length
    ? result.logLines.map((l, i) => String(i + 1).padStart(3, '0') + '  ' + l)
    : ['(no log lines recorded)']
  const body = header + rawLines.join('\n')
  return writeChunkedFile(logPath, body, 'file-writer:pipeline-log', result,
    (n, max) => `pipeline.log flushed in ${n} chunks (>${max} chars)`)
}

// IM-1: deterministic integrity check for pipeline-state.json. The state file is
// written through an LLM file-writer in ~12k-char chunks, so a failed middle chunk
// can leave a file that still parses as JSON but silently drops fields. We can't
// checksum on the host (the engine has no FS), so we embed a self-describing checksum
// over the serialized `result` and re-verify it on resume. djb2 is a small, pure,
// dependency-free string hash — enough to catch truncation/corruption, not a security MAC.
function stateChecksum(str) {
  const s = String(str == null ? '' : str)
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0 // h * 33 + c, kept unsigned
  }
  return h.toString(16)
}

// EN-2: structural validation of a hydrated pipeline-state.json before resume trusts
// it. `loadPipelineState` hydrates whatever the reader returns into 25+ result flags, so
// a corrupt/truncated file (IM-1) would poison the run. Pure: returns {ok, errors[]}.
// Also verifies the IM-1 checksum when present (older state files without it still pass
// the structural check — the checksum is advisory, not required, for backward-compat).
function validatePipelineState(state) {
  const errors = []
  if (!state || typeof state !== 'object') {
    return { ok: false, errors: ['state is not an object'] }
  }
  for (const key of ['task', 'slug', 'planPath', 'planDir']) {
    if (typeof state[key] !== 'string' || !state[key]) errors.push(`missing/invalid ${key}`)
  }
  if (!state.result || typeof state.result !== 'object') {
    errors.push('missing/invalid result object')
  }
  if (state.config !== undefined && (typeof state.config !== 'object' || state.config === null)) {
    errors.push('config present but not an object')
  }
  if (typeof state.checksum === 'string' && state.result) {
    const actual = stateChecksum(JSON.stringify(state.result))
    if (actual !== state.checksum) errors.push(`checksum mismatch (state file may be truncated/corrupt): expected ${state.checksum}, got ${actual}`)
  }
  return { ok: errors.length === 0, errors }
}

// Status-report helpers (status mode). All three are pure and defensive against results
// hydrated from older pipeline-state.json files (any flag may be absent) — a status query
// must render best-effort, never throw.

// Map the result's completion flags onto a gate list with done/pending/blocked status.
// `blocked` is attributed by substring-matching result.blockedAt against the gate name
// (covers blockedAt='test' vs gate 'tests' AND compound names like 'detailed-design' vs
// gate 'design'); non-gate block reasons (issues-handoff, uncaught-throw, …) surface in
// the report header instead.
function summarizeGates(result) {
  const r = result || {}
  const rows = [
    ['define', !!r.definitionPath],
    ['requirements', !!r.requirementsPath],
    ['architecture', !!r.archPath],
    ['design', !!r.designPath],
    ['plan', !!(r.planned || r.planAccepted)],
    ['tdd', !!r.tddEnforced],
    ['reconcile', !!r.reconcile],
    ['chunker', !!(Array.isArray(r.stages) && r.stages.length)],
    ['design-ready', !!r.designReady],
    ['execute', !!r.executed],
    ['tests', !!r.testsPassed],
    ['code-review', !!r.codeReview],
    ['goalkeeper', !!r._goalkeeper],
    ['ready', !!r.ready],
    ['commit', !!r.committed],
  ]
  const blockedAt = String(r.blockedAt || '')
  return rows.map(([gate, done]) => {
    if (done) return { gate, status: 'done' }
    const blocked = blockedAt && (blockedAt === gate || gate.includes(blockedAt) || blockedAt.includes(gate))
    return { gate, status: blocked ? 'blocked' : 'pending' }
  })
}

// Derive the exact next command for a persisted run. Precedence: a committed run needs
// nothing; an explicit handoff (set at every mode boundary) is the most precise directive;
// then readiness, block state, and design progress in that order.
function deriveNextCommand(state) {
  const s = state || {}
  const r = s.result || {}
  const planDir = s.planDir || r.planDir || '<planDir>'
  if (r.committed) return { command: '(none)', reason: 'run committed — pipeline complete' }
  const handoff = r.handoff
  if (handoff && handoff.nextMode) {
    const dir = handoff.planDir || planDir
    const command = handoff.nextMode === 'implement' ? `/implement-feature ${dir}`
      : handoff.nextMode === 'tune' ? `/tune-feature ${dir}`
      : handoff.nextMode === 'review' ? `/review-design ${dir}`
      : `/design-feature --resume ${dir}`
    return { command, reason: handoff.message || `handoff from ${handoff.from || 'pipeline'}` }
  }
  if (r.ready) return { command: `/implement-feature ${planDir} --auto-commit`, reason: 'implementation ready; commit pending' }
  if (r.blockedAt) {
    const mode = r.mode || (s.config && s.config.mode) || 'design'
    const command = mode === 'implement' ? `/implement-feature ${planDir}`
      : mode === 'tune' ? `/tune-feature ${planDir}`
      : mode === 'review' ? `/review-design ${planDir}`
      : `/design-feature --resume ${planDir}`
    return { command, reason: `blocked at ${r.blockedAt} — resume after addressing it` }
  }
  if (r.designReady && !r.executed) return { command: `/implement-feature ${planDir}`, reason: 'design ready; implementation not started' }
  return { command: `/design-feature --resume ${planDir}`, reason: 'design incomplete — resume design' }
}

// Render the full human-readable status report for a persisted run: header, gate table,
// stage table, budgets, telemetry, open questions/issues, and the exact next command.
// `validation` (optional, from validatePipelineState) downgrades to a warning line —
// inspecting a corrupt/stuck run is exactly when a status report is most needed.
function renderStatusReport(state, validation) {
  const s = state || {}
  const r = s.result || {}
  const c = s.config || {}
  const lines = []
  lines.push(`Pipeline status — ${s.planDir || r.planDir || '(unknown planDir)'}`)
  if (validation && validation.ok === false) {
    lines.push(`WARNING: pipeline-state.json failed validation (${(validation.errors || []).join('; ')}) — report is best-effort`)
  }
  const task = String(s.task || r.task || '(unknown task)')
  lines.push(`Task: ${task.length > 200 ? task.slice(0, 200) + '…' : task}`)
  const cursor = r._state || {}
  lines.push(`Mode: ${r.mode || c.mode || '(unknown)'} | profile: ${c.profile || 'full'} | lastGate: ${cursor.lastGate || s.lastGate || '(none)'}${cursor.status ? ` (${cursor.status})` : ''} | blockedAt: ${r.blockedAt || '(none)'}`)
  lines.push('Gates:')
  for (const g of summarizeGates(r)) {
    lines.push(`  ${g.status === 'done' ? '[x]' : g.status === 'blocked' ? '[!]' : '[ ]'} ${g.gate}`)
  }
  const stages = Array.isArray(r.stages) ? r.stages : []
  if (stages.length) {
    lines.push('Stages:')
    for (const st of stages) {
      lines.push(`  ${(st && st.id) || '(?)'} [${(st && st.status) || 'pending'}] ${(st && st.name) || ''} — ${((st && st.files) || []).length} file(s)`)
    }
  }
  lines.push(`Budgets: retries ${r.retryUsed || 0}/${c.retryBudget || '?'}, decisions ${r.decisionUsed || 0}/${c.decisionCap || '?'}`)
  for (const line of renderTelemetrySummary(r.gateTelemetry, r.degradationTelemetry)) lines.push(line)
  if (r.openQuestionsPath) lines.push(`Open questions: ${r.openQuestionsPath}`)
  if (r.needsClarification) lines.push('Needs clarification: yes (unresolved interview answers)')
  if (r.issuesPath) lines.push(`Issues file: ${r.issuesPath}`)
  if (r._uncaughtError) lines.push(`Last error: ${r._uncaughtError}`)
  const next = deriveNextCommand(s)
  lines.push(`Next: ${next.command} — ${next.reason}`)
  return lines.join('\n')
}

// R6: persist the durable pipeline-state JSON to <planDir>/pipeline-state.json
// via the file-writer agent. This is the --resume substrate: every consolidate
// boundary (success + each hard-block exit) flushes the latest result + config
// so a blocked run can be resumed. Non-blocking: a write failure only warns.
// Reuses writeChunkedFile's greedy line-boundary chunking (>12k chars).
async function flushPipelineState(planDir, result, config) {
  const statePath = planDir.replace(/\/$/, '') + '/pipeline-state.json'
  const payload = {
    task: result.task,
    slug: result.slug,
    planPath: result.planPath,
    planDir,
    lastGate: (result._state && result._state.lastGate) || null,
    // Engine version that wrote this state. Installs track the plugin (user-level
    // symlink), so a later --resume may run a newer engine; the resume path warns
    // on skew instead of hydrating silently. Absent on pre-1.5.0 state files.
    // Use ENGINE_VERSION (build-injected), not the meta export binding — the Workflow
    // sandbox does not bind `export const meta` at runtime (issue #17).
    engineVersion: ENGINE_VERSION,
    // IM-1: integrity checksum over the serialized result, verified by
    // validatePipelineState() on resume to detect a truncated chunked write.
    checksum: stateChecksum(JSON.stringify(result)),
    result,
    config,
  }
  return writeChunkedFile(statePath, JSON.stringify(payload, null, 2), 'file-writer:pipeline-state', result)
}

// Pure: compare a resumed state's engineVersion to the running engine. Returns
// {saved, current} when both are present and differ; otherwise null. Pre-1.5.0
// state files omit engineVersion and stay silent. Used by --resume (issue #17:
// must not read the meta export binding — sandbox leaves meta unbound).
function detectResumeEngineSkew(savedVersion, currentVersion) {
  if (savedVersion && savedVersion !== currentVersion) {
    return { saved: savedVersion, current: currentVersion }
  }
  return null
}

// Load <planDir>/pipeline-state.json for --resume. Returns { state: <obj|null> }
// via the file-reader agent; null if the file does not exist.
async function loadPipelineState(planDir) {
  const statePath = planDir.replace(/\/$/, '') + '/pipeline-state.json'
  return safeAgent(
    `You are a file-reader agent. Read ${statePath} and return its full JSON content parsed as an
object in the "state" field. If the file does not exist, return state=null.`,
    { label: 'file-reader:pipeline-state', phase: 'Checkpoint', schema: PIPELINE_STATE_READ, model: gm('todo') },
    null
  )
}


// Retain a last-good snapshot before each state write so resume can auto-recover
// from a truncated/partial chunked write. Before writing the new state, copies
// the current pipeline-state.json to pipeline-state.last-good.json via agent I/O.
// Non-blocking: a copy failure warns but does not prevent the new write.
async function flushPipelineStateWithSnapshot(planDir, result, config) {
  const lastGoodPath = planDir.replace(/\/$/, '') + '/pipeline-state.last-good.json'
  try {
    const current = await loadPipelineState(planDir)
    if (current && current.state) {
      await writeChunkedFile(
        lastGoodPath,
        JSON.stringify(current.state, null, 2),
        'file-writer:last-good',
        result
      )
    }
  } catch (e) {
    if (result && result.logLines) {
      result.logLines.push(`snapshot: last-good copy skipped (${String(e)})`)
    }
  }
  return flushPipelineState(planDir, result, config)
}

// Load pipeline state with auto-recovery from a last-good snapshot. If the
// primary state file fails validation (truncated/corrupt chunked write), the
// last-good snapshot is loaded and validated instead. Returns { state, recovered }
// where recovered=true signals the primary file was bypassed.
async function loadPipelineStateWithRecovery(planDir) {
  const loaded = await loadPipelineState(planDir)
  const state = loaded && loaded.state
  if (state) {
    const validation = validatePipelineState(state)
    if (validation.ok) {
      return { state, recovered: false }
    }
  }
  const lastGoodPath = planDir.replace(/\/$/, '') + '/pipeline-state.last-good.json'
  const lastGoodLoaded = await safeAgent(
    `You are a file-reader agent. Read ${lastGoodPath} and return its full JSON content parsed as an
object in the "state" field. If the file does not exist, return state=null.`,
    { label: 'file-reader:last-good', phase: 'Checkpoint', schema: PIPELINE_STATE_READ, model: gm('todo') },
    null
  )
  const lastGoodState = lastGoodLoaded && lastGoodLoaded.state
  if (lastGoodState) {
    const lastGoodValidation = validatePipelineState(lastGoodState)
    if (lastGoodValidation.ok) {
      return { state: lastGoodState, recovered: true }
    }
  }
  return { state: null, recovered: false }
}

async function verifyArtifactPresence({ path, gate, expectedHeadings, result, pathKey }) {
  if (!path || path === 'present') return { exists: !!path, sizeBytes: 0, hasExpectedHeadings: true, summary: 'not a file path' }
  // Deterministic verification via durable digest contract. An LLM file-reader's
  // self-reported existence cannot be trusted — a hallucinated claim could pass
  // a missing artifact. When a durable checkpoint recorded this artifact with a
  // digest, that is the authoritative verification and the LLM call is skipped.
  if (pathKey) {
    const digestResult = verifyArtifactDigest(result, pathKey)
    if (digestResult.verified) {
      return { exists: true, sizeBytes: 1, hasExpectedHeadings: true, summary: 'verified via durable digest checkpoint' }
    }
  }
  const headingLine = expectedHeadings && expectedHeadings.length
    ? `Also verify the file contains at least one of these headings/markers: ${expectedHeadings.join(', ')}.`
    : 'No specific heading marker is required.'
  const verdict = await safeAgent(
    `You are a file-reader agent. Verify the artifact file for gate "${gate}" exists at ${path}.
Read the file metadata/content just enough to answer:
- exists: true only if the file exists
- sizeBytes: approximate byte size; 0 if missing
- hasExpectedHeadings: true when the heading/marker expectation is met
${headingLine}
Return summary with the evidence. Do not modify files.`,
    { label: `artifact-check:${gate}`, phase: 'Checkpoint', schema: ARTIFACT_CHECK, model: gm('todo') },
    result
  )
  return verdict || { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'artifact check returned null' }
}

async function repairResumeArtifactFlags(result) {
  if (!result) return []
  const repairs = []
  const checkpoints = result._designCheckpoints || {}
  const digests = result._artifactDigests || {}

  // Map each artifact to its checkpoint gate name so digest-driven skip can
  // consult the durable checkpoint record. When a gate was durably
  // acknowledged and its artifact digest was recorded, the artifact was
  // verified at checkpoint time and the expensive LLM re-verification can be
  // skipped entirely on resume.
  const checkpointGateMap = ARTIFACT_CHECKPOINT_GATE_MAP
  const artifacts = [
    { pathKey: 'definitionPath', flags: ['_define'], gate: 'Define' },
    { pathKey: 'requirementsPath', flags: ['_requirements', '_reviewedRequirements'], gate: 'Requirements' },
    { pathKey: 'archPath', flags: ['_arch', '_reviewedArch'], gate: 'Architecture' },
    { pathKey: 'designPath', flags: ['_design', '_reviewedDesign'], gate: 'Detailed Design' },
    { pathKey: 'planPath', flags: ['planned', '_plan', '_reviewedPlan', 'planAccepted', 'tddEnforced', 'reconcile'], gate: 'Plan' },
  ].filter((a) =>
    !(a.pathKey === 'planPath' && !result.planned)
  )
  for (const artifact of artifacts) {
    const path = result[artifact.pathKey]
    if (!path) continue

    const cpGate = checkpointGateMap[artifact.pathKey]
    const cp = cpGate ? checkpoints[cpGate] : null
    const storedDigest = digests[artifact.pathKey]
    if (cp && cp.acknowledged && storedDigest) {
      continue
    }

    const checked = await verifyArtifactPresence({
      path,
      gate: `resume:${artifact.gate}`,
      expectedHeadings: ['#'],
      result,
      pathKey: artifact.pathKey,
    })
    if (checked.exists && checked.sizeBytes > 0 && checked.hasExpectedHeadings !== false) continue
    for (const flag of artifact.flags) {
      if (flag in result) result[flag] = null
    }
    result[artifact.pathKey] = null
    repairs.push(`${artifact.pathKey} (${artifact.gate})`)
  }
  if (repairs.length) {
    result.designReady = false
    result.ready = false
    result.executed = null
    result.testsPassed = false
    result.codeReview = null
    result._goalkeeper = null
  }
  return repairs
}

export { consolidate, writeChunkedFile, flushPipelineLog, stateChecksum, validatePipelineState, summarizeGates, deriveNextCommand, renderStatusReport, flushPipelineState, flushPipelineStateWithSnapshot, loadPipelineState, loadPipelineStateWithRecovery, verifyArtifactPresence, verifyArtifactDigest, repairResumeArtifactFlags, detectResumeEngineSkew }
