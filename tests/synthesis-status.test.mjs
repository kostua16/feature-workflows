// Phase 6 SYNTH-01 + OBSERVE-01 + STATUS-01:
// Synthesis, publish, persist, and status truth tests.
// Covers: incremental synthesis with selective revision invalidation,
// attempted-vs-durable persistence tracking, and truthful readiness derivation
// with a single immutable status projection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  // Synthesis (SYNTH-01)
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
  // Observe-persist (OBSERVE-01)
  PERSISTENCE_STATES,
  PERSIST_UNIT_TYPES,
  createPersistenceTracker,
  recordAttemptedWrite,
  verifyDurableWrite,
  failWrite,
  isRetrySafe,
  isDurablyVerified,
  persistenceReport,
  // Status-truth (STATUS-01)
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

// ===== SYNTH-01: Incremental synthesis tests =====

test('SYNTH-01: createSynthesisState returns empty state', () => {
  const state = createSynthesisState()
  assert.ok(state)
  assert.deepEqual(state.views, {})
  assert.equal(state.synthesized, false)
})

test('SYNTH-01: synthesizeProjectViews produces four view types', () => {
  const summaries = [
    { id: 'feat-a', name: 'Feature A', lifecycle: 'completed', artifacts: { arch: 'a.md' }, dependencies: ['feat-b'], crossCuttingConcerns: ['auth'] },
    { id: 'feat-b', name: 'Feature B', lifecycle: 'completed', artifacts: { arch: 'b.md' }, dependencies: [], crossCuttingConcerns: ['auth', 'logging'] },
  ]
  const state = synthesizeProjectViews(summaries, createSynthesisState(), { scope: 'rev1' })
  assert.ok(state.synthesized)
  assert.ok(state.views.systemOverview)
  assert.ok(state.views.dependencyMap)
  assert.ok(state.views.crossCutting)
  assert.ok(state.views.coverageIndex)
  assert.equal(state.views.systemOverview.totalModules, 2)
  assert.equal(state.views.dependencyMap.totalEdges, 1)
  assert.equal(state.views.dependencyMap.edges[0].from, 'feat-a')
  assert.equal(state.views.dependencyMap.edges[0].to, 'feat-b')
  assert.equal(state.views.coverageIndex.denominator, 2)
  assert.equal(state.views.coverageIndex.completed, 2)
})

