# Phase 12: Tech-Debt Cleanup (Post-Milestone v1.5.0)

**Status:** Complete
**Date:** 2026-07-23

## Scope

Address accumulated tech-debt items from the v1.5.0 milestone audit
(`.planning/v1.5.0-MILESTONE-AUDIT.md`). All items are non-blocking; milestone
was 36/36 requirements, 11/11 phases, 1458 tests, build drift-free.

## Items

### A — requirements-completed frontmatter (docs)
Prepend YAML `requirements-completed` frontmatter to all 11 NN-SUMMARY.md files.
Source C of the 3-source cross-reference was empty everywhere.

### B — validateMigrationBoundary "Pure" comment (P1, migration.mjs)
Docstring claimed "Pure: without performing any writes" but function mutates
`child._durable=true` as an internal accumulator. Corrected docstring.

### C — INT-MIGRATION-RESUME (migration.mjs, main.mjs)
v1.4.5 → v1.5 migration was unreachable on resume. Added `migrateResumeState()`
and an explicit `--migrate` flag. Opt-in to avoid misfire-prone auto-detection.

### D1 — designBudgetGate call counting (P10, main.mjs)
Gate counts 1 call per invocation, not actual intra-gate agent calls. Documented
the conservative choice in code (low-risk; instrumentation would regress verified code).

### D2 — two parallel budget systems (P5 retryState + P10 designBudget)
Documented in code why both coexist. Do NOT unify (YAGNI).

### D3 — token budgets uncharacterized (P10, design-budget.mjs)
Added `recordGateTokenSpend()` + `gateTokensRemaining()` measurement plumbing.
Real characterization requires a dogfood run.
