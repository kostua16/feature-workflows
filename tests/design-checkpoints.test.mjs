// Phase 8 DCKPT-01, DSTATE-01, DRESUME-01: Design-mode durable checkpoints,
// auto-recovering atomic state writes, and digest-driven resume.
//
// RED evidence: F1 (no mid-chain state persistence), F2 (truncated state
// hard-blocks), F3 (resume re-reads every artifact regardless of change).
// GREEN evidence: per-gate durable flush, last-good snapshot auto-recovery,
// digest-driven skip of unchanged artifacts.
import test from 'node:test'
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
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// Mock agent for state-write tests — returns a FILE_ACK-compatible response.
function mockFileAck() {
  return async () => ({ ok: true })
}

// Mock agent for file-reader tests — returns a PIPELINE_STATE_READ-compatible response.
function mockStateReader(stateObj) {
  return async () => ({ state: stateObj })
}

// Mock agent that returns null (file not found).
function mockNullReader() {
  return async () => ({ state: null })
}

// ---- DCKPT-01: per-gate durable checkpoint structural assertions ----

test('DCKPT-01: checkpointDesign function is defined in the dist', () => {
  assert.ok(source.includes('const checkpointDesign ='), 'checkpointDesign must be defined')
})

test('DCKPT-01: checkpointDesign calls flushPipelineStateWithSnapshot', () => {
  assert.ok(
    source.includes('flushPipelineStateWithSnapshot(planDir, result, config)'),
    'checkpointDesign must call flushPipelineStateWithSnapshot for durable persistence'
  )
})

test('DCKPT-01: checkpointDesign is called after each material design gate', () => {
  const expectedGates = [
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
    'checkpointDesign(\'test-authoring\'',
    'checkpointDesign(\'execute\'',
    'checkpointDesign(\'test\'',
    'checkpointDesign(\'code-review\'',
  ]
  for (const gate of expectedGates) {
    assert.ok(
      source.includes(gate),
      `checkpointDesign must be called for gate: ${gate}`
    )
  }
})

test('DCKPT-01: _designCheckpoints and _artifactDigests initialized in result', () => {
  assert.ok(source.includes('_designCheckpoints: {}'), '_designCheckpoints must be initialized')
  assert.ok(source.includes('_artifactDigests: {}'), '_artifactDigests must be initialized')
})

test('DCKPT-01: checkpointDesign records acknowledged gate with artifact path', () => {
  const fnBody = source.match(/const checkpointDesign = async \(gateName, artifactPathKey\) => \{[\s\S]*?\n  \}/)
  assert.ok(fnBody, 'checkpointDesign body must exist')
  assert.ok(fnBody[0].includes('acknowledged: true'), 'checkpoint must set acknowledged: true')
  assert.ok(fnBody[0].includes('_designCheckpoints'), 'checkpoint must record in _designCheckpoints')
  assert.ok(fnBody[0].includes('_artifactDigests'), 'checkpoint must record digest in _artifactDigests')
})

test('DCKPT-01: checkpointDesign is non-blocking (try-catch around flush)', () => {
  const fnBody = source.match(/const checkpointDesign = async [\s\S]*?flushPipelineStateWithSnapshot[\s\S]*?\n  \}/)
  assert.ok(fnBody, 'checkpointDesign body with flush must exist')
  assert.ok(fnBody[0].includes('catch'), 'checkpointDesign must have try-catch for non-blocking flush')
})

test('DCKPT-01: checkpointDesign computes artifact digest via computeContentDigest', () => {
  const fnBody = source.match(/const checkpointDesign = async [\s\S]*?computeContentDigest[\s\S]*?\n  \}/)
  assert.ok(fnBody, 'checkpointDesign must use computeContentDigest')
})

// ---- DSTATE-01: auto-recovering atomic state writes ----

test('DSTATE-01: flushPipelineStateWithSnapshot is a function', () => {
  assert.equal(typeof flushPipelineStateWithSnapshot, 'function')
})

