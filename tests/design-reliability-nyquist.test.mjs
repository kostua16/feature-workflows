// Phase 11 Nyquist validation gap-fillers for DTRANS-01, DVERIFY-01, DTEST-01.
// Supplements design-reliability.test.mjs with additional behavioral dimensions
// required by the Nyquist sampling rate: untested error patterns, classification
// priority, fatal-error no-retry path, retry reclassification, degradation journal
// structure, digest-priority edges, and wiring source assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  classifyAgentError,
  TRANSIENT_RETRY_MAX,
  verifyArtifactDigest,
  verifyAppendGrowth,
  flexibleAgent,
  computeContentDigest,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ============================================================
// DTRANS-01: Additional transient error pattern coverage
// ============================================================

test('NYQUIST DTRANS-01: classifyAgentError detects "temporarily" keyword as transient', () => {
  assert.equal(classifyAgentError('service temporarily unavailable'), 'transient')
})

test('NYQUIST DTRANS-01: classifyAgentError detects 502 Bad Gateway as transient', () => {
  assert.equal(classifyAgentError('502 Bad Gateway'), 'transient')
})

test('NYQUIST DTRANS-01: classifyAgentError detects "service unavailable" as transient', () => {
  assert.equal(classifyAgentError('service unavailable'), 'transient')
})

test('NYQUIST DTRANS-01: classifyAgentError detects socket hang up as transient', () => {
  assert.equal(classifyAgentError('socket hang up ECONNRESET'), 'transient')
})

// ============================================================
// DTRANS-01: Classification priority edge cases
// ============================================================

test('NYQUIST DTRANS-01: schema classification takes priority over transient in classifyAgentError', () => {
  // An error message containing both schema and network keywords should classify
  // as schema because classifyAgentError checks the schema regex first.
  assert.equal(classifyAgentError('schema validation failed during network call'), 'schema')
  assert.equal(classifyAgentError('StructuredOutput error: connection timeout'), 'schema')
})

test('NYQUIST DTRANS-01: classifyAgentError handles numeric-only error strings', () => {
  assert.equal(classifyAgentError('429'), 'transient')
  assert.equal(classifyAgentError('503'), 'transient')
  assert.equal(classifyAgentError('502'), 'transient')
})

test('NYQUIST DTRANS-01: classifyAgentError handles mixed-case patterns', () => {
  assert.equal(classifyAgentError('NETWORK TIMEOUT'), 'transient')
  assert.equal(classifyAgentError('Connection Reset'), 'transient')
  assert.equal(classifyAgentError('RATE LIMIT EXCEEDED'), 'transient')
})

// ============================================================
// DTRANS-01: Fatal error behavioral path (no retry)
// ============================================================

test('NYQUIST DTRANS-01: flexibleAgent with fatal error returns null without retrying', async () => {
  const originalAgent = globalThis.agent
  let callCount = 0
  globalThis.agent = async () => {
    callCount++
    throw new Error('unexpected reference error in agent logic')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-fatal', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.equal(out, null, 'fatal error should return null')
    assert.equal(callCount, 1, 'agent should be called exactly once — no retries for fatal errors')
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTRANS-01: fatal error does not create retry degradation entries', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('unexpected fatal error')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-fatal-no-retry', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.ok(
      !result._degradationLog || result._degradationLog.length === 0,
      'no retry degradation entries should be created for fatal errors'
    )
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTRANS-01: fatal error pushes warning to logLines', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('catastrophic failure')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-fatal-log', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    const warningLine = result.logLines.find((l) => l.includes('threw (caught)') && l.includes('catastrophic failure'))
    assert.ok(warningLine, 'a warning log line should be pushed for fatal errors')
  } finally {
    globalThis.agent = originalAgent
  }
})

// ============================================================
// DTRANS-01: Transient retry reclassification behavior
// ============================================================

