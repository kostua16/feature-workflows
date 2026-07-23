---
phase: 1
slug: state-coverage-migration-and-revision-contracts
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert`) |
| **Config file** | `package.json` scripts.test |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | CONTRACT-01 | unit | `npm test` | tests/lifecycle-reducers.test.mjs | green |
| 1-01-02 | 01 | 1 | CONTRACT-01 | unit | `npm test` | tests/migration.test.mjs | green |
| 1-01-03 | 01 | 1 | REV-01 | unit | `npm test` | tests/revision-invalidation.test.mjs | green |
| 1-01-04 | 01 | 1 | CONTRACT-01 | unit | `npm test` | src/lifecycle.mjs (green) | green |
| 1-01-05 | 01 | 1 | CONTRACT-01 | unit | `npm test` | src/migration.mjs (green) | green |
| 1-01-06 | 01 | 1 | REV-01 | unit | `npm test` | src/revision.mjs (green) | green |
| 1-01-07 | 01 | 1 | ALL | integration | `npm test && npm run validate:build` | build + drift | green |

---

## Requirement Coverage

### CONTRACT-01: Versioned state contract, lifecycle, readiness, migration

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/lifecycle-reducers.test.mjs | 37 | Illegal transitions, no-mutation, byte-stable replay, skip semantics (3 classifications), readiness derivation |
| tests/migration.test.mjs | 20 | Deterministic feature IDs, idempotent migration, root-last boundary, mixed-version never ready |
| tests/phase01-nyquist-validation.test.mjs | 49 (shared) | Input validation edge cases, TRANSITION_TABLE completeness, mixed-state readiness, migration legacy completeness, resume convergence, boundary edge cases |

**Status:** COVERED — all success criteria have automated verification.

### STATE-01: Bounded root state contract

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/phase01-nyquist-validation.test.mjs | 3 | Root manifest contains only index fields (no gate histories/artifacts), shardRef uniqueness, schema version |

**Status:** COVERED — validated that migrated root state contains only indexes and aggregate evidence, not per-feature gate histories or artifact content.

### REV-01: Selective revision invalidation

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/revision-invalidation.test.mjs | 22 | Digest determinism, content-sensitive digests, key-order independence, gate-targeted invalidation (source/scope/graph/deps/artifact), independent evidence retention, integration flow |
| tests/phase01-nyquist-validation.test.mjs | 10 (shared) | Combined multi-input changes (source+scope, all inputs, artifact+source), nested object digest, array digest, GATE_DEPENDENCY_MAP completeness, REVISION_INPUTS enumeration |

**Status:** COVERED — all revision input types tested individually and in combination.

---

## E2E Matrix Coverage (Phase 1 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-STATE-01 | tests/migration.test.mjs + tests/phase01-nyquist-validation.test.mjs (full boundary lifecycle) | green |
| E2E-REV-01 | tests/revision-invalidation.test.mjs + tests/phase01-nyquist-validation.test.mjs (each input independently + combined) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 7 |
| Resolved | 7 |
| Escalated | 0 |

### Gaps Identified and Filled

1. **STATE-01 bounded root state contract** (MISSING → COVERED)
   - Gap: No test verified that migrated root manifest contains only index fields, not gate histories or artifact content.
   - Fix: Added 3 tests in `tests/phase01-nyquist-validation.test.mjs` verifying root fields are bounded, shardRefs are unique/referenceable, and gate data is excluded from root.

2. **CONTRACT-01 applyLifecycleEvent input validation** (PARTIAL → COVERED)
   - Gap: Missing tests for null state, null event, missing event type, unknown lifecycle state.
   - Fix: Added 5 edge-case input validation tests.

3. **CONTRACT-01 TRANSITION_TABLE completeness** (PARTIAL → COVERED)
   - Gap: No test verified the transition table covers all 8 lifecycle states or that exclude is correctly restricted from in-progress.
   - Fix: Added tests for table coverage of all states, terminal-state emptiness, and in-progress exclude rejection.

4. **CONTRACT-01 migration legacy status completeness** (PARTIAL → COVERED)
   - Gap: Missing tests for 'failed', 'excluded', and unknown legacy status conversions.
   - Fix: Added 3 tests covering all legacy status branches plus missing result field and non-object input.

5. **CONTRACT-01 deriveReadiness comprehensive mixed states** (PARTIAL → COVERED)
   - Gap: No test exercised all lifecycle states simultaneously to verify counting and denominator logic.
   - Fix: Added 3 tests: comprehensive mixed-state manifest, ready-when-only-completed-and-policy-skip, and null-features edge case.

6. **CONTRACT-01 resume convergence after partial migration** (PARTIAL → COVERED)
   - Gap: No explicit test for convergence from partial migration state to same end state.
   - Fix: Added test simulating partial migration and verifying convergence.

7. **REV-01 combined multi-input and nested digest** (PARTIAL → COVERED)
   - Gap: No tests for combined revision changes (source+scope, all inputs, artifact+source) or nested object digest stability.
   - Fix: Added 9 tests covering combined changes, nested/deeply-nested object digests, arrays, GATE_DEPENDENCY_MAP completeness, and REVISION_INPUTS enumeration.

---

## Success Criteria Verification

1. ✅ **Byte-stable replay:** `applyLifecycleEvent` replay test + no-mutation test (lifecycle-reducers.test.mjs)
2. ✅ **Root-last migration:** `validateMigrationBoundary` fault-injection tests + full lifecycle test (migration.test.mjs + phase01-nyquist-validation.test.mjs)
3. ✅ **Selective invalidation:** Gate-targeted invalidation tests + combined input tests (revision-invalidation.test.mjs + phase01-nyquist-validation.test.mjs)
4. ✅ **Skip semantics:** Feature-level, policy-disabled-optional, required-gate all tested (lifecycle-reducers.test.mjs + phase01-nyquist-validation.test.mjs)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] All MISSING references covered by gap-filling tests
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-22

**Test totals after validation:** 836 pass / 0 fail (787 original + 49 new validation tests)
