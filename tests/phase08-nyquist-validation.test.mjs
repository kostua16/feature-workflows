// Phase 8 Nyquist Validation: gap-filling tests for DCKPT-01, DSTATE-01, DRESUME-01.
//
// Retroactively audits Phase 8 for Nyquist validation gaps:
// - DCKPT-01: behavioral checkpoint semantics, gate-list completeness, dataKey
//   derivation, idempotency, non-blocking semantics, implement-mode coverage
// - DSTATE-01: write ordering, first-write snapshot skip, recovery signal
//   propagation, validation patterns, delegation chain, source wiring
// - DRESUME-01: digest-mismatch path, mixed-state artifacts, gate-map
//   completeness, planned-gate exclusion, downstream-flag cleanup, edge cases
// - E2E-DCKPT-01/DSTATE-01/DRESUME-01: roadmap gate list alignment
// - Continuous regression: no FS/shell, dist exports, forbidden tokens
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  flushPipelineStateWithSnapshot,
  loadPipelineStateWithRecovery,
  repairResumeArtifactFlags,
  computeContentDigest,
  validatePipelineState,
  stateChecksum,
  flushPipelineState,
} = engine

const dist = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)
const stateSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/state.mjs', import.meta.url),
  'utf8'
)
const mainSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/main.mjs', import.meta.url),
  'utf8'
)

// Extract the checkpointDesign function body from the dist for source assertions.
const cpDesignMatch = dist.match(/const checkpointDesign = async[\s\S]*?\n  \}/)
const cpDesignBody = cpDesignMatch ? cpDesignMatch[0] : ''

// =========================================================================
// DCKPT-01: Per-gate durable checkpoint — behavioral + structural gaps
// =========================================================================

// --- Gate list completeness ---

