// Budget admission: characterize limits, track spend, and reserve non-spendable
// capacity for checkpoint, reconciliation, synthesis, and handoff.
// All functions are pure and deterministic — no I/O, no side effects.

// Non-spendable reserve categories — capacity reserved for system-critical work
// that must never be consumed by gate/feature processing.
const RESERVE_TYPES = Object.freeze({
  CHECKPOINT: 'checkpoint',
  RECONCILIATION: 'reconciliation',
  SYNTHESIS: 'synthesis',
  HANDOFF: 'handoff',
})

// Characterized budget limits derived from runtime evidence, not guessed.
// callCeiling: shared runtime agent-call ceiling (default 1000)
// tokenCeiling: shared token budget (0 = uncharacterized)
// concurrency: max parallel features per segment
// retryPerGate: max retry attempts per gate per feature
// retryPerFeature: max total retries per feature
function createBudgetLimits(opts) {
  const o = opts || {}
  return {
    callCeiling: o.callCeiling || 1000,
    tokenCeiling: o.tokenCeiling || 0,
    concurrency: o.concurrency || 1,
    retryPerGate: o.retryPerGate || 3,
    retryPerFeature: o.retryPerFeature || 10,
  }
}

// Create a budget accountant that tracks actual spend against limits.
// Pure: all state is in the returned object, no mutation of inputs.
function createBudgetAccountant(limits) {
  return {
    limits,
    callsSpent: 0,
    tokensSpent: 0,
    reserve: {
      [RESERVE_TYPES.CHECKPOINT]: 0,
      [RESERVE_TYPES.RECONCILIATION]: 0,
      [RESERVE_TYPES.SYNTHESIS]: 0,
      [RESERVE_TYPES.HANDOFF]: 0,
    },
  }
}

// Set aside non-spendable reserve capacity. Returns a new accountant.
function setReserve(accountant, category, amount) {
  const next = {
    ...accountant,
    reserve: { ...accountant.reserve },
  }
  next.reserve[category] = amount
  return next
}

// Compute total reserved capacity across all categories.
function totalReserve(accountant) {
  return Object.values(accountant.reserve).reduce(function (s, v) { return s + v }, 0)
}

// Compute remaining callable budget after subtracting spent and reserved.
function callsRemaining(accountant) {
  var reserved = totalReserve(accountant)
  return Math.max(0, accountant.limits.callCeiling - accountant.callsSpent - reserved)
}

// Compute remaining token budget after subtracting spent and reserved.
function tokensRemaining(accountant) {
  if (!accountant.limits.tokenCeiling) return Infinity
  var reserved = totalReserve(accountant)
  return Math.max(0, accountant.limits.tokenCeiling - accountant.tokensSpent - reserved)
}

// Admit a segment: check if estimated work fits within remaining budget
// after reserving non-spendable capacity. Never accept a segment that
// crosses the characterized ceiling.
function admitSegment(accountant, segmentCost) {
  var calls = callsRemaining(accountant)
  var tokens = tokensRemaining(accountant)
  var neededCalls = (segmentCost && segmentCost.calls) || 0
  var neededTokens = (segmentCost && segmentCost.tokens) || 0

  if (neededCalls > calls) {
    return { admitted: false, reason: 'call-ceiling', remaining: { calls: calls, tokens: tokens } }
  }
  if (neededTokens > tokens) {
    return { admitted: false, reason: 'token-ceiling', remaining: { calls: calls, tokens: tokens } }
  }
  return { admitted: true, remaining: { calls: calls, tokens: tokens } }
}

// Record actual budget spend. Pure: returns a new accountant.
function spendBudget(accountant, calls, tokens) {
  return {
    ...accountant,
    callsSpent: accountant.callsSpent + (calls || 0),
    tokensSpent: accountant.tokensSpent + (tokens || 0),
    reserve: { ...accountant.reserve },
  }
}

// Check if a feature's next atomic gate can complete within remaining budget.
// Prevents admitting a feature whose next gate would cross the ceiling.
function canFinishNextGate(accountant, gateCost) {
  var calls = callsRemaining(accountant)
  var tokens = tokensRemaining(accountant)
  var neededCalls = (gateCost && gateCost.calls) || 0
  var neededTokens = (gateCost && gateCost.tokens) || 0
  return neededCalls <= calls && neededTokens <= tokens
}

// Budget summary for handoff/status reporting.
function budgetSummary(accountant) {
  return {
    callCeiling: accountant.limits.callCeiling,
    callsSpent: accountant.callsSpent,
    callsRemaining: callsRemaining(accountant),
    reserved: totalReserve(accountant),
    reserveBreakdown: { ...accountant.reserve },
  }
}

export { RESERVE_TYPES, createBudgetLimits, createBudgetAccountant, setReserve, totalReserve, callsRemaining, tokensRemaining, admitSegment, spendBudget, canFinishNextGate, budgetSummary }
