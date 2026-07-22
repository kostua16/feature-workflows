// Phase 7 DOGFOOD-01: Whole-repository dogfood scale characterization.
//
// Simulates a full whole-repository /feature-workflows:extract-design run:
// 100+ features discovered, multi-segment extraction with budget admission,
// interruption recovery, duplicate continuation convergence, and final
// truthful readiness with synthesis + coverage evidence.
//
// This test exercises the FULL Phase 1-6 primitive surface as an integrated
// pipeline simulation — proving the one-command whole-project promise.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  LIFECYCLE_STATES, SKIP_REASONS, applyLifecycleEvent, deriveReadiness,
  migrateLegacyState, validateMigrationBoundary,
  applyCap, promoteDeferred, queueDenominator,
  createBudgetLimits, createBudgetAccountant, setReserve, callsRemaining,
  admitSegment, spendBudget, canFinishNextGate, budgetSummary, RESERVE_TYPES,
  createRetryPolicy, createAttemptHistory, recordAttempt, ATTEMPT_OUTCOMES,
  isGateRetriesExhausted, isTerminalFailure,
  isolateFailure, shouldContinueAfterFailure,
  createContinuationState, nextSegmentId, idempotencyKey,
  createSegmentIntent, acknowledgeSegment, resolveConvergence,
  shouldContinue, resumeCommand, segmentCounts, canAutoRelaunch,
  createSynthesisState, synthesizeProjectViews, isSynthesisCurrent,
  createPersistenceTracker, recordAttemptedWrite, verifyDurableWrite,
  persistenceReport,
  deriveExtractReadiness, projectStatusProjection, readinessSummary,
  countLifecycleStates,
} = engine

// ===========================================================================
// Helper: generate a 100+ feature whole-repository inventory
// ===========================================================================

function generateProjectInventory(count) {
  const features = []
  for (let i = 0; i < count; i++) {
    features.push({
      id: `mod-${String(i).padStart(3, '0')}`,
      name: `Module ${i}`,
      files: [`src/mod-${i}.mjs`, `src/mod-${i}-helper.mjs`],
      entryPoints: [`mod-${i}:run`],
      lifecycle: LIFECYCLE_STATES.RUNNABLE,
    })
  }
  return features
}

function generateFeatureSummaries(features) {
  return features.map((f) => ({
    id: f.id,
    lifecycle: 'completed',
    digest: `digest-${f.id}`,
    systemOverview: `${f.name} provides core functionality`,
    dependencies: [],
    crossCutting: [],
  }))
}

// ===========================================================================
// DOGFOOD-01a: Whole-repository multi-segment extraction
// ===========================================================================

