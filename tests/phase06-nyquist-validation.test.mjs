// Phase 6 Nyquist validation: SYNTH-01 + OBSERVE-01 + STATUS-01
// Edge cases, error paths, default fallbacks, boundary conditions, and
// structural assertions that complement the primary synthesis-status tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  VIEW_TYPES,
  createSynthesisState,
  synthesizeProjectViews,
  isSynthesisCurrent,
  invalidateStaleViews,
  synthesisSummary,
  deriveCoverageIndex,
  deriveDependencyMap,
  deriveCrossCutting,
  deriveSystemOverview,
  PERSISTENCE_STATES,
  PERSIST_UNIT_TYPES,
  createPersistenceTracker,
  recordAttemptedWrite,
  verifyDurableWrite,
  failWrite,
  isRetrySafe,
  isDurablyVerified,
  persistenceReport,
  READINESS_REASONS,
  deriveExtractReadiness,
  projectStatusProjection,
  projectionsMatch,
  readinessSummary,
  countLifecycleStates,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ===== SYNTH-01: Incremental synthesis edge cases =====

test('SYNTH-01[NYQUIST]: VIEW_TYPES has exactly 4 frozen entries', () => {
  assert.ok(Object.isFrozen(VIEW_TYPES))
  const keys = Object.keys(VIEW_TYPES)
  assert.equal(keys.length, 4)
  assert.equal(VIEW_TYPES.SYSTEM_OVERVIEW, 'systemOverview')
  assert.equal(VIEW_TYPES.DEPENDENCY_MAP, 'dependencyMap')
  assert.equal(VIEW_TYPES.CROSS_CUTTING, 'crossCutting')
  assert.equal(VIEW_TYPES.COVERAGE_INDEX, 'coverageIndex')
})

test('SYNTH-01[NYQUIST]: synthesizeProjectViews with non-array summaries defaults to empty', () => {
  const state = synthesizeProjectViews(null, createSynthesisState(), { scope: 'r1' })
  assert.ok(state.synthesized)
  assert.equal(state.views.systemOverview.totalModules, 0)
  assert.equal(state.views.dependencyMap.totalEdges, 0)
})

test('SYNTH-01[NYQUIST]: synthesizeProjectViews with string summaries defaults to empty', () => {
  const state = synthesizeProjectViews('not-an-array', createSynthesisState(), { scope: 'r1' })
  assert.ok(state.synthesized)
  assert.equal(state.views.systemOverview.totalModules, 0)
})

test('SYNTH-01[NYQUIST]: synthesizeProjectViews with null oldState creates fresh state', () => {
  const summaries = [{ id: 'x', lifecycle: 'completed' }]
  const state = synthesizeProjectViews(summaries, null, { scope: 'r1' })
  assert.ok(state.synthesized)
  assert.equal(state.views.systemOverview.totalModules, 1)
})

test('SYNTH-01[NYQUIST]: synthesizeProjectViews with null revisions treated as empty', () => {
  const summaries = [{ id: 'x', lifecycle: 'completed' }]
  const state = synthesizeProjectViews(summaries, createSynthesisState(), null)
  assert.ok(state.synthesized)
  assert.deepEqual(state.viewRevisions, {})
})

test('SYNTH-01[NYQUIST]: revision-only change triggers rebuild even with unchanged digests', () => {
  const summaries = [{ id: 'x', lifecycle: 'completed' }]
  const state1 = synthesizeProjectViews(summaries, createSynthesisState(), { scope: 'r1' })
  // Same summaries but different scope revision — should NOT be identity
  const state2 = synthesizeProjectViews(summaries, state1, { scope: 'r2' })
  assert.notStrictEqual(state2, state1)
  assert.equal(state2.viewRevisions.scope, 'r2')
})

test('SYNTH-01[NYQUIST]: adding a new feature triggers rebuild', () => {
  const s1 = [{ id: 'a', lifecycle: 'completed' }]
  const s2 = [{ id: 'a', lifecycle: 'completed' }, { id: 'b', lifecycle: 'completed' }]
  const revs = { scope: 'r1' }
  const state1 = synthesizeProjectViews(s1, createSynthesisState(), revs)
  const state2 = synthesizeProjectViews(s2, state1, revs)
  assert.equal(state2.views.systemOverview.totalModules, 2)
  assert.equal(state1.views.systemOverview.totalModules, 1)
})