test('NYQUIST DTRANS-01: transient retry stops when error reclassifies as fatal', async () => {
  const originalAgent = globalThis.agent
  let callCount = 0
  globalThis.agent = async () => {
    callCount++
    if (callCount === 1) throw new Error('network timeout')
    // Second call (retry attempt 1) throws a fatal error
    throw new Error('unexpected null reference')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-reclassify', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.equal(out, null, 'should return null after reclassification to fatal')
    assert.equal(callCount, 2, 'should stop after 1 retry attempt — fatal reclassification stops the loop')
    // Should have exactly 1 retry degradation entry (the attempt before reclassification)
    assert.ok(result._degradationLog, 'degradation log should exist')
    const retryEntries = result._degradationLog.filter((e) => e.type === 'retry')
    assert.equal(retryEntries.length, 1, 'exactly 1 retry entry before reclassification')
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTRANS-01: transient retry stops when error reclassifies as schema', async () => {
  const originalAgent = globalThis.agent
  let callCount = 0
  globalThis.agent = async () => {
    callCount++
    if (callCount === 1) throw new Error('connection timeout')
    throw new Error('StructuredOutput schema validation failed')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-reclassify-schema', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.equal(out, null, 'should return null after reclassification to schema')
    assert.equal(callCount, 2, 'should stop after 1 retry — schema reclassification stops the loop')
    // Verify the reclassification log line was pushed
    const reclassLog = result.logLines.find((l) => l.includes('reclassified as schema'))
    assert.ok(reclassLog, 'should log the reclassification reason')
  } finally {
    globalThis.agent = originalAgent
  }
})

// ============================================================
// DTRANS-01: Degradation journal structure verification
// ============================================================

test('NYQUIST DTRANS-01: transient retry degradation entries have correct structure', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('503 Service Unavailable')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-structure', phase: 'Checkpoint', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.ok(result._degradationLog, 'degradation log should exist')
    assert.equal(result._degradationLog.length, TRANSIENT_RETRY_MAX, 'exactly TRANSIENT_RETRY_MAX retry entries')
    for (const entry of result._degradationLog) {
      assert.equal(typeof entry.seq, 'number', 'entry must have numeric seq')
      assert.equal(entry.type, 'retry', 'entry type must be retry')
      assert.equal(entry.gate, 'Checkpoint', 'entry gate must match opts.phase')
      assert.equal(entry.label, 'test-structure', 'entry label must match opts.label')
      assert.ok(entry.reason.includes('transient error retry'), 'entry reason must include retry context')
    }
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTRANS-01: transient retry degradation entries are sequentially numbered', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('network error')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-seq', phase: 'Test', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    const seqs = result._degradationLog.map((e) => e.seq)
    assert.deepEqual(seqs, [1, 2, 3], 'entries must be numbered 1, 2, 3')
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTRANS-01: transient retry log lines include backoff delay value', async () => {
  const originalAgent = globalThis.agent
  let firstCall = true
  globalThis.agent = async () => {
    if (firstCall) {
      firstCall = false
      throw new Error('network timeout')
    }
    return { accepted: true }
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-delay-log', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    const retryLog = result.logLines.find((l) => l.includes('500ms backoff'))
    assert.ok(retryLog, 'first retry log line should include 500ms base delay')
  } finally {
    globalThis.agent = originalAgent
  }
})

// ============================================================
// DTRANS-01: Source assertions for control flow
// ============================================================

test('NYQUIST DTRANS-01: schemaFailed is checked before classifyAgentError in flexibleAgent', () => {
  const schemaIdx = source.indexOf('schemaFailed')
  const classifyIdx = source.indexOf('classifyAgentError(originalError)')
  assert.ok(schemaIdx > 0 && classifyIdx > 0, 'both patterns must exist in source')
  assert.ok(schemaIdx < classifyIdx, 'schemaFailed must be checked before classifyAgentError')
})

test('NYQUIST DTRANS-01: flexibleAgent passes effectivePrompt to retryTransientError', () => {
  assert.ok(
    source.includes('retryTransientError(effectivePrompt'),
    'retryTransientError must receive effectivePrompt (hardened), not raw prompt'
  )
})

