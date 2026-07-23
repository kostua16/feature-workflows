// Phase 5 Nyquist Validation: Gap-filling tests for BUDGET-01, RETRY-01,
// ISOLATE-01, CONT-01.
//
// Closes validation gaps identified by the gsd-validate-phase audit:
// - BUDGET-01: token-ceiling rejection, token dimension in canFinishNextGate,
//   setReserve overwrite, zero-cost admission, budgetSummary completeness,
//   budget exhaustion boundary
// - RETRY-01: zero-attempt terminal/reason, cross-feature isolation,
//   over-limit exhaustion, success-does-not-count
// - ISOLATE-01: timeout→blocked, undefined failure type, segmentOutcome
//   completed/unknown conventions, eligibleIndependents excludes done,
//   transitive chain depth > 2, preserveVerifiedArtifacts null-safe
// - CONT-01: null revision key, acknowledge marks intent, empty-state
//   convergence, canAutoRelaunch boundary (2 vs 3), out-of-order multi-gap,
//   sorted features, resumeCommand empty state
// - E2E-BUDGET-01: multi-wave reserve preservation
// - E2E-FAIL-01: all five failure-type classifications
// - E2E-CONT-01: out-of-order delivery convergence
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  // Budget admission (BUDGET-01)
  RESERVE_TYPES,
  createBudgetLimits,
  createBudgetAccountant,
  setReserve,
  totalReserve,
  callsRemaining,
  tokensRemaining,
  admitSegment,
  spendBudget,
  canFinishNextGate,
  budgetSummary,
  // Retry policy (RETRY-01)
  ATTEMPT_OUTCOMES,
  createRetryPolicy,
  createAttemptHistory,
  recordAttempt,
  gateAttemptCount,
  featureAttemptCount,
  isGateRetriesExhausted,
  isFeatureRetriesExhausted,
  isTerminalFailure,
  terminalReason,
  attemptSummary,
  // Failure isolation (ISOLATE-01)
  isolateFailure,
  eligibleIndependents,
  preserveVerifiedArtifacts,
  shouldContinueAfterFailure,
  segmentOutcome,
  // Continuation (CONT-01)
  createContinuationState,
  nextSegmentId,
  idempotencyKey,
  createSegmentIntent,
  acknowledgeSegment,
  resolveConvergence,
  shouldContinue,
  resumeCommand,
  segmentCounts,
  isOutOfOrder,
  canAutoRelaunch,
  continuationSummary,
} = engine

// =========================================================================
// BUDGET-01: Token-ceiling rejection and token-dimension coverage
// =========================================================================

test('NV BUDGET-01: admitSegment rejects on token-ceiling when token budget characterized', () => {
  // Reserve is subtracted from both calls and tokens. Keep callCeiling high
  // enough that calls are NOT the binding constraint — only tokens are.
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 10000, tokenCeiling: 50000 }))
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 5000)
  // callsRemaining = 10000-0-5000 = 5000; tokensRemaining = 50000-0-5000 = 45000
  // Calls fit but tokens do not
  const result = admitSegment(acct, { calls: 10, tokens: 50000 })
  assert.equal(result.admitted, false)
  assert.equal(result.reason, 'token-ceiling')
})

test('NV BUDGET-01: admitSegment admits when both calls and tokens fit', () => {
  // Reserve is subtracted from both calls and tokens; keep callCeiling high
  // enough that calls have headroom alongside the reserve.
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 10000, tokenCeiling: 50000 }))
  acct = setReserve(acct, RESERVE_TYPES.SYNTHESIS, 5000)
  // callsRemaining = 10000-0-5000 = 5000; tokensRemaining = 50000-0-5000 = 45000
  const result = admitSegment(acct, { calls: 100, tokens: 40000 })
  assert.equal(result.admitted, true)
  assert.equal(result.remaining.tokens, 45000)
})

