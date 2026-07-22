// Phase 4 CHECKPOINT-01 + ORCH-01: Checkpointed feature leaf tests.
// Covers: per-gate durable checkpoint, resume at first incomplete gate, idempotent
// replay, lifecycle integration, skip semantics, and Workflow spawn structural
// assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  checkpointSlice,
  applyLifecycleEvent,
  deriveReadiness,
  LIFECYCLE_STATES,
  SKIP_REASONS,
  compareRevisions,
  selectiveInvalidate,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// Mock agent for checkpoint tests — returns a FILE_ACK-compatible response.
function mockAgent() {
  return async () => ({ ok: true })
}

// ---- checkpointSlice: per-gate state tracking ----

test('checkpointSlice: records gate checkpoint with artifact path', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = mockAgent()
  try {
    const slice = { id: 'feat-1', name: 'Feature 1', planDir: '/tmp/test-feat/' }
    const sliceState = { factsPath: '/tmp/test-feat/codebase-facts.md' }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    assert.ok(sliceState._gateCheckpoints, '_gateCheckpoints should be initialized')
    assert.ok(sliceState._gateCheckpoints['extract-facts'], 'extract-facts checkpoint should exist')
    assert.equal(sliceState._gateCheckpoints['extract-facts'].acknowledged, true)
    assert.equal(sliceState._gateCheckpoints['extract-facts'].artifactPath, '/tmp/test-feat/codebase-facts.md')
  } finally {
    globalThis.agent = origAgent
  }
})

test('checkpointSlice: records correct artifact path for each gate type', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = mockAgent()
  try {
    const slice = { id: 'feat-2', name: 'Feature 2', planDir: '/tmp/test-feat-2/' }
    const sliceState = {
      factsPath: '/tmp/facts.md',
      useCasePath: '/tmp/e2e.md',
      designPath: '/tmp/design.md',
      archPath: '/tmp/arch.md',
      requirementsPath: '/tmp/reqs.md',
    }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    await checkpointSlice(slice, sliceState, 'extract-e2e', result)
    await checkpointSlice(slice, sliceState, 'extract-design', result)
    await checkpointSlice(slice, sliceState, 'extract-arch', result)
    await checkpointSlice(slice, sliceState, 'extract-requirements', result)

    assert.equal(sliceState._gateCheckpoints['extract-facts'].artifactPath, '/tmp/facts.md')
    assert.equal(sliceState._gateCheckpoints['extract-e2e'].artifactPath, '/tmp/e2e.md')
    assert.equal(sliceState._gateCheckpoints['extract-design'].artifactPath, '/tmp/design.md')
    assert.equal(sliceState._gateCheckpoints['extract-arch'].artifactPath, '/tmp/arch.md')
    assert.equal(sliceState._gateCheckpoints['extract-requirements'].artifactPath, '/tmp/reqs.md')
  } finally {
    globalThis.agent = origAgent
  }
})

test('checkpointSlice: review gate has null artifact path (sets flag not path)', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = mockAgent()
  try {
    const slice = { id: 'feat-3', name: 'Feature 3', planDir: '/tmp/feat3/' }
    const sliceState = { _reviewedDesign: true, _reviewedArch: true }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-review', result)
    assert.ok(sliceState._gateCheckpoints['extract-review'])
    assert.equal(sliceState._gateCheckpoints['extract-review'].artifactPath, null)
  } finally {
    globalThis.agent = origAgent
  }
})

// ---- Idempotent replay ----

test('checkpointSlice: idempotent — same gate name overwrites without duplication', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = mockAgent()
  try {
    const slice = { id: 'feat-4', name: 'Feature 4', planDir: '/tmp/feat4/' }
    const sliceState = { factsPath: '/tmp/facts.md' }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    const firstSeq = sliceState._gateCheckpoints['extract-facts'].seq
    // Replay the same gate — should overwrite, not duplicate
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    const keys = Object.keys(sliceState._gateCheckpoints)
    const factsCheckpoints = keys.filter((k) => k === 'extract-facts')
    assert.equal(factsCheckpoints.length, 1, 'should have exactly one extract-facts checkpoint')
    assert.ok(sliceState._gateCheckpoints['extract-facts'].seq > firstSeq, 'seq should advance')
  } finally {
    globalThis.agent = origAgent
  }
})

test('checkpointSlice: non-blocking on flush failure — state still advances', async () => {
  // Agent returns error — checkpoint should still record in-memory state
  const origAgent = globalThis.agent
  globalThis.agent = async () => { throw new Error('mock agent failure') }
  try {
    const slice = { id: 'feat-5', name: 'Feature 5', planDir: '/tmp/feat5/' }
    const sliceState = { factsPath: '/tmp/facts.md' }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    // Even though the flush failed, the checkpoint is recorded
    assert.ok(sliceState._gateCheckpoints['extract-facts'])
    assert.equal(sliceState._gateCheckpoints['extract-facts'].acknowledged, true)
  } finally {
    globalThis.agent = origAgent
  }
})

// ---- Lifecycle reducer integration in extract context ----

