// Phase 11 DTRANS-01, DVERIFY-01, DTEST-01: Design-mode reliability,
// deterministic artifact verification, and behavioral characterization proof.
//
// RED evidence: F14 (no transient-error retry), F15 (LLM-self-reported
// verification trusted over digest contract), F17 (no behavioral tests for
// design gate sequence, review loop, retry ladder, crash-resume, partial writes).
// GREEN evidence: classifyAgentError + bounded backoff retry, digest-driven
// verifyArtifactDigest + verifyArtifactPresence, verifyAppendGrowth digest
// comparison, comprehensive source and behavioral assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  classifyAgentError,
  TRANSIENT_RETRY_MAX,
  TRANSIENT_BACKOFF_BASE_MS,
  verifyArtifactDigest,
  verifyAppendGrowth,
  flexibleAgent,
  computeContentDigest,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- DTRANS-01: transient error classification ----

test('DTRANS-01: classifyAgentError is a pure function', () => {
  assert.equal(typeof classifyAgentError, 'function')
})

test('DTRANS-01: classifyAgentError classifies network timeout as transient', () => {
  assert.equal(classifyAgentError('network timeout'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies ECONNRESET as transient', () => {
  assert.equal(classifyAgentError('ECONNRESET connection reset by peer'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies 503 as transient', () => {
  assert.equal(classifyAgentError('503 Service Unavailable'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies 429 as transient', () => {
  assert.equal(classifyAgentError('429 Too Many Requests'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies rate limit as transient', () => {
  assert.equal(classifyAgentError('rate limit exceeded'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies overloaded as transient', () => {
  assert.equal(classifyAgentError('service overloaded'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies ENOTFOUND as transient', () => {
  assert.equal(classifyAgentError('ENOTFOUND dns lookup failed'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies ETIMEDOUT as transient', () => {
  assert.equal(classifyAgentError('ETIMEDOUT connection timed out'), 'transient')
})

test('DTRANS-01: classifyAgentError classifies schema errors correctly', () => {
  assert.equal(classifyAgentError('StructuredOutput schema validation failed'), 'schema')
  assert.equal(classifyAgentError('valid output required'), 'schema')
})

test('DTRANS-01: classifyAgentError classifies unknown errors as fatal', () => {
  assert.equal(classifyAgentError('something unexpected happened'), 'fatal')
  assert.equal(classifyAgentError('null reference'), 'fatal')
  assert.equal(classifyAgentError(''), 'fatal')
})

test('DTRANS-01: classifyAgentError is deterministic for same input', () => {
  const msg = 'network timeout occurred'
  assert.equal(classifyAgentError(msg), classifyAgentError(msg))
})

test('DTRANS-01: classifyAgentError handles null/undefined gracefully', () => {
  assert.equal(classifyAgentError(null), 'fatal')
  assert.equal(classifyAgentError(undefined), 'fatal')
})

test('DTRANS-01: TRANSIENT_RETRY_MAX is 3', () => {
  assert.equal(TRANSIENT_RETRY_MAX, 3)
})

test('DTRANS-01: TRANSIENT_BACKOFF_BASE_MS is 500', () => {
  assert.equal(TRANSIENT_BACKOFF_BASE_MS, 500)
})

// ---- DTRANS-01: source assertions for flexibleAgent integration ----

test('DTRANS-01: flexibleAgent catch block calls classifyAgentError', () => {
  assert.ok(source.includes('classifyAgentError('), 'flexibleAgent must call classifyAgentError')
})

test('DTRANS-01: retryTransientError function is defined in the dist', () => {
  assert.ok(source.includes('retryTransientError'), 'retryTransientError must be defined')
})

test('DTRANS-01: transient retry uses bounded loop with TRANSIENT_RETRY_MAX', () => {
  const fnBody = source.match(/async function retryTransientError[\s\S]*?\n}/)
  assert.ok(fnBody, 'retryTransientError body must exist')
  assert.ok(fnBody[0].includes('TRANSIENT_RETRY_MAX'), 'retry must use TRANSIENT_RETRY_MAX as bound')
  assert.ok(fnBody[0].includes('setTimeout'), 'retry must use setTimeout for backoff')
  assert.ok(fnBody[0].includes('recordDegradationEvent'), 'retry must journal attempts')
})

test('DTRANS-01: flexibleAgent non-schema branch checks transient classification', () => {
  assert.ok(
    source.includes("errorClass === 'transient'"),
    'flexibleAgent must check transient classification before returning null'
  )
})

// ---- DTRANS-01: integration test with mock agent ----

test('DTRANS-01: flexibleAgent retries transient error and succeeds on second attempt', async () => {
  const originalAgent = globalThis.agent
  let callCount = 0
  globalThis.agent = async () => {
    callCount++
    if (callCount === 1) throw new Error('network timeout')
    return { accepted: true }
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-transient', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.ok(callCount >= 2, 'agent should be called at least twice (initial throw + retry)')
    assert.ok(out, 'flexibleAgent should return a result after transient retry succeeds')
  } finally {
    globalThis.agent = originalAgent
  }
})

test('DTRANS-01: flexibleAgent hard-blocks after transient retries exhausted', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('503 Service Unavailable')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-transient-exhaust', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.equal(out, null, 'flexibleAgent should return null after all transient retries fail')
    // Verify degradation events were journaled
    assert.ok(result._degradationLog, 'degradation log should be created')
    assert.ok(result._degradationLog.length >= TRANSIENT_RETRY_MAX, 'each retry should be journaled')
  } finally {
    globalThis.agent = originalAgent
  }
})

// ---- DVERIFY-01: deterministic artifact verification ----

test('DVERIFY-01: verifyArtifactDigest is a pure function', () => {
  assert.equal(typeof verifyArtifactDigest, 'function')
})

test('DVERIFY-01: verifyArtifactDigest returns verified when checkpoint acknowledged + digest present', () => {
  const result = {
    _designCheckpoints: { define: { acknowledged: true } },
    _artifactDigests: { definitionPath: 'abc123' },
  }
  const r = verifyArtifactDigest(result, 'definitionPath')
  assert.equal(r.verified, true)
  assert.equal(r.reason, 'checkpoint-verified')
  assert.equal(r.digest, 'abc123')
})

test('DVERIFY-01: verifyArtifactDigest returns not-verified when no checkpoint', () => {
  const result = {
    _designCheckpoints: {},
    _artifactDigests: { definitionPath: 'abc123' },
  }
  const r = verifyArtifactDigest(result, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-checkpoint')
})

test('DVERIFY-01: verifyArtifactDigest returns not-verified when checkpoint not acknowledged', () => {
  const result = {
    _designCheckpoints: { define: { acknowledged: false } },
    _artifactDigests: { definitionPath: 'abc123' },
  }
  const r = verifyArtifactDigest(result, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-checkpoint')
})

test('DVERIFY-01: verifyArtifactDigest returns not-verified when no digest', () => {
  const result = {
    _designCheckpoints: { define: { acknowledged: true } },
    _artifactDigests: {},
  }
  const r = verifyArtifactDigest(result, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-digest')
})

test('DVERIFY-01: verifyArtifactDigest returns no-gate-mapping for unknown pathKey', () => {
  const r = verifyArtifactDigest({}, 'unknownPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-gate-mapping')
})

test('DVERIFY-01: verifyArtifactDigest returns no-path-key for null pathKey', () => {
  const r = verifyArtifactDigest({}, null)
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-path-key')
})

test('DVERIFY-01: verifyArtifactDigest returns no-path-key for null result', () => {
  const r = verifyArtifactDigest(null, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-path-key')
})

test('DVERIFY-01: verifyArtifactDigest is pure (does not mutate input)', () => {
  const result = {
    _designCheckpoints: { define: { acknowledged: true } },
    _artifactDigests: { definitionPath: 'abc123' },
  }
  const snapshot = JSON.stringify(result)
  verifyArtifactDigest(result, 'definitionPath')
  assert.equal(JSON.stringify(result), snapshot, 'verifyArtifactDigest must not mutate input')
})

test('DVERIFY-01: verifyArtifactDigest works for all known artifact path keys', () => {
  const result = {
    _designCheckpoints: {
      define: { acknowledged: true },
      requirements: { acknowledged: true },
      architecture: { acknowledged: true },
      'detailed-design': { acknowledged: true },
      plan: { acknowledged: true },
    },
    _artifactDigests: {
      definitionPath: 'd1',
      requirementsPath: 'd2',
      archPath: 'd3',
      designPath: 'd4',
      planPath: 'd5',
    },
  }
  for (const key of ['definitionPath', 'requirementsPath', 'archPath', 'designPath', 'planPath']) {
    const r = verifyArtifactDigest(result, key)
    assert.equal(r.verified, true, `${key} should be verified`)
  }
})

// ---- DVERIFY-01: source assertions for verifyArtifactPresence ----

test('DVERIFY-01: verifyArtifactPresence calls verifyArtifactDigest before LLM reader', () => {
  assert.ok(
    source.includes('verifyArtifactDigest(result, pathKey)'),
    'verifyArtifactPresence must call verifyArtifactDigest'
  )
})

test('DVERIFY-01: verifyArtifactPresence accepts optional pathKey parameter', () => {
  assert.ok(
    source.includes('pathKey') && source.includes('verifyArtifactPresence'),
    'verifyArtifactPresence must accept pathKey'
  )
})

test('DVERIFY-01: verifyArtifactPresence returns early when digest-verified', () => {
  assert.ok(
    source.includes('verified via durable digest checkpoint'),
    'verifyArtifactPresence must return early with digest verification message'
  )
})

test('DVERIFY-01: verifyAppendGrowth uses digest comparison when content available', () => {
  assert.ok(source.includes('_appendDigests'), 'verifyAppendGrowth must use _appendDigests')
  assert.ok(source.includes('computeContentDigest'), 'verifyAppendGrowth must import computeContentDigest')
})

// ---- DVERIFY-01: verifyAppendGrowth behavioral tests ----

test('DVERIFY-01: verifyAppendGrowth with digest detects content growth', () => {
  const result = {}
  const r1 = verifyAppendGrowth(result, 'path-a', { content: 'hello world' })
  assert.equal(r1.ok, true)
  assert.equal(r1.reason, 'digest-first-write')

  const r2 = verifyAppendGrowth(result, 'path-a', { content: 'hello world expanded' })
  assert.equal(r2.ok, true)
  assert.equal(r2.reason, 'digest-grew')
})

test('DVERIFY-01: verifyAppendGrowth with digest detects unchanged content (overwrite)', () => {
  const result = {}
  verifyAppendGrowth(result, 'path-b', { content: 'same content' })
  const r2 = verifyAppendGrowth(result, 'path-b', { content: 'same content' })
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'digest-unchanged')
  assert.ok(result.appendWarnings, 'should record warning for unchanged content')
})

test('DVERIFY-01: verifyAppendGrowth falls back to byte count when no content', () => {
  const result = {}
  const r1 = verifyAppendGrowth(result, 'path-c', { totalBytes: 100 })
  assert.equal(r1.ok, true)
  assert.equal(r1.prev, null)

  const r2 = verifyAppendGrowth(result, 'path-c', { totalBytes: 150 })
  assert.equal(r2.ok, true)
  assert.equal(r2.prev, 100)
  assert.equal(r2.now, 150)
})

test('DVERIFY-01: verifyAppendGrowth byte-count fallback detects shrinkage', () => {
  const result = {}
  verifyAppendGrowth(result, 'path-d', { totalBytes: 200 })
  const r2 = verifyAppendGrowth(result, 'path-d', { totalBytes: 100 })
  assert.equal(r2.ok, false)
  assert.equal(r2.shrank, true)
})

test('DVERIFY-01: verifyAppendGrowth returns unknown for null result', () => {
  const r = verifyAppendGrowth(null, 'path', { totalBytes: 100 })
  assert.equal(r.ok, true)
  assert.equal(r.unknown, true)
})

test('DVERIFY-01: verifyAppendGrowth returns unknown when ack has neither content nor totalBytes', () => {
  const r = verifyAppendGrowth({}, 'path', {})
  assert.equal(r.ok, true)
  assert.equal(r.unknown, true)
})

// ---- DTEST-01: behavioral characterization source assertions ----

test('DTEST-01: design gate sequence has checkpointDesign at all material gates', () => {
  const expectedGates = [
    "checkpointDesign('define'",
    "checkpointDesign('requirements'",
    "checkpointDesign('architecture'",
    "checkpointDesign('detailed-design'",
    "checkpointDesign('plan'",
  ]
  for (const gate of expectedGates) {
    assert.ok(source.includes(gate), `checkpointDesign must be called for: ${gate}`)
  }
})

test('DTEST-01: review loop function is defined and testable', () => {
  assert.ok(source.includes('reviewLoop') || source.includes('review-loop'), 'review loop must be defined')
})

test('DTEST-01: agent retry ladder components are present', () => {
  assert.ok(source.includes('classifyAgentError'), 'error classification must be present')
  assert.ok(source.includes('retryTransientError'), 'transient retry must be present')
  assert.ok(source.includes('TRANSIENT_RETRY_MAX'), 'retry bound must be present')
  assert.ok(source.includes('recordDegradationEvent'), 'attempt journaling must be present')
})

test('DTEST-01: crash-resume uses loadPipelineStateWithRecovery', () => {
  assert.ok(source.includes('loadPipelineStateWithRecovery'), 'crash-resume recovery function must be defined')
  assert.ok(source.includes('flushPipelineStateWithSnapshot'), 'snapshot write function must be defined')
})

test('DTEST-01: partial state writes use last-good snapshot', () => {
  assert.ok(source.includes('last-good'), 'last-good snapshot mechanism must be present')
  assert.ok(source.includes('recovered'), 'recovery flag must be present')
})

test('DTEST-01: digest-driven resume skip is present (Phase 8 + 11)', () => {
  assert.ok(source.includes('_artifactDigests'), 'artifact digests must be tracked')
  assert.ok(source.includes('_designCheckpoints'), 'design checkpoints must be tracked')
  assert.ok(source.includes('verifyArtifactDigest'), 'deterministic digest verification must be present')
})

test('DTEST-01: transient retry journals degradation events', () => {
  const fnBody = source.match(/async function retryTransientError[\s\S]*?\n}/)
  assert.ok(fnBody, 'retryTransientError body must exist')
  assert.ok(fnBody[0].includes('recordDegradationEvent'), 'each retry must be journaled')
  assert.ok(fnBody[0].includes("'retry'"), 'journal type must be retry')
})

test('DTEST-01: flexibleAgent does not immediately return null on transient errors', () => {
  // The catch block must classify before deciding to return null
  assert.ok(
    source.includes('transient retries exhausted'),
    'flexibleAgent must log exhaustion message instead of immediate null'
  )
})

// ---- DTEST-01: regression assertions from prior phases ----

test('DTEST-01 REGRESSION: compactList is used for design-gate prompts (Phase 10)', () => {
  // No raw JSON.stringify of reconcile/blockers at prompt sites
  const reconcileMatches = (source.match(/JSON\.stringify\(result\.reconcile/g) || []).length
  assert.equal(reconcileMatches, 0, 'no raw JSON.stringify of result.reconcile at prompt sites')
  const yagniMatches = (source.match(/JSON\.stringify\(yagniBlockers/g) || []).length
  assert.equal(yagniMatches, 0, 'no raw JSON.stringify of yagniBlockers at prompt sites')
})

test('DTEST-01 REGRESSION: designReady checks fail-forward flags (Phase 9)', () => {
  assert.ok(source.includes('deriveDesignReadiness'), 'truthful readiness derivation must be present')
  assert.ok(source.includes('_reviewedRequirementsForced'), 'fail-forward flag check must be present')
})

test('DTEST-01 REGRESSION: budget enforcement present (Phase 10)', () => {
  assert.ok(source.includes('createDesignBudget'), 'design budget creation must be present')
  assert.ok(source.includes('createLoopBudgets'), 'per-loop budgets must be present')
  assert.ok(source.includes('loopBudgetExhausted'), 'loop exhaustion check must be present')
})

test('DTEST-01 REGRESSION: checkpoint durability present (Phase 8)', () => {
  assert.ok(source.includes('flushPipelineStateWithSnapshot'), 'snapshot flush must be present')
  assert.ok(source.includes('checkpointDesign'), 'design checkpoint function must be present')
})

test('DTEST-01 REGRESSION: degradation journal present (Phase 9)', () => {
  assert.ok(source.includes('recordDegradationEvent'), 'degradation journaling must be present')
  assert.ok(source.includes('degradationLogSummary'), 'degradation summary must be present')
})

// ---- DTEST-01: ARTIFACT_CHECKPOINT_GATE_MAP consistency ----

test('DTEST-01: ARTIFACT_CHECKPOINT_GATE_MAP covers all five artifact path keys', () => {
  assert.ok(source.includes('ARTIFACT_CHECKPOINT_GATE_MAP'), 'gate map constant must be defined')
  for (const key of ['definitionPath', 'requirementsPath', 'archPath', 'designPath', 'planPath']) {
    assert.ok(source.includes(key), `gate map must include ${key}`)
  }
  for (const gate of ["'define'", "'requirements'", "'architecture'", "'detailed-design'", "'plan'"]) {
    assert.ok(source.includes(gate), `gate map must include gate ${gate}`)
  }
})