test('NV BUDGET-01: canFinishNextGate checks token dimension independently', () => {
  // Reserve is subtracted from BOTH calls and tokens; keep it small enough
  // that calls still have headroom while tokens are the binding constraint.
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 5000, tokenCeiling: 10000 }))
  acct = setReserve(acct, RESERVE_TYPES.HANDOFF, 2000)
  // callsRemaining = 5000-0-2000 = 3000; tokensRemaining = 10000-0-2000 = 8000
  // Calls fit but tokens do not
  assert.equal(canFinishNextGate(acct, { calls: 5, tokens: 9000 }), false)
  // Both fit
  assert.equal(canFinishNextGate(acct, { calls: 5, tokens: 7000 }), true)
})

test('NV BUDGET-01: setReserve overwrites same category (does not accumulate)', () => {
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 1000 }))
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 50)
  assert.equal(totalReserve(acct), 50)
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 100)
  assert.equal(totalReserve(acct), 100)
  assert.equal(acct.reserve[RESERVE_TYPES.CHECKPOINT], 100)
})

test('NV BUDGET-01: admitSegment with null/zero cost always admits', () => {
  const acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 100 }))
  assert.equal(admitSegment(acct, null).admitted, true)
  assert.equal(admitSegment(acct, {}).admitted, true)
  assert.equal(admitSegment(acct, { calls: 0 }).admitted, true)
})

test('NV BUDGET-01: spendBudget with no args is a no-op', () => {
  const acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 1000 }))
  const spent = spendBudget(acct)
  assert.equal(spent.callsSpent, 0)
  assert.equal(spent.tokensSpent, 0)
})

test('NV BUDGET-01: budgetSummary reserveBreakdown contains all 4 categories', () => {
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 500 }))
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 10)
  acct = setReserve(acct, RESERVE_TYPES.RECONCILIATION, 20)
  acct = setReserve(acct, RESERVE_TYPES.SYNTHESIS, 30)
  acct = setReserve(acct, RESERVE_TYPES.HANDOFF, 40)
  const summary = budgetSummary(acct)
  assert.equal(summary.reserveBreakdown.checkpoint, 10)
  assert.equal(summary.reserveBreakdown.reconciliation, 20)
  assert.equal(summary.reserveBreakdown.synthesis, 30)
  assert.equal(summary.reserveBreakdown.handoff, 40)
})

test('NV BUDGET-01: budget exhaustion boundary — admission stops at zero remaining', () => {
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 100 }))
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 20)
  // Spend all non-reserved budget
  acct = spendBudget(acct, 80, 0)
  assert.equal(callsRemaining(acct), 0)
  // Even 1 call cannot be admitted
  assert.equal(admitSegment(acct, { calls: 1 }).admitted, false)
  assert.equal(canFinishNextGate(acct, { calls: 1 }), false)
})

// =========================================================================
// RETRY-01: Zero-attempt edge cases and cross-feature isolation
// =========================================================================

test('NV RETRY-01: isTerminalFailure returns false for feature with no attempts', () => {
  const policy = createRetryPolicy({})
  const history = createAttemptHistory()
  assert.equal(isTerminalFailure(history, 'unknown-feature', policy), false)
})

test('NV RETRY-01: terminalReason returns null for feature with no attempts', () => {
  const history = createAttemptHistory()
  assert.equal(terminalReason(history, 'unknown-feature'), null)
})

test('NV RETRY-01: gateAttemptCount does not leak across features', () => {
  let history = createAttemptHistory()
  history = recordAttempt(history, 'feat-a', 'gate-1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  history = recordAttempt(history, 'feat-a', 'gate-1', ATTEMPT_OUTCOMES.TIMEOUT)
  history = recordAttempt(history, 'feat-b', 'gate-1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  // feat-a has 2 exhausting attempts; feat-b has 1; cross-check
  assert.equal(gateAttemptCount(history, 'feat-a', 'gate-1'), 2)
  assert.equal(gateAttemptCount(history, 'feat-b', 'gate-1'), 1)
  assert.equal(gateAttemptCount(history, 'feat-a', 'gate-2'), 0)
})

test('NV RETRY-01: isGateRetriesExhausted returns true when count exceeds max', () => {
  const policy = createRetryPolicy({ maxPerGate: 2 })
  let history = createAttemptHistory()
  // Record 5 exhausting attempts for the same gate
  for (let i = 0; i < 5; i++) {
    history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  }
  assert.equal(isGateRetriesExhausted(history, 'f1', 'g1', policy), true)
})

test('NV RETRY-01: success outcome does not count toward gate exhaustion', () => {
  const policy = createRetryPolicy({ maxPerGate: 2 })
  let history = createAttemptHistory()
  // 2 exhausting + 1 success
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.TIMEOUT)
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.SUCCESS)
  assert.equal(gateAttemptCount(history, 'f1', 'g1'), 2)
  assert.equal(isGateRetriesExhausted(history, 'f1', 'g1', policy), true)
})

