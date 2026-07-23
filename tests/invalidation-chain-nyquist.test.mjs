// Phase 17 — Invalidation Chain Nyquist characterization tests
// Fills sampling gaps: no-demote invariant, gate-predicate reset coverage,
// invalidateSliceChain completeness, onSliceRemoved vs invalidateSliceChain
// distinction, markStaleForSlice edge cases, history accumulation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  invalidatePersistenceEvidence,
  invalidateSliceChain,
  markStaleForSlice,
  onSliceRemoved,
  INVALIDATION_EVENT,
  createPersistenceTracker,
  recordAttemptedWrite,
  verifyDurableWrite,
  failWrite,
  PERSISTENCE_STATES,
  PERSIST_UNIT_TYPES,
  createSynthesisState,
  applyLifecycleEvent,
  deriveCoverageIndex,
} = engine

const observePersistSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/observe-persist.mjs', import.meta.url),
  'utf8'
)
const extractSliceSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-slice.mjs', import.meta.url),
  'utf8'
)
const mainSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/main.mjs', import.meta.url),
  'utf8'
)

// ---- GAP-1: No-demote invariant (extensive) ----

test('GAP1: DURABLY_VERIFIED feature-shard → superseded, state stays verified', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:shard', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  t = verifyDurableWrite(t, 'feature:s1:shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persistenceTracker.writes['feature:s1:shard'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
  assert.ok(state._invalidations.some((e) => e.key === 'feature:s1:shard' && e.action === 'superseded'))
})

test('GAP1: DURABLY_VERIFIED synthesis-view → superseded, state stays verified', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'synthesis:s1:view', PERSIST_UNIT_TYPES.SYNTHESIS_VIEW)
  t = verifyDurableWrite(t, 'synthesis:s1:view')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persistenceTracker.writes['synthesis:s1:view'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
})

test('GAP1: DURABLY_VERIFIED project-index → superseded, state stays verified', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'index:s1:entry', PERSIST_UNIT_TYPES.PROJECT_INDEX)
  t = verifyDurableWrite(t, 'index:s1:entry')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persistenceTracker.writes['index:s1:entry'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
})

test('GAP1: multiple DURABLY_VERIFIED writes → all superseded, none demoted', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:a', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:s1:a')
  t = recordAttemptedWrite(t, 'synthesis:s1:b', 'synthesis-view')
  t = verifyDurableWrite(t, 'synthesis:s1:b')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persistenceTracker.writes['feature:s1:a'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
  assert.equal(state.persistenceTracker.writes['synthesis:s1:b'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
  const superseded = state._invalidations.filter((e) => e.action === 'superseded')
  assert.equal(superseded.length, 2)
})

test('GAP1: mixed set (1 verified + 1 attempted) → verified superseded, attempted removed', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:verified', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:s1:verified')
  t = recordAttemptedWrite(t, 'feature:s1:attempted', 'feature-shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persistenceTracker.writes['feature:s1:verified'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
  assert.equal(state.persistenceTracker.writes['feature:s1:attempted'], undefined)
  assert.ok(state._invalidations.some((e) => e.key === 'feature:s1:verified' && e.action === 'superseded'))
  assert.ok(state._invalidations.some((e) => e.key === 'feature:s1:attempted' && e.action === 'removed'))
})

// ---- GAP-2: Gate-predicate reset coverage ----

test('GAP2: result.published as object → cleared to null', () => {
  const state = { published: { published: true, path: '/x' }, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.published, null)
})

test('GAP2: result.published already null → stays null (idempotent)', () => {
  const state = { published: null, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.published, null)
})

test('GAP2: result.persist as object → cleared to null', () => {
  const state = { persist: { persisted: true, path: '/y' }, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persist, null)
})

test('GAP2: result.persist already null → stays null (idempotent)', () => {
  const state = { persist: null, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state.persist, null)
})

test('GAP2: _publishVerified true → false', () => {
  const state = { _publishVerified: true, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state._publishVerified, false)
})

test('GAP2: _publishVerified undefined → false', () => {
  const state = { persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state._publishVerified, false)
})

test('GAP2: _persistVerified true → false', () => {
  const state = { _persistVerified: true, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state._persistVerified, false)
})

test('GAP2: _persistVerified undefined → false', () => {
  const state = { persistenceTracker: null }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(state._persistVerified, false)
})

// ---- GAP-3: invalidateSliceChain completeness ----