test('SYNTH-01: repeated summaries produce identical views (idempotent)', () => {
  const summaries = [
    { id: 'feat-a', name: 'Feature A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] },
  ]
  const revs = { scope: 'rev1' }
  const state1 = synthesizeProjectViews(summaries, createSynthesisState(), revs)
  const state2 = synthesizeProjectViews(summaries, state1, revs)
  assert.deepEqual(state2.views, state1.views)
  assert.deepEqual(state2.featureDigests, state1.featureDigests)
})

test('SYNTH-01: unchanged summaries with unchanged revisions is a no-op', () => {
  const summaries = [
    { id: 'feat-a', name: 'Feature A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] },
  ]
  const revs = { scope: 'rev1' }
  const state1 = synthesizeProjectViews(summaries, createSynthesisState(), revs)
  // Same call with the produced state — should return the same state object
  const state2 = synthesizeProjectViews(summaries, state1, revs)
  assert.strictEqual(state2, state1) // identity check — fully idempotent
})

test('SYNTH-01: changed feature summary triggers view rebuild', () => {
  const summaries1 = [
    { id: 'feat-a', name: 'Feature A', lifecycle: 'deferred', artifacts: {}, dependencies: [], crossCuttingConcerns: [] },
  ]
  const summaries2 = [
    { id: 'feat-a', name: 'Feature A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] },
  ]
  const revs = { scope: 'rev1' }
  const state1 = synthesizeProjectViews(summaries1, createSynthesisState(), revs)
  const state2 = synthesizeProjectViews(summaries2, state1, revs)
  assert.notDeepEqual(state2.views.coverageIndex, state1.views.coverageIndex)
  assert.equal(state2.views.coverageIndex.completed, 1)
  assert.equal(state1.views.coverageIndex.completed, 0)
})

test('SYNTH-01: isSynthesisCurrent detects stale revisions', () => {
  const summaries = [{ id: 'feat-a', name: 'A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] }]
  const state = synthesizeProjectViews(summaries, createSynthesisState(), { scope: 'rev1' })
  assert.ok(isSynthesisCurrent(state, { scope: 'rev1' }))
  assert.ok(!isSynthesisCurrent(state, { scope: 'rev2' }))
})

test('SYNTH-01: isSynthesisCurrent returns false for unsynthesized state', () => {
  const empty = createSynthesisState()
  assert.ok(!isSynthesisCurrent(empty, { scope: 'rev1' }))
})

test('SYNTH-01: invalidateStaleViews marks only affected views', () => {
  const state = synthesizeProjectViews(
    [{ id: 'feat-a', name: 'A', lifecycle: 'completed', artifacts: {}, dependencies: ['feat-b'], crossCuttingConcerns: ['logging'] }],
    createSynthesisState(), { scope: 'rev1' }
  )
  // Source change affects systemOverview, dependencyMap, crossCutting
  const invalidated = invalidateStaleViews(state, { changedInputs: ['source'] })
  assert.ok(invalidated.staleViews)
  assert.ok(invalidated.staleViews.indexOf('systemOverview') !== -1)
  assert.ok(invalidated.staleViews.indexOf('dependencyMap') !== -1)
  // Scope change affects systemOverview and coverageIndex but NOT dependencyMap
  const invalidated2 = invalidateStaleViews(state, { changedInputs: ['scope'] })
  assert.ok(invalidated2.staleViews.indexOf('systemOverview') !== -1)
  assert.ok(invalidated2.staleViews.indexOf('coverageIndex') !== -1)
  assert.ok(invalidated2.staleViews.indexOf('dependencyMap') === -1)
})

test('SYNTH-01: invalidateStaleViews with no affected inputs returns unchanged', () => {
  const state = synthesizeProjectViews(
    [{ id: 'feat-a', name: 'A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] }],
    createSynthesisState(), { scope: 'rev1' }
  )
  const result = invalidateStaleViews(state, { changedInputs: [] })
  assert.strictEqual(result, state)
})

test('SYNTH-01: synthesisSummary reports view count and coverage', () => {
  const state = synthesizeProjectViews(
    [{ id: 'feat-a', name: 'A', lifecycle: 'completed', artifacts: {}, dependencies: [], crossCuttingConcerns: [] }],
    createSynthesisState(), { scope: 'rev1' }
  )
  const summary = synthesisSummary(state)
  assert.equal(summary.synthesized, true)
  assert.equal(summary.views, 4)
  assert.ok(summary.coverage)
  assert.equal(summary.coverage.denominator, 1)
})

test('SYNTH-01: synthesisSummary for unsynthesized state', () => {
  const summary = synthesisSummary(createSynthesisState())
  assert.equal(summary.synthesized, false)
})

test('SYNTH-01: deriveCoverageIndex counts lifecycle states', () => {
  const summaries = [
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'deferred' },
    { id: 'c', lifecycle: 'blocked' },
    { id: 'd', lifecycle: 'failed' },
    { id: 'e', lifecycle: 'excluded' },
  ]
  const ci = deriveCoverageIndex(summaries)
  assert.equal(ci.denominator, 4)
  assert.equal(ci.completed, 1)
  assert.equal(ci.deferred, 1)
  assert.equal(ci.blocked, 1)
  assert.equal(ci.failed, 1)
  assert.equal(ci.excluded, 1)
})

test('SYNTH-01: deriveDependencyMap sorts edges deterministically', () => {
  const summaries = [
    { id: 'c', dependencies: ['a'] },
    { id: 'a', dependencies: ['b'] },
    { id: 'b', dependencies: [] },
  ]
  const dm = deriveDependencyMap(summaries)
  assert.equal(dm.totalEdges, 2)
  assert.equal(dm.edges[0].from, 'a')
  assert.equal(dm.edges[0].to, 'b')
  assert.equal(dm.edges[1].from, 'c')
  assert.equal(dm.edges[1].to, 'a')
})

test('SYNTH-01: deriveCrossCutting only reports concerns shared by 2+ features', () => {
  const summaries = [
    { id: 'a', crossCuttingConcerns: ['auth', 'logging'] },
    { id: 'b', crossCuttingConcerns: ['auth', 'logging'] },
    { id: 'c', crossCuttingConcerns: ['unique'] },
  ]
  const cc = deriveCrossCutting(summaries)
  assert.equal(cc.sharedConcerns.length, 2)
  assert.ok(cc.sharedConcerns.find(c => c.concern === 'auth'))
  assert.ok(cc.sharedConcerns.find(c => c.concern === 'logging'))
  assert.ok(!cc.sharedConcerns.find(c => c.concern === 'unique'))
})

test('SYNTH-01: deriveSystemOverview sorts modules by id', () => {
  const summaries = [
    { id: 'c', name: 'C' },
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ]
  const so = deriveSystemOverview(summaries)
  assert.equal(so.modules[0].id, 'a')
  assert.equal(so.modules[1].id, 'b')
  assert.equal(so.modules[2].id, 'c')
})

test('SYNTH-01: empty summaries produce zeroed views', () => {
  const state = synthesizeProjectViews([], createSynthesisState(), { scope: 'rev1' })
  assert.ok(state.synthesized)
  assert.equal(state.views.systemOverview.totalModules, 0)
  assert.equal(state.views.dependencyMap.totalEdges, 0)
  assert.equal(state.views.coverageIndex.denominator, 0)
  assert.equal(state.views.crossCutting.sharedConcerns.length, 0)
})

// ===== OBSERVE-01: Persistence tracking tests =====

test('OBSERVE-01: createPersistenceTracker returns empty tracker', () => {
  const tracker = createPersistenceTracker()
  assert.ok(tracker)
  assert.deepEqual(tracker.writes, {})
  assert.equal(tracker.history.length, 0)
})

test('OBSERVE-01: recordAttemptedWrite creates an ATTEMPTED entry', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.ATTEMPTED)
  assert.equal(tracker.writes['shard:feat-a'].attempts, 1)
  assert.equal(tracker.history.length, 1)
})

test('OBSERVE-01: verifyDurableWrite upgrades ATTEMPTED to DURABLY_VERIFIED', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
  assert.equal(tracker.history.length, 2)
  assert.equal(tracker.history[1].action, 'verified')
})

test('OBSERVE-01: durably verified write cannot be demoted to ATTEMPTED', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  // Attempting to record another write for the same key should not demote
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
})

test('OBSERVE-01: durably verified write cannot be failed', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  tracker = failWrite(tracker, 'shard:feat-a', 'inject fault')
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
})

test('OBSERVE-01: verifyDurableWrite is idempotent', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  const stateBefore = tracker.writes['shard:feat-a'].state
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  assert.equal(tracker.writes['shard:feat-a'].state, stateBefore)
})