test('NV RETRY-01: featureAttemptCount counts exhausting outcomes across all gates', () => {
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  history = recordAttempt(history, 'f1', 'g2', ATTEMPT_OUTCOMES.TIMEOUT)
  history = recordAttempt(history, 'f1', 'g3', ATTEMPT_OUTCOMES.INVALID_OUTPUT)
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.SUCCESS)
  assert.equal(featureAttemptCount(history, 'f1'), 3)
})

test('NV RETRY-01: terminalReason returns outcome when reason is null', () => {
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.PERMANENT_FAILURE)
  // No reason provided — terminalReason should return the outcome string
  assert.equal(terminalReason(history, 'f1'), ATTEMPT_OUTCOMES.PERMANENT_FAILURE)
})

// =========================================================================
// ISOLATE-01: Failure type classification and edge cases
// =========================================================================

test('NV ISOLATE-01: isolateFailure with timeout produces blocked (resumable)', () => {
  const queue = [{ id: 'f1', status: 'in-progress', artifacts: {} }]
  const result = isolateFailure(queue, 'f1', 'timeout')
  assert.equal(result[0].status, 'blocked')
  assert.equal(result[0].failureType, 'timeout')
})

test('NV ISOLATE-01: isolateFailure with undefined failure type defaults to failed', () => {
  const queue = [{ id: 'f1', status: 'in-progress', artifacts: {} }]
  const result = isolateFailure(queue, 'f1', undefined)
  assert.equal(result[0].status, 'failed')
  assert.equal(result[0].failureType, 'unknown')
})

test('NV ISOLATE-01: isolateFailure with null failure type defaults to failed', () => {
  const queue = [{ id: 'f1', status: 'in-progress', artifacts: {} }]
  const result = isolateFailure(queue, 'f1', null)
  assert.equal(result[0].status, 'failed')
})

test('NV ISOLATE-01: segmentOutcome maps completed status to completed bucket', () => {
  const queue = [
    { id: 'f1', status: 'completed' },
    { id: 'f2', status: 'done' },
    { id: 'f3', status: 'skipped' },
  ]
  const counts = segmentOutcome(queue)
  assert.equal(counts.completed, 2) // both 'completed' and 'done'
  assert.equal(counts.skipped, 1)
})

test('NV ISOLATE-01: segmentOutcome with unknown status falls to pending', () => {
  const queue = [{ id: 'f1', status: 'weird-status' }]
  const counts = segmentOutcome(queue)
  assert.equal(counts.pending, 1)
  assert.equal(counts.completed, 0)
})

test('NV ISOLATE-01: segmentOutcome with empty queue returns all zeros', () => {
  const counts = segmentOutcome([])
  assert.equal(counts.completed, 0)
  assert.equal(counts.blocked, 0)
  assert.equal(counts.failed, 0)
  assert.equal(counts.deferred, 0)
})