test('SYNTH-01[NYQUIST]: removing a feature triggers rebuild', () => {
  const s1 = [{ id: 'a', lifecycle: 'completed' }, { id: 'b', lifecycle: 'completed' }]
  const s2 = [{ id: 'a', lifecycle: 'completed' }]
  const revs = { scope: 'r1' }
  const state1 = synthesizeProjectViews(s1, createSynthesisState(), revs)
  const state2 = synthesizeProjectViews(s2, state1, revs)
  assert.equal(state2.views.systemOverview.totalModules, 1)
})

test('SYNTH-01[NYQUIST]: isSynthesisCurrent with null currentRevisions returns true for synthesized', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', lifecycle: 'completed' }], createSynthesisState(), { scope: 'r1' }
  )
  assert.ok(isSynthesisCurrent(state, null))
  assert.ok(isSynthesisCurrent(state, undefined))
  assert.ok(isSynthesisCurrent(state, {}))
})

test('SYNTH-01[NYQUIST]: isSynthesisCurrent false when extra revision key not in viewRevisions', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', lifecycle: 'completed' }], createSynthesisState(), { scope: 'r1' }
  )
  assert.ok(!isSynthesisCurrent(state, { scope: 'r1', graph: 'new-key' }))
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews with graph input affects dependencyMap', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', name: 'A', lifecycle: 'completed', dependencies: ['b'], crossCuttingConcerns: [] }],
    createSynthesisState(), { scope: 'r1' }
  )
  const inv = invalidateStaleViews(state, { changedInputs: ['graph'] })
  assert.ok(inv.staleViews.indexOf('dependencyMap') !== -1)
  assert.ok(inv.staleViews.indexOf('systemOverview') === -1)
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews with artifact input affects systemOverview', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', name: 'A', lifecycle: 'completed', dependencies: [], crossCuttingConcerns: [] }],
    createSynthesisState(), { scope: 'r1' }
  )
  const inv = invalidateStaleViews(state, { changedInputs: ['artifact'] })
  assert.ok(inv.staleViews.indexOf('systemOverview') !== -1)
  assert.ok(inv.staleViews.indexOf('coverageIndex') === -1)
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews with deps input affects dependencyMap', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', name: 'A', lifecycle: 'completed', dependencies: [], crossCuttingConcerns: [] }],
    createSynthesisState(), { scope: 'r1' }
  )
  const inv = invalidateStaleViews(state, { changedInputs: ['deps'] })
  assert.ok(inv.staleViews.indexOf('dependencyMap') !== -1)
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews with unknown input returns state unchanged', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', lifecycle: 'completed' }], createSynthesisState(), { scope: 'r1' }
  )
  const result = invalidateStaleViews(state, { changedInputs: ['unknown-type'] })
  assert.strictEqual(result, state)
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews on unsynthesized state returns empty state', () => {
  const empty = createSynthesisState()
  const result = invalidateStaleViews(empty, { changedInputs: ['source'] })
  assert.deepEqual(result, createSynthesisState())
})

test('SYNTH-01[NYQUIST]: invalidateStaleViews with null revisionDelta returns state', () => {
  const state = synthesizeProjectViews(
    [{ id: 'a', lifecycle: 'completed' }], createSynthesisState(), { scope: 'r1' }
  )
  const result = invalidateStaleViews(state, null)
  assert.strictEqual(result, state)
})

test('SYNTH-01[NYQUIST]: synthesisSummary with null state returns unsynthesized', () => {
  const summary = synthesisSummary(null)
  assert.equal(summary.synthesized, false)
  assert.equal(summary.views, 0)
})

test('SYNTH-01[NYQUIST]: deriveCoverageIndex with in-progress lifecycle is counted', () => {
  const ci = deriveCoverageIndex([
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'in-progress' },
    { id: 'c', lifecycle: 'runnable' },
  ])
  assert.equal(ci.denominator, 3)
  assert.equal(ci.completed, 1)
  assert.equal(ci.remaining, 2) // runnable + in-progress
})

