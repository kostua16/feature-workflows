# Phase 10 Research: Design-Mode Bounded Budgets and Prompt Context

**Researched:** 2026-07-22
**Scope:** F11 (observational telemetry), F12 (shared retry budget starvation), F13 (unbounded prompt payloads).

## F11 — Budgets bound iterations, not calls/tokens (DBUDGET-01)

**Current state:** `gateTelemetry` (agent-core.mjs:191-209) counts calls/retries/escalations/fallbacks per gate but NEVER enforces a cap. No per-gate call limit, no per-run token accounting, no reserve for state flush/handoff.

**Phase 5 pattern to reuse:** `budget-admission.mjs` provides the exact BUDGET-01 primitive:
- `createBudgetAccountant(limits)` — tracks callsSpent, tokensSpent, reserve (pure)
- `spendBudget(accountant, calls, tokens)` — returns new accountant (pure)
- `callsRemaining(accountant)` / `tokensRemaining(accountant)` — after subtracting spent + reserved
- `canFinishNextGate(accountant, gateCost)` — whether next gate fits
- `RESERVE_TYPES` — frozen map: CHECKPOINT, RECONCILIATION, SYNTHESIS, HANDOFF

**Adoption plan:** Create a `design-budget.mjs` module that wraps the Phase 5 accountant with per-gate tracking. Before each design gate, check admission; after each gate, record actual spend from telemetry deltas. Reserve capacity via `RESERVE_TYPES.HANDOFF` for state flush/handoff. When exhausted, stop with truthful handoff (`blockedAt='budget'`).

**Key files:**
- `budget-admission.mjs` — Phase 5 primitive (reuse, do not fork)
- `agent-core.mjs:191-209` — bumpGateTelemetry (spend source)
- `main.mjs:16` — already imports budget-admission helpers
- `config.mjs:17-21` — existing budget constants

## F12 — Shared retry budget starvation (DLOOP-01)

**Current state:** All four design review/refine loops call `spendRetry(1)` which increments the single shared `retryState.used` (config.mjs:137-143). Sub-caps exist (REFINE_SUBCAP=10, RECONCILE_SUBCAP=5, DEBUG_SUBCAP=20) but they all draw from the same shared pool, so early loops can starve later ones.

**`ESCALATION_RETRIES = 5`** is HARDCODED at main.mjs:2360 — not configurable.

**Adoption plan:** Create per-loop sub-budget tracker (`design-loops.mjs`):
- `createLoopBudgets(config)` — each loop gets its own `{used, cap}` pool
- `spendLoop(budgets, loopName)` — increments only that loop's pool (pure)
- `loopBudgetExhausted(budgets, loopName)` — per-loop check
- Make ESCALATION_RETRIES configurable: `ESCALATION_RETRIES_DEFAULT` in config.mjs, overridable via `args.maxEscalationRetries`

**Wiring in main.mjs:** Replace `budgetExhausted(retryBudget)` in loop conditions with `loopBudgetExhausted(loopBudgets, 'refine'|'reconcile')`. Escalation loop iterates over `loopBudgets.escalation.cap`.

**Key files:**
- `config.mjs:17-19,137-143` — retryState, sub-caps
- `main.mjs:189-191` — sub-cap resolution from args
- `main.mjs:2164-2266` — reconcile loop (spendRetry calls)
- `main.mjs:2266-2330` — review/refine loop (spendRetry calls)
- `main.mjs:2360-2432` — escalation loop (ESCALATION_RETRIES hardcoded)

## F13 — Unbounded prompt inputs (DPROMPT-01)

**Current state:** `compactList` exists in decisions.mjs:346-352 and IS used for implement/executor prompts (decisions.mjs:85, main.mjs:2718, 2800). But design-gate prompts still use raw `JSON.stringify`:

| Line | Site | Current |
|------|------|---------|
| 2128 | reconcileContext (resume) | `JSON.stringify(result.reconcile.conflicts)` |
| 2152 | reconcileContext (after reconcile) | `JSON.stringify(result.reconcile.conflicts)` |
| 2176 | quick-decider failureContext | `JSON.stringify(result.reconcile.designFixes \|\| []).slice(0, 800)` |
| 2205 | enhancePrompt failureContext | `JSON.stringify(result.reconcile.designFixes).slice(0, 800)` |
| 2240 | reconcileContext (after re-reconcile) | `JSON.stringify(result.reconcile.conflicts)` |
| 2366 | yagniBlockerContext | `JSON.stringify(yagniBlockers, null, 2)` |
| 2379 | escalatePrompt prior blockers | `JSON.stringify(reviewState.blockers \|\| [], null, 2)` |

**Adoption plan:** Replace all 7 sites with `compactList(payload, 8)`. No new module needed — `compactList` is already imported in main.mjs:15 and is tested.

## Build and test integration

- New modules must be added to BOTH entries in `scripts/build-workflows.mjs` (feature-pipeline.js modules list and fp-extract-slice.js modules list).
- New testable functions must be added to `CANDIDATES` in `tests/harness.mjs`.
- Tests follow the established pattern: `import { engine } from './harness.mjs'`, source-line assertions via `readFileSync` for integration checks.

## Validation Architecture

### Dimension 1: RED characterization
- Test that design budget enforcement blocks when calls exceed cap (fails before implementation — no enforcement exists)
- Test that per-loop budgets are independent (fails — all share retryState)
- Test that compactList is applied to all 7 design prompt sites (fails — raw JSON.stringify present)

### Dimension 2: GREEN evidence
- Design budget accountant tracks per-gate and per-run spend with reserve
- Per-loop budgets are independent; escalation cap is configurable
- All 7 prompt sites use compactList

### Dimension 3: Continuous regression
- All 700 existing tests remain green
- Build drift check passes after rebuild
- Generated dist contains new modules