test('NV ISOLATE-01: eligibleIndependents excludes completed and failed features', () => {
  const queue = [
    { id: 'f1', status: 'done' },
    { id: 'f2', status: 'failed' },
    { id: 'f3', status: 'pending' },
    { id: 'f4', status: 'in-progress' },
    { id: 'f5', status: 'blocked' },
  ]
  const eligible = eligibleIndependents(queue, 'f-none', [])
  const ids = eligible.map((e) => e.id)
  assert.ok(ids.includes('f3'), 'pending feature is eligible')
  assert.ok(ids.includes('f4'), 'in-progress feature is eligible')
  assert.ok(!ids.includes('f1'), 'completed feature excluded')
  assert.ok(!ids.includes('f2'), 'failed feature excluded')
  assert.ok(!ids.includes('f5'), 'blocked feature excluded')
})

test('NV ISOLATE-01: transitive dependency chain depth > 2', () => {
  const queue = [
    { id: 'A', status: 'pending' },
    { id: 'B', status: 'pending' },
    { id: 'C', status: 'pending' },
    { id: 'D', status: 'pending' },
    { id: 'E', status: 'pending' }, // independent
  ]
  // Chain: D → C → B → A (if A fails, B, C, D are all blocked)
  const edges = [
    { from: 'B', to: 'A' },
    { from: 'C', to: 'B' },
    { from: 'D', to: 'C' },
  ]
  const eligible = eligibleIndependents(queue, 'A', edges)
  const ids = eligible.map((e) => e.id)
  assert.ok(!ids.includes('B'), 'B depends on A')
  assert.ok(!ids.includes('C'), 'C transitively depends on A')
  assert.ok(!ids.includes('D'), 'D transitively depends on A')
  assert.ok(ids.includes('E'), 'E is truly independent')
})

test('NV ISOLATE-01: preserveVerifiedArtifacts with missing artifacts field', () => {
  assert.deepEqual(preserveVerifiedArtifacts({}), {})
  assert.deepEqual(preserveVerifiedArtifacts({ artifacts: null }), {})
})

test('NV ISOLATE-01: shouldContinueAfterFailure with all blocked returns false', () => {
  const queue = [
    { id: 'f1', status: 'pending' },
    { id: 'f2', status: 'pending' },
  ]
  // Both depend on failed feature
  const edges = [
    { from: 'f1', to: 'f-dead' },
    { from: 'f2', to: 'f-dead' },
  ]
  assert.equal(shouldContinueAfterFailure(queue, 'f-dead', edges), false)
})

// =========================================================================
// CONT-01: Edge cases and boundary conditions
// =========================================================================

test('NV CONT-01: idempotencyKey with null revision falls to none', () => {
  const key = idempotencyKey(1, ['feat-a'], null)
  assert.ok(key.includes('-none'))
  assert.ok(key.includes('feat-a'))
})

test('NV CONT-01: idempotencyKey with empty feature list', () => {
  const key = idempotencyKey(1, [], 'rev-1')
  assert.ok(key.includes('seg-1'))
  // Empty sorted join produces empty string between dashes
  assert.ok(key.includes('rev-1'))
})

test('NV CONT-01: createSegmentIntent stores features in sorted order', () => {
  const state = createContinuationState()
  const result = createSegmentIntent(state, 1, ['c', 'a', 'b'], 'rev-1')
  assert.deepEqual(result.intent.features, ['a', 'b', 'c'])
})

test('NV CONT-01: acknowledgeSegment marks the intent as acknowledged', () => {
  let state = createContinuationState()
  const seg = nextSegmentId(state); state = seg.state
  const intent = createSegmentIntent(state, seg.segmentId, ['f1'], 'rev'); state = intent.state
  assert.equal(state.intents[0].acknowledged, false)
  const key = idempotencyKey(seg.segmentId, ['f1'], 'rev')
  const ack = acknowledgeSegment(state, seg.segmentId, key, 'done', { completed: 1 })
  assert.equal(ack.state.intents[0].acknowledged, true)
})

test('NV CONT-01: resolveConvergence with empty state returns no segments', () => {
  const state = createContinuationState()
  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 0)
  assert.equal(convergence.unacknowledged.length, 0)
  assert.equal(convergence.pendingRetry.length, 0)
})