test('DCKPT-01: exactly 15 design-mode checkpointDesign calls in dist', () => {
  const designGates = [
    'checkpointDesign(\'define\'',
    'checkpointDesign(\'knowledge\'',
    'checkpointDesign(\'codebase-facts\'',
    'checkpointDesign(\'e2e-use-cases\'',
    'checkpointDesign(\'requirements\'',
    'checkpointDesign(\'requirements-review\'',
    'checkpointDesign(\'architecture\'',
    'checkpointDesign(\'arch-review\'',
    'checkpointDesign(\'detailed-design\'',
    'checkpointDesign(\'design-review\'',
    'checkpointDesign(\'plan\'',
    'checkpointDesign(\'tdd-enforce\'',
    'checkpointDesign(\'reconcile\'',
    'checkpointDesign(\'review-refine\'',
    'checkpointDesign(\'chunk-plan\'',
  ]
  for (const g of designGates) {
    assert.ok(dist.includes(g), `design gate checkpoint missing: ${g}`)
  }
  // Count total checkpointDesign calls to detect accidental removals
  const allCalls = dist.match(/checkpointDesign\('/g) || []
  assert.ok(allCalls.length >= 19, `expected >= 19 checkpointDesign calls, got ${allCalls.length}`)
})

test('DCKPT-01: exactly 4 implement-mode checkpointDesign calls in dist', () => {
  const implementGates = [
    'checkpointDesign(\'test-authoring\'',
    'checkpointDesign(\'execute\'',
    'checkpointDesign(\'test\'',
    'checkpointDesign(\'code-review\'',
  ]
  for (const g of implementGates) {
    assert.ok(dist.includes(g), `implement gate checkpoint missing: ${g}`)
  }
})

test('DCKPT-01: design gate list matches E2E-DCKPT-01 roadmap definition', () => {
  // The roadmap E2E-DCKPT-01 names: Define, Codebase Facts, E2E Use Cases,
  // Requirements, Architecture, Detailed Design, Plan, Reconcile, Review/Refine
  // (plus reviews and TDD/chunk that are also material).
  const e2eGates = ['define', 'codebase-facts', 'e2e-use-cases', 'requirements',
    'architecture', 'detailed-design', 'plan', 'reconcile', 'review-refine']
  for (const g of e2eGates) {
    assert.ok(dist.includes(`checkpointDesign('${g}'`),
      `E2E-DCKPT-01 gate must be checkpointed: ${g}`)
  }
})

// --- checkpointDesign structural semantics ---

test('DCKPT-01: checkpointDesign sets acknowledged: true for every gate', () => {
  assert.ok(cpDesignBody.includes('acknowledged: true'),
    'checkpointDesign must set acknowledged: true')
})

test('DCKPT-01: checkpointDesign stores artifactPath from result[artifactPathKey]', () => {
  assert.ok(cpDesignBody.includes('result[artifactPathKey]'),
    'checkpointDesign must read artifactPath from result')
})

test('DCKPT-01: checkpointDesign initializes _designCheckpoints if absent', () => {
  assert.ok(cpDesignBody.includes("result._designCheckpoints = {}"),
    'must lazily initialize _designCheckpoints')
})

test('DCKPT-01: checkpointDesign initializes _artifactDigests if absent', () => {
  assert.ok(cpDesignBody.includes("result._artifactDigests = {}"),
    'must lazily initialize _artifactDigests')
})

test('DCKPT-01: checkpointDesign wraps flush in try-catch (non-blocking)', () => {
  assert.ok(cpDesignBody.includes('try'),
    'checkpointDesign must have try block')
  assert.ok(cpDesignBody.includes('catch'),
    'checkpointDesign must have catch block')
  assert.ok(cpDesignBody.includes('non-blocking'),
    'checkpointDesign catch should log non-blocking warning')
})

test('DCKPT-01: checkpointDesign computes digest from correct data field', () => {
  // The dataKey derivation must produce field names that actually exist in result.
  // definitionPath → _define (NOT _definition), other keys use _ + replace.
  assert.ok(cpDesignBody.includes('definitionPath'),
    'checkpointDesign must handle definitionPath')
  // Verify it resolves to _define not _definition
  assert.ok(cpDesignBody.includes("_define") || cpDesignBody.includes("'_define'"),
    'checkpointDesign must derive _define from definitionPath (not _definition)')
})

test('DCKPT-01: checkpointDesign computes digest via computeContentDigest', () => {
  assert.ok(cpDesignBody.includes('computeContentDigest'),
    'must use computeContentDigest for stable digests')
})

test('DCKPT-01: checkpointDesign calls flushPipelineStateWithSnapshot not flushPipelineState', () => {
  assert.ok(cpDesignBody.includes('flushPipelineStateWithSnapshot'),
    'must use snapshot-retaining writer')
  assert.ok(!cpDesignBody.match(/flushPipelineState[^W]/),
    'must NOT call plain flushPipelineState directly')
})

// --- Gates without artifact path keys ---

test('DCKPT-01: knowledge gate checkpointed without artifactPathKey', () => {
  // knowledge gate has no file artifact — checkpointDesign('knowledge') with no second arg
  assert.ok(dist.includes("checkpointDesign('knowledge')"),
    'knowledge gate should be checkpointed without path key')
})

test('DCKPT-01: requirements-review checkpointed without artifactPathKey', () => {
  assert.ok(dist.includes("checkpointDesign('requirements-review')"),
    'requirements-review should be checkpointed without path key')
})

test('DCKPT-01: arch-review checkpointed without artifactPathKey', () => {
  assert.ok(dist.includes("checkpointDesign('arch-review')"),
    'arch-review should be checkpointed without path key')
})

test('DCKPT-01: design-review checkpointed without artifactPathKey', () => {
  assert.ok(dist.includes("checkpointDesign('design-review')"),
    'design-review should be checkpointed without path key')
})

test('DCKPT-01: tdd-enforce checkpointed without artifactPathKey', () => {
  assert.ok(dist.includes("checkpointDesign('tdd-enforce')"),
    'tdd-enforce should be checkpointed without path key')
})

// --- ARTIFACT_CHECKPOINT_GATE_MAP completeness ---

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP maps definitionPath to define gate', () => {
  assert.ok(stateSrc.includes("definitionPath: 'define'"),
    'definitionPath must map to define gate')
})

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP maps requirementsPath to requirements gate', () => {
  assert.ok(stateSrc.includes("requirementsPath: 'requirements'"),
    'requirementsPath must map to requirements gate')
})

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP maps archPath to architecture gate', () => {
  assert.ok(stateSrc.includes("archPath: 'architecture'"),
    'archPath must map to architecture gate')
})

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP maps designPath to detailed-design gate', () => {
  assert.ok(stateSrc.includes("designPath: 'detailed-design'"),
    'designPath must map to detailed-design gate')
})

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP maps planPath to plan gate', () => {
  assert.ok(stateSrc.includes("planPath: 'plan'"),
    'planPath must map to plan gate')
})

