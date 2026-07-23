---
phase: 10
title: "Design-Mode Bounded Budgets and Prompt Context"
wave: 1
depends_on: []
requirements: [DBUDGET-01, DLOOP-01, DPROMPT-01]
files_modified:
  - plugins/feature-workflows/workflows/src/design-budget.mjs
  - plugins/feature-workflows/workflows/src/design-loops.mjs
  - plugins/feature-workflows/workflows/src/config.mjs
  - plugins/feature-workflows/workflows/src/main.mjs
  - scripts/build-workflows.mjs
  - tests/harness.mjs
  - tests/design-budget.test.mjs
autonomous: true
---

# Phase 10: Design-Mode Bounded Budgets and Prompt Context

## Objective

Enforce real per-gate and per-run call/token budgets with reserved capacity for state persistence and handoff (DBUDGET-01), give each design review/refine loop its own bounded sub-budget and make escalation retries configurable (DLOOP-01), and cap/compact design-gate prompt payloads via the existing compactList helper (DPROMPT-01).

## must_haves

truths:
  - "Per-gate and per-run call/token budgets are enforced, not merely observed, using the Phase 5 budget-admission pattern"
  - "Non-spendable reserve for state flush/handoff is never consumed by design gate work"
  - "Each design review/refine loop draws from its own bounded sub-budget — early-loop spend cannot starve later loops"
  - "Escalation retry limit is configurable, not hardcoded"
  - "All design-gate prompt payloads use compactList before interpolation — no raw JSON.stringify of conflicts/blockers/fixes"

## RED Gate Evidence

1. `tests/design-budget.test.mjs` asserts `createDesignBudget` exists and enforces per-gate caps — fails (function absent).
2. Test asserts per-loop budgets are independent (refine spend does not reduce escalation budget) — fails (all share retryState).
3. Source assertion test scans main.mjs for raw `JSON.stringify(result.reconcile` at prompt interpolation sites — fails (raw sites present).
4. Test asserts `ESCALATION_RETRIES_DEFAULT` is importable from config — fails (hardcoded in main.mjs).

## Tasks

### Task 1: Create design-budget.mjs (DBUDGET-01)

<action>
Create `plugins/feature-workflows/workflows/src/design-budget.mjs` with pure design-mode budget enforcement functions wrapping the Phase 5 budget-admission pattern:
- `DESIGN_BUDGET_DEFAULTS` frozen const: callPerGate=8, callPerRun=200, tokenPerGate=0, tokenPerRun=0
- `DESIGN_RESERVE_CALLS=10` const for state-flush/handoff reserve
- `createDesignBudget(opts)` — creates `{ accountant, gateSpend, caps }` using `createBudgetAccountant` from budget-admission.mjs, sets reserve via `setReserve(accountant, RESERVE_TYPES.HANDOFF, DESIGN_RESERVE_CALLS)`
- `spendDesignGate(budget, gateName, calls, tokens)` — pure, returns new budget with incremented accountant + gateSpend
- `gateCallsRemaining(budget, gateName)` — max(0, caps.callPerGate - gateSpend[gateName].calls)
- `canAdmitDesignGate(budget, gateName, estimatedCost)` — checks per-gate AND per-run via `callsRemaining(accountant)`; returns `{admitted, reason, remaining}`
- `designBudgetSummary(budget)` — for handoff/status, merges `budgetSummary(accountant)` with gateSpend + caps
Import from `./budget-admission.mjs`. Export all functions + `DESIGN_BUDGET_DEFAULTS` + `DESIGN_RESERVE_CALLS`.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/budget-admission.mjs (Phase 5 pattern to reuse)
- plugins/feature-workflows/workflows/src/agent-core.mjs (bumpGateTelemetry spend source)
</read_first>

<acceptance_criteria>
- `design-budget.mjs` exists and exports createDesignBudget, spendDesignGate, gateCallsRemaining, canAdmitDesignGate, designBudgetSummary, DESIGN_BUDGET_DEFAULTS, DESIGN_RESERVE_CALLS
- createDesignBudget returns object with accountant (from createBudgetAccountant), gateSpend={}, caps with callPerGate and tokenPerGate
- spendDesignGate is pure (does not mutate input budget)
- canAdmitDesignGate returns {admitted:false} when per-gate cap exceeded
- canAdmitDesignGate returns {admitted:false} when per-run callsRemaining is exceeded
- Reserve for HANDOFF is set and callsRemaining subtracts it
</acceptance_criteria>

### Task 2: Create design-loops.mjs (DLOOP-01)

<action>
Create `plugins/feature-workflows/workflows/src/design-loops.mjs` with per-loop sub-budget tracker:
- Import `REFINE_SUBCAP_DEFAULT, RECONCILE_SUBCAP_DEFAULT, DEBUG_SUBCAP_DEFAULT, ESCALATION_RETRIES_DEFAULT` from config.mjs
- `createLoopBudgets(config)` — returns `{ refine:{used:0,cap}, reconcile:{used:0,cap}, debug:{used:0,cap}, escalation:{used:0,cap} }` where caps come from config args or defaults
- `spendLoop(budgets, loopName)` — pure, returns new budgets with that loop's used incremented
- `loopBudgetExhausted(budgets, loopName)` — returns `b.used >= b.cap`
- `loopBudgetSummary(budgets)` — returns map of loop → {used, cap, remaining} for handoff/status
Export all functions.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/config.mjs (existing sub-cap constants)
</read_first>