function makeFullSliceState() {
  return {
    status: 'done',
    artifacts: { factsPath: '/a', designPath: '/b', nested: { key: 'val' } },
    _gateCheckpoints: { 'extract-facts': { seq: 1 }, 'extract-design': { seq: 2 } },
    factsPath: '/docs/facts.md',
    useCasePath: '/docs/e2e.md',
    designPath: '/docs/design.md',
    archPath: '/docs/arch.md',
    requirementsPath: '/docs/reqs.md',
    auditPath: '/docs/audit.md',
    _facts: { data: 'x' },
    _e2e: { data: 'y' },
    _design: { data: 'z' },
    _arch: { data: 'w' },
    _requirements: { data: 'r' },
    _reviewedDesign: true,
    _reviewedArch: true,
  }
}

function makeFullParent() {
  return {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'abc123def',
    extractReady: true,
  }
}

test('GAP3: all 6 artifact paths set to non-null → all cleared', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  const paths = ['factsPath', 'useCasePath', 'designPath', 'archPath', 'requirementsPath', 'auditPath']
  for (const p of paths) {
    assert.equal(qe[p], null, `${p} cleared`)
  }
})

test('GAP3: artifacts with nested keys → reset to {}', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  assert.deepEqual(qe.artifacts, {})
})

test('GAP3: _gateCheckpoints with multiple entries → cleared to {}', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  assert.deepEqual(qe._gateCheckpoints, {})
})

test('GAP3: _facts cache with data → cleared', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  assert.equal(qe._facts, undefined)
})

test('GAP3: review flags set → cleared', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  assert.equal(qe._reviewedDesign, false)
  assert.equal(qe._reviewedArch, false)
})

test('GAP3: extractReady true → false', () => {
  const state = makeFullParent()
  const qe = makeFullSliceState()
  invalidateSliceChain(state, 's1', qe)
  assert.equal(state.extractReady, false)
})

// ---- GAP-4: onSliceRemoved vs invalidateSliceChain distinction ----

test('GAP4: onSliceRemoved does NOT call invalidateSliceChain (source assertion)', () => {
  const fnBody = mainSrc.match(/function onSliceRemoved[\s\S]*?\n}/)[0]
  assert.equal(fnBody.match(/invalidateSliceChain/), null)
})

test('GAP4: invalidateSliceChain does NOT call onSliceRemoved (source assertion)', () => {
  const fnBody = extractSliceSrc.match(/function invalidateSliceChain[\s\S]*?\n}/)[0]
  assert.equal(fnBody.match(/onSliceRemoved/), null)
})

test('GAP4: onSliceRemoved preserves artifact paths; invalidateSliceChain clears them', () => {
  const state1 = makeFullParent()
  const qe1 = makeFullSliceState()
  qe1.lifecycle = 'runnable'
  onSliceRemoved(state1, 's1', qe1)
  assert.ok(qe1.factsPath, 'onSliceRemoved preserves factsPath')

  const state2 = makeFullParent()
  const qe2 = makeFullSliceState()
  invalidateSliceChain(state2, 's1', qe2)
  assert.equal(qe2.factsPath, null, 'invalidateSliceChain clears factsPath')
})

test('GAP4: onSliceRemoved sets excluded; invalidateSliceChain sets pending', () => {
  const qe1 = { lifecycle: 'runnable' }
  onSliceRemoved(makeFullParent(), 's1', qe1)
  assert.equal(qe1.lifecycle, 'excluded')

  const qe2 = makeFullSliceState()
  invalidateSliceChain(makeFullParent(), 's1', qe2)
  assert.equal(qe2.status, 'pending')
})

test('GAP4: both call invalidatePersistenceEvidence (shared evidence primitive)', () => {
  assert.ok(mainSrc.includes('invalidatePersistenceEvidence'), 'onSliceRemoved calls invalidatePersistenceEvidence')
  assert.ok(extractSliceSrc.includes('invalidatePersistenceEvidence'), 'invalidateSliceChain calls invalidatePersistenceEvidence')
})

// ---- GAP-5: markStaleForSlice edge cases ----

test('GAP5: null synthesisState → fresh state with slice marked stale', () => {
  const result = markStaleForSlice(null, 'slice-x')
  assert.ok(result.staleSlices.includes('slice-x'))
  assert.equal(result.synthesized, false)
})

test('GAP5: already-stale synthesisState → appends to existing staleSlices', () => {
  const ss = { synthesized: true, views: {}, staleSlices: ['slice-a'] }
  const result = markStaleForSlice(ss, 'slice-b')
  assert.ok(result.staleSlices.includes('slice-a'))
  assert.ok(result.staleSlices.includes('slice-b'))
  assert.equal(result.staleSlices.length, 2)
})