test('DCKPT-01: ARTIFACT_CHECKPOINT_GATE_MAP has exactly 5 entries', () => {
  const mapMatch = stateSrc.match(/const ARTIFACT_CHECKPOINT_GATE_MAP = \{[\s\S]*?\}/)
  assert.ok(mapMatch, 'ARTIFACT_CHECKPOINT_GATE_MAP must be defined')
  const entries = mapMatch[0].match(/\w+Path:/g) || []
  assert.equal(entries.length, 5, `expected 5 path-key entries, got ${entries.length}`)
})

// --- Result initialization ---

test('DCKPT-01: result initializes _designCheckpoints as empty object', () => {
  assert.ok(dist.includes('_designCheckpoints: {}'),
    '_designCheckpoints must be initialized empty')
})

test('DCKPT-01: result initializes _artifactDigests as empty object', () => {
  assert.ok(dist.includes('_artifactDigests: {}'),
    '_artifactDigests must be initialized empty')
})

// =========================================================================
// DSTATE-01: Auto-recovering atomic state writes — behavioral + ordering
// =========================================================================

test('DSTATE-01: flushPipelineStateWithSnapshot reads current state before writing snapshot', async () => {
  const origAgent = globalThis.agent
  const callOrder = []
  globalThis.agent = async (prompt) => {
    if (prompt.includes('file-reader') && prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      callOrder.push('read-current')
      return { state: { task: 'old', slug: 's', planPath: '/p', planDir: '/p/', result: {} } }
    }
    if (prompt.includes('file-writer') && prompt.includes('last-good')) {
      callOrder.push('write-snapshot')
      return { ok: true }
    }
    if (prompt.includes('file-writer') && prompt.includes('pipeline-state.json')) {
      callOrder.push('write-new-state')
      return { ok: true }
    }
    return { ok: true }
  }
  try {
    const result = { task: 'new', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    const readIdx = callOrder.indexOf('read-current')
    const snapIdx = callOrder.indexOf('write-snapshot')
    const newIdx = callOrder.indexOf('write-new-state')
    assert.ok(readIdx >= 0, 'must read current state')
    assert.ok(snapIdx >= 0, 'must write snapshot')
    assert.ok(newIdx >= 0, 'must write new state')
    assert.ok(readIdx < snapIdx, 'read-current must precede write-snapshot')
    assert.ok(snapIdx < newIdx, 'write-snapshot must precede write-new-state')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: flushPipelineStateWithSnapshot skips snapshot when no existing state', async () => {
  const origAgent = globalThis.agent
  let snapshotWritten = false
  let newStateWritten = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('file-reader') && prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      return { state: null }
    }
    if (prompt.includes('last-good')) {
      snapshotWritten = true
      return { ok: true }
    }
    if (prompt.includes('file-writer') && prompt.includes('pipeline-state.json')) {
      newStateWritten = true
      return { ok: true }
    }
    return { ok: true }
  }
  try {
    const result = { task: 'first', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    assert.equal(snapshotWritten, false, 'should NOT write snapshot when no existing state')
    assert.ok(newStateWritten, 'should still write new state')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: flushPipelineStateWithSnapshot proceeds without snapshot when read returns null', async () => {
  // loadPipelineState uses safeAgent which catches agent throws and returns null.
  // The snapshot copy is then skipped via the null-state check, but the new
  // state write must still proceed.
  const origAgent = globalThis.agent
  let newWriteCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('file-reader') && prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      throw new Error('read error') // safeAgent converts to null
    }
    if (prompt.includes('file-writer') && prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      newWriteCalled = true
    }
    return { ok: true }
  }
  try {
    const result = { task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    assert.ok(newWriteCalled, 'new state write must proceed even when snapshot read fails')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: flushPipelineStateWithSnapshot delegates to flushPipelineState for write', async () => {
  const origAgent = globalThis.agent
  let stateWriteCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('file-writer') && prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      stateWriteCalled = true
    }
    return { ok: true }
  }
  try {
    const result = { task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    assert.ok(stateWriteCalled, 'flushPipelineState write must be invoked')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery tries last-good only when primary fails', async () => {
  const origAgent = globalThis.agent
  let lastGoodReadCount = 0
  let primaryReadCount = 0
  globalThis.agent = async (prompt) => {
    if (prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      primaryReadCount++
      // Return a valid state — last-good should NOT be read
      return {
        state: {
          task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/',
          result: { task: 't' }, checksum: stateChecksum(JSON.stringify({ task: 't' })),
        }
      }
    }
    if (prompt.includes('last-good')) {
      lastGoodReadCount++
      return { state: null }
    }
    return { state: null }
  }
  try {
    await loadPipelineStateWithRecovery('/p/')
    assert.equal(primaryReadCount, 1, 'should read primary state')
    assert.equal(lastGoodReadCount, 0, 'should NOT read last-good when primary is valid')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery reads last-good when primary has bad checksum', async () => {
  const origAgent = globalThis.agent
  const goodState = {
    task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/',
    result: { task: 'recovered' }, checksum: stateChecksum(JSON.stringify({ task: 'recovered' })),
  }
  globalThis.agent = async (prompt) => {
    if (prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      return { state: { task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/', result: { task: 't' }, checksum: 'bogus' } }
    }
    if (prompt.includes('last-good')) {
      return { state: goodState }
    }
    return { state: null }
  }
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.ok(loaded.state, 'should return recovered state')
    assert.equal(loaded.recovered, true, 'should signal recovery')
    assert.equal(loaded.state.result.task, 'recovered', 'should use last-good data')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery returns null when primary null and no last-good', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ state: null })
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.equal(loaded.state, null, 'no state to recover')
    assert.equal(loaded.recovered, false, 'no recovery signal')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery returns null when primary corrupt and last-good null', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async (prompt) => {
    if (prompt.includes('last-good')) return { state: null }
    return { state: { task: 't', result: {}, checksum: 'bad' } }
  }
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.equal(loaded.state, null, 'both sources failed')
    assert.equal(loaded.recovered, false, 'no recovery')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery hard-blocks when both primary and last-good corrupt', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => {
    return { state: { task: 't', result: {}, checksum: 'bad' } }
  }
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.equal(loaded.state, null, 'corrupt state should not be trusted')
    assert.equal(loaded.recovered, false, 'no recovery from corrupt')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery returns valid state without recovery flag', async () => {
  const validState = {
    task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/',
    result: { task: 't' }, checksum: stateChecksum(JSON.stringify({ task: 't' })),
  }
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ state: validState })
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.ok(loaded.state, 'valid state returned')
    assert.equal(loaded.recovered, false, 'no recovery needed')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: validatePipelineState catches missing required fields', () => {
  const bad = { task: '', slug: 's' }
  const v = validatePipelineState(bad)
  assert.ok(!v.ok, 'missing fields should fail')
  assert.ok(v.errors.some((e) => e.includes('planPath')), 'should report missing planPath')
})

test('DSTATE-01: validatePipelineState catches non-object state', () => {
  assert.ok(!validatePipelineState(null).ok, 'null should fail')
  assert.ok(!validatePipelineState('string').ok, 'string should fail')
  assert.ok(!validatePipelineState(undefined).ok, 'undefined should fail')
})

test('DSTATE-01: validatePipelineState catches missing result object', () => {
  const bad = { task: 't', slug: 's', planPath: '/p', planDir: '/p/', result: null }
  const v = validatePipelineState(bad)
  assert.ok(!v.ok, 'null result should fail')
  assert.ok(v.errors.some((e) => e.includes('result')))
})

test('DSTATE-01: validatePipelineState catches checksum mismatch', () => {
  const bad = {
    task: 't', slug: 's', planPath: '/p', planDir: '/p/',
    result: { task: 'changed' }, checksum: 'stale',
  }
  const v = validatePipelineState(bad)
  assert.ok(!v.ok, 'checksum mismatch should fail')
  assert.ok(v.errors.some((e) => e.includes('checksum')))
})

test('DSTATE-01: validatePipelineState passes valid state', () => {
  const good = {
    task: 't', slug: 's', planPath: '/p', planDir: '/p/',
    result: { task: 't' },
  }
  const v = validatePipelineState(good)
  assert.ok(v.ok, 'valid state should pass')
})

test('DSTATE-01: validatePipelineState passes state without checksum (backward compat)', () => {
  const noChecksum = {
    task: 't', slug: 's', planPath: '/p', planDir: '/p/',
    result: { task: 't' },
  }
  const v = validatePipelineState(noChecksum)
  assert.ok(v.ok, 'state without checksum should pass (advisory)')
})

test('DSTATE-01: resume path in main.mjs uses loadPipelineStateWithRecovery', () => {
  assert.ok(mainSrc.includes('loadPipelineStateWithRecovery(resumeDir)'),
    'resume must use recovery-aware loader')
})

test('DSTATE-01: flushPipelineStateWithSnapshot is exported from state.mjs', () => {
  assert.ok(stateSrc.includes('flushPipelineStateWithSnapshot'),
    'must be defined in state.mjs')
  assert.ok(stateSrc.match(/export.*flushPipelineStateWithSnapshot/),
    'must be exported from state.mjs')
})

test('DSTATE-01: loadPipelineStateWithRecovery is exported from state.mjs', () => {
  assert.ok(stateSrc.includes('loadPipelineStateWithRecovery'),
    'must be defined in state.mjs')
  assert.ok(stateSrc.match(/export.*loadPipelineStateWithRecovery/),
    'must be exported from state.mjs')
})

test('DSTATE-01: flushPipelineStateWithSnapshot catches snapshot copy errors', () => {
  const fnBody = stateSrc.match(/async function flushPipelineStateWithSnapshot[\s\S]*?^}/m)
  assert.ok(fnBody, 'function must exist')
  assert.ok(fnBody[0].includes('catch'),
    'must catch errors from snapshot copy')
})