test('SYNTH-01[NYQUIST]: deriveCoverageIndex remaining includes runnable + deferred + in-progress', () => {
  const ci = deriveCoverageIndex([
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'runnable' },
    { id: 'c', lifecycle: 'deferred' },
    { id: 'd', lifecycle: 'in-progress' },
  ])
  assert.equal(ci.remaining, 3)
})

test('SYNTH-01[NYQUIST]: deriveCoverageIndex with skipped lifecycle', () => {
  const ci = deriveCoverageIndex([
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'skipped' },
  ])
  assert.equal(ci.denominator, 2)
  assert.equal(ci.skipped, 1)
})

test('SYNTH-01[NYQUIST]: deriveCoverageIndex default lifecycle for missing field', () => {
  const ci = deriveCoverageIndex([
    { id: 'a' }, // no lifecycle field — defaults to 'runnable'
    { id: 'b', lifecycle: 'completed' },
  ])
  assert.equal(ci.remaining, 1) // runnable counts toward remaining
  assert.equal(ci.completed, 1)
})

test('SYNTH-01[NYQUIST]: deriveCoverageIndex with empty array', () => {
  const ci = deriveCoverageIndex([])
  assert.equal(ci.denominator, 0)
  assert.equal(ci.completed, 0)
  assert.equal(ci.remaining, 0)
})

test('SYNTH-01[NYQUIST]: deriveDependencyMap with missing dependencies field', () => {
  const dm = deriveDependencyMap([
    { id: 'a' }, // no dependencies field
    { id: 'b', dependencies: ['a'] },
  ])
  assert.equal(dm.totalEdges, 1)
  assert.equal(dm.edges[0].from, 'b')
  assert.equal(dm.edges[0].to, 'a')
})

test('SYNTH-01[NYQUIST]: deriveDependencyMap with empty array', () => {
  const dm = deriveDependencyMap([])
  assert.equal(dm.totalEdges, 0)
  assert.equal(dm.edges.length, 0)
})

test('SYNTH-01[NYQUIST]: deriveCrossCutting with missing crossCuttingConcerns field', () => {
  const cc = deriveCrossCutting([
    { id: 'a' }, // no crossCuttingConcerns
    { id: 'b', crossCuttingConcerns: ['auth'] },
    { id: 'c', crossCuttingConcerns: ['auth'] },
  ])
  assert.equal(cc.sharedConcerns.length, 1)
  assert.equal(cc.sharedConcerns[0].concern, 'auth')
})

test('SYNTH-01[NYQUIST]: deriveCrossCutting sorts concerns alphabetically', () => {
  const cc = deriveCrossCutting([
    { id: 'a', crossCuttingConcerns: ['zeta', 'alpha'] },
    { id: 'b', crossCuttingConcerns: ['zeta', 'alpha'] },
  ])
  assert.equal(cc.sharedConcerns[0].concern, 'alpha')
  assert.equal(cc.sharedConcerns[1].concern, 'zeta')
})

test('SYNTH-01[NYQUIST]: deriveSystemOverview uses id when name missing', () => {
  const so = deriveSystemOverview([{ id: 'a' }])
  assert.equal(so.modules[0].name, 'a')
})

test('SYNTH-01[NYQUIST]: deriveSystemOverview defaults lifecycle to runnable', () => {
  const so = deriveSystemOverview([{ id: 'a' }])
  assert.equal(so.modules[0].lifecycle, 'runnable')
})

test('SYNTH-01[NYQUIST]: deriveSystemOverview defaults artifacts to empty object', () => {
  const so = deriveSystemOverview([{ id: 'a' }])
  assert.deepEqual(so.modules[0].artifacts, {})
})

test('SYNTH-01[NYQUIST]: digest change detection uses JSON content not reference', () => {
  const summaries1 = [{ id: 'a', lifecycle: 'completed', artifacts: { x: '1' } }]
  const summaries2 = [{ id: 'a', lifecycle: 'completed', artifacts: { x: '2' } }]
  const revs = { scope: 'r1' }
  const state1 = synthesizeProjectViews(summaries1, createSynthesisState(), revs)
  const state2 = synthesizeProjectViews(summaries2, state1, revs)
  assert.notStrictEqual(state2, state1)
})

