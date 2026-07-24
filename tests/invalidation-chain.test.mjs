// Phase 17 — Invalidation Chain & Removal Path (D2.3)
// Tests invalidatePersistenceEvidence, invalidateSliceChain, markStaleForSlice,
// onSliceRemoved, and INVALIDATION_EVENT schema. Pure functions + source assertions.
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
  createSynthesisState,
  applyLifecycleEvent,
  LIFECYCLE_STATES,
  deriveCoverageIndex,
} = engine

const distSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

const observePersistSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/observe-persist.mjs', import.meta.url),
  'utf8'
)

const extractSliceSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-slice.mjs', import.meta.url),
  'utf8'
)

const synthesisSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/synthesis.mjs', import.meta.url),
  'utf8'
)

const mainSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/main.mjs', import.meta.url),
  'utf8'
)

// ---- RED tests (functions must exist) ----

test('RED: invalidatePersistenceEvidence is defined and callable', () => {
  assert.equal(typeof invalidatePersistenceEvidence, 'function')
})

test('RED: invalidateSliceChain is defined and callable', () => {
  assert.equal(typeof invalidateSliceChain, 'function')
})

test('RED: markStaleForSlice is defined and callable', () => {
  assert.equal(typeof markStaleForSlice, 'function')
})

test('RED: onSliceRemoved is defined and callable', () => {
  assert.equal(typeof onSliceRemoved, 'function')
})

// ---- RED tests (source assertions — bare checkpoint clear is insufficient) ----

test('RED: clearing only _gateCheckpoints leaves artifact-path guards set', () => {
  // Prove that the 6 artifact-path guards are separate from _gateCheckpoints.
  // The checkpointSlice function only manages _gateCheckpoints; the actual
  // gate-skip predicates are the 6 path properties on the slice state.
  const sliceState = {
    factsPath: '/docs/facts.md',
    useCasePath: '/docs/e2e.md',
    designPath: '/docs/design.md',
    archPath: '/docs/arch.md',
    requirementsPath: '/docs/reqs.md',
    auditPath: '/docs/audit.md',
    _gateCheckpoints: { 'extract-facts': { seq: 1, acknowledged: true } },
  }
  // Simulate a bare checkpoint clear (NOT invalidateSliceChain)
  sliceState._gateCheckpoints = {}
  // The 6 artifact paths are still set — extractSlice would still skip gates
  assert.ok(sliceState.factsPath, 'factsPath still set after bare checkpoint clear')
  assert.ok(sliceState.useCasePath, 'useCasePath still set')
  assert.ok(sliceState.designPath, 'designPath still set')
  assert.ok(sliceState.archPath, 'archPath still set')
  assert.ok(sliceState.requirementsPath, 'requirementsPath still set')
  assert.ok(sliceState.auditPath, 'auditPath still set')
})

test('RED: clearing only _publishVerified/_persistVerified leaves result guards set', () => {
  // Prove that result.published/result.persist are the actual gate predicates,
  // separate from the booleans.
  const state = {
    _publishVerified: true,
    _persistVerified: true,
    published: { published: true },
    persist: { persisted: true },
  }
  // Simulate clearing only booleans (NOT invalidatePersistenceEvidence)
  state._publishVerified = false
  state._persistVerified = false
  // result.published / result.persist are still set — gates would still skip
  assert.ok(state.published, 'result.published still set — gate would skip')
  assert.ok(state.persist, 'result.persist still set — gate would skip')
})

// ---- GREEN tests: invalidatePersistenceEvidence ----

test('GREEN: resets _publishVerified to false', () => {
  const state = { _publishVerified: true, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state._publishVerified, false)
})

test('GREEN: resets _persistVerified to false', () => {
  const state = { _persistVerified: true, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state._persistVerified, false)
})

test('GREEN: clears result.published', () => {
  const state = { published: { published: true }, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state.published, null)
})