test('NYQUIST DTRANS-01: retryTransientError uses callAgentWithWatchdog not raw agent()', () => {
  const fnBody = source.match(/async function retryTransientError[\s\S]*?\n}/)
  assert.ok(fnBody, 'retryTransientError body must exist')
  assert.ok(fnBody[0].includes('callAgentWithWatchdog'), 'must use callAgentWithWatchdog for timeout safety')
})

// ============================================================
// DVERIFY-01: verifyArtifactDigest edge cases
// ============================================================

test('NYQUIST DVERIFY-01: verifyArtifactDigest with empty result object returns no-checkpoint', () => {
  const r = verifyArtifactDigest({}, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-checkpoint')
})

test('NYQUIST DVERIFY-01: verifyArtifactDigest with acknowledged checkpoint but empty-string digest returns no-digest', () => {
  const result = {
    _designCheckpoints: { define: { acknowledged: true } },
    _artifactDigests: { definitionPath: '' },
  }
  const r = verifyArtifactDigest(result, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-digest')
})

test('NYQUIST DVERIFY-01: verifyArtifactDigest returns correct digest value on success', () => {
  const expectedDigest = 'sha256:abc123def456'
  const result = {
    _designCheckpoints: { plan: { acknowledged: true } },
    _artifactDigests: { planPath: expectedDigest },
  }
  const r = verifyArtifactDigest(result, 'planPath')
  assert.equal(r.digest, expectedDigest, 'must return the actual digest value')
})

test('NYQUIST DVERIFY-01: verifyArtifactDigest with undefined _designCheckpoints and _artifactDigests', () => {
  const r = verifyArtifactDigest({ foo: 'bar' }, 'definitionPath')
  assert.equal(r.verified, false)
  assert.equal(r.reason, 'no-checkpoint')
})

// ============================================================
// DVERIFY-01: verifyAppendGrowth multi-path and priority
// ============================================================

test('NYQUIST DVERIFY-01: verifyAppendGrowth tracks multiple paths independently', () => {
  const result = {}
  // Path A: first write
  const a1 = verifyAppendGrowth(result, 'path-a', { content: 'content-a-v1' })
  assert.equal(a1.ok, true)
  assert.equal(a1.reason, 'digest-first-write')

  // Path B: first write (independent of path A)
  const b1 = verifyAppendGrowth(result, 'path-b', { content: 'content-b-v1' })
  assert.equal(b1.ok, true)
  assert.equal(b1.reason, 'digest-first-write')

  // Path A: second write (changed)
  const a2 = verifyAppendGrowth(result, 'path-a', { content: 'content-a-v2' })
  assert.equal(a2.ok, true)
  assert.equal(a2.reason, 'digest-grew')

  // Path B: second write (unchanged — should detect overwrite)
  const b2 = verifyAppendGrowth(result, 'path-b', { content: 'content-b-v1' })
  assert.equal(b2.ok, false)
  assert.equal(b2.reason, 'digest-unchanged')
})

test('NYQUIST DVERIFY-01: verifyAppendGrowth uses content digest when both content and totalBytes present', () => {
  const result = {}
  // First write with both content and totalBytes — content path should win
  const r1 = verifyAppendGrowth(result, 'dual-path', { content: 'hello', totalBytes: 5 })
  assert.equal(r1.reason, 'digest-first-write')
  assert.ok(result._appendDigests['dual-path'], 'digest should be stored')
  // totalBytes should NOT be stored when content path is taken
  assert.equal(result._appendSizes['dual-path'], undefined, 'byte count should not be stored when content is used')
})

test('NYQUIST DVERIFY-01: verifyAppendGrowth with empty-string content uses digest path', () => {
  const result = {}
  const r = verifyAppendGrowth(result, 'empty-content', { content: '' })
  // content != null is true for empty string, so digest path is used
  assert.equal(r.ok, true)
  assert.equal(r.reason, 'digest-first-write')
  assert.ok(result._appendDigests['empty-content'], 'digest should be computed for empty content')
})

test('NYQUIST DVERIFY-01: verifyAppendGrowth digest-unchanged pushes to appendWarnings', () => {
  const result = {}
  verifyAppendGrowth(result, 'warn-path', { content: 'same' })
  verifyAppendGrowth(result, 'warn-path', { content: 'same' })
  assert.ok(result.appendWarnings, 'appendWarnings should exist')
  assert.ok(
    result.appendWarnings.some((w) => w.includes('warn-path') && w.includes('unchanged')),
    'warning should mention the path and unchanged content'
  )
})

test('NYQUIST DVERIFY-01: verifyAppendGrowth byte-count fallback does not create _appendDigests', () => {
  const result = {}
  verifyAppendGrowth(result, 'byte-only', { totalBytes: 100 })
  assert.ok(!result._appendDigests, '_appendDigests should not be created when using byte-count fallback')
  assert.equal(result._appendSizes['byte-only'], 100, 'byte count should be stored')
})

test('NYQUIST DVERIFY-01: verifyAppendGrowth switching from byte-count to content mid-stream', () => {
  const result = {}
  // First ack: byte count only
  const r1 = verifyAppendGrowth(result, 'switch-path', { totalBytes: 50 })
  assert.equal(r1.ok, true)
  // Second ack: content provided — should use digest path
  const r2 = verifyAppendGrowth(result, 'switch-path', { content: 'now with content', totalBytes: 100 })
  assert.equal(r2.ok, true)
  assert.equal(r2.reason, 'digest-first-write', 'first content write should be treated as digest-first-write')
  assert.ok(result._appendDigests['switch-path'], 'digest should now be tracked')
})

// ============================================================
// DVERIFY-01: Digest computation consistency
// ============================================================

test('NYQUIST DVERIFY-01: computeContentDigest is deterministic for same input', () => {
  const d1 = computeContentDigest('test content')
  const d2 = computeContentDigest('test content')
  assert.equal(d1, d2, 'same content must produce same digest')
})

test('NYQUIST DVERIFY-01: computeContentDigest differs for different input', () => {
  const d1 = computeContentDigest('content-a')
  const d2 = computeContentDigest('content-b')
  assert.notEqual(d1, d2, 'different content must produce different digests')
})

// ============================================================
// DTEST-01: Wiring source assertions
// ============================================================

test('NYQUIST DTEST-01: safeAgent delegates to flexibleAgent', () => {
  assert.ok(
    source.includes('async function safeAgent') && source.includes('return flexibleAgent(prompt, opts, result)'),
    'safeAgent must delegate to flexibleAgent'
  )
})

test('NYQUIST DTEST-01: verifyArtifactPresence LLM fallback path uses safeAgent', () => {
  // The LLM file-reader call inside verifyArtifactPresence must use safeAgent (not raw agent)
  const fnBody = source.match(/async function verifyArtifactPresence[\s\S]*?\n}/)
  assert.ok(fnBody, 'verifyArtifactPresence body must exist')
  assert.ok(fnBody[0].includes('safeAgent'), 'LLM path must use safeAgent')
})

test('NYQUIST DTEST-01: repairResumeArtifactFlags passes pathKey to verifyArtifactPresence', () => {
  const fnBody = source.match(/function repairResumeArtifactFlags[\s\S]*?\n}/)
  assert.ok(fnBody, 'repairResumeArtifactFlags body must exist')
  assert.ok(fnBody[0].includes('pathKey'), 'must pass pathKey to verifyArtifactPresence')
})

