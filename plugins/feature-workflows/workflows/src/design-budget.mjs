// Design-mode per-gate/per-run call/token budget enforcement (DBUDGET-01).
// Wraps the Phase 5 budget-admission primitive with per-gate tracking so design
// runs enforce real budgets instead of merely observing via gateTelemetry.
// Non-spendable reserve for state flush/handoff is carved out and never consumed
// by gate work. All functions are pure and deterministic — no I/O, no side effects.
import { createBudgetAccountant, createBudgetLimits, setReserve, spendBudget, callsRemaining, budgetSummary, RESERVE_TYPES } from './budget-admission.mjs'

// Default budget caps derived from gateTelemetry characterization, not guessed.
// callPerGate: max agent calls a single design gate may consume.
// callPerRun: max total agent calls across the entire design run.
// tokenPerGate/tokenPerRun: 0 = uncharacterized (call-only enforcement).
const DESIGN_BUDGET_DEFAULTS = Object.freeze({
  callPerGate: 8,
  callPerRun: 200,
  tokenPerGate: 0,
  tokenPerRun: 0,
})

// Non-spendable reserve for state persistence and handoff — never consumed by gate work.
const DESIGN_RESERVE_CALLS = 10

// Create a design-mode budget accountant wrapping the Phase 5 pattern with per-gate tracking.
// opts can override defaults (from args.designCallPerGate / args.designCallPerRun).
function createDesignBudget(opts) {
  const o = opts || {}
  const limits = createBudgetLimits({
    callCeiling: o.callPerRun || DESIGN_BUDGET_DEFAULTS.callPerRun,
    tokenCeiling: o.tokenPerRun || DESIGN_BUDGET_DEFAULTS.tokenPerRun,
  })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, DESIGN_RESERVE_CALLS)
  return {
    accountant,
    gateSpend: {},
    caps: {
      callPerGate: o.callPerGate || DESIGN_BUDGET_DEFAULTS.callPerGate,
      tokenPerGate: o.tokenPerGate || DESIGN_BUDGET_DEFAULTS.tokenPerGate,
    },
  }
}

// Record actual spend for a design gate. Pure: returns a new budget object.
function spendDesignGate(budget, gateName, calls, tokens) {
  const prev = (budget.gateSpend && budget.gateSpend[gateName]) || { calls: 0, tokens: 0 }
  return {
    accountant: spendBudget(budget.accountant, calls, tokens),
    gateSpend: {
      ...budget.gateSpend,
      [gateName]: {
        calls: prev.calls + (calls || 0),
        tokens: prev.tokens + (tokens || 0),
      },
    },
    caps: { ...budget.caps },
  }
}

// Remaining calls for a specific gate (per-gate cap minus spent).
function gateCallsRemaining(budget, gateName) {
  const spent = (budget.gateSpend && budget.gateSpend[gateName]) || { calls: 0 }
  return Math.max(0, budget.caps.callPerGate - spent.calls)
}

// Check if a gate can be admitted within its per-gate cap AND the per-run ceiling.
// estimatedCost: { calls, tokens } the gate is expected to consume.
function canAdmitDesignGate(budget, gateName, estimatedCost) {
  const gateCalls = gateCallsRemaining(budget, gateName)
  const runCalls = callsRemaining(budget.accountant)
  const neededCalls = (estimatedCost && estimatedCost.calls) || 0
  if (neededCalls > gateCalls) {
    return { admitted: false, reason: 'per-gate-cap', remaining: { gate: gateCalls, run: runCalls } }
  }
  if (neededCalls > runCalls) {
    return { admitted: false, reason: 'per-run-cap', remaining: { gate: gateCalls, run: runCalls } }
  }
  return { admitted: true, remaining: { gate: gateCalls, run: runCalls } }
}

// Budget summary for handoff/status reporting. Merges the Phase 5 budgetSummary
// with per-gate spend detail and the caps in effect.
function designBudgetSummary(budget) {
  const base = budgetSummary(budget.accountant)
  const gateSpendCopy = {}
  for (const name of Object.keys(budget.gateSpend)) {
    gateSpendCopy[name] = { ...budget.gateSpend[name] }
  }
  return {
    ...base,
    gateSpend: gateSpendCopy,
    caps: { ...budget.caps },
  }
}

// Remaining tokens for a specific gate (per-gate token cap minus spent).
// Returns Infinity when tokenPerGate is 0 (uncharacterized — see note below).
function gateTokensRemaining(budget, gateName) {
  const cap = budget.caps.tokenPerGate || 0
  if (!cap) return Infinity
  const spent = (budget.gateSpend && budget.gateSpend[gateName]) || { tokens: 0 }
  return Math.max(0, cap - spent.tokens)
}

// Post-gate token spend recording. Called after a gate's agent calls complete to
// record actual token consumption. This is the measurement hook for D3: the
// mechanism exists so a dogfood run can collect real per-gate token data and
// feed it back into characterized tokenPerGate/tokenPerRun caps. Until then,
// designBudgetGate always records 0 tokens and only the call ceiling is enforced.
// Pure: returns a new budget object.
function recordGateTokenSpend(budget, gateName, tokens) {
  return spendDesignGate(budget, gateName, 0, tokens)
}

export { DESIGN_BUDGET_DEFAULTS, DESIGN_RESERVE_CALLS, createDesignBudget, spendDesignGate, gateCallsRemaining, gateTokensRemaining, canAdmitDesignGate, designBudgetSummary, recordGateTokenSpend }
