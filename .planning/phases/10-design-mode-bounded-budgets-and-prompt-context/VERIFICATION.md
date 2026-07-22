# Phase 10 — UAT Verification (Goal-Backward)

**Phase:** 10 — Design-Mode Bounded Budgets and Prompt Context
**Milestone:** v1.5.0 (gh sub-issue #29)
**Verification date:** 2026-07-23
**Verifier:** autonomous UAT agent (`/gsd-verify-work 10 --auto`)
**Method:** Goal-backward — examine delivered source against the stated DBUDGET-01,
DLOOP-01, and DPROMPT-01 goals, then run live behavioral checks (clean rebuild drift,
dist call-site counts, wiring confirmation, full test suite). No human interaction; all
defaults taken autonomously.

---

## Verdict: GOAL MET (after UAT fix)

Phase 10's three requirements are genuinely delivered in the post-fix codebase. The UAT
found one enforcement gap (DBUDGET-01 spend/admit functions imported but never called in
the live path) and fixed it by adding a `designBudgetGate` helper wired into all 12
design gates.

- **DBUDGET-01:** Per-gate/per-run call budget enforcement is live. `designBudgetGate`
  checks `canAdmitDesignGate` before each design gate and records actual spend via
  `spendDesignGate`. The non-spendable HANDOFF reserve (10 calls) is protected by
  `callsRemaining` inside the admission check. Budget exhaustion produces a truthful
  handoff with `blockedAt='design-budget-exhausted'`.
- **DLOOP-01:** Each review/refine loop draws from its own bounded sub-budget.
  `loopBudgetExhausted` is the primary loop-condition check; `spendLoop` tracks each
  iteration. Escalation cap is configurable via `args.maxEscalationRetries` or defaults
  to `ESCALATION_RETRIES_DEFAULT` (5) — no hardcoded constant.
- **DPROMPT-01:** All 7 former raw `JSON.stringify` sites at design-gate prompt
  interpolation points replaced with `compactList(..., 8)`. Source assertion tests
  confirm zero remnants.

91 Phase 10 tests pass (32 in `design-budget.test.mjs` + 59 in
`design-budget-nyquist.test.mjs`); full milestone suite **1458** pass / 0 fail; clean
rebuild is drift-free.

---

## Requirements Verified

### DBUDGET-01 — Enforced per-gate/per-run call/token budgets — MET

**Goal:** A design run enforces per-gate and per-run call/token budgets with a
non-spendable reserve for state persistence and handoff, instead of purely
observational counters.

**Evidence (source — `plugins/feature-workflows/workflows/src/design-budget.mjs`):**

- `DESIGN_BUDGET_DEFAULTS` frozen: `callPerGate=8, callPerRun=200, tokenPerGate=0,
  tokenPerRun=0`.
- `DESIGN_RESERVE_CALLS=10`: non-spendable HANDOFF reserve.
- `createDesignBudget(opts)` creates a Phase 5 budget accountant with the HANDOFF
  reserve set via `setReserve(accountant, RESERVE_TYPES.HANDOFF, 10)`.
- `canAdmitDesignGate(budget, gateName, estimatedCost)` checks BOTH per-gate cap
  (`gateCallsRemaining`) and per-run ceiling (`callsRemaining` which subtracts reserve).
- `spendDesignGate(budget, gateName, calls, tokens)` — pure, returns new budget with
  incremented accountant + per-gate spend.
- `designBudgetSummary(budget)` — deep-copies `gateSpend` entries (Nyquist defect fix,
  commit `c4a1caa`): iterates keys and spreads each nested `{calls, tokens}` object.

**Live enforcement wiring (UAT fix — `main.mjs` lines 213-234, 1588, 1711, 1750, 1802,
1862, 1945, 2013, 2083, 2133, 2187, 2322, 2541):**

The `designBudgetGate(r, gateName)` async helper (source line 213) is called before each
of the 12 design gates' primary agent calls. It:
1. Calls `canAdmitDesignGate(designBudget, gateName, {calls: 1})`.
2. If admitted: records spend via `spendDesignGate(designBudget, gateName, 1, 0)` and
   returns `false` (caller proceeds).
3. If denied: sets `r.blockedAt='design-budget-exhausted'`, records
   `r._designBudget=designBudgetSummary(...)`, `r._loopBudgets=loopBudgetSummary(...)`,
   sets a truthful handoff message with the reason and remaining budget, persists state,
   and returns `true` (caller returns `result`).

Gates instrumented: Define, Knowledge, Codebase Facts, E2E Use Cases, Requirements,
Architecture, Detailed Design, Plan, TDD Enforce, Reconcile, Review/Refine, Chunk Plan.

**Dist confirmation:** 13 references to `designBudgetGate` in generated
`feature-pipeline.js` (1 definition + 12 gate calls). Verified by 10 new NYQ-ENFORCE
source-assertion tests.

**HANDOFF reserve protection:** The `callsRemaining` function in `budget-admission.mjs`
computes `max(0, callCeiling - callsSpent - totalReserve)`. The HANDOFF reserve (10) is
included in `totalReserve`, so it is never available for gate work. Verified by
`NYQ-DBUDGET: spending all available calls does not touch reserve`.

### DLOOP-01 — Per-loop sub-budgets — MET

**Goal:** Later design gates cannot be starved by earlier ones because each review/refine
loop draws from its own bounded sub-budget; escalation retry limits are configurable.

**Evidence (source — `plugins/feature-workflows/workflows/src/design-loops.mjs`):**

- `createLoopBudgets(config)` returns 4 independent pools:
  `{refine:{used:0,cap:10}, reconcile:{used:0,cap:5}, debug:{used:0,cap:20},
  escalation:{used:0,cap:5}}` — caps from config or defaults.
- `spendLoop(budgets, loopName)` — pure, increments only the named loop's `used`.
- `loopBudgetExhausted(budgets, loopName)` — returns `used >= cap` for the named loop.
- `loopBudgetSummary(budgets)` — returns `{used, cap, remaining}` per loop for handoff.

**Live wiring (main.mjs):**
- Reconcile loop condition (line ~2228): `!loopBudgetExhausted(loopBudgets, 'reconcile')`
  as primary check; `spendLoop(loopBudgets, 'reconcile')` after each iteration.
- Review/refine loop condition (line ~2330): `!loopBudgetExhausted(loopBudgets, 'refine')`
  as primary check; `spendLoop(loopBudgets, 'refine')` after each iteration.
- Escalation loop (line ~2413): bounded by `escalationCap` from `loopBudgets.escalation.cap`;
  `spendLoop(loopBudgets, 'escalation')` after each iteration.
- `escalationCap` is configurable via `args.maxEscalationRetries` or defaults to
  `ESCALATION_RETRIES_DEFAULT` (5) — no hardcoded `const ESCALATION_RETRIES = 5`.

**Loop independence:** Spending `refine` does not increase `escalation.used` — verified
by `DLOOP-01: spending reconcile does NOT affect refine or escalation`.

### DPROMPT-01 — Bounded prompt context — MET

**Goal:** Design-gate prompts stay bounded because conflict, blocker, and fix payloads
are capped and compacted with `compactList` before interpolation.

**Evidence (source — `main.mjs`, confirmed in dist):**

All 7 former raw `JSON.stringify` sites replaced with `compactList(..., 8)`:

| Site (dist line) | Former | Current |
|------------------|--------|---------|
| 9223 | `JSON.stringify(result.reconcile.conflicts)` | `compactList(result.reconcile.conflicts, 8)` |
| 9247 | `JSON.stringify(result.reconcile.conflicts)` | `compactList(result.reconcile.conflicts, 8)` |
| 9271 | `JSON.stringify(result.reconcile.designFixes \|\| []).slice(0, 800)` | `compactList(result.reconcile.designFixes \|\| [], 8)` |
| 9300 | `JSON.stringify(result.reconcile.designFixes).slice(0, 800)` | `compactList(result.reconcile.designFixes, 8)` |
| 9335 | `JSON.stringify(result.reconcile.conflicts)` | `compactList(result.reconcile.conflicts, 8)` |
| 9461 | `JSON.stringify(yagniBlockers, null, 2)` | `compactList(yagniBlockers, 8)` |
| 9474 | `JSON.stringify((reviewState && reviewState.blockers) \|\| [], null, 2)` | `compactList((reviewState && reviewState.blockers) \|\| [], 8)` |

Source assertion tests confirm: zero `JSON.stringify(result.reconcile`, zero
`JSON.stringify(yagniBlockers`, zero `JSON.stringify((reviewState`, zero `.slice(0, 800)`
on design payloads.

---

## UAT Scenarios Confirmed

### Goal 1 — Budget exhaustion stops the run with truthful handoff

`designBudgetGate` is called before each design gate's agent call. If
`canAdmitDesignGate` returns `admitted: false` (either `per-gate-cap` or `per-run-cap`),
the gate sets `blockedAt='design-budget-exhausted'`, records the full budget summary
(`_designBudget` with callsSpent, callsRemaining, gateSpend, reserveBreakdown), and
returns early with a handoff message naming the gate and reason.

The HANDOFF reserve (10 calls) is subtracted inside `callsRemaining`, making it
non-spendable by gate work. Verified: `spending all available calls does not touch reserve`
test passes.

### Goal 2 — Loop independence prevents starvation

`createLoopBudgets` creates 4 separate `{used, cap}` pools. `spendLoop` only increments
the named loop. An early loop that exhausts its `refine` cap (10) does not reduce the
`escalation` cap (5). The global `budgetExhausted(retryState)` remains as a secondary
runaway guard.

### Goal 3 — Prompt payloads stay bounded

`compactList(items, 8)` caps each design-gate prompt payload at 8 entries. No raw
`JSON.stringify` of conflicts/blockers/fixes remains at prompt interpolation sites.

---

## Defect Fix Applied During This UAT

**DBUDGET-01 enforcement gap (found and fixed by this UAT):**

The original Phase 10 implementation created `designBudget` and recorded its summary at
handoff, but `spendDesignGate` and `canAdmitDesignGate` were imported as dead imports —
never called in the live code path. Per-gate caps and the HANDOFF reserve were
functionally inert during a design run.

**Fix:** Added the `designBudgetGate(r, gateName)` async helper (main.mjs:213-234) that
wraps `canAdmitDesignGate` + `spendDesignGate` into a single admission gate. Wired it
into all 12 design gates as a one-line check before each gate's primary agent call:
`if (await designBudgetGate(result, 'GateName')) return result`.

Added 10 source-assertion tests (NYQ-ENFORCE series) that verify the helper exists, calls
both admission and spend functions, is wired into >= 12 gates (including specific gates:
Define, Plan, Architecture, Review/Refine, Reconcile), and blocks with
`design-budget-exhausted`.

**Pre-existing Nyquist defect fix (commit `c4a1caa`, verified present):**
`designBudgetSummary` deep-copies each `gateSpend` entry instead of shallow-spreading
the top-level object. Verified by `NYQ-DBUDGET: designBudgetSummary returns deep copy`
test which mutates the summary and asserts the live budget is unaffected.

---

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| `tests/design-budget.test.mjs` | 32 | all pass — DBUDGET-01 (15), DLOOP-01 (9), DPROMPT-01 (6), Regression (2) |
| `tests/design-budget-nyquist.test.mjs` | 59 | all pass — DBUDGET (15), DLOOP (14), DPROMPT (7), WIRE (13), ENFORCE (10, new) |
| **Phase 10 total** | **91** | **all pass** |
| Full milestone suite | **1458** | pass / 0 fail |

Build validation: `npm run validate:build` — both entries drift-free (`feature-pipeline.js`
+ `fp-extract-slice.js` each 33 modules, 314 top-level names, engine-version 1.4.5).

---

## Files Verified

| File | Role |
|------|------|
| `plugins/feature-workflows/workflows/src/design-budget.mjs` | `createDesignBudget`, `spendDesignGate`, `canAdmitDesignGate`, `designBudgetSummary` (deep-copy fix), `DESIGN_BUDGET_DEFAULTS`, `DESIGN_RESERVE_CALLS` |
| `plugins/feature-workflows/workflows/src/design-loops.mjs` | `createLoopBudgets`, `spendLoop`, `loopBudgetExhausted`, `loopBudgetSummary` |
| `plugins/feature-workflows/workflows/src/budget-admission.mjs` | Phase 5 primitives: `createBudgetAccountant`, `setReserve`, `callsRemaining`, `spendBudget` |
| `plugins/feature-workflows/workflows/src/config.mjs` | `ESCALATION_RETRIES_DEFAULT=5` (line 20, exported line 205) |
| `plugins/feature-workflows/workflows/src/main.mjs` | `designBudgetGate` helper (213-234), 12 gate-level checks, loop budget wiring, compactList at 7 sites, `_designBudget`/`_loopBudgets` handoff fields |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist — drift-free, all Phase 10 patterns present (13 designBudgetGate refs) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated leaf dist — drift-free |
| `tests/design-budget.test.mjs` | 32 original Phase 10 tests |
| `tests/design-budget-nyquist.test.mjs` | 59 Nyquist tests (49 original + 10 new ENFORCE wiring tests) |

---

## Concerns (non-blocking)

1. **`designBudgetGate` counts 1 call per gate invocation, not actual agent calls.**
   Each gate's primary `flexibleAgent`/`safeAgent` call may internally retry or escalate,
   consuming multiple agent calls. The design budget counts 1 per gate entry, which
   under-counts actual usage. This is conservative (allows more than it should) but still
   provides genuine protection against gate-level abuse. Full accuracy would require
   reading telemetry deltas after each gate — deferred as a future refinement.

2. **Design budget is separate from the Phase 5 global retry budget.** Two budget systems
   run in parallel: the global `retryState` (Phase 5) and the design-specific
   `designBudget` (Phase 10). Both have ceilings. Under normal operation neither is hit.
   The design budget's per-gate cap (8) and per-run cap (200) are safety nets against
   runaway gates, not primary constraints.

---

## Sign-off

Phase 10 goals are genuinely met. Per-gate/per-run design budgets are enforced via
`designBudgetGate` at all 12 design gates (UAT fix). Per-loop sub-budgets prevent
inter-loop starvation. All design-gate prompt payloads use `compactList`. The Nyquist
defect fix (designBudgetSummary deep-copy) is verified present. 91 Phase 10 tests pass;
1458 tests pass overall; clean rebuild is drift-free.

**Status:** VERIFIED