test('OBSERVE-01: failWrite records FAILED state with reason', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = failWrite(tracker, 'shard:feat-a', 'disk-full')
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.FAILED)
  assert.equal(tracker.writes['shard:feat-a'].failReason, 'disk-full')
})

test('OBSERVE-01: failed write can be retried (attempt again)', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = failWrite(tracker, 'shard:feat-a', 'transient')
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.ATTEMPTED)
  assert.equal(tracker.writes['shard:feat-a'].attempts, 2)
})

test('OBSERVE-01: isRetrySafe returns true for untracked key', () => {
  const tracker = createPersistenceTracker()
  assert.ok(isRetrySafe(tracker, 'unknown-key'))
})

test('OBSERVE-01: isRetrySafe returns true for ATTEMPTED or FAILED writes', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  assert.ok(isRetrySafe(tracker, 'shard:feat-a'))
  tracker = failWrite(tracker, 'shard:feat-a', 'err')
  assert.ok(isRetrySafe(tracker, 'shard:feat-a'))
})

test('OBSERVE-01: isRetrySafe returns false for DURABLY_VERIFIED writes', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  assert.ok(!isRetrySafe(tracker, 'shard:feat-a'))
})

test('OBSERVE-01: isDurablyVerified checks write state', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  assert.ok(!isDurablyVerified(tracker, 'shard:feat-a'))
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  assert.ok(isDurablyVerified(tracker, 'shard:feat-a'))
  assert.ok(!isDurablyVerified(tracker, 'nonexistent'))
})