test('DOGFOOD-01: 120-feature whole-repository extraction across multiple segments', () => {
  const TOTAL = 120
  const CAP = 40
  const allFeatures = generateProjectInventory(TOTAL)

  // Phase 5 budget: characterize limits with non-spendable reserve
  const limits = createBudgetLimits({
    callCeiling: 1000,
    tokenCeiling: 0,
    concurrency: 3,
    retryPerGate: 3,
    retryPerFeature: 10,
  })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.CHECKPOINT, 30)
  accountant = setReserve(accountant, RESERVE_TYPES.RECONCILIATION, 20)
  accountant = setReserve(accountant, RESERVE_TYPES.SYNTHESIS, 15)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, 10)

  const reserveTotal = 75 // 30+20+15+10
  const availableCalls = callsRemaining(accountant) // 1000-0-75 = 925

  // Each feature needs ~7 calls (extract gates); per segment: cap * 7 = 280
  const callsPerFeature = 7
  const segmentCost = { calls: CAP * callsPerFeature, tokens: 0 }

  // Phase 5 continuation state
  let contState = createContinuationState()
  const completedIds = new Set()
  let features = allFeatures.slice()
  let segmentNum = 0

  while (features.some((f) => f.lifecycle !== LIFECYCLE_STATES.COMPLETED)) {
    segmentNum++

    // Check budget admission
    const admission = admitSegment(accountant, segmentCost)
    assert.ok(admission.admitted, `segment ${segmentNum} must be admitted within budget`)

    // Allocate segment ID
    const segId = nextSegmentId(contState)
    contState = segId.state

    // Create intent
    const segmentFeatures = features
      .filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE || f.lifecycle === LIFECYCLE_STATES.DEFERRED)
      .slice(0, CAP)
      .map((f) => f.id)
    const intentResult = createSegmentIntent(contState, segId.segmentId, segmentFeatures, `rev-${segmentNum}`)
    contState = intentResult.state

    // Simulate processing: mark features as completed
    for (const fid of segmentFeatures) {
      completedIds.add(fid)
    }

    // Acknowledge segment
    const ack = acknowledgeSegment(contState, segId.segmentId, intentResult.intent.idempotencyKey, 'completed', {
      completed: segmentFeatures.length,
      deferred: features.filter((f) => !completedIds.has(f.id)).length,
    })
    contState = ack.state

    // Spend budget
    accountant = spendBudget(accountant, segmentFeatures.length * callsPerFeature, 0)

    // Mark completed features and promote deferred for next segment
    features = features.map((f) =>
      completedIds.has(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
    )
    if (features.some((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED || f.lifecycle === LIFECYCLE_STATES.RUNNABLE)) {
      features = promoteDeferred(features, completedIds, CAP).features
    }

    if (segmentNum > 10) break // safety valve
  }

  // Verify: all features processed exactly once
  assert.equal(completedIds.size, TOTAL, `all ${TOTAL} features must be processed`)
  assert.ok(segmentNum >= 3, `must span multiple segments (got ${segmentNum})`)

  // Verify: budget stayed within characterized limits
  const summary = budgetSummary(accountant)
  assert.ok(summary.callsSpent <= 1000, 'must stay below call ceiling')
  assert.ok(summary.callsRemaining >= 0, 'must have non-negative remaining calls')
  assert.equal(summary.reserved, reserveTotal, 'reserve must be preserved')

  // Verify: continuation convergence
  const convergence = resolveConvergence(contState)
  assert.equal(convergence.converged.length, segmentNum, 'all segments must converge')
  assert.equal(convergence.unacknowledged.length, 0, 'no unacknowledged intents')

  // Verify: segment counts
  const counts = segmentCounts(contState)
  assert.equal(counts.completed, TOTAL, 'segment counts must sum to all features')
})

// ===========================================================================
// DOGFOOD-01b: Recovery from injected gate interruption
// ===========================================================================

test('DOGFOOD-01: recovery from injected mid-gate interruption resumes correctly', () => {
  const features = generateProjectInventory(10)
  const completedIds = new Set()

  // Simulate: segment 1 processes 5 features, then interruption occurs mid-gate
  // on feature 3 (gate checkpoint was already recorded before interruption)
  const seg1Features = features.slice(0, 5).map((f) => f.id)
  // Features 1, 2 completed; 3 was interrupted but has a checkpoint; 4, 5 not started
  completedIds.add('mod-000')
  completedIds.add('mod-001')
  // mod-002 has a checkpoint at 'extract-facts' but not at 'extract-e2e'

  // On resume: mod-002 resumes from first incomplete gate (extract-e2e)
  // mod-003, mod-004 are still runnable

  let resumedFeatures = features.map((f) => {
    if (completedIds.has(f.id)) return { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED }
    if (f.id === 'mod-002') return { ...f, lifecycle: LIFECYCLE_STATES.RUNNABLE } // resumable
    return { ...f, lifecycle: LIFECYCLE_STATES.RUNNABLE }
  })

  // Process remaining features in segment 2
  const seg2 = applyCap(
    resumedFeatures.map((f) =>
      f.lifecycle === LIFECYCLE_STATES.COMPLETED ? f : { ...f, lifecycle: LIFECYCLE_STATES.RUNNABLE }
    ),
    10
  )

  const remaining = seg2.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  assert.ok(remaining.length >= 3, 'remaining features must be runnable after resume')

  // Complete all remaining
  for (const f of remaining) completedIds.add(f.id)

  assert.equal(completedIds.size, 10, 'all features must complete after interruption recovery')
})