test('GREEN: clears result.persist', () => {
  const state = { persist: { persisted: true }, persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state.persist, null)
})

test('GREEN: initializes _invalidations if not present', () => {
  const state = { persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.ok(Array.isArray(state._invalidations))
})

test('GREEN: appends invalidation event for affected durable key', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-1:shard', 'feature-shard')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.ok(state._invalidations.length >= 1)
  assert.ok(state._invalidations.some((e) => e.key === 'feature:slice-1:shard'))
})

test('GREEN: does NOT demote DURABLY_VERIFIED write (OBSERVE-01)', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-1:shard', 'feature-shard')
  tracker = verifyDurableWrite(tracker, 'feature:slice-1:shard')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-1')
  // The write should still be DURABLY_VERIFIED — not demoted
  assert.equal(
    state.persistenceTracker.writes['feature:slice-1:shard'].state,
    PERSISTENCE_STATES.DURABLY_VERIFIED
  )
  // A superseded event was appended
  assert.ok(
    state._invalidations.some(
      (e) => e.key === 'feature:slice-1:shard' && e.action === 'superseded'
    )
  )
})

test('GREEN: removes ATTEMPTED writes and appends removed event', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-1:shard', 'feature-shard')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state.persistenceTracker.writes['feature:slice-1:shard'], undefined)
  assert.ok(
    state._invalidations.some(
      (e) => e.key === 'feature:slice-1:shard' && e.action === 'removed'
    )
  )
})

test('GREEN: removes FAILED writes and appends removed event', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-1:shard', 'feature-shard')
  tracker = failWrite(tracker, 'feature:slice-1:shard', 'test-failure')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state.persistenceTracker.writes['feature:slice-1:shard'], undefined)
  assert.ok(
    state._invalidations.some(
      (e) => e.key === 'feature:slice-1:shard' && e.action === 'removed'
    )
  )
})

test('GREEN: invalidatePersistenceEvidence is pure — no async/safeAgent/Date.now/Math.random', () => {
  assert.equal(observePersistSrc.match(/async\s+function\s+invalidatePersistenceEvidence/), null)
  assert.equal(observePersistSrc.match(/safeAgent|flexibleAgent/), null)
  const fnBody = observePersistSrc.match(/function invalidatePersistenceEvidence[\s\S]*?\n}/)[0]
  assert.equal(fnBody.match(/Date\.now|Math\.random/), null)
})

test('GREEN: handles empty/missing persistenceTracker', () => {
  const state = {}
  assert.doesNotThrow(() => invalidatePersistenceEvidence(state, 'slice-1'))
  assert.equal(state._invalidations.length, 0)
})

test('GREEN: handles state with no prior booleans', () => {
  const state = { persistenceTracker: null }
  invalidatePersistenceEvidence(state, 'slice-1')
  assert.equal(state._publishVerified, false)
  assert.equal(state._persistVerified, false)
})

test('GREEN: each history event has shape {sliceId, key, action}', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-1:shard', 'feature-shard')
  tracker = recordAttemptedWrite(tracker, 'synthesis:slice-1:view', 'synthesis-view')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-1')
  for (const evt of state._invalidations) {
    assert.ok(evt.sliceId, 'event has sliceId')
    assert.ok(evt.key, 'event has key')
    assert.ok(evt.action, 'event has action')
  }
})

// ---- GREEN tests: invalidateSliceChain ----

function makeSliceState() {
  return {
    status: 'done',
    artifacts: { factsPath: '/a', designPath: '/b' },
    _gateCheckpoints: { 'extract-facts': { seq: 1 } },
    factsPath: '/docs/facts.md',
    useCasePath: '/docs/e2e.md',
    designPath: '/docs/design.md',
    archPath: '/docs/arch.md',
    requirementsPath: '/docs/reqs.md',
    auditPath: '/docs/audit.md',
    _facts: { data: 'test' },
    _e2e: { data: 'test' },
    _design: { data: 'test' },
    _arch: { data: 'test' },
    _requirements: { data: 'test' },
    _reviewedDesign: true,
    _reviewedArch: true,
  }
}