// ===== OBSERVE-01: Persistence tracking error paths =====

test('OBSERVE-01[NYQUIST]: PERSISTENCE_STATES has 3 frozen entries', () => {
  assert.ok(Object.isFrozen(PERSISTENCE_STATES))
  const keys = Object.keys(PERSISTENCE_STATES)
  assert.equal(keys.length, 3)
  assert.equal(PERSISTENCE_STATES.ATTEMPTED, 'attempted')
  assert.equal(PERSISTENCE_STATES.DURABLY_VERIFIED, 'durably-verified')
  assert.equal(PERSISTENCE_STATES.FAILED, 'failed')
})

test('OBSERVE-01[NYQUIST]: PERSIST_UNIT_TYPES has 4 entries including CONTINUATION_ACK', () => {
  assert.ok(Object.isFrozen(PERSIST_UNIT_TYPES))
  const keys = Object.keys(PERSIST_UNIT_TYPES)
  assert.equal(keys.length, 4)
  assert.equal(PERSIST_UNIT_TYPES.FEATURE_SHARD, 'feature-shard')
  assert.equal(PERSIST_UNIT_TYPES.PROJECT_INDEX, 'project-index')
  assert.equal(PERSIST_UNIT_TYPES.SYNTHESIS_VIEW, 'synthesis-view')
  // Verify the corrected spelling (was CONTINUUATION_ACK with double-U)
  assert.equal(PERSIST_UNIT_TYPES.CONTINUATION_ACK, 'continuation-ack')
})

test('OBSERVE-01[NYQUIST]: recordAttemptedWrite throws for null tracker', () => {
  assert.throws(() => recordAttemptedWrite(null, 'key'), /tracker must be an object/)
})

test('OBSERVE-01[NYQUIST]: recordAttemptedWrite throws for missing key', () => {
  assert.throws(() => recordAttemptedWrite(createPersistenceTracker(), ''), /key is required/)
})

test('OBSERVE-01[NYQUIST]: verifyDurableWrite throws for null tracker', () => {
  assert.throws(() => verifyDurableWrite(null, 'key'), /tracker must be an object/)
})

test('OBSERVE-01[NYQUIST]: verifyDurableWrite throws for missing key', () => {
  assert.throws(() => verifyDurableWrite(createPersistenceTracker(), ''), /key is required/)
})

test('OBSERVE-01[NYQUIST]: failWrite throws for null tracker', () => {
  assert.throws(() => failWrite(null, 'key'), /tracker must be an object/)
})

test('OBSERVE-01[NYQUIST]: failWrite throws for missing key', () => {
  assert.throws(() => failWrite(createPersistenceTracker(), ''), /key is required/)
})

test('OBSERVE-01[NYQUIST]: failWrite for key with no prior attempt', () => {
  let tracker = createPersistenceTracker()
  tracker = failWrite(tracker, 'never-attempted', 'initial-failure')
  assert.equal(tracker.writes['never-attempted'].state, PERSISTENCE_STATES.FAILED)
  assert.equal(tracker.writes['never-attempted'].attempts, 0)
  assert.equal(tracker.writes['never-attempted'].failReason, 'initial-failure')
})

test('OBSERVE-01[NYQUIST]: failWrite defaults reason to unknown', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'key-a')
  tracker = failWrite(tracker, 'key-a')
  assert.equal(tracker.writes['key-a'].failReason, 'unknown')
})

test('OBSERVE-01[NYQUIST]: recordAttemptedWrite default unitType is feature-shard', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'key-a')
  assert.equal(tracker.writes['key-a'].unitType, PERSIST_UNIT_TYPES.FEATURE_SHARD)
})

test('OBSERVE-01[NYQUIST]: recordAttemptedWrite preserves unitType on re-attempt', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'key-a', PERSIST_UNIT_TYPES.SYNTHESIS_VIEW)
  tracker = failWrite(tracker, 'key-a', 'err')
  tracker = recordAttemptedWrite(tracker, 'key-a')
  assert.equal(tracker.writes['key-a'].unitType, PERSIST_UNIT_TYPES.SYNTHESIS_VIEW)
})