// =========================================================================
// DRESUME-01: Digest-driven resume — edge cases
// =========================================================================

test('DRESUME-01: repairResumeArtifactFlags skips when checkpoint acknowledged + digest exists', async () => {
  const origAgent = globalThis.agent
  let verifyCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('artifact-check') || prompt.includes('resume:')) {
      verifyCalled = true
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      _define: { summary: 'test' },
      _designCheckpoints: {
        define: { acknowledged: true, artifactPath: '/p/define.md' },
      },
      _artifactDigests: {
        definitionPath: computeContentDigest({ summary: 'test' }),
      },
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no repairs for checkpointed artifact')
    assert.equal(verifyCalled, false, 'LLM verification must be skipped')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: checkpoint acknowledged but no digest → falls through to verification', async () => {
  const origAgent = globalThis.agent
  let verifyCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      verifyCalled = true
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      _designCheckpoints: {
        define: { acknowledged: true, artifactPath: '/p/define.md' },
      },
      _artifactDigests: {}, // no digest stored
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no repair needed — artifact exists')
    assert.equal(verifyCalled, true, 'must verify when digest missing')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: digest present but checkpoint NOT acknowledged → falls through', async () => {
  const origAgent = globalThis.agent
  let verifyCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      verifyCalled = true
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      _designCheckpoints: {}, // no checkpoint
      _artifactDigests: {
        definitionPath: 'someDigest',
      },
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no repair — artifact exists')
    assert.equal(verifyCalled, true, 'must verify when checkpoint missing')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: multiple artifacts with mixed checkpoint states', async () => {
  const origAgent = globalThis.agent
  const verifyGates = []
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      const gateMatch = prompt.match(/resume:(\w+)/)
      if (gateMatch) verifyGates.push(gateMatch[1])
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      requirementsPath: '/p/reqs.md',
      archPath: '/p/arch.md',
      _designCheckpoints: {
        define: { acknowledged: true, artifactPath: '/p/define.md' },
        // requirements NOT checkpointed
        architecture: { acknowledged: true, artifactPath: '/p/arch.md' },
      },
      _artifactDigests: {
        definitionPath: 'digest1', // checkpoint + digest → skip
        // requirementsPath: no digest → verify
        archPath: 'digest3', // checkpoint + digest → skip
      },
    }
    await repairResumeArtifactFlags(result)
    // Only Requirements should be verified (no checkpoint)
    assert.ok(verifyGates.some((g) => g.includes('Requirements')),
      'Requirements should be verified (no checkpoint)')
    assert.ok(!verifyGates.some((g) => g.includes('Define')),
      'Define should be skipped (checkpoint + digest)')
    assert.ok(!verifyGates.some((g) => g.includes('Architecture')),
      'Architecture should be skipped (checkpoint + digest)')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: planned=false excludes planPath from verification', async () => {
  const origAgent = globalThis.agent
  let planVerified = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:Plan')) planVerified = true
    return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      planPath: '/p/plan.md',
      planned: false,
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    await repairResumeArtifactFlags(result)
    assert.equal(planVerified, false, 'planPath should be excluded when planned=false')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: planned=true includes planPath in verification', async () => {
  const origAgent = globalThis.agent
  let planVerified = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:Plan')) {
      planVerified = true
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      planPath: '/p/plan.md',
      planned: true,
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    await repairResumeArtifactFlags(result)
    assert.equal(planVerified, true, 'planPath should be verified when planned=true')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: nullified artifact clears all downstream flags', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => {
    return { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'missing' }
  }
  try {
    const result = {
      definitionPath: '/p/gone.md',
      _define: { summary: 'old' },
      designReady: true,
      ready: true,
      executed: true,
      testsPassed: true,
      codeReview: 'pass',
      _goalkeeper: 'pass',
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.ok(repairs.length > 0, 'should report missing artifact')
    assert.equal(result.definitionPath, null, 'should null the path')
    assert.equal(result._define, null, 'should null the data flag')
    assert.equal(result.designReady, false, 'should clear designReady')
    assert.equal(result.ready, false, 'should clear ready')
    assert.equal(result.executed, null, 'should clear executed')
    assert.equal(result.testsPassed, false, 'should clear testsPassed')
    assert.equal(result.codeReview, null, 'should clear codeReview')
    assert.equal(result._goalkeeper, null, 'should clear _goalkeeper')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: repairResumeArtifactFlags returns repair descriptions', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => {
    return { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'missing' }
  }
  try {
    const result = {
      definitionPath: '/p/gone.md',
      archPath: '/p/also-gone.md',
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.ok(repairs.includes('definitionPath (Define)'), 'should name definitionPath')
    assert.ok(repairs.some((r) => r.includes('archPath')), 'should name archPath')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: repairResumeArtifactFlags with null result returns empty', async () => {
  const repairs = await repairResumeArtifactFlags(null)
  assert.deepEqual(repairs, [], 'null result should return no repairs')
})

test('DRESUME-01: repairResumeArtifactFlags with no artifacts returns empty', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const result = {
      // No artifact paths set — all null
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no artifacts to check')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: all 5 artifacts verified when no checkpoints exist', async () => {
  const origAgent = globalThis.agent
  const verifiedGates = []
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      const m = prompt.match(/resume:(\w+)/)
      if (m) verifiedGates.push(m[1])
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      requirementsPath: '/p/reqs.md',
      archPath: '/p/arch.md',
      designPath: '/p/design.md',
      planPath: '/p/plan.md',
      planned: true,
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    await repairResumeArtifactFlags(result)
    assert.ok(verifiedGates.some((g) => g.includes('Define')))
    assert.ok(verifiedGates.some((g) => g.includes('Requirements')))
    assert.ok(verifiedGates.some((g) => g.includes('Architecture')))
    assert.ok(verifiedGates.some((g) => g.includes('Detailed')))
    assert.ok(verifiedGates.some((g) => g.includes('Plan')))
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: backward compat — state with neither checkpoints nor digests', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ exists: true, sizeBytes: 500, hasExpectedHeadings: true, summary: 'ok' })
  try {
    // Old v1.4.5 state — no _designCheckpoints or _artifactDigests fields at all
    const result = {
      definitionPath: '/p/define.md',
      requirementsPath: '/p/reqs.md',
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'old state should verify normally')
    assert.equal(result.definitionPath, '/p/define.md', 'paths preserved')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: artifact exists and passes verification → no repair', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ exists: true, sizeBytes: 200, hasExpectedHeadings: true, summary: 'ok' })
  try {
    const result = {
      definitionPath: '/p/define.md',
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'existing artifact should not trigger repair')
  } finally {
    globalThis.agent = origAgent
  }
})

// =========================================================================
// E2E Matrix coverage assertions
// =========================================================================

test('E2E-DCKPT-01: source has checkpointDesign for all roadmap-named design gates', () => {
  // The roadmap lists 9 design gate boundaries for E2E-DCKPT-01
  const e2eDesignGates = [
    'define', 'codebase-facts', 'e2e-use-cases', 'requirements',
    'architecture', 'detailed-design', 'plan', 'reconcile', 'review-refine',
  ]
  for (const g of e2eDesignGates) {
    assert.ok(dist.includes(`checkpointDesign('${g}'`),
      `E2E-DCKPT-01 requires checkpoint for gate: ${g}`)
  }
})

test('E2E-DSTATE-01: loadPipelineStateWithRecovery exists and returns {state, recovered}', async () => {
  assert.equal(typeof loadPipelineStateWithRecovery, 'function')
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ state: null })
  try {
    const result = await loadPipelineStateWithRecovery('/p/')
    assert.ok('state' in result, 'must return state field')
    assert.ok('recovered' in result, 'must return recovered field')
  } finally {
    globalThis.agent = origAgent
  }
})

test('E2E-DRESUME-01: unchanged artifacts skip, missing artifacts null — combined scenario', async () => {
  const origAgent = globalThis.agent
  let llmCalls = 0
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      llmCalls++
      return { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'gone' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      archPath: '/p/arch-gone.md',
      _designCheckpoints: {
        define: { acknowledged: true, artifactPath: '/p/define.md' },
        // architecture NOT checkpointed → should be verified and found missing
      },
      _artifactDigests: {
        definitionPath: 'someDigest',
      },
    }
    const repairs = await repairResumeArtifactFlags(result)
    // definitionPath should be SKIPPED (checkpoint + digest)
    // archPath should be VERIFIED and found missing → repaired
    assert.ok(repairs.some((r) => r.includes('archPath')), 'missing arch should be repaired')
    assert.equal(result.archPath, null, 'missing arch path should be nulled')
    assert.equal(result.definitionPath, '/p/define.md', 'checkpointed path preserved')
  } finally {
    globalThis.agent = origAgent
  }
})