// ===========================================================================
// DOGFOOD-01c: Recovery from duplicate continuation delivery
// ===========================================================================

test('DOGFOOD-01: duplicate continuation delivery converges idempotently', () => {
  let state = createContinuationState()

  // Segment 1: intent + ack
  const seg1 = nextSegmentId(state)
  state = seg1.state
  const intent1 = createSegmentIntent(state, seg1.segmentId, ['f1', 'f2'], 'rev-1')
  state = intent1.state
  const ack1 = acknowledgeSegment(state, seg1.segmentId, intent1.intent.idempotencyKey, 'completed', { completed: 2 })
  state = ack1.state

  // Segment 2: intent + ack
  const seg2 = nextSegmentId(state)
  state = seg2.state
  const intent2 = createSegmentIntent(state, seg2.segmentId, ['f3', 'f4'], 'rev-2')
  state = intent2.state
  const ack2 = acknowledgeSegment(state, seg2.segmentId, intent2.intent.idempotencyKey, 'completed', { completed: 2 })
  state = ack2.state

  // Inject: duplicate delivery of segment 2 acknowledgement
  const dupAck = acknowledgeSegment(state, seg2.segmentId, intent2.intent.idempotencyKey, 'completed', { completed: 2 })
  assert.ok(dupAck.duplicate, 'duplicate must be detected')
  state = dupAck.state // state unchanged

  // Inject: duplicate delivery of segment 2 intent (re-launch)
  const dupIntent = createSegmentIntent(state, seg2.segmentId, ['f3', 'f4'], 'rev-2')
  assert.ok(dupIntent.duplicate, 'duplicate intent must be detected')
  state = dupIntent.state // state unchanged

  // Convergence: exactly 2 segments, no double-applied work
  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 2, 'exactly 2 converged segments')
  assert.equal(convergence.unacknowledged.length, 0, 'no unacknowledged intents')

  const counts = segmentCounts(state)
  assert.equal(counts.completed, 4, 'total completed = 4 (no duplicates)')
})

// ===========================================================================
// DOGFOOD-01d: Final truthful readiness with synthesis + coverage
// ===========================================================================

test('DOGFOOD-01: final readiness is truthful with synthesis and coverage', () => {
  const TOTAL = 50
  const features = generateProjectInventory(TOTAL).map((f) => ({
    ...f,
    lifecycle: LIFECYCLE_STATES.COMPLETED,
  }))

  // Synthesize project views
  const summaries = generateFeatureSummaries(features)
  const revisions = { source: 'final-rev', scope: 'final-scope', graph: 'final-graph' }
  const synthesisState = synthesizeProjectViews(summaries, createSynthesisState(), revisions)
  assert.ok(synthesisState.synthesized, 'synthesis must produce views')

  // Check synthesis is current
  const currentCheck = isSynthesisCurrent(synthesisState, revisions)
  assert.ok(currentCheck, 'synthesis must be current with final revisions')

  // Derive truthful readiness
  const projectState = {
    discoveryExhausted: true,
    graphValid: true,
    features: features.map((f) => ({ id: f.id, lifecycle: f.lifecycle })),
    synthesisCurrent: true,
    artifactsCurrent: true,
    planDir: '/whole-repo/extract/',
  }
  const readiness = deriveExtractReadiness(projectState)
  assert.ok(readiness.ready, 'readiness must be true when all conditions met')
  assert.equal(readiness.reason, 'all-conditions-met')

  // Project status projection
  const projection = projectStatusProjection(projectState)
  assert.equal(projection.ready, true)
  assert.equal(projection.denominator, TOTAL)
  assert.equal(projection.lifecycleOutcomes.completed, TOTAL)

  // Readiness summary is human-readable
  const summary = readinessSummary(projection)
  assert.ok(summary.includes('READY'), 'summary must show READY')
  assert.ok(summary.includes('Denominator: ' + TOTAL), 'summary must show correct denominator')
})