test('OBSERVE-01[NYQUIST]: failWrite preserves unitType from existing entry', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'key-a', PERSIST_UNIT_TYPES.PROJECT_INDEX)
  tracker = failWrite(tracker, 'key-a', 'err')
  assert.equal(tracker.writes['key-a'].unitType, PERSIST_UNIT_TYPES.PROJECT_INDEX)
})

test('OBSERVE-01[NYQUIST]: isRetrySafe with null tracker returns true', () => {
  assert.ok(isRetrySafe(null, 'any-key'))
})

test('OBSERVE-01[NYQUIST]: isRetrySafe with undefined tracker returns true', () => {
  assert.ok(isRetrySafe(undefined, 'any-key'))
})

test('OBSERVE-01[NYQUIST]: isDurablyVerified with null tracker returns false', () => {
  assert.ok(!isDurablyVerified(null, 'any-key'))
})

test('OBSERVE-01[NYQUIST]: isDurablyVerified with undefined tracker returns false', () => {
  assert.ok(!isDurablyVerified(undefined, 'any-key'))
})

test('OBSERVE-01[NYQUIST]: persistenceReport byType includes total per type', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'a', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  tracker = recordAttemptedWrite(tracker, 'b', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  tracker = verifyDurableWrite(tracker, 'a')
  const report = persistenceReport(tracker)
  assert.equal(report.byType['feature-shard'].total, 2)
  assert.equal(report.byType['feature-shard'].verified, 1)
  assert.equal(report.byType['feature-shard'].attempted, 1)
})

test('OBSERVE-01[NYQUIST]: persistenceReport with empty tracker returns zeros', () => {
  const report = persistenceReport(createPersistenceTracker())
  assert.equal(report.total, 0)
  assert.equal(report.attempted, 0)
  assert.equal(report.verified, 0)
  assert.equal(report.failed, 0)
  assert.deepEqual(report.byType, {})
})

test('OBSERVE-01[NYQUIST]: full lifecycle attempt → verify → cannot-retry', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'unit-1')
  assert.ok(isRetrySafe(tracker, 'unit-1'))
  tracker = verifyDurableWrite(tracker, 'unit-1')
  assert.ok(!isRetrySafe(tracker, 'unit-1'))
  assert.ok(isDurablyVerified(tracker, 'unit-1'))
})

test('OBSERVE-01[NYQUIST]: full lifecycle attempt → fail → retry → verify', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'unit-1')
  tracker = failWrite(tracker, 'unit-1', 'transient')
  assert.ok(isRetrySafe(tracker, 'unit-1'))
  assert.ok(!isDurablyVerified(tracker, 'unit-1'))
  tracker = recordAttemptedWrite(tracker, 'unit-1')
  assert.equal(tracker.writes['unit-1'].attempts, 2)
  tracker = verifyDurableWrite(tracker, 'unit-1')
  assert.ok(isDurablyVerified(tracker, 'unit-1'))
  assert.equal(tracker.writes['unit-1'].attempts, 2) // verify does not increment
})

test('OBSERVE-01[NYQUIST]: history records full audit trail', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'k')
  tracker = failWrite(tracker, 'k', 'err')
  tracker = recordAttemptedWrite(tracker, 'k')
  tracker = verifyDurableWrite(tracker, 'k')
  assert.equal(tracker.history.length, 4)
  assert.equal(tracker.history[0].action, 'attempted')
  assert.equal(tracker.history[1].action, 'failed')
  assert.equal(tracker.history[2].action, 'attempted')
  assert.equal(tracker.history[3].action, 'verified')
})

// ===== STATUS-01: Readiness and projection edge cases =====

test('STATUS-01[NYQUIST]: deriveExtractReadiness with undefined state', () => {
  const result = deriveExtractReadiness(undefined)
  assert.ok(!result.ready)
  assert.ok(result.checks)
  assert.equal(result.checks.discoveryExhausted, false)
})

test('STATUS-01[NYQUIST]: deriveExtractReadiness with non-object state', () => {
  const result = deriveExtractReadiness('invalid')
  assert.ok(!result.ready)
  assert.ok(result.checks)
  assert.equal(result.checks.graphValid, false)
})

test('STATUS-01[NYQUIST]: deriveExtractReadiness with empty features and all conditions met', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(result.ready)
  assert.equal(result.incompleteCount, 0)
})