test('NV CONT-01: canAutoRelaunch boundary — exactly 2 unacknowledged returns true', () => {
  let state = createContinuationState()
  for (let i = 1; i <= 2; i++) {
    const intent = createSegmentIntent(state, i, ['f' + i], 'r1')
    state = intent.state
  }
  assert.equal(canAutoRelaunch(state, 100), true)
})

test('NV CONT-01: canAutoRelaunch boundary — exactly 3 unacknowledged returns false', () => {
  let state = createContinuationState()
  for (let i = 1; i <= 3; i++) {
    const intent = createSegmentIntent(state, i, ['f' + i], 'r1')
    state = intent.state
  }
  assert.equal(canAutoRelaunch(state, 100), false)
})

test('NV CONT-01: segmentCounts with empty state returns all zeros', () => {
  const state = createContinuationState()
  const counts = segmentCounts(state)
  assert.equal(counts.completed, 0)
  assert.equal(counts.deferred, 0)
  assert.equal(counts.blocked, 0)
  assert.equal(counts.failed, 0)
  assert.equal(counts.skipped, 0)
})

test('NV CONT-01: continuationSummary with empty state', () => {
  const state = createContinuationState()
  const summary = continuationSummary(state)
  assert.equal(summary.lastSegmentId, 0)
  assert.equal(summary.acknowledgedSegments, 0)
  assert.equal(summary.unacknowledgedIntents, 0)
  assert.equal(summary.hasUnacknowledged, false)
})

test('NV CONT-01: out-of-order convergence with multiple gaps', () => {
  let state = createContinuationState()
  // Segments 1, 2, 3 have intents; only segment 3 is acknowledged
  let i1 = createSegmentIntent(state, 1, ['f1'], 'r1'); state = i1.state
  let i2 = createSegmentIntent(state, 2, ['f2'], 'r1'); state = i2.state
  let i3 = createSegmentIntent(state, 3, ['f3'], 'r1'); state = i3.state
  let a3 = acknowledgeSegment(state, 3, 'k3', 'done', { completed: 1 }); state = a3.state
  // Out-of-order: segments 1 and 2 have no ack
  assert.equal(isOutOfOrder(state, 3), true)
  // Convergence shows 1 converged and 2 unacknowledged
  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 1)
  assert.equal(convergence.unacknowledged.length, 2)
})

test('NV CONT-01: resumeCommand with no acknowledgements produces valid command', () => {
  let state = createContinuationState()
  const seg = nextSegmentId(state); state = seg.state
  const intent = createSegmentIntent(state, seg.segmentId, ['f1'], 'r1'); state = intent.state
  // No acknowledgement — resume detects unacknowledged intent
  const cmd = resumeCommand('/plan/', seg.segmentId, state)
  assert.equal(cmd.idempotent, true)
  assert.equal(cmd.reason, 'unacknowledged-intent')
  assert.ok(cmd.command.includes('--resume'))
})

test('NV CONT-01: acknowledgeSegment without prior intent still creates acknowledgement', () => {
  let state = createContinuationState()
  // Acknowledge a segment that has no intent
  const result = acknowledgeSegment(state, 5, 'orphan-key', 'done', { completed: 1 })
  assert.equal(result.duplicate, false)
  assert.equal(result.state.acknowledgements.length, 1)
})

test('NV CONT-01: shouldContinue with in-progress feature returns true', () => {
  const queue = [{ status: 'in-progress' }]
  assert.equal(shouldContinue(queue), true)
})

// =========================================================================
// E2E-BUDGET-01: Multi-wave project near characterized limits
// =========================================================================

