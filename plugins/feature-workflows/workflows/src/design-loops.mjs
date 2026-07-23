// Per-loop sub-budget tracker for design review/refine loops (DLOOP-01).
//
// Each design review/refine loop (refine, reconcile, debug, escalation) gets its
// OWN bounded sub-budget so early-loop spend cannot starve later gates or
// escalation. This replaces the F12 defect where all four loops drew from the
// single shared retryState counter. The shared retryState remains as a secondary
// runaway guard, but the PRIMARY iteration limit for each loop is its own cap.
//
// All functions are pure and deterministic — no I/O, no side effects.
import { REFINE_SUBCAP_DEFAULT, RECONCILE_SUBCAP_DEFAULT, DEBUG_SUBCAP_DEFAULT, ESCALATION_RETRIES_DEFAULT } from './config.mjs'

// Create per-loop budget tracker. Each loop gets its own {used, cap} pool.
// config overrides come from args (maxRefineIterations, maxReconcileIterations,
// maxDebugRetries, maxEscalationRetries).
function createLoopBudgets(config) {
  const c = config || {}
  return {
    refine: { used: 0, cap: c.refineCap || REFINE_SUBCAP_DEFAULT },
    reconcile: { used: 0, cap: c.reconcileCap || RECONCILE_SUBCAP_DEFAULT },
    debug: { used: 0, cap: c.debugCap || DEBUG_SUBCAP_DEFAULT },
    escalation: { used: 0, cap: c.escalationCap || ESCALATION_RETRIES_DEFAULT },
  }
}

// Increment a single loop's used counter. Pure: returns a new budgets object.
function spendLoop(budgets, loopName) {
  const b = budgets && budgets[loopName]
  if (!b) return budgets
  return {
    ...budgets,
    [loopName]: { used: b.used + 1, cap: b.cap },
  }
}

// Check if a specific loop has exhausted its own sub-budget.
function loopBudgetExhausted(budgets, loopName) {
  const b = budgets && budgets[loopName]
  if (!b) return true
  return b.used >= b.cap
}

// Summary of all loop budgets for handoff/status reporting.
function loopBudgetSummary(budgets) {
  if (!budgets) return {}
  const out = {}
  for (const name of Object.keys(budgets)) {
    const b = budgets[name]
    out[name] = { used: b.used, cap: b.cap, remaining: Math.max(0, b.cap - b.used) }
  }
  return out
}

export { createLoopBudgets, spendLoop, loopBudgetExhausted, loopBudgetSummary }
