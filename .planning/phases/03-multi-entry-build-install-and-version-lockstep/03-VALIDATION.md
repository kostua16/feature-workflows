---
phase: 3
slug: multi-entry-build-install-and-version-lockstep
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 3 — Validation Strategy

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
| 3-01-01 | 03 | 1 | DIST-01 | unit + integration | `npm test` | tests/multi-entry-build.test.mjs | green |
| 3-01-02 | 03 | 1 | DIST-01 | unit | `npm test` | tests/phase03-nyquist-validation.test.mjs | green |
| 3-01-03 | 03 | 1 | DIST-01 | unit | `npm test` | src/extract-slice-entry.mjs (green) | green |
| 3-01-04 | 03 | 1 | DIST-01 | integration | `npm run validate:build` | build + drift (2 entries) | green |
| 3-01-05 | 03 | 1 | DIST-01 | integration | `npm run validate:versions` | version lockstep (2 entries) | green |

---

## Requirement Coverage

### DIST-01: Multi-entry build, install, and version lockstep

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/multi-entry-build.test.mjs | 22 | Build drift (both entries), entry structure (banner/header/meta.version/ENGINE_VERSION/tails), leaf-specific (no main(), extractSliceMain(), 2-phase meta, name), sandbox safety (forbidden tokens, no CR, ESM validity), version lockstep (validator passes, headers agree), install resolution (copy + symlink), packaging |
| tests/phase03-nyquist-validation.test.mjs | 31 | extractSliceMain behavioral (null/undefined/empty/missing-id/missing-planDir args, JSON-string coercion, lifecycle init/preservation, return shape), source assertions (done→complete transition, try/catch, imports), leaf meta source (2 phases, dev version, name, description), build script invariants (leaf = top - main + entry, equal module count, main exclusion, entry inclusion, tail/banner config), version validator (N-surface coverage, exit-1 path, entry count), phase subset (leaf ⊆ top-level), entry independence (distinct names/tails/descriptions) |

**Status:** COVERED — all success criteria have automated verification at twice the behavior frequency.

---

## E2E Matrix Coverage (Phase 3 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-BUILD-01 | tests/multi-entry-build.test.mjs + tests/phase03-nyquist-validation.test.mjs (both entries drift-free, correct structure, equal module count) | green |
| E2E-LOCKSTEP-01 | tests/multi-entry-build.test.mjs + tests/phase03-nyquist-validation.test.mjs (all surfaces agree, validator exit paths) | green |
| E2E-INSTALL-01 | tests/multi-entry-build.test.mjs (copy + symlink install resolution for both entries) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 7 |
| Resolved | 7 |
| Escalated | 0 |

### Gaps Identified and Filled

1. **DIST-01 extractSliceMain behavioral coverage** (MISSING → COVERED)
   - Gap: The original 22 tests verified dist *structure* (entry exists, tail correct, ESM valid) but no test exercised the actual `extractSliceMain()` function. Arg parsing, missing-slice validation, JSON coercion, lifecycle initialization, and return shape were all untested.
   - Fix: Added 10 behavioral tests importing the source module directly with sandbox globals (null/undefined/empty/missing-id/missing-planDir args, JSON string parsing, invalid JSON coercion, lifecycle init, explicit lifecycle preservation, return shape).

2. **DIST-01 extractSliceMain lifecycle transition logic** (MISSING → COVERED)
   - Gap: No test verified the done→complete transition or the try/catch for illegal transitions.
   - Fix: Added 3 source-level assertions verifying done-status check, complete transition call, try/catch block, and failure log message.

3. **DIST-01 extractSliceMain dependency wiring** (PARTIAL → COVERED)
   - Gap: No test verified that the entry imports and wires config defaults (RETRY_BUDGET_DEFAULT, REFINE_SUBCAP_DEFAULT, DECISION_CAP_DEFAULT) from config.mjs.
   - Fix: Added source assertion test for import statements and fallback wiring.

4. **DIST-01 leaf meta source verification** (PARTIAL → COVERED)
   - Gap: Existing tests checked the *dist* meta but not the *source* meta. The source meta's dev placeholder version (proving build injection is needed) and description content were untested.
   - Fix: Added 4 source-level tests for phase count, dev placeholder version + injection comment, meta name, and description content (leaf/per-feature scope).

5. **DIST-01 build script structural invariants** (PARTIAL → COVERED)
   - Gap: No test verified the module-set relationship (leaf = top-level − main.mjs + extract-slice-entry.mjs), equal module count, or the presence/absence of specific modules per entry.
   - Fix: Added 6 tests verifying module-set equality, equal count, main.mjs exclusion from leaf, entry-module inclusion in leaf, per-entry tail config, and per-entry banner config.

6. **DIST-01 version validator failure paths** (MISSING → COVERED)
   - Gap: Existing tests only ran the validator in the passing case. No test verified the failure path (exit 1 on mismatch/missing), the N-surface coverage, or the entry count in the success message.
   - Fix: Added 3 source-level tests for N-surface coverage (plugin.json + headers + meta.version), exit-1 path with error messages, and success message format.

7. **DIST-01 phase subset and entry independence** (MISSING → COVERED)
   - Gap: No test verified that leaf phases are a subset of top-level phases, or that entries have distinct names, tails, and descriptions.
   - Fix: Added 4 tests for phase subset invariant and entry independence (distinct meta names, tails, descriptions).

---

## Success Criteria Verification

1. ✅ **Clean build emits both entries deterministically:** `npm run validate:build` reports both entries up to date (33 modules, 314 top-level names each), no drift, no sandbox violations.
2. ✅ **Both copy and symlink installs resolve both entries:** Copy/symlink install tests verify both entries exist and carry correct version headers.
3. ✅ **All surfaces report one version:** `npm run validate:versions` confirms `1.4.5 (2 entries)` — plugin.json, both dist headers, both meta.version agree.

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
- [x] Build drift: `npm run build` + `npm run validate:build` clean (33 modules, 314 top-level names per entry)
- [x] Version lockstep: `npm run validate:versions` OK (1.4.5, 2 entries)

**Approval:** approved 2026-07-22

**Test totals after validation:** 914 pass / 0 fail (883 pre-validation + 31 new validation tests)