test('NV E2E-BUDGET-01: multi-wave admission preserves non-spendable reserve', () => {
  let acct = createBudgetAccountant(createBudgetLimits({ callCeiling: 200, tokenCeiling: 0 }))
  // Reserve for system-critical work
  acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 10)
  acct = setReserve(acct, RESERVE_TYPES.RECONCILIATION, 10)
  acct = setReserve(acct, RESERVE_TYPES.SYNTHESIS, 10)
  acct = setReserve(acct, RESERVE_TYPES.HANDOFF, 10)
  // Total reserved: 40; available: 160
  // Simulate waves of 8 features at 5 calls each (40 calls/wave)
  let waves = 0
  while (true) {
    if (!canFinishNextGate(acct, { calls: 40 })) break
    acct = spendBudget(acct, 40, 0)
    waves++
  }
  // 4 waves fit (4 × 40 = 160 = available budget)
  assert.equal(waves, 4)
  // Reserve is intact
  assert.equal(totalReserve(acct), 40)
  assert.ok(acct.callsSpent + totalReserve(acct) <= 200)
  // 5th wave cannot be admitted
  assert.equal(canFinishNextGate(acct, { calls: 40 }), false)
})

// =========================================================================
// E2E-FAIL-01: All five failure-type classifications
// =========================================================================