test('NYQUIST DTEST-01: ARTIFACT_CHECKPOINT_GATE_MAP is referenced by repairResumeArtifactFlags', () => {
  const fnBody = source.match(/function repairResumeArtifactFlags[\s\S]*?\n}/)
  assert.ok(fnBody, 'repairResumeArtifactFlags body must exist')
  assert.ok(
    fnBody[0].includes('ARTIFACT_CHECKPOINT_GATE_MAP') || fnBody[0].includes('checkpointGateMap'),
    'repairResumeArtifactFlags must use the shared gate map'
  )
})

test('NYQUIST DTEST-01: flexibleAgent catch block has both schema and transient branches', () => {
  assert.ok(
    source.includes('schemaFailed') && source.includes("errorClass === 'transient'"),
    'catch block must have distinct schema and transient branches'
  )
})

test('NYQUIST DTEST-01: flexibleAgent catch block has fatal else branch', () => {
  // The non-transient, non-schema path must exist and return null
  assert.ok(
    source.includes('threw (caught)') && source.includes('converting to null (graceful degradation)'),
    'fatal error path must log and return null'
  )
})

test('NYQUIST DTEST-01: retryTransientError catch block reclassifies errors', () => {
  const fnBody = source.match(/async function retryTransientError[\s\S]*?\n}/)
  assert.ok(fnBody, 'retryTransientError body must exist')
  assert.ok(
    fnBody[0].includes('classifyAgentError(msg)') && fnBody[0].includes('errorClass !== ' + "'transient'"),
    'retry catch block must reclassify errors and stop on non-transient'
  )
})

