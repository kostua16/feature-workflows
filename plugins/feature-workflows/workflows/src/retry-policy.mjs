// Bounded retry policy: per-gate and per-feature retry limits, persistent
// attempt history with monotonic sequence, and terminal reason tracking.
// Exhausted retries are never reclassified as completed.
// All functions are pure and deterministic — no I/O, no side effects.

// Attempt outcomes
const ATTEMPT_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  RETRYABLE_FAILURE: 'retryable-failure',
  TIMEOUT: 'timeout',
  INVALID_OUTPUT: 'invalid-output',
  PERMANENT_FAILURE: 'permanent-failure',
  BLOCKED_DEPENDENCY: 'blocked-dependency',
})

// Outcomes that count toward retry exhaustion
var EXHAUSTING_OUTCOMES = {
  'retryable-failure': true,
  'timeout': true,
  'invalid-output': true,
}

// Create a retry policy with per-gate and per-feature limits.
function createRetryPolicy(opts) {
  var o = opts || {}
  return {
    maxPerGate: o.maxPerGate || 3,
    maxPerFeature: o.maxPerFeature || 10,
  }
}

// Create a fresh attempt history. The _seq counter is monotonic.
function createAttemptHistory() {
  return {
    attempts: [],
    _seq: 0,
  }
}

// Record an attempt. Pure: returns a new history with a new monotonic sequence number.
function recordAttempt(history, featureId, gate, outcome, reason) {
  var seq = history._seq + 1
  var attempt = {
    seq: seq,
    featureId: featureId,
    gate: gate,
    outcome: outcome,
    reason: reason || null,
  }
  return {
    attempts: history.attempts.concat([attempt]),
    _seq: seq,
  }
}

// Count retryable attempts for a specific feature+gate combination.
// Only exhausting outcomes (retryable-failure, timeout, invalid-output) count.
function gateAttemptCount(history, featureId, gate) {
  var count = 0
  for (var i = 0; i < history.attempts.length; i++) {
    var a = history.attempts[i]
    if (a.featureId === featureId && a.gate === gate && EXHAUSTING_OUTCOMES[a.outcome]) {
      count++
    }
  }
  return count
}

// Count total retryable attempts for a feature across all gates.
function featureAttemptCount(history, featureId) {
  var count = 0
  for (var i = 0; i < history.attempts.length; i++) {
    var a = history.attempts[i]
    if (a.featureId === featureId && EXHAUSTING_OUTCOMES[a.outcome]) {
      count++
    }
  }
  return count
}

// Check if per-gate retries are exhausted for a feature+gate.
function isGateRetriesExhausted(history, featureId, gate, policy) {
  return gateAttemptCount(history, featureId, gate) >= policy.maxPerGate
}

// Check if total per-feature retries are exhausted.
function isFeatureRetriesExhausted(history, featureId, policy) {
  return featureAttemptCount(history, featureId) >= policy.maxPerFeature
}

// Check if a feature is terminally failed — no more retries possible.
// A permanent failure or blocked dependency is immediately terminal.
// Exhausted retries (per-gate or per-feature) are also terminal.
function isTerminalFailure(history, featureId, policy) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  if (featureAttempts.length === 0) return false

  var lastOutcome = featureAttempts[featureAttempts.length - 1].outcome
  if (lastOutcome === ATTEMPT_OUTCOMES.PERMANENT_FAILURE) return true
  if (lastOutcome === ATTEMPT_OUTCOMES.BLOCKED_DEPENDENCY) return true

  return isFeatureRetriesExhausted(history, featureId, policy)
}

// Get the terminal reason for a feature (if terminally failed).
function terminalReason(history, featureId) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  if (featureAttempts.length === 0) return null
  var last = featureAttempts[featureAttempts.length - 1]
  return last.reason || last.outcome
}

// Summary of attempts for a feature for handoff/status reporting.
function attemptSummary(history, featureId) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  return {
    totalAttempts: featureAttempts.length,
    lastOutcome: featureAttempts.length > 0 ? featureAttempts[featureAttempts.length - 1].outcome : null,
    lastReason: featureAttempts.length > 0 ? featureAttempts[featureAttempts.length - 1].reason : null,
    gates: featureAttempts.map(function (a) { return a.gate }).filter(function (v, i, arr) { return arr.indexOf(v) === i }),
  }
}

export { ATTEMPT_OUTCOMES, createRetryPolicy, createAttemptHistory, recordAttempt, gateAttemptCount, featureAttemptCount, isGateRetriesExhausted, isFeatureRetriesExhausted, isTerminalFailure, terminalReason, attemptSummary }