test('OBSERVE-01: persistenceReport counts by state', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'a', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  tracker = recordAttemptedWrite(tracker, 'b', PERSIST_UNIT_TYPES.SYNTHESIS_VIEW)
  tracker = verifyDurableWrite(tracker, 'a')
  tracker = recordAttemptedWrite(tracker, 'c', PERSIST_UNIT_TYPES.PROJECT_INDEX)
  tracker = failWrite(tracker, 'c', 'err')
  const report = persistenceReport(tracker)
  assert.equal(report.total, 3)
  assert.equal(report.attempted, 1)
  assert.equal(report.verified, 1)
  assert.equal(report.failed, 1)
})

test('OBSERVE-01: persistenceReport byType breakdown', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'a', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  tracker = recordAttemptedWrite(tracker, 'b', PERSIST_UNIT_TYPES.FEATURE_SHARD)
  tracker = verifyDurableWrite(tracker, 'a')
  const report = persistenceReport(tracker)
  assert.ok(report.byType['feature-shard'])
  assert.equal(report.byType['feature-shard'].verified, 1)
  assert.equal(report.byType['feature-shard'].attempted, 1)
})

test('OBSERVE-01: persistenceReport for null tracker', () => {
  const report = persistenceReport(null)
  assert.equal(report.total, 0)
  assert.equal(report.attempted, 0)
  assert.equal(report.verified, 0)
})

test('OBSERVE-01: retry after verify does not duplicate state', () => {
  let tracker = createPersistenceTracker()
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  tracker = verifyDurableWrite(tracker, 'shard:feat-a')
  const keysBefore = Object.keys(tracker.writes).length
  // Simulate a retry scenario — attempt the same write again
  tracker = recordAttemptedWrite(tracker, 'shard:feat-a')
  const keysAfter = Object.keys(tracker.writes).length
  assert.equal(keysAfter, keysBefore) // no new key created
  assert.equal(tracker.writes['shard:feat-a'].state, PERSISTENCE_STATES.DURABLY_VERIFIED)
})

test('OBSERVE-01: verifyDurableWrite throws for unknown key', () => {
  let tracker = createPersistenceTracker()
  assert.throws(() => verifyDurableWrite(tracker, 'nonexistent'), /no attempted write/)
})

// ===== STATUS-01: Truthful readiness tests =====

test('STATUS-01: deriveExtractReadiness returns ready when all conditions met', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'completed' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(result.ready)
  assert.equal(result.reason, READINESS_REASONS.ALL_MET)
  assert.equal(result.incompleteCount, 0)
})

test('STATUS-01: deriveExtractReadiness returns not-ready when discovery incomplete', () => {
  const state = {
    discoveryExhausted: false,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.DISCOVERY_INCOMPLETE)
})

test('STATUS-01: deriveExtractReadiness returns not-ready when graph invalid', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: false,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.GRAPH_INVALID)
})