<acceptance_criteria>
- `design-loops.mjs` exists and exports createLoopBudgets, spendLoop, loopBudgetExhausted, loopBudgetSummary
- createLoopBudgets returns 4 loop entries each with used=0 and cap from config or default
- spendLoop is pure (returns new object, does not mutate)
- Spending 'refine' loop does NOT increase 'escalation' loop used count
- loopBudgetExhausted returns true when used >= cap
</acceptance_criteria>

### Task 3: Add ESCALATION_RETRIES_DEFAULT to config.mjs (DLOOP-01)

<action>
Add `const ESCALATION_RETRIES_DEFAULT = 5` to config.mjs alongside existing sub-cap constants (after RECONCILE_SUBCAP_DEFAULT). Add to the export statement. This replaces the hardcoded `const ESCALATION_RETRIES = 5` in main.mjs.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/config.mjs (constants section lines 17-21 and export line 204)
</read_first>

<acceptance_criteria>
- config.mjs contains `const ESCALATION_RETRIES_DEFAULT = 5`
- config.mjs export statement includes ESCALATION_RETRIES_DEFAULT
- main.mjs import from config.mjs includes ESCALATION_RETRIES_DEFAULT
</acceptance_criteria>

### Task 4: Wire budgets and loops into main.mjs (DBUDGET-01, DLOOP-01)

<action>
In main.mjs design-mode section:
1. Import design-budget and design-loops functions + ESCALATION_RETRIES_DEFAULT from config
2. After retryState initialization (around line 188-192), add:
   - `const designBudget = createDesignBudget({ callPerGate: args.designCallPerGate, callPerRun: args.designCallPerRun })`
   - `const loopBudgets = createLoopBudgets({ refineCap: refineSubcap, reconcileCap: reconcileSubcap, escalationCap: (args && args.maxEscalationRetries) || ESCALATION_RETRIES_DEFAULT })`
3. Replace `const ESCALATION_RETRIES = 5` with `const escalationCap = loopBudgets.escalation.cap` and use it everywhere ESCALATION_RETRIES was used
4. In reconcile loop condition: replace `!budgetExhausted(retryBudget)` with `!loopBudgetExhausted(loopBudgets, 'reconcile')`; replace `spendRetry(1)` with `loopBudgets = spendLoop(loopBudgets, 'reconcile')`
5. In review/refine loop condition: replace `!budgetExhausted(retryBudget)` with `!loopBudgetExhausted(loopBudgets, 'refine')`; replace spendRetry(1) with loopBudgets spend
6. In escalation loop: iterate over escalationCap; replace spendRetry(1) with loopBudgets escalation spend
7. Keep global budgetExhausted check as a SECONDARY runaway guard alongside per-loop checks
8. Record designBudget in result for handoff: `result._designBudget = designBudgetSummary(designBudget)` before terminal exits
</action>

<read_first>
- plugins/feature-workflows/workflows/src/main.mjs (lines 186-192 budget init; 2120-2266 reconcile loop; 2255-2330 review/refine loop; 2355-2445 escalation loop)
- plugins/feature-workflows/workflows/src/design-budget.mjs (Task 1 output)
- plugins/feature-workflows/workflows/src/design-loops.mjs (Task 2 output)
</read_first>

<acceptance_criteria>
- main.mjs no longer contains `const ESCALATION_RETRIES = 5`
- main.mjs imports ESCALATION_RETRIES_DEFAULT from config.mjs
- Reconcile loop condition uses loopBudgetExhausted(loopBudgets, 'reconcile') not budgetExhausted(retryBudget) as primary check
- Review/refine loop condition uses loopBudgetExhausted(loopBudgets, 'refine') as primary check
- Escalation loop uses escalationCap from loopBudgets
- result._designBudget is set for handoff reporting
</acceptance_criteria>

### Task 5: Apply compactList to all design-gate prompts (DPROMPT-01)

<action>
Replace all 7 raw JSON.stringify interpolation sites in main.mjs design gates with compactList:
1. Line ~2128: `JSON.stringify(result.reconcile.conflicts)` → `compactList(result.reconcile.conflicts, 8)`
2. Line ~2152: same replacement
3. Line ~2176: `JSON.stringify(result.reconcile.designFixes || []).slice(0, 800)` → `compactList(result.reconcile.designFixes || [], 8)`
4. Line ~2205: `JSON.stringify(result.reconcile.designFixes).slice(0, 800)` → `compactList(result.reconcile.designFixes, 8)`
5. Line ~2240: `JSON.stringify(result.reconcile.conflicts)` → `compactList(result.reconcile.conflicts, 8)`
6. Line ~2366: `JSON.stringify(yagniBlockers, null, 2)` → `compactList(yagniBlockers, 8)`
7. Line ~2379: `JSON.stringify((reviewState && reviewState.blockers) || [], null, 2)` → `compactList((reviewState && reviewState.blockers) || [], 8)`
compactList is already imported in main.mjs:15.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/main.mjs (lines 2120-2260 reconcile section; 2360-2390 escalation section)
- plugins/feature-workflows/workflows/src/decisions.mjs (compactList definition, lines 341-352)
</read_first>

