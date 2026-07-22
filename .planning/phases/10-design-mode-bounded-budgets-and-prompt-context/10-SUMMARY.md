# Phase 10: Design-Mode Bounded Budgets and Prompt Context — Summary

**Phase:** 10
**Completed:** 2026-07-22
**Requirements:** DBUDGET-01, DLOOP-01, DPROMPT-01
**Commit:** d733758 (impl) · c4a1caa (Nyquist validation: deep-copy fix in `designBudgetSummary`) · 9b84230 (UAT: wired `designBudgetGate` into the live design flow)

## What was built

Design runs enforce real per-gate/per-run budgets with reserved handoff capacity, give each
review/refine loop its own sub-budget, and keep every design-gate prompt bounded — adopting the
Phase 5 enforced-budget/reserve pattern.

1. **`design-budget.mjs` — enforced design budget (DBUDGET-01)**
   - `createDesignBudget`, `spendDesignGate`, `canAdmitDesignGate`, `gateCallsRemaining`,
     `designBudgetSummary` + frozen `DESIGN_BUDGET_DEFAULTS` and `DESIGN_RESERVE_CALLS=10`.
   - Tracks per-gate spend (calls/tokens) against per-gate caps AND the per-run ceiling, with a
     non-spendable HANDOFF reserve that reduces available calls. Wraps the Phase 5 `budget-admission`
     primitives (`createBudgetAccountant`/`createBudgetLimits`/`setReserve`/`spendBudget`/`callsRemaining`).
   - (Nyquist validation fixed a shallow-copy mutation in `designBudgetSummary` — each `gateSpend` entry
     is now deep-copied so a consumer mutating the summary cannot corrupt the live budget.)

2. **`design-loops.mjs` — per-loop sub-budgets (DLOOP-01)**
   - `createLoopBudgets`, `spendLoop`, `loopBudgetExhausted`, `loopBudgetSummary`.
   - Each review/refine loop (refine, reconcile, debug, escalation) gets its own independent
     `{used, cap}` pool; spending one loop does NOT reduce another's budget. Escalation cap is
     configurable via `args.maxEscalationRetries` (replacing the previously hardcoded `ESCALATION_RETRIES=5`).

3. **`main.mjs` — bounded prompt payloads (DPROMPT-01) + runtime enforcement**
   - DPROMPT-01: all 10 raw `JSON.stringify` design-gate prompt sites (reconcile conflicts, design fixes,
     review blockers, YAGNI blockers) replaced with `compactList(payload, 8)`.
   - Runtime enforcement (added during UAT, commit `9b84230`): a `designBudgetGate(result, gateName)`
     helper wraps `canAdmitDesignGate` + `spendDesignGate` into a single admission gate and is wired into
     all 12 design gates. Budget exhaustion yields a truthful `blockedAt='design-budget-exhausted'` handoff.
     > The pure budget functions were initially imported but NOT called in the live design flow (a
     > goal-level gap); UAT verification caught this and wired `designBudgetGate` in (+10 tests).

4. **Tests** — 32 implementation + 49 Nyquist + 10 UAT-enforcement.

## Notes

- Findings F11–F13 trace to `.planning/research/DESIGN-MODE-FINDINGS.md`.
- Non-blocking observation: `designBudgetGate` counts 1 call per gate *invocation*, not actual intra-gate
  agent calls (conservative — under-counts retries/escalations within a gate).