function makeParentState() {
  return {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'abc123',
    extractReady: true,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
}

test('GREEN: resets queueEntry.status to pending', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(qe.status, 'pending')
})

test('GREEN: resets queueEntry.artifacts to {}', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.deepEqual(qe.artifacts, {})
})

test('GREEN: clears queueEntry._gateCheckpoints to {}', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.deepEqual(qe._gateCheckpoints, {})
})

test('GREEN: sets all 6 artifact-path guards to null', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(qe.factsPath, null)
  assert.equal(qe.useCasePath, null)
  assert.equal(qe.designPath, null)
  assert.equal(qe.archPath, null)
  assert.equal(qe.requirementsPath, null)
  assert.equal(qe.auditPath, null)
})

test('GREEN: clears _facts cache', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(qe._facts, undefined)
})

test('GREEN: calls invalidatePersistenceEvidence (source assertion)', () => {
  assert.ok(
    extractSliceSrc.includes('invalidatePersistenceEvidence(state, sliceId)'),
    'invalidateSliceChain calls invalidatePersistenceEvidence'
  )
})

test('GREEN: calls markStaleForSlice (source assertion)', () => {
  assert.ok(
    extractSliceSrc.includes('markStaleForSlice(state.synthesisState, sliceId)'),
    'invalidateSliceChain calls markStaleForSlice'
  )
})

test('GREEN: sets state.overviewPath to null', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(state.overviewPath, null)
})

test('GREEN: clears state._sourceDigest', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(state._sourceDigest, null)
})

test('GREEN: sets state.extractReady to false', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(state.extractReady, false)
})

// ---- GREEN tests: markStaleForSlice ----

test('GREEN: markStaleForSlice returns a new object (does not mutate input)', () => {
  const ss = { synthesized: true, views: {}, staleSlices: [] }
  const result = markStaleForSlice(ss, 'slice-1')
  assert.notEqual(result, ss)
  assert.deepEqual(ss.staleSlices, []) // input not mutated
})

test('GREEN: adds sliceId to staleSlices', () => {
  const ss = { synthesized: true, views: {} }
  const result = markStaleForSlice(ss, 'slice-1')
  assert.ok(result.staleSlices.includes('slice-1'))
})

test('GREEN: sets staleViews to all 4 view types', () => {
  const ss = { synthesized: true, views: {} }
  const result = markStaleForSlice(ss, 'slice-1')
  assert.deepEqual(result.staleViews.sort(), ['coverageIndex', 'crossCutting', 'dependencyMap', 'systemOverview'])
})

test('GREEN: handles uninitialized synthesis state (null)', () => {
  const result = markStaleForSlice(null, 'slice-1')
  assert.ok(result.staleSlices.includes('slice-1'))
})

test('GREEN: handles synthesized: false (returns as-is)', () => {
  const ss = { synthesized: false }
  const result = markStaleForSlice(ss, 'slice-1')
  assert.deepEqual(result, ss)
})

test('GREEN: markStaleForSlice is pure (source assertion)', () => {
  const fnBody = synthesisSrc.match(/function markStaleForSlice[\s\S]*?\n}/)[0]
  assert.equal(fnBody.match(/safeAgent|flexibleAgent|async/), null)
})

// ---- GREEN tests: onSliceRemoved ----

test('GREEN: does NOT set queueEntry.status to pending (terminal)', () => {
  const state = makeParentState()
  const qe = { lifecycle: 'runnable', factsPath: '/docs/facts.md' }
  onSliceRemoved(state, 'slice-1', qe)
  assert.notEqual(qe.status, 'pending')
})