<acceptance_criteria>
- `grep -c 'JSON.stringify(result.reconcile' main.mjs` returns 0
- `grep -c 'JSON.stringify(yagniBlockers' main.mjs` returns 0
- `grep -c 'JSON.stringify((reviewState && reviewState.blockers)' main.mjs` returns 0
- compactList is called with max=8 at each of the 7 former sites
</acceptance_criteria>

### Task 6: Update build script and test harness

<action>
1. In `scripts/build-workflows.mjs`: add 'design-budget.mjs' and 'design-loops.mjs' to BOTH module lists (feature-pipeline.js entry before main.mjs/extract-slice-entry.mjs; fp-extract-slice.js entry before extract-slice-entry.mjs).
2. In `tests/harness.mjs`: add to CANDIDATES: 'createDesignBudget', 'spendDesignGate', 'gateCallsRemaining', 'canAdmitDesignGate', 'designBudgetSummary', 'DESIGN_BUDGET_DEFAULTS', 'DESIGN_RESERVE_CALLS', 'createLoopBudgets', 'spendLoop', 'loopBudgetExhausted', 'loopBudgetSummary', 'ESCALATION_RETRIES_DEFAULT'
3. Run `npm run build` to regenerate the dist.
4. Run `npm run validate:build` to confirm no drift.
</action>

<read_first>
- scripts/build-workflows.mjs (module lists at lines 47-79 and 102-134)
- tests/harness.mjs (CANDIDATES array lines 28-208)
</read_first>

<acceptance_criteria>
- `npm run build` succeeds with exit 0
- `npm run validate:build` succeeds with exit 0
- Generated feature-pipeline.js contains design-budget and design-loops module bodies
- harness CANDIDATES includes all new function names
</acceptance_criteria>

### Task 7: Write tests (RED → GREEN)

<action>
Create `tests/design-budget.test.mjs` with:
- DBUDGET-01 tests: createDesignBudget pure construction, spendDesignGate purity, canAdmitDesignGate per-gate cap enforcement, per-run cap enforcement, HANDOFF reserve non-spendable, designBudgetSummary structure
- DLOOP-01 tests: createLoopBudgets 4 loops, spendLoop purity, loop independence (refine spend does not affect escalation), loopBudgetExhausted, configurable escalation cap via args.maxEscalationRetries, ESCALATION_RETRIES_DEFAULT export from config
- DPROMPT-01 tests: source assertion that main.mjs does NOT contain `JSON.stringify(result.reconcile`, `JSON.stringify(yagniBlockers`, `JSON.stringify((reviewState && reviewState.blockers)` at prompt sites; source assertion that compactList IS called at those sites
- Regression: existing ESCALATION_RETRIES behavior preserved (escalationCap defaults to 5)
</action>

<read_first>
- tests/telemetry.test.mjs (test pattern reference)
- tests/design-truth.test.mjs (source assertion pattern)
- tests/harness.mjs (engine import pattern)
</read_first>

<acceptance_criteria>
- `npm test` passes with 0 failures
- New test file covers all 3 requirements (DBUDGET-01, DLOOP-01, DPROMPT-01)
- Source-assertion tests read the generated dist to verify prompt hygiene
- Total test count increases from 700 baseline
</acceptance_criteria>

## GREEN Evidence

1. Per-gate/per-run call/token budgets enforced via design-budget.mjs wrapping Phase 5 budget-admission pattern
2. Each review/refine loop has independent sub-budget; escalation cap configurable
3. All 7 design-gate prompt sites use compactList
4. All 700 prior tests remain green; build drift is empty

## Success Criteria

1. A design run that would exceed a characterized per-gate or per-run call/token budget stops with a truthful handoff before exhausting shared capacity, and reserved capacity for state flush/handoff is never spent by gate work.
2. An early design review/refine loop that spends heavily cannot reduce the budget available to a later loop or to plan-review escalation; escalation retry limits are configurable.
3. A design-gate prompt built from a large accumulated set of conflicts, blockers, or fixes stays within the same bounded size discipline already applied to implement/executor prompts.

## Artifacts this phase produces

- `design-budget.mjs` module: createDesignBudget, spendDesignGate, gateCallsRemaining, canAdmitDesignGate, designBudgetSummary, DESIGN_BUDGET_DEFAULTS, DESIGN_RESERVE_CALLS
- `design-loops.mjs` module: createLoopBudgets, spendLoop, loopBudgetExhausted, loopBudgetSummary
- `ESCALATION_RETRIES_DEFAULT` constant in config.mjs
- `result._designBudget` field in design-mode handoff state
- `result._loopBudgets` field in design-mode handoff state