test('NV E2E-FAIL-01: retryable error is recorded but not terminal until exhausted', () => {
  const policy = createRetryPolicy({ maxPerGate: 3, maxPerFeature: 10 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE, 'transient error')
  assert.equal(isTerminalFailure(history, 'f1', policy), false)
  assert.equal(gateAttemptCount(history, 'f1', 'g1'), 1)
})

test('NV E2E-FAIL-01: timeout is recorded and counts toward exhaustion', () => {
  const policy = createRetryPolicy({ maxPerGate: 1 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.TIMEOUT, '30s exceeded')
  assert.equal(isGateRetriesExhausted(history, 'f1', 'g1', policy), true)
})

test('NV E2E-FAIL-01: invalid output is recorded and counts toward exhaustion', () => {
  const policy = createRetryPolicy({ maxPerGate: 1 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.INVALID_OUTPUT, 'schema mismatch')
  assert.equal(isGateRetriesExhausted(history, 'f1', 'g1', policy), true)
})

test('NV E2E-FAIL-01: permanent failure is immediately terminal', () => {
  const policy = createRetryPolicy({})
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.PERMANENT_FAILURE, 'fatal')
  assert.equal(isTerminalFailure(history, 'f1', policy), true)
  // Terminal reason preserved
  assert.equal(terminalReason(history, 'f1'), 'fatal')
})

test('NV E2E-FAIL-01: blocked dependency is immediately terminal', () => {
  const policy = createRetryPolicy({})
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.BLOCKED_DEPENDENCY, 'upstream failed')
  assert.equal(isTerminalFailure(history, 'f1', policy), true)
  assert.equal(terminalReason(history, 'f1'), 'upstream failed')
})

test('NV E2E-FAIL-01: terminal failure never counted as completed', () => {
  const policy = createRetryPolicy({ maxPerFeature: 1 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  assert.equal(isTerminalFailure(history, 'f1', policy), true)
  // Attempt summary shows the retryable failure, not success
  const summary = attemptSummary(history, 'f1')
  assert.equal(summary.lastOutcome, ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  assert.notEqual(summary.lastOutcome, ATTEMPT_OUTCOMES.SUCCESS)
})

// =========================================================================
// E2E-CONT-01: Out-of-order delivery convergence
// =========================================================================

test('NV E2E-CONT-01: out-of-order ack delivery converges to one outcome per segment', () => {
  let state = createContinuationState()
  // Segments 1, 2, 3: intents created in order
  let i1 = createSegmentIntent(state, 1, ['f1'], 'r1'); state = i1.state
  let i2 = createSegmentIntent(state, 2, ['f2'], 'r1'); state = i2.state
  let i3 = createSegmentIntent(state, 3, ['f3'], 'r1'); state = i3.state
  // Acknowledge in reverse order: 3, 2, 1
  let a3 = acknowledgeSegment(state, 3, idempotencyKey(3, ['f3'], 'r1'), 'done', { completed: 1 })
  state = a3.state
  let a2 = acknowledgeSegment(state, 2, idempotencyKey(2, ['f2'], 'r1'), 'done', { completed: 1 })
  state = a2.state
  let a1 = acknowledgeSegment(state, 1, idempotencyKey(1, ['f1'], 'r1'), 'done', { completed: 1 })
  state = a1.state
  // Convergence: all 3 segments acknowledged, no gaps
  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 3)
  assert.equal(convergence.unacknowledged.length, 0)
  // Segments are sorted by ID in converged output
  assert.equal(convergence.converged[0].segmentId, 1)
  assert.equal(convergence.converged[1].segmentId, 2)
  assert.equal(convergence.converged[2].segmentId, 3)
})

test('NV E2E-CONT-01: duplicate out-of-order ack converges (first ack wins)', () => {
  let state = createContinuationState()
  let i1 = createSegmentIntent(state, 1, ['f1'], 'r1'); state = i1.state
  const key = idempotencyKey(1, ['f1'], 'r1')
  // First ack with outcome 'done'
  let a1 = acknowledgeSegment(state, 1, key, 'done', { completed: 1 })
  state = a1.state
  // Duplicate ack with different outcome — first wins
  let a2 = acknowledgeSegment(state, 1, key, 'failed', { failed: 1 })
  assert.equal(a2.duplicate, true)
  assert.equal(a2.state.acknowledgements[0].outcome, 'done')
  assert.equal(a2.state.acknowledgements[0].counts.completed, 1)
})

// =========================================================================
// INTEGRATION: Retry exhaustion → isolation → continuation decision
// =========================================================================

test('NV INTEGRATION: retry exhaustion leads to isolation and continuation check', () => {
  // isTerminalFailure checks feature-level exhaustion, not per-gate.
  // Use maxPerFeature: 2 so 2 exhausting attempts make the feature terminal.
  const policy = createRetryPolicy({ maxPerGate: 2, maxPerFeature: 2 })
  let history = createAttemptHistory()

  // Feature f-dep fails after exhausting retries
  history = recordAttempt(history, 'f-dep', 'extract-facts', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE)
  history = recordAttempt(history, 'f-dep', 'extract-facts', ATTEMPT_OUTCOMES.TIMEOUT)
  assert.equal(isTerminalFailure(history, 'f-dep', policy), true)

  // Queue has f-dep (failed) and f-indep (independent, pending)
  const queue = [
    { id: 'f-dep', status: 'in-progress', artifacts: { factsPath: '/partial.md' } },
    { id: 'f-indep', status: 'pending', artifacts: {} },
  ]
  // Isolate the failure
  const isolated = isolateFailure(queue, 'f-dep', 'failed')
  assert.equal(isolated.find((e) => e.id === 'f-dep').status, 'failed')
  assert.equal(isolated.find((e) => e.id === 'f-indep').status, 'pending')
  // Artifacts preserved
  assert.equal(isolated.find((e) => e.id === 'f-dep').artifacts.factsPath, '/partial.md')

  // Independent feature can continue
  assert.equal(shouldContinueAfterFailure(isolated, 'f-dep', []), true)
})

test('NV INTEGRATION: budget exhaustion triggers segment stop with resume command', () => {
  let budget = createBudgetAccountant(createBudgetLimits({ callCeiling: 100 }))
  budget = setReserve(budget, RESERVE_TYPES.HANDOFF, 20)
  let contState = createContinuationState()

  // Process until budget exhausted
  const seg = nextSegmentId(contState)
  contState = seg.state
  const intent = createSegmentIntent(contState, seg.segmentId, ['f1', 'f2'], 'rev')
  contState = intent.state

  // Spend all non-reserved budget
  budget = spendBudget(budget, 80, 0)

  // Budget exhausted — cannot admit more work
  assert.equal(canFinishNextGate(budget, { calls: 1 }), false)

  // Acknowledge partial segment and generate resume command
  const key = idempotencyKey(seg.segmentId, ['f1', 'f2'], 'rev')
  const ack = acknowledgeSegment(contState, seg.segmentId, key, 'partial', {
    completed: 1,
    deferred: 1,
  })
  contState = ack.state

  const cmd = resumeCommand('/plan/', seg.segmentId, contState)
  assert.equal(cmd.idempotent, true)
  assert.equal(cmd.counts.completed, 1)
  assert.equal(cmd.counts.deferred, 1)
})