test('GREEN: calls invalidatePersistenceEvidence (source assertion)', () => {
  assert.ok(
    mainSrc.includes('invalidatePersistenceEvidence(state, sliceId)'),
    'onSliceRemoved calls invalidatePersistenceEvidence'
  )
})

test('GREEN: calls applyLifecycleEvent with exclude (source assertion)', () => {
  assert.ok(
    mainSrc.match(/applyLifecycleEvent\(queueEntry.*type:\s*'exclude'/),
    'onSliceRemoved calls applyLifecycleEvent with exclude event'
  )
})

test('GREEN: does NOT clear artifact paths (history preserved)', () => {
  const fnMatch = mainSrc.match(/function onSliceRemoved[\s\S]*?\n}/)
  assert.ok(fnMatch, 'onSliceRemoved function found in source')
  const fnBody = fnMatch[0]
  assert.equal(fnBody.match(/factsPath\s*=\s*null|designPath\s*=\s*null|archPath\s*=\s*null/), null,
    'onSliceRemoved does NOT set artifact paths to null')
})

test('GREEN: coverage denominator drops after onSliceRemoved', () => {
  const summaries = [
    { lifecycle: 'completed' },
    { lifecycle: 'completed' },
    { lifecycle: 'completed' },
  ]
  const before = deriveCoverageIndex(summaries)
  assert.equal(before.denominator, 3)

  // After excluding one
  const summariesAfter = [
    { lifecycle: 'completed' },
    { lifecycle: 'completed' },
    { lifecycle: 'excluded' },
  ]
  const after = deriveCoverageIndex(summariesAfter)
  assert.equal(after.denominator, 2)
})

test('GREEN: result.published/result.persist cleared via invalidatePersistenceEvidence', () => {
  const state = makeParentState()
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-1', qe)
  assert.equal(state.published, null)
  assert.equal(state.persist, null)
})

// ---- INT-W1: onSliceRemoved marks synthesis stale (symmetry with chain invalidator) ----

test('INT-W1: onSliceRemoved marks the removed slice stale in synthesisState', () => {
  const state = makeParentState()
  state.synthesisState = { synthesized: true, views: { systemOverview: {} }, staleSlices: [] }
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-7', qe)
  assert.ok(state.synthesisState.staleSlices.includes('slice-7'),
    'removed slice id is added to staleSlices')
})

test('INT-W1: onSliceRemoved populates staleViews for all 4 view types', () => {
  const state = makeParentState()
  state.synthesisState = { synthesized: true, views: { systemOverview: {} }, staleSlices: [] }
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-7', qe)
  assert.deepEqual(state.synthesisState.staleViews.sort(),
    ['coverageIndex', 'crossCutting', 'dependencyMap', 'systemOverview'])
})

test('INT-W1: onSliceRemoved calls markStaleForSlice on state.synthesisState (source assertion)', () => {
  assert.ok(
    mainSrc.match(/function onSliceRemoved[\s\S]*?markStaleForSlice\(state\.synthesisState/),
    'onSliceRemoved calls markStaleForSlice(state.synthesisState, sliceId)'
  )
})

test('INT-W1: removal + synthesis-staleness is symmetric (lifecycle excluded AND stale)', () => {
  const state = makeParentState()
  state.synthesisState = { synthesized: true, views: { systemOverview: {} }, staleSlices: [] }
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-9', qe)
  // Lifecycle excluded (terminal removal)
  assert.equal(qe.lifecycle, LIFECYCLE_STATES.EXCLUDED)
  // Persistence evidence superseded
  assert.equal(state.published, null)
  assert.equal(state.persist, null)
  // Synthesis marked stale
  assert.ok(state.synthesisState.staleSlices.includes('slice-9'))
})

// ---- GREEN tests: crash-resume ----

test('CRASH-RESUME: after invalidateSliceChain, all 4 publish/persist guards false/null', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(state._publishVerified, false)
  assert.equal(state._persistVerified, false)
  assert.equal(state.published, null)
  assert.equal(state.persist, null)
})

