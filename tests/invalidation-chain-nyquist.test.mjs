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

// ---- GAP-8: Key isolation — substring collision prevention (DEFECT FIX) ----

test('GAP8: invalidating slice-1 does NOT affect slice-10 ATTEMPTED writes', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:slice-1:shard', 'feature-shard')
  t = recordAttemptedWrite(t, 'feature:slice-10:shard', 'feature-shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state.persistenceTracker.writes['feature:slice-1:shard'], undefined,
    'slice-1 write removed')
  assert.ok(state.persistenceTracker.writes['feature:slice-10:shard'],
    'slice-10 write preserved — no substring collision')
})

test('GAP8: invalidating slice-1 does NOT supersede slice-10 DURABLY_VERIFIED writes', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:slice-1:shard', 'feature-shard')
  t = recordAttemptedWrite(t, 'feature:slice-10:shard', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:slice-10:shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(
    state.persistenceTracker.writes['feature:slice-10:shard'].state,
    PERSISTENCE_STATES.DURABLY_VERIFIED,
    'slice-10 DURABLY_VERIFIED untouched'
  )
  const falseEvents = state._invalidations.filter((e) => e.key.includes('slice-10'))
  assert.equal(falseEvents.length, 0, 'no false supersede event for slice-10')
})

test('GAP8: unrelated slice writes fully preserved after invalidation', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:alpha:shard', 'feature-shard')
  t = recordAttemptedWrite(t, 'synthesis:alpha:view', 'synthesis-view')
  t = recordAttemptedWrite(t, 'index:alpha:entry', 'project-index')
  t = recordAttemptedWrite(t, 'feature:beta:shard', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:beta:shard')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 'alpha')
  assert.equal(state.persistenceTracker.writes['feature:beta:shard'].state,
    PERSISTENCE_STATES.DURABLY_VERIFIED, 'beta write fully preserved')
  assert.equal(state._invalidations.filter((e) => e.key.includes('beta')).length, 0,
    'no events for beta')
  assert.equal(state._invalidations.filter((e) => e.sliceId === 'alpha').length, 3,
    'all 3 alpha keys invalidated')
})

// ---- GAP-9: Synthesis state behavioral after invalidateSliceChain ----

test('GAP9: invalidateSliceChain updates synthesis staleSlices with invalidated sliceId', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: true, views: {}, staleSlices: ['old'] },
    overviewPath: '/o', _sourceDigest: 'd', extractReady: true,
  }
  const qe = { status: 'done', artifacts: {}, _gateCheckpoints: {} }
  invalidateSliceChain(state, 'slice-x', qe)
  assert.ok(state.synthesisState.staleSlices.includes('slice-x'),
    'staleSlices contains the invalidated sliceId')
  assert.ok(state.synthesisState.staleSlices.includes('old'),
    'existing staleSlices preserved')
})

test('GAP9: invalidateSliceChain marks all 4 synthesis view types stale', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: true, views: {} },
    overviewPath: '/o', _sourceDigest: 'd', extractReady: true,
  }
  const qe = { status: 'done', artifacts: {}, _gateCheckpoints: {} }
  invalidateSliceChain(state, 'slice-y', qe)
  assert.deepEqual(state.synthesisState.staleViews.sort(),
    ['coverageIndex', 'crossCutting', 'dependencyMap', 'systemOverview'])
})

test('GAP9: invalidateSliceChain with unsynthesized state does not add staleSlices', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: false, views: {} },
    overviewPath: '/o', _sourceDigest: 'd', extractReady: true,
  }
  const qe = { status: 'done', artifacts: {}, _gateCheckpoints: {} }
  invalidateSliceChain(state, 'slice-z', qe)
  assert.equal(state.synthesisState.staleSlices, undefined,
    'unsynthesized state not marked stale (nothing to rebuild)')
})

// ---- GAP-10: Lifecycle/status distinction behavioral ----

test('GAP10: invalidateSliceChain does NOT set lifecycle to excluded', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: false },
    overviewPath: null, _sourceDigest: null, extractReady: false,
  }
  const qe = { status: 'done', artifacts: {}, _gateCheckpoints: {}, lifecycle: 'runnable' }
  invalidateSliceChain(state, 's1', qe)
  assert.notEqual(qe.lifecycle, 'excluded',
    'invalidateSliceChain must NOT exclude — slice will be re-extracted')
  assert.equal(qe.lifecycle, 'runnable', 'lifecycle unchanged')
})

test('GAP10: onSliceRemoved does NOT set status to pending', () => {
  const state = { persistenceTracker: null }
  const qe = { lifecycle: 'runnable', status: 'done', factsPath: '/f' }
  onSliceRemoved(state, 's1', qe)
  assert.notEqual(qe.status, 'pending',
    'onSliceRemoved must NOT set pending — slice is terminal')
  assert.equal(qe.status, 'done', 'status unchanged')
})

// ---- GAP-11: All caches cleared by invalidateSliceChain ----