test('GAP5: synthesized state → marks all 4 view types stale', () => {
  const ss = { synthesized: true, views: { systemOverview: {} } }
  const result = markStaleForSlice(ss, 'slice-x')
  assert.equal(result.staleViews.length, 4)
  assert.ok(result.staleViews.includes('systemOverview'))
  assert.ok(result.staleViews.includes('dependencyMap'))
  assert.ok(result.staleViews.includes('crossCutting'))
  assert.ok(result.staleViews.includes('coverageIndex'))
})

test('GAP5: synthesized: false → returns state as-is', () => {
  const ss = { synthesized: false, views: {} }
  const result = markStaleForSlice(ss, 'slice-x')
  assert.deepEqual(result, ss)
})

// ---- GAP-6: History accumulation ----

test('GAP6: two invalidations of same slice → 2+ entries (append-only)', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:a', 'feature-shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')

  let t2 = state.persistenceTracker
  t2 = recordAttemptedWrite(t2, 'feature:s1:b', 'feature-shard')
  state.persistenceTracker = t2
  invalidatePersistenceEvidence(state, 's1')

  assert.ok(state._invalidations.length >= 2, 'append-only history')
})

test('GAP6: invalidation of slice A then B → entries for both, in order', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:sliceA:shard', 'feature-shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 'sliceA')

  let t2 = state.persistenceTracker
  t2 = recordAttemptedWrite(t2, 'feature:sliceB:shard', 'feature-shard')
  state.persistenceTracker = t2
  invalidatePersistenceEvidence(state, 'sliceB')

  const aEvents = state._invalidations.filter((e) => e.sliceId === 'sliceA')
  const bEvents = state._invalidations.filter((e) => e.sliceId === 'sliceB')
  assert.ok(aEvents.length >= 1)
  assert.ok(bEvents.length >= 1)
  const aIdx = state._invalidations.indexOf(aEvents[0])
  const bIdx = state._invalidations.indexOf(bEvents[0])
  assert.ok(aIdx < bIdx, 'sliceA events before sliceB events')
})

test('GAP6: history events validate against INVALIDATION_EVENT schema shape', () => {
  const validActions = INVALIDATION_EVENT.properties.action.enum
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:shard', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:s1:shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')

  for (const evt of state._invalidations) {
    assert.ok(typeof evt.sliceId === 'string', 'sliceId is string')
    assert.ok(typeof evt.key === 'string', 'key is string')
    assert.ok(validActions.includes(evt.action), `action ${evt.action} is valid enum`)
  }
})

// ---- GAP-7: Source-assertion robustness ----

test('GAP7: invalidatePersistenceEvidence source — all 4 resets appear in body', () => {
  const fnBody = observePersistSrc.match(/function invalidatePersistenceEvidence[\s\S]*?\n}/)[0]
  assert.ok(fnBody.includes('_publishVerified'), 'resets _publishVerified')
  assert.ok(fnBody.includes('_persistVerified'), 'resets _persistVerified')
  assert.ok(fnBody.includes('state.published'), 'clears state.published')
  assert.ok(fnBody.includes('state.persist'), 'clears state.persist')
})

test('GAP7: onSliceRemoved source — applyLifecycleEvent with exclude event type', () => {
  const fnBody = mainSrc.match(/function onSliceRemoved[\s\S]*?\n}/)[0]
  assert.ok(fnBody.match(/applyLifecycleEvent.*exclude/), 'calls applyLifecycleEvent with exclude')
})

test('GAP7: invalidateSliceChain source — markStaleForSlice call appears', () => {
  const fnBody = extractSliceSrc.match(/function invalidateSliceChain[\s\S]*?\n}/)[0]
  assert.ok(fnBody.includes('markStaleForSlice'), 'calls markStaleForSlice')
})

test('GAP7: no Math.random or Date.now in any Phase 17 function', () => {
  const fns = [
    observePersistSrc.match(/function invalidatePersistenceEvidence[\s\S]*?\n}/)[0],
    extractSliceSrc.match(/function invalidateSliceChain[\s\S]*?\n}/)[0],
    mainSrc.match(/function onSliceRemoved[\s\S]*?\n}/)[0],
  ]
  const synthSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/synthesis.mjs', import.meta.url),
    'utf8'
  )
  fns.push(synthSrc.match(/function markStaleForSlice[\s\S]*?\n}/)[0])
  for (const body of fns) {
    assert.equal(body.match(/Math\.random|Date\.now/), null, 'no Math.random or Date.now')
  }
})