test('NYQUIST DTEST-01: exponential backoff formula present in retryTransientError', () => {
  const fnBody = source.match(/async function retryTransientError[\s\S]*?\n}/)
  assert.ok(fnBody, 'retryTransientError body must exist')
  assert.ok(
    fnBody[0].includes('Math.pow(2, attempt - 1)'),
    'backoff must use exponential formula: base * 2^(attempt-1)'
  )
})

// ============================================================
// DTEST-01: Behavioral interaction assertions
// ============================================================

test('NYQUIST DTEST-01: transient retry entries in degradation log have non-empty reason', async () => {
  const originalAgent = globalThis.agent
  globalThis.agent = async () => {
    throw new Error('ETIMEDOUT connection timed out')
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-reason', phase: 'Design', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    for (const entry of result._degradationLog) {
      assert.ok(entry.reason.length > 0, 'reason field must not be empty')
      assert.ok(entry.reason.includes('ETIMEDOUT'), 'reason must include the original error message')
    }
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTEST-01: transient retry bumpGateTelemetry records retry events', async () => {
  const originalAgent = globalThis.agent
  let firstCall = true
  globalThis.agent = async () => {
    if (firstCall) {
      firstCall = false
      throw new Error('network timeout')
    }
    return { accepted: true }
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    await flexibleAgent(
      'test prompt',
      { label: 'test-telemetry', phase: 'Verify', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.ok(result.gateTelemetry, 'gateTelemetry should exist')
    assert.ok(result.gateTelemetry['Verify'], 'Verify gate bucket should exist')
    assert.ok(
      result.gateTelemetry['Verify'].retries >= 1,
      'at least 1 retry should be counted in telemetry'
    )
  } finally {
    globalThis.agent = originalAgent
  }
})

test('NYQUIST DTEST-01: flexibleAgent successful retry does not create degradation fallback entries', async () => {
  const originalAgent = globalThis.agent
  let firstCall = true
  globalThis.agent = async () => {
    if (firstCall) {
      firstCall = false
      throw new Error('connection reset')
    }
    return { accepted: true }
  }
  try {
    const result = { logLines: [], agentFailures: {} }
    const out = await flexibleAgent(
      'test prompt',
      { label: 'test-clean-retry', schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
      result
    )
    assert.ok(out, 'should return a result')
    // Retry entries are expected, but NO fallback entries should exist
    const fallbackEntries = (result._degradationLog || []).filter((e) => e.type === 'fallback')
    assert.equal(fallbackEntries.length, 0, 'no fallback entries on successful retry')
    // agentFailures should not track this agent
    assert.equal(Object.keys(result.agentFailures).length, 0, 'no agentFailures on successful retry')
  } finally {
    globalThis.agent = originalAgent
  }
})