test('STATUS-01[NYQUIST]: deriveExtractReadiness checks all five conditions independently', () => {
  const base = {
    discoveryExhausted: true,
    graphValid: true,
    features: [],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  // Toggle each off independently
  for (const key of ['discoveryExhausted', 'graphValid', 'synthesisCurrent', 'artifactsCurrent']) {
    const toggled = Object.assign({}, base, { [key]: false })
    const result = deriveExtractReadiness(toggled)
    assert.ok(!result.ready, `${key}=false should block readiness`)
    assert.equal(result.checks[key], false)
  }
})

test('STATUS-01[NYQUIST]: deriveExtractReadiness with mixed incomplete lifecycle states', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'in-progress' },
      { id: 'c', lifecycle: 'runnable' },
      { id: 'd', lifecycle: 'deferred' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.FEATURES_INCOMPLETE)
  assert.equal(result.incompleteCount, 3)
})

test('STATUS-01[NYQUIST]: deriveExtractReadiness counts excluded in denominator but not incomplete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'excluded' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(result.ready)
  assert.equal(result.counts.denominator, 1) // excluded subtracted
  assert.equal(result.incompleteCount, 0)
})

test('STATUS-01[NYQUIST]: READINESS_REASONS has 6 frozen entries', () => {
  assert.ok(Object.isFrozen(READINESS_REASONS))
  const keys = Object.keys(READINESS_REASONS)
  assert.equal(keys.length, 6)
  assert.equal(READINESS_REASONS.DISCOVERY_INCOMPLETE, 'discovery-not-exhausted')
  assert.equal(READINESS_REASONS.GRAPH_INVALID, 'graph-invalid')
  assert.equal(READINESS_REASONS.FEATURES_INCOMPLETE, 'features-incomplete')
  assert.equal(READINESS_REASONS.SYNTHESIS_STALE, 'synthesis-stale')
  assert.equal(READINESS_REASONS.ARTIFACTS_STALE, 'artifacts-stale')
  assert.equal(READINESS_REASONS.ALL_MET, 'all-conditions-met')
})

test('STATUS-01[NYQUIST]: projectStatusProjection with missing optional fields', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const projection = projectStatusProjection(state)
  assert.ok(Object.isFrozen(projection))
  assert.ok(projection.ready)
  assert.equal(projection.revisions, null)
  assert.equal(projection.budget, null)
  assert.deepEqual(projection.failures, [])
  assert.equal(projection.continuation, null)
  assert.equal(projection.planDir, null)
})

test('STATUS-01[NYQUIST]: projectionsMatch with null inputs returns false', () => {
  assert.ok(!projectionsMatch(null, null))
  assert.ok(!projectionsMatch(null, { ready: true }))
  assert.ok(!projectionsMatch({ ready: true }, null))
})

test('STATUS-01[NYQUIST]: projectionsMatch with undefined inputs returns false', () => {
  assert.ok(!projectionsMatch(undefined, undefined))
})

test('STATUS-01[NYQUIST]: readinessSummary for NOT READY projection', () => {
  const state = {
    discoveryExhausted: false,
    graphValid: true,
    features: [],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const projection = projectStatusProjection(state)
  const summary = readinessSummary(projection)
  assert.ok(summary.includes('NOT READY'))
  assert.ok(summary.includes('discovery-not-exhausted'))
  assert.ok(summary.includes('[ ]'))
})

test('STATUS-01[NYQUIST]: readinessSummary with null projection returns fallback', () => {
  const summary = readinessSummary(null)
  assert.equal(summary, 'No projection available.')
})

test('STATUS-01[NYQUIST]: readinessSummary includes incomplete count when > 0', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'deferred' },
      { id: 'c', lifecycle: 'blocked' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const projection = projectStatusProjection(state)
  const summary = readinessSummary(projection)
  assert.ok(summary.includes('Incomplete: 2'))
})

test('STATUS-01[NYQUIST]: countLifecycleStates with empty array', () => {
  const counts = countLifecycleStates([])
  assert.equal(counts.denominator, 0)
  assert.equal(counts.completed, 0)
})