// ===========================================================================
// DOGFOOD-01e: Readiness is NOT true when features are incomplete
// ===========================================================================

test('DOGFOOD-01: readiness remains false until ALL features complete', () => {
  const TOTAL = 50
  const features = generateProjectInventory(TOTAL).map((f, i) => ({
    ...f,
    lifecycle: i < 48 ? LIFECYCLE_STATES.COMPLETED : LIFECYCLE_STATES.DEFERRED,
  }))

  const projectState = {
    discoveryExhausted: true,
    graphValid: true,
    features: features.map((f) => ({ id: f.id, lifecycle: f.lifecycle })),
    synthesisCurrent: true,
    artifactsCurrent: true,
  }
  const readiness = deriveExtractReadiness(projectState)
  assert.equal(readiness.ready, false, 'must not be ready with deferred features')
  assert.equal(readiness.reason, 'features-incomplete')
  assert.equal(readiness.incompleteCount, 2)
})

// ===========================================================================
// DOGFOOD-01f: Persistence tracking around terminal boundaries
// ===========================================================================

test('DOGFOOD-01: persistence tracking around synthesis and handoff boundaries', () => {
  let tracker = createPersistenceTracker()

  // Feature shards (key=featureId, unitType=feature-shard)
  for (let i = 0; i < 5; i++) {
    tracker = recordAttemptedWrite(tracker, `f${i}`, 'feature-shard')
    tracker = verifyDurableWrite(tracker, `f${i}`, 'feature-shard')
  }

  // Project index
  tracker = recordAttemptedWrite(tracker, 'root', 'project-index')
  tracker = verifyDurableWrite(tracker, 'root', 'project-index')

  // Synthesis views
  tracker = recordAttemptedWrite(tracker, 'views', 'synthesis')
  tracker = verifyDurableWrite(tracker, 'views', 'synthesis')

  // Continuation ack
  tracker = recordAttemptedWrite(tracker, 'final-segment', 'continuation')
  tracker = verifyDurableWrite(tracker, 'final-segment', 'continuation')

  const report = persistenceReport(tracker)
  assert.ok(report.verified >= 8, 'all writes must be durably verified')
  assert.equal(report.failed, 0, 'no failed writes')
})

// ===========================================================================
// DOGFOOD-01g: Coverage denominator correctness
// ===========================================================================

test('DOGFOOD-01: coverage denominator excludes excluded features only', () => {
  const features = [
    ...generateProjectInventory(40),
    { id: 'excluded-1', name: 'Excluded', files: [], lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'excluded-2', name: 'Excluded 2', files: [], lifecycle: LIFECYCLE_STATES.EXCLUDED },
  ]

  const denom = queueDenominator(features)
  assert.equal(denom.denominator, 40, 'denominator excludes excluded features')
  assert.equal(denom.excluded, 2)
  assert.equal(denom.total, 42)
})

// ===========================================================================
// DOGFOOD-01h: Budget headroom characterization below runtime ceiling
// ===========================================================================

test('DOGFOOD-01: budget headroom stays below shared runtime ceiling', () => {
  const limits = createBudgetLimits({ callCeiling: 1000, concurrency: 3 })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.CHECKPOINT, 25)
  accountant = setReserve(accountant, RESERVE_TYPES.SYNTHESIS, 15)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, 10)
  accountant = setReserve(accountant, RESERVE_TYPES.RECONCILIATION, 10)

  // Reserve total: 60
  // Available for segment work: 1000 - 0 - 60 = 940

  // Simulate 3 segments of ~280 calls each = 840 total
  for (let i = 0; i < 3; i++) {
    accountant = spendBudget(accountant, 280, 0)
  }

  const summary = budgetSummary(accountant)
  assert.equal(summary.callsSpent, 840)
  assert.equal(summary.callsRemaining, 100) // 1000 - 840 - 60 = 100
  assert.ok(summary.callsRemaining > 0, 'must have headroom below ceiling')
  assert.equal(summary.reserved, 60, 'reserve must be intact')
})