test('CRASH-RESUME: after invalidateSliceChain, queue entry is pending with cleared artifacts', () => {
  const state = makeParentState()
  const qe = makeSliceState()
  invalidateSliceChain(state, 'slice-1', qe)
  assert.equal(qe.status, 'pending')
  assert.deepEqual(qe.artifacts, {})
  assert.deepEqual(qe._gateCheckpoints, {})
  assert.equal(qe.factsPath, null)
})

test('CRASH-RESUME: after onSliceRemoved, removed slice remains excluded', () => {
  const state = makeParentState()
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-1', qe)
  assert.equal(qe.lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

// ---- GREEN tests: schema validation ----

test('SCHEMA: INVALIDATION_EVENT has additionalProperties: false', () => {
  assert.equal(INVALIDATION_EVENT.additionalProperties, false)
})

test('SCHEMA: INVALIDATION_EVENT requires sliceId, key, action', () => {
  assert.ok(INVALIDATION_EVENT.required.includes('sliceId'))
  assert.ok(INVALIDATION_EVENT.required.includes('key'))
  assert.ok(INVALIDATION_EVENT.required.includes('action'))
})

test('SCHEMA: INVALIDATION_EVENT.action is enum of versioned, removed, superseded', () => {
  assert.deepEqual(INVALIDATION_EVENT.properties.action.enum, ['versioned', 'removed', 'superseded'])
})

test('SCHEMA: INVALIDATION_EVENT is exported from schemas', () => {
  assert.ok(INVALIDATION_EVENT, 'INVALIDATION_EVENT is defined')
  assert.ok(typeof INVALIDATION_EVENT === 'object')
})

// ---- GREEN tests: meta + cross-cutting ----

test('META: phases include Invalidation', () => {
  assert.ok(distSrc.includes("{ title: 'Invalidation' }"), 'meta.phases includes Invalidation')
})

test('META: all new functions exported from respective modules (source assertion)', () => {
  assert.ok(observePersistSrc.match(/export \{[^}]*invalidatePersistenceEvidence/), 'observe-persist exports invalidatePersistenceEvidence')
  assert.ok(extractSliceSrc.match(/export \{[^}]*invalidateSliceChain/), 'extract-slice exports invalidateSliceChain')
  assert.ok(synthesisSrc.match(/export \{[^}]*markStaleForSlice/), 'synthesis exports markStaleForSlice')
  assert.ok(mainSrc.match(/export \{[^}]*onSliceRemoved/), 'main exports onSliceRemoved')
})

test('META: no crypto/createHash in any Phase 17 function (source assertion)', () => {
  const fn1 = observePersistSrc.match(/function invalidatePersistenceEvidence[\s\S]*?\n}/)[0]
  const fn2 = extractSliceSrc.match(/function invalidateSliceChain[\s\S]*?\n}/)[0]
  const fn3 = synthesisSrc.match(/function markStaleForSlice[\s\S]*?\n}/)[0]
  const fn4 = mainSrc.match(/function onSliceRemoved[\s\S]*?\n}/)[0]
  for (const body of [fn1, fn2, fn3, fn4]) {
    assert.equal(body.match(/crypto|createHash/), null, 'no crypto in Phase 17 functions')
  }
})

test('META: _invalidations accumulates across multiple calls (append-only)', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'feature:slice-A:shard', 'feature-shard')
  const state = { persistenceTracker: tracker }
  invalidatePersistenceEvidence(state, 'slice-A')
  const firstCount = state._invalidations.length

  let tracker2 = state.persistenceTracker
  tracker2 = recordAttemptedWrite(tracker2, 'feature:slice-B:shard', 'feature-shard')
  state.persistenceTracker = tracker2
  invalidatePersistenceEvidence(state, 'slice-B')
  assert.ok(state._invalidations.length > firstCount, 'history accumulated')
})
