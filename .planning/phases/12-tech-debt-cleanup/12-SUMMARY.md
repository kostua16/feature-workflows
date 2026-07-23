---
requirements-completed:
  - TECH-DEBT-A
  - TECH-DEBT-B
  - TECH-DEBT-C
  - TECH-DEBT-D1
  - TECH-DEBT-D2
  - TECH-DEBT-D3
---

# Phase 12: Tech-Debt Cleanup — Summary

**Phase:** 12
**Completed:** 2026-07-23
**Test count:** 1470 (1458 baseline + 12 new), all passing

## What was done

### A — requirements-completed frontmatter (COMMIT b179a10)
Added YAML `requirements-completed` frontmatter to all 11 phase SUMMARY files.
The 3-source cross-reference source C is now populated everywhere. Existing prose
`**Requirements:**` lines preserved.

### B — validateMigrationBoundary docstring fix (COMMIT 7a2fe5a)
Corrected the misleading "Pure: without performing any writes" comment in
`src/migration.mjs`. The function uses an internal-accumulator pattern (mutates
`child._durable=true` in-place between phase calls). Docstring now accurately
describes the semantics: deterministic, no I/O side effects, but NOT a pure
read-only check.

### C — INT-MIGRATION-RESUME: explicit resume migration (COMMIT 7a2fe5a)
**Approach:** Added `migrateResumeState(state)` to `migration.mjs` and wired an
explicit `--migrate` flag into the resume path in `main.mjs`. When `args.migrate`
is set, the loaded state is migrated from v1.4.5 format (detected via
`result.slices` presence + non-1.5.0 schemaVersion) to v1.5.0 format before
validation. Opt-in flag avoids misfire-prone auto-detection on every resume.

**Rationale:** Auto-detection on every resume would be risky — the legacy signal
(`result.slices`) could theoretically appear in a valid v1.5.0 state. An explicit
flag is safe, documented, and puts the user in control of when migration runs.

**7 characterization tests** added: v1.4.5 round-trip, validatePipelineState
passes after migration, v1.5.0 pass-through, no-slices pass-through, checksum
stripping, null safety, idempotency.

### D1 — designBudgetGate call counting (COMMIT 7157ae2)
Documented the conservative choice: each gate invocation counts as 1 call, not
actual intra-gate agent calls. The per-gate cap (default 8) acts as a multiplier
ceiling. Instrumenting actual agent calls would require modifying every gate's
invocation site — regression risk on verified code outweighs precision gain.

### D2 — two parallel budget systems (COMMIT 7157ae2)
Added code comments in `main.mjs` explaining Phase-5 `retryState` (extract-mode
retry tracking) and Phase-10 `designBudget` (design-mode per-gate enforcement)
coexist by design. They serve different modes; neither ceiling approached in
production. Unification is YAGNI without proven need.

### D3 — token budget measurement plumbing (COMMIT 7157ae2)
Added `recordGateTokenSpend(budget, gateName, tokens)` and
`gateTokensRemaining(budget, gateName)` to `design-budget.mjs`. These provide the
mechanism for post-gate token recording when agents eventually report token usage.
Token caps default to 0 (uncharacterized/Infinity); real characterization requires
a dogfood run. 5 tests added.

## Test totals

- Baseline: 1458 tests / 0 fail
- After all changes: 1470 tests / 0 fail (+12 new)
- Build: drift-free (33 modules, 317 top-level names)

## Commits

- `b179a10` — docs: add requirements-completed frontmatter to all 11 phase SUMMARYs
- `7a2fe5a` — fix: correct migration boundary docstring and add explicit resume migration
- `7157ae2` — docs: document budget trade-offs and add token measurement plumbing