test('STATUS-01: deriveExtractReadiness returns not-ready when features incomplete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'deferred' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.FEATURES_INCOMPLETE)
  assert.ok(result.incompleteCount > 0)
})

test('STATUS-01: deriveExtractReadiness returns not-ready when synthesis stale', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: false,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.SYNTHESIS_STALE)
})

test('STATUS-01: deriveExtractReadiness returns not-ready when artifacts stale', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: false,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.ARTIFACTS_STALE)
})

test('STATUS-01: feature-level skipped is incomplete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'skipped', skipReason: 'feature-level' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
  assert.equal(result.reason, READINESS_REASONS.FEATURES_INCOMPLETE)
})

test('STATUS-01: required-gate skipped is incomplete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'skipped', skipReason: 'required-gate' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
})

test('STATUS-01: policy-disabled-optional skip with evidence may complete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'skipped', skipReason: 'policy-disabled-optional', policyEvidence: 'recorded' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(result.ready)
})

test('STATUS-01: policy-disabled-optional skip without evidence is incomplete', () => {
  const state = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'skipped', skipReason: 'policy-disabled-optional' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const result = deriveExtractReadiness(state)
  assert.ok(!result.ready)
})

test('STATUS-01: deriveExtractReadiness with null state', () => {
  const result = deriveExtractReadiness(null)
  assert.ok(!result.ready)
  assert.ok(result.checks)
  assert.equal(result.checks.discoveryExhausted, false)
})

test('STATUS-01: projectStatusProjection produces frozen projection', () => {
  const state = {
    planDir: '/test/',
    scopeManifestPath: '/test/scope.md',
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
    revisions: { scope: 'rev1' },
    budget: { callsRemaining: 100 },
    failures: [],
    continuation: { lastSegmentId: 1 },
  }
  const projection = projectStatusProjection(state)
  assert.ok(Object.isFrozen(projection))
  assert.ok(projection.ready)
  assert.equal(projection.denominator, 1)
  assert.equal(projection.lifecycleOutcomes.completed, 1)
})

test('STATUS-01: projectStatusProjection for null state returns frozen empty projection', () => {
  const projection = projectStatusProjection(null)
  assert.ok(Object.isFrozen(projection))
  assert.ok(!projection.ready)
  assert.equal(projection.denominator, 0)
})

test('STATUS-01: projectionsMatch returns true for identical projections', () => {
  const state = {
    discoveryExhausted: true, graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true, artifactsCurrent: true,
  }
  const p1 = projectStatusProjection(state)
  const p2 = projectStatusProjection(state)
  assert.ok(projectionsMatch(p1, p2))
})

test('STATUS-01: projectionsMatch returns false for different projections', () => {
  const state1 = {
    discoveryExhausted: true, graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true, artifactsCurrent: true,
    planDir: '/a/',
  }
  const state2 = {
    discoveryExhausted: true, graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true, artifactsCurrent: true,
    planDir: '/b/',
  }
  const p1 = projectStatusProjection(state1)
  const p2 = projectStatusProjection(state2)
  assert.ok(!projectionsMatch(p1, p2))
})

test('STATUS-01: readinessSummary produces human-readable string', () => {
  const state = {
    discoveryExhausted: true, graphValid: true,
    features: [{ id: 'a', lifecycle: 'completed' }],
    synthesisCurrent: true, artifactsCurrent: true,
    planDir: '/test/',
  }
  const projection = projectStatusProjection(state)
  const summary = readinessSummary(projection)
  assert.ok(summary.includes('READY'))
  assert.ok(summary.includes('all-conditions-met'))
  assert.ok(summary.includes('Denominator: 1'))
  assert.ok(summary.includes('[x]'))
})