test('DSTATE-01: flushPipelineStateWithSnapshot writes last-good snapshot before new state', async () => {
  const origAgent = globalThis.agent
  const calls = []
  globalThis.agent = async (prompt) => {
    calls.push(prompt)
    if (prompt.includes('file-reader')) return { state: { task: 'old', slug: 's', planPath: '/p', planDir: '/p/', result: {} } }
    return { ok: true }
  }
  try {
    const result = { task: 'new', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    const readCalls = calls.filter((c) => c.includes('file-reader'))
    assert.ok(readCalls.length > 0, 'must read current state for snapshot')
    const lastGoodWrites = calls.filter((c) => c.includes('last-good'))
    assert.ok(lastGoodWrites.length > 0, 'must write last-good snapshot')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: flushPipelineStateWithSnapshot continues on snapshot copy failure', async () => {
  const origAgent = globalThis.agent
  let writeCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('file-reader') && prompt.includes('pipeline-state.json')) {
      throw new Error('read failed')
    }
    if (prompt.includes('file-writer') && prompt.includes('pipeline-state.json')) {
      writeCalled = true
    }
    return { ok: true }
  }
  try {
    const result = { task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/', logLines: [] }
    await flushPipelineStateWithSnapshot('/p/', result, { mode: 'design' })
    assert.ok(writeCalled, 'new state write must proceed even if snapshot copy fails')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery is a function', () => {
  assert.equal(typeof loadPipelineStateWithRecovery, 'function')
})

test('DSTATE-01: loadPipelineStateWithRecovery returns valid state without recovery', async () => {
  const validState = {
    task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/',
    result: { task: 't' }, checksum: stateChecksum(JSON.stringify({ task: 't' })),
  }
  const origAgent = globalThis.agent
  globalThis.agent = mockStateReader(validState)
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.ok(loaded.state, 'should return state')
    assert.equal(loaded.recovered, false, 'should not need recovery')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery auto-recovers from last-good on truncation', async () => {
  const goodState = {
    task: 't', slug: 's', planPath: '/p/plan.md', planDir: '/p/',
    result: { task: 't' }, checksum: stateChecksum(JSON.stringify({ task: 't' })),
  }
  const origAgent = globalThis.agent
  let callCount = 0
  globalThis.agent = async (prompt) => {
    callCount++
    if (prompt.includes('pipeline-state.json') && !prompt.includes('last-good')) {
      return { state: { task: 't', result: {}, checksum: 'bogus' } }
    }
    if (prompt.includes('last-good')) {
      return { state: goodState }
    }
    return { state: null }
  }
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.ok(loaded.state, 'should return recovered state')
    assert.equal(loaded.recovered, true, 'should signal recovery from last-good')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery returns null when both current and last-good fail', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ state: null })
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.equal(loaded.state, null, 'should return null state')
    assert.equal(loaded.recovered, false, 'should not signal recovery')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DSTATE-01: loadPipelineStateWithRecovery returns null when both are corrupt', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async (prompt) => {
    return { state: { task: 't', result: {}, checksum: 'bogus' } }
  }
  try {
    const loaded = await loadPipelineStateWithRecovery('/p/')
    assert.equal(loaded.state, null, 'should return null when both fail validation')
    assert.equal(loaded.recovered, false, 'should not signal recovery')
  } finally {
    globalThis.agent = origAgent
  }
})

// ---- DRESUME-01: digest-driven resume ----

test('DRESUME-01: repairResumeArtifactFlags skips unchanged artifacts with matching digest', async () => {
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
    assert.deepEqual(repairs, [], 'no repairs needed for durably checkpointed artifact')
    assert.equal(verifyCalled, false, 'should NOT call verifyArtifactPresence when digest matches')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: repairResumeArtifactFlags re-verifies when checkpoint not acknowledged', async () => {
  const origAgent = globalThis.agent
  let verifyCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:Define')) {
      verifyCalled = true
      return { exists: true, sizeBytes: 100, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no repairs when artifact exists')
    assert.equal(verifyCalled, true, 'should call verifyArtifactPresence when no checkpoint')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: repairResumeArtifactFlags falls back to verification without stored digests', async () => {
  const origAgent = globalThis.agent
  let verifyCalled = false
  globalThis.agent = async (prompt) => {
    if (prompt.includes('resume:')) {
      verifyCalled = true
      return { exists: true, sizeBytes: 200, hasExpectedHeadings: true, summary: 'ok' }
    }
    return { ok: true }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      archPath: '/p/arch.md',
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'no repairs when artifacts exist')
    assert.equal(verifyCalled, true, 'should verify when no digests stored (backward compat)')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: repairResumeArtifactFlags nulls missing artifacts even with checkpoints', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => {
    return { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'missing' }
  }
  try {
    const result = {
      definitionPath: '/p/gone.md',
      _define: { summary: 'old' },
      designReady: true,
      _designCheckpoints: {},
      _artifactDigests: {},
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.ok(repairs.some((r) => r.includes('definitionPath')), 'should report missing artifact')
    assert.equal(result.definitionPath, null, 'should null the path')
    assert.equal(result._define, null, 'should null the data flag')
    assert.equal(result.designReady, false, 'should clear designReady')
  } finally {
    globalThis.agent = origAgent
  }
})

test('DRESUME-01: backward compat — works with state lacking _designCheckpoints', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => {
    return { exists: true, sizeBytes: 500, hasExpectedHeadings: true, summary: 'ok' }
  }
  try {
    const result = {
      definitionPath: '/p/define.md',
      requirementsPath: '/p/reqs.md',
      planned: true,
      planPath: '/p/plan.md',
    }
    const repairs = await repairResumeArtifactFlags(result)
    assert.deepEqual(repairs, [], 'old states without checkpoints verify normally')
    assert.equal(result.definitionPath, '/p/define.md', 'paths preserved when artifacts exist')
  } finally {
    globalThis.agent = origAgent
  }
})

// ---- Continuous regression: no new forbidden tokens in new code ----

test('REGRESSION: checkpointDesign uses no direct FS or shell access', () => {
  const cpSection = source.match(/const checkpointDesign = async[\s\S]*?^  \}/m)
  assert.ok(cpSection, 'checkpointDesign section must exist')
  assert.ok(!cpSection[0].match(/\brequire\(/), 'no require() in checkpointDesign')
  assert.ok(!cpSection[0].match(/\breadFileSync\(/), 'no readFileSync in checkpointDesign')
  assert.ok(!cpSection[0].match(/\bwriteFileSync\(/), 'no writeFileSync in checkpointDesign')
})

test('REGRESSION: flushPipelineStateWithSnapshot uses no direct FS access', () => {
  const fnSection = source.match(/async function flushPipelineStateWithSnapshot[\s\S]*?^}/m)
  assert.ok(fnSection, 'flushPipelineStateWithSnapshot section must exist')
  assert.ok(!fnSection[0].match(/\brequire\(/), 'no require()')
  assert.ok(!fnSection[0].match(/\breadFileSync\(/), 'no direct file reads')
})