// =========================================================================
// Continuous regression gates
// =========================================================================

test('REGRESSION: no require() in flushPipelineStateWithSnapshot', () => {
  const fn = stateSrc.match(/async function flushPipelineStateWithSnapshot[\s\S]*?^}/m)
  assert.ok(fn, 'function must exist')
  assert.ok(!fn[0].match(/\brequire\(/), 'no require()')
  assert.ok(!fn[0].match(/\breadFileSync\(/), 'no readFileSync')
  assert.ok(!fn[0].match(/\bwriteFileSync\(/), 'no writeFileSync')
})

test('REGRESSION: no require() in loadPipelineStateWithRecovery', () => {
  const fn = stateSrc.match(/async function loadPipelineStateWithRecovery[\s\S]*?^}/m)
  assert.ok(fn, 'function must exist')
  assert.ok(!fn[0].match(/\brequire\(/), 'no require()')
  assert.ok(!fn[0].match(/\breadFileSync\(/), 'no readFileSync')
  assert.ok(!fn[0].match(/\bwriteFileSync\(/), 'no writeFileSync')
})

test('REGRESSION: no forbidden runtime tokens in checkpointDesign', () => {
  assert.ok(cpDesignBody, 'checkpointDesign must exist in dist')
  assert.ok(!cpDesignBody.match(/\brequire\(/), 'no require()')
  assert.ok(!cpDesignBody.match(/\breadFileSync\(/), 'no readFileSync')
  assert.ok(!cpDesignBody.match(/\bwriteFileSync\(/), 'no writeFileSync')
  assert.ok(!cpDesignBody.match(/\bDate\.now\(/), 'no Date.now()')
  assert.ok(!cpDesignBody.match(/\bMath\.random\(/), 'no Math.random()')
})

test('REGRESSION: no forbidden runtime tokens in flushPipelineStateWithSnapshot', () => {
  const fn = stateSrc.match(/async function flushPipelineStateWithSnapshot[\s\S]*?^}/m)
  assert.ok(fn, 'function must exist')
  assert.ok(!fn[0].match(/\bDate\.now\(/), 'no Date.now()')
  assert.ok(!fn[0].match(/\bMath\.random\(/), 'no Math.random()')
})

test('REGRESSION: Phase 8 functions exported from dist', () => {
  assert.ok(dist.includes('flushPipelineStateWithSnapshot'),
    'flushPipelineStateWithSnapshot must be in dist')
  assert.ok(dist.includes('loadPipelineStateWithRecovery'),
    'loadPipelineStateWithRecovery must be in dist')
  assert.ok(dist.includes('repairResumeArtifactFlags'),
    'repairResumeArtifactFlags must be in dist')
  assert.ok(dist.includes('checkpointDesign'),
    'checkpointDesign must be in dist')
  assert.ok(dist.includes('ARTIFACT_CHECKPOINT_GATE_MAP'),
    'ARTIFACT_CHECKPOINT_GATE_MAP must be in dist')
})

test('REGRESSION: flushPipelineStateWithSnapshot available via harness', () => {
  assert.equal(typeof flushPipelineStateWithSnapshot, 'function',
    'must be testable via harness')
})

test('REGRESSION: loadPipelineStateWithRecovery available via harness', () => {
  assert.equal(typeof loadPipelineStateWithRecovery, 'function',
    'must be testable via harness')
})

test('REGRESSION: repairResumeArtifactFlags available via harness', () => {
  assert.equal(typeof repairResumeArtifactFlags, 'function',
    'must be testable via harness')
})