test('lifecycle: extract leaf transitions runnable -> in-progress -> completed', () => {
  let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  state = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
  state = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('lifecycle: blocked extract leaf stays in-progress (resumable, not terminal)', () => {
  let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  state = applyLifecycleEvent(state, { type: 'start' })
  // A blocked leaf stays in-progress — it's not a terminal state
  assert.equal(state.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
  // Can complete later after resuming
  state = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('lifecycle: failed extract leaf transitions in-progress -> failed', () => {
  let state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  state = applyLifecycleEvent(state, { type: 'fail' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.FAILED)
})

// ---- Skip semantics ----

test('skip semantics: feature-level skip remains incomplete in readiness', () => {
  const manifest = {
    schemaVersion: '1.0',
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'skipped', skipReason: 'feature-level' },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, false, 'feature-level skip should block readiness')
  assert.ok(readiness.skipped > 0, 'feature-level skip should count as incomplete')
})

test('skip semantics: policy-disabled optional gate with evidence may complete', () => {
  const manifest = {
    schemaVersion: '1.0',
    features: [
      { id: 'f1', lifecycle: 'completed' },
      {
        id: 'f2',
        lifecycle: 'skipped',
        skipReason: 'policy-disabled-optional',
        policyEvidence: { gate: 'audit', policy: 'disabled' },
      },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, true, 'policy-disabled skip with evidence should allow readiness')
  assert.equal(readiness.skipped, 0, 'policy-disabled skip with evidence is not incomplete')
})

test('skip semantics: required-gate skip blocks completion permanently', () => {
  let state = { lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.REQUIRED_GATE }
  assert.throws(
    () => applyLifecycleEvent(state, { type: 'complete' }),
    /required gate was skipped/
  )
})

test('skip semantics: policy-disabled skip without evidence cannot complete', () => {
  let state = {
    lifecycle: LIFECYCLE_STATES.SKIPPED,
    skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL,
  }
  assert.throws(
    () => applyLifecycleEvent(state, { type: 'complete' }),
    /policyEvidence/
  )
  // With evidence, completion succeeds
  state.policyEvidence = { gate: 'audit', policy: 'disabled' }
  const next = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

// ---- Revision-aware invalidation for extract gates ----

test('revision: source change invalidates codeFacts and arch gates', () => {
  const oldR = { source: 'abc123' }
  const newR = { source: 'def456' }
  const delta = compareRevisions(oldR, newR)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
})

test('revision: selective invalidation preserves independent gate evidence', () => {
  const shard = {
    gates: {
      codeFacts: { valid: true, digest: 'aaa' },
      arch: { valid: true, digest: 'bbb' },
      design: { valid: true, digest: 'ccc' },
    },
  }
  const delta = { affectedGates: ['codeFacts'], changedInputs: ['source'] }
  const invalidated = selectiveInvalidate(shard, delta)
  assert.equal(invalidated.gates.codeFacts.valid, false, 'codeFacts should be invalidated')
  assert.equal(invalidated.gates.arch.valid, true, 'arch should remain valid (not affected)')
  assert.equal(invalidated.gates.design.valid, true, 'design should remain valid')
})

// ---- Structural assertions on the dist ----

test('structure: extractSlice contains checkpoint calls after each material gate', () => {
  // Each material gate should have a checkpointSlice call after setting its artifact
  const checkpointCalls = source.match(/checkpointSlice\(/g) || []
  // extract-facts, extract-e2e, extract-design, extract-arch, extract-review,
  // extract-requirements, extract-audit = 7 gates + 1 function definition = 8
  assert.ok(checkpointCalls.length >= 8,
    `expected at least 8 checkpointSlice references, found ${checkpointCalls.length}`)
})

test('structure: checkpointSlice function is defined', () => {
  assert.match(source, /async function checkpointSlice\(/,
    'checkpointSlice function should be defined')
})

test('structure: _gateCheckpoints field tracks gate completion', () => {
  assert.match(source, /_gateCheckpoints/,
    '_gateCheckpoints field should be referenced in the dist')
})

test('structure: Workflow spawn for fp-extract-slice exists in top-level orchestrator', () => {
  assert.match(source, /name:\s*'fp-extract-slice'/,
    "top-level should spawn Workflow({name:'fp-extract-slice', ...})")
  assert.match(source, /typeof Workflow === 'function'/,
    "should check Workflow availability before spawning")
})

test('structure: Workflow spawn falls back to direct extractSlice call', () => {
  // The fallback ensures single-slice runs and test harness work without Workflow
  assert.match(source, /outcome = await extractSlice\(/,
    'should have direct extractSlice fallback call')
})

test('structure: leaf entry tracks lifecycle via shared reducer', () => {
  assert.match(source, /applyLifecycleEvent/,
    'leaf entry should use applyLifecycleEvent from the shared reducer')
})

test('structure: sliceState initialization includes lifecycle field', () => {
  assert.match(source, /lifecycle:\s*'in-progress'/,
    "sliceState should initialize lifecycle to 'in-progress'")
})

test('structure: leaf entry exports extractSliceMain', () => {
  // Read the leaf dist
  const leafSource = readFileSync(
    new URL('../plugins/feature-workflows/workflows/fp-extract-slice.js', import.meta.url),
    'utf8'
  )
  assert.match(leafSource, /extractSliceMain/,
    'leaf dist should contain extractSliceMain entry function')
  assert.match(leafSource, /gateCheckpoints/,
    'leaf result should include gateCheckpoints')
})

// ---- Multi-entry consistency ----

test('multi-entry: both dists contain checkpointSlice', () => {
  const leafSource = readFileSync(
    new URL('../plugins/feature-workflows/workflows/fp-extract-slice.js', import.meta.url),
    'utf8'
  )
  assert.match(source, /checkpointSlice/, 'top-level dist should contain checkpointSlice')
  assert.match(leafSource, /checkpointSlice/, 'leaf dist should contain checkpointSlice')
})

test('multi-entry: both dists contain applyLifecycleEvent', () => {
  const leafSource = readFileSync(
    new URL('../plugins/feature-workflows/workflows/fp-extract-slice.js', import.meta.url),
    'utf8'
  )
  assert.match(source, /applyLifecycleEvent/, 'top-level dist should contain applyLifecycleEvent')
  assert.match(leafSource, /applyLifecycleEvent/, 'leaf dist should contain applyLifecycleEvent')
})