test('STATUS-01[NYQUIST]: countLifecycleStates with null features throws', () => {
  assert.throws(() => countLifecycleStates(null), TypeError)
})

test('STATUS-01[NYQUIST]: countLifecycleStates with unknown lifecycle counts in denominator', () => {
  const counts = countLifecycleStates([
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'unknown-state' },
  ])
  assert.equal(counts.denominator, 2) // unknown state still in denominator
  assert.equal(counts.completed, 1)
})

test('STATUS-01[NYQUIST]: frozen projection cannot be mutated', () => {
  const state = {
    discoveryExhausted: true, graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true, artifactsCurrent: true,
  }
  const projection = projectStatusProjection(state)
  assert.throws(() => { projection.ready = false }, TypeError)
})

test('STATUS-01[NYQUIST]: empty projection is frozen at top level', () => {
  const projection = projectStatusProjection(null)
  assert.ok(Object.isFrozen(projection))
  // Object.freeze is shallow — nested objects are not frozen, but the
  // top-level immutability is the invariant (consumers cannot reassign
  // ready, denominator, etc.).
})

test('STATUS-01[NYQUIST]: projection lifecycleOutcomes has all 8 state keys', () => {
  const projection = projectStatusProjection(null)
  const keys = Object.keys(projection.lifecycleOutcomes)
  assert.ok(keys.includes('completed'))
  assert.ok(keys.includes('deferred'))
  assert.ok(keys.includes('blocked'))
  assert.ok(keys.includes('failed'))
  assert.ok(keys.includes('skipped'))
  assert.ok(keys.includes('excluded'))
  assert.ok(keys.includes('in-progress'))
  assert.ok(keys.includes('runnable'))
  assert.equal(keys.length, 8)
})

// ===== Build/Structural regression gates =====

test('REGRESSION[NYQUIST]: synthesis source uses hyphenated in-progress key', () => {
  // The dist concatenates lifecycle.mjs (which uses camelCase inProgress
  // with explicit if/else — correct) and synthesis.mjs (which uses generic
  // counts[lc] lookup — must use hyphenated key). Check the source directly.
  const synthSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/synthesis.mjs', import.meta.url), 'utf8')
  assert.ok(synthSrc.includes("'in-progress': 0"),
    'deriveCoverageIndex must use hyphenated in-progress key')
  assert.ok(!synthSrc.includes('counts.inProgress'),
    'deriveCoverageIndex must not reference camelCase inProgress in synthesis')
})

test('REGRESSION[NYQUIST]: dist uses correct CONTINUATION_ACK spelling', () => {
  assert.ok(source.includes('CONTINUATION_ACK'),
    'PERSIST_UNIT_TYPES must use correct CONTINUATION_ACK spelling')
  assert.ok(!source.includes('CONTINUUATION_ACK'),
    'PERSIST_UNIT_TYPES must not have double-U typo')
})

test('REGRESSION[NYQUIST]: all three Phase 6 modules present in dist', () => {
  for (const exportName of [
    'createSynthesisState', 'synthesizeProjectViews', 'isSynthesisCurrent',
    'invalidateStaleViews', 'synthesisSummary',
    'createPersistenceTracker', 'recordAttemptedWrite', 'verifyDurableWrite',
    'failWrite', 'isRetrySafe', 'isDurablyVerified', 'persistenceReport',
    'deriveExtractReadiness', 'projectStatusProjection', 'projectionsMatch',
    'readinessSummary', 'countLifecycleStates',
  ]) {
    assert.ok(source.includes(exportName), `${exportName} must be in dist`)
  }
})

test('REGRESSION[NYQUIST]: no forbidden tokens in Phase 6 source modules', () => {
  for (const mod of ['synthesis', 'observe-persist', 'status-truth']) {
    const src = readFileSync(
      new URL(`../plugins/feature-workflows/workflows/src/${mod}.mjs`, import.meta.url), 'utf8')
    assert.ok(!src.match(/require\s*\(/), `no require() in ${mod}`)
    assert.ok(!src.match(/Date\.now/), `no Date.now in ${mod}`)
    assert.ok(!src.match(/Math\.random/), `no Math.random in ${mod}`)
    assert.ok(!src.match(/new Date/), `no new Date in ${mod}`)
  }
})