test('GAP11: invalidateSliceChain clears _e2e, _design, _arch, _requirements caches', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: false },
    overviewPath: null, _sourceDigest: null, extractReady: false,
  }
  const qe = {
    status: 'done', artifacts: { x: 1 }, _gateCheckpoints: { g: 1 },
    _facts: { a: 1 }, _e2e: { b: 2 }, _design: { c: 3 },
    _arch: { d: 4 }, _requirements: { e: 5 },
  }
  invalidateSliceChain(state, 's1', qe)
  assert.equal(qe._facts, undefined, '_facts cleared')
  assert.equal(qe._e2e, undefined, '_e2e cleared')
  assert.equal(qe._design, undefined, '_design cleared')
  assert.equal(qe._arch, undefined, '_arch cleared')
  assert.equal(qe._requirements, undefined, '_requirements cleared')
})

// ---- GAP-12: No-demote with continuation-ack unit type ----

test('GAP12: DURABLY_VERIFIED continuation-ack write → superseded, state stays verified', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'continuation:s1:ack', PERSIST_UNIT_TYPES.CONTINUATION_ACK)
  t = verifyDurableWrite(t, 'continuation:s1:ack')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  assert.equal(
    state.persistenceTracker.writes['continuation:s1:ack'].state,
    PERSISTENCE_STATES.DURABLY_VERIFIED,
    'continuation-ack not demoted'
  )
  assert.ok(
    state._invalidations.some((e) => e.key === 'continuation:s1:ack' && e.action === 'superseded'),
    'continuation-ack supersede event appended'
  )
})

// ---- GAP-13: Re-invalidation sequence (append-only with new verified writes) ----

test('GAP13: re-invalidation after new durable write — both events in history', () => {
  let t = createPersistenceTracker()
  t = recordAttemptedWrite(t, 'feature:s1:original', 'feature-shard')
  t = verifyDurableWrite(t, 'feature:s1:original')
  const state = { persistenceTracker: t }
  invalidatePersistenceEvidence(state, 's1')
  const firstCount = state._invalidations.length

  // Simulate republication: a new durable write appears for the same slice
  let t2 = state.persistenceTracker
  t2 = recordAttemptedWrite(t2, 'feature:s1:updated', 'feature-shard')
  t2 = verifyDurableWrite(t2, 'feature:s1:updated')
  state.persistenceTracker = t2
  invalidatePersistenceEvidence(state, 's1')

  assert.ok(state._invalidations.length > firstCount,
    'second invalidation appended new events')
  assert.ok(
    state._invalidations.some((e) => e.key === 'feature:s1:updated' && e.action === 'superseded'),
    'newly verified write was superseded on re-invalidation'
  )
  // Original event still in history (append-only audit trail)
  assert.ok(
    state._invalidations.some((e) => e.key === 'feature:s1:original'),
    'original invalidation event preserved in history'
  )
})

// ---- GAP-14: Crash-resume completeness after invalidation ----

test('GAP14: after invalidateSliceChain, synthesis state triggers rebuild on resume', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: { synthesized: true, views: { systemOverview: { data: 'old' } } },
    overviewPath: '/old-overview.md',
    _sourceDigest: 'old-digest',
    extractReady: true,
  }
  const qe = {
    status: 'done', artifacts: { factsPath: '/a' },
    _gateCheckpoints: { 'extract-facts': { seq: 1 } },
    factsPath: '/f', designPath: '/d',
  }
  invalidateSliceChain(state, 's1', qe)

  // Simulate crash-resume: state is re-loaded from persisted pipeline-state.json
  // All guards must be reset so gates re-run from the beginning
  assert.equal(qe.status, 'pending', 'queue entry pending — will re-extract')
  assert.equal(qe.factsPath, null, 'artifact guard cleared')
  assert.equal(qe.designPath, null, 'artifact guard cleared')
  assert.equal(state.extractReady, false, 'not ready — blocks handoff')
  assert.equal(state.overviewPath, null, 'overview regenerated')
  assert.equal(state._sourceDigest, null, 'digest cleared for re-computation')
  assert.ok(state.synthesisState.staleViews && state.synthesisState.staleViews.length === 4,
    'all synthesis views stale — triggers rebuild')
  assert.equal(state.published, null, 'publish predicate cleared')
  assert.equal(state.persist, null, 'persist predicate cleared')
  assert.equal(state._publishVerified, false, 'publish boolean cleared')
  assert.equal(state._persistVerified, false, 'persist boolean cleared')
})

test('GAP14: after onSliceRemoved, crash-resume does NOT re-extract the removed slice', () => {
  const state = {
    persistenceTracker: null,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
  const qe = {
    lifecycle: 'runnable',
    status: 'done',
    factsPath: '/docs/facts.md',
    designPath: '/docs/design.md',
  }
  onSliceRemoved(state, 's1', qe)

  // Simulate crash-resume: removed slice must stay terminal
  assert.equal(qe.lifecycle, 'excluded', 'lifecycle stays excluded')
  assert.notEqual(qe.status, 'pending', 'NOT pending — terminal')
  assert.equal(qe.factsPath, '/docs/facts.md', 'artifact paths preserved as history')
  assert.equal(qe.designPath, '/docs/design.md', 'artifact paths preserved as history')
  assert.equal(state.published, null, 'parent publish reruns')
  assert.equal(state.persist, null, 'parent persist reruns')
})