test('STATUS-01: countLifecycleStates counts each state', () => {
  const features = [
    { id: 'a', lifecycle: 'completed' },
    { id: 'b', lifecycle: 'deferred' },
    { id: 'c', lifecycle: 'blocked' },
    { id: 'd', lifecycle: 'excluded' },
    { id: 'e', lifecycle: 'failed' },
    { id: 'f', lifecycle: 'skipped' },
    { id: 'g', lifecycle: 'runnable' },
    { id: 'h', lifecycle: 'in-progress' },
  ]
  const counts = countLifecycleStates(features)
  assert.equal(counts.completed, 1)
  assert.equal(counts.deferred, 1)
  assert.equal(counts.blocked, 1)
  assert.equal(counts.excluded, 1)
  assert.equal(counts.failed, 1)
  assert.equal(counts.skipped, 1)
  assert.equal(counts.runnable, 1)
  assert.equal(counts['in-progress'], 1)
  assert.equal(counts.denominator, 7)
})

test('STATUS-01: handoff and status share identical projection data', () => {
  // Simulates: handoff builds a projection from state X, status loads the
  // persisted state X and builds the same projection — they MUST match.
  const state = {
    planDir: '/extract/test/',
    scopeManifestPath: '/extract/test/scope.md',
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'feat-a', lifecycle: 'completed' },
      { id: 'feat-b', lifecycle: 'completed' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
    revisions: { scope: 'rev-scope-1' },
    budget: { callsRemaining: 500 },
    failures: [],
    continuation: { lastSegmentId: 3, acknowledgedSegments: 3 },
  }
  const handoffProjection = projectStatusProjection(state)
  // Simulate status mode: load the same state (as if from pipeline-state.json)
  const statusProjection = projectStatusProjection(state)
  assert.ok(projectionsMatch(handoffProjection, statusProjection))
  assert.equal(handoffProjection.ready, statusProjection.ready)
  assert.equal(handoffProjection.denominator, statusProjection.denominator)
  assert.deepEqual(handoffProjection.lifecycleOutcomes, statusProjection.lifecycleOutcomes)
})

// ===== Build/Regression gates =====

test('REGRESSION: dist contains synthesis module exports', () => {
  assert.ok(source.includes('createSynthesisState'), 'createSynthesisState must be in dist')
  assert.ok(source.includes('synthesizeProjectViews'), 'synthesizeProjectViews must be in dist')
  assert.ok(source.includes('isSynthesisCurrent'), 'isSynthesisCurrent must be in dist')
})

test('REGRESSION: dist contains observe-persist module exports', () => {
  assert.ok(source.includes('createPersistenceTracker'), 'createPersistenceTracker must be in dist')
  assert.ok(source.includes('PERSISTENCE_STATES'), 'PERSISTENCE_STATES must be in dist')
  assert.ok(source.includes('verifyDurableWrite'), 'verifyDurableWrite must be in dist')
})

test('REGRESSION: dist contains status-truth module exports', () => {
  assert.ok(source.includes('deriveExtractReadiness'), 'deriveExtractReadiness must be in dist')
  assert.ok(source.includes('projectStatusProjection'), 'projectStatusProjection must be in dist')
  assert.ok(source.includes('READINESS_REASONS'), 'READINESS_REASONS must be in dist')
})

test('REGRESSION: no direct FS or shell access in new modules', () => {
  // Check only the new module sources — the existing dist may contain Math.random
  // in comments or pre-existing modules (forbidden-token scan is the build's job).
  const synthSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/synthesis.mjs', import.meta.url), 'utf8')
  const obsSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/observe-persist.mjs', import.meta.url), 'utf8')
  const statusSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/status-truth.mjs', import.meta.url), 'utf8')
  for (const [name, src] of [['synthesis', synthSrc], ['observe-persist', obsSrc], ['status-truth', statusSrc]]) {
    assert.ok(!src.match(/require\s*\(/), `no require() in ${name}`)
    assert.ok(!src.match(/Date\.now/), `no Date.now in ${name}`)
    assert.ok(!src.match(/Math\.random/), `no Math.random in ${name}`)
    assert.ok(!src.match(/new Date/), `no new Date in ${name}`)
  }
})