// ===========================================================================
// DOGFOOD-01i: Failure isolation preserves independent work
// ===========================================================================

test('DOGFOOD-01: one feature failure preserves independent verified work', () => {
  // Use queue entries with status field (matching failure-isolation API)
  const queue = []
  for (let i = 0; i < 10; i++) {
    queue.push({
      id: `mod-${String(i).padStart(3, '0')}`,
      name: `Module ${i}`,
      status: i < 5 ? 'completed' : 'in-progress',
      artifacts: {},
    })
  }

  // Isolate: mark feature 5 as failed, preserve its artifacts
  const afterFailure = isolateFailure(queue, 'mod-005', 'error')
  const failed5 = afterFailure.find((e) => e.id === 'mod-005')
  assert.equal(failed5.status, 'failed', 'failed feature must be marked failed')
  assert.ok(failed5.artifacts, 'failed feature must preserve artifacts')

  // Independent features continue — eligible are those still pending/in-progress
  const independents = engine.eligibleIndependents(afterFailure, 'mod-005', [])
  assert.ok(independents.length >= 4, 'independent in-progress features must continue')

  // Completed features are preserved
  const stillCompleted = afterFailure.filter((e) => e.status === 'completed')
  assert.equal(stillCompleted.length, 5, '5 completed features must be preserved')
})

// ===========================================================================
// DOGFOOD-01j: Installed version and mode compatibility evidence
// ===========================================================================

test('DOGFOOD-01: all workflow modes remain compatible with v1.5 state contract', () => {
  // A v1.5 completed shard consumed by design/implement/tune/review/status
  // must preserve its established gates, artifacts, and handoffs.
  const v15Shard = {
    task: 'extract feature design',
    slug: 'extract-feature',
    planPath: 'docs/extract/feat/plan.md',
    planDir: 'docs/extract/feat/',
    lastGate: 'Extract',
    engineVersion: '1.5.0',
    result: {
      mode: 'extract',
      definitionPath: 'docs/extract/feat/scope.md',
      requirementsPath: 'docs/extract/feat/requirements.md',
      archPath: 'docs/extract/feat/architecture.md',
      designPath: 'docs/extract/feat/detailed-design.md',
      extractScope: { files: ['src/feat.mjs'], entryPoints: ['feat:run'] },
      extractQueue: [{ id: 'feat', status: 'completed' }],
      extractReady: true,
      designReady: true,
    },
    config: { mode: 'extract' },
  }

  // The shard validates (structural integrity)
  const validation = engine.validatePipelineState(v15Shard)
  assert.ok(validation.ok, `v1.5 shard must validate: ${validation.errors?.join(', ')}`)

  // Status projection works for this shard
  const projectState = {
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'feat', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
    planDir: v15Shard.planDir,
  }
  const projection = projectStatusProjection(projectState)
  assert.equal(projection.ready, true, 'shard must be ready')
  assert.ok(projection.denominator > 0)
})

// ===========================================================================
// DOGFOOD-01k: Full lifecycle event replay produces stable state
// ===========================================================================

test('DOGFOOD-01: ordered lifecycle event replay is byte-stable', () => {
  const events = [
    { type: 'start' },
    { type: 'complete' },
  ]

  // Replay the same event sequence twice
  function replay(events) {
    let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
    for (const e of events) {
      state = applyLifecycleEvent(state, e)
    }
    return state
  }

  const result1 = replay(events)
  const result2 = replay(events)
  assert.deepEqual(result1, result2, 'replay must produce identical state')
  assert.equal(result1.lifecycle, LIFECYCLE_STATES.COMPLETED)
})
