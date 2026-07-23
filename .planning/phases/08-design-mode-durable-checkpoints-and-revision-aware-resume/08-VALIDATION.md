---
phase: 8
slug: design-mode-durable-checkpoints-and-revision-aware-resume
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
---

# Phase 8 — Validation Strategy

> Nyquist validation for DCKPT-01, DSTATE-01, DRESUME-01.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | none — `npm test` runs `node --test tests/` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **Before milestone audit:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Test File | Status |
|---------|------|------|-------------|-----------|-----------|--------|
| 8-01 | 01 | 1 | DCKPT-01 | unit + structural | `tests/design-checkpoints.test.mjs` (7), `tests/phase08-nyquist-validation.test.mjs` (24) | green |
| 8-02 | 01 | 1 | DSTATE-01 | unit + behavioral | `tests/design-checkpoints.test.mjs` (8), `tests/phase08-nyquist-validation.test.mjs` (19) | green |
| 8-03 | 01 | 1 | DRESUME-01 | unit + behavioral | `tests/design-checkpoints.test.mjs` (5), `tests/phase08-nyquist-validation.test.mjs` (16) | green |
| 8-04 | 01 | 1 | REGRESSION | structural | `tests/design-checkpoints.test.mjs` (2), `tests/phase08-nyquist-validation.test.mjs` (9) | green |

---

## Gap Analysis Summary

### Gaps Found and Filled (68 new tests)

**DCKPT-01 (24 gap-filling tests):**
- Gate list completeness: 15 design + 4 implement checkpoint calls verified against E2E-DCKPT-01 roadmap definition
- Gates without artifact path keys: knowledge, requirements-review, arch-review, design-review, tdd-enforce
- ARTIFACT_CHECKPOINT_GATE_MAP: 5-entry completeness, per-key mapping assertions
- checkpointDesign structural semantics: acknowledged flag, artifactPath storage, lazy initialization, non-blocking try-catch, computeContentDigest usage, flushPipelineStateWithSnapshot delegation
- Result initialization: _designCheckpoints and _artifactDigests empty-object init
- dataKey derivation correctness for definitionPath (defect found and fixed)

**DSTATE-01 (19 gap-filling tests):**
- Write ordering: snapshot read → snapshot write → new state write (sequence verified)
- First-write behavior: no existing state → snapshot skipped, write proceeds
- Recovery signal: recovered=true on truncation, recovered=false when valid
- loadPipelineStateWithRecovery: last-good tried only when primary fails, both-null, both-corrupt
- validatePipelineState: missing fields, non-object, missing result, checksum mismatch, valid, backward compat
- Source wiring: resume path uses loadPipelineStateWithRecovery, exports verified

**DRESUME-01 (16 gap-filling tests):**
- Digest mismatch path: checkpoint acknowledged but no digest → falls through to LLM verification
- Digest present but checkpoint not acknowledged → falls through
- Multiple artifacts with mixed checkpoint/digest states (some skip, some verify)
- planned=false excludes planPath; planned=true includes it
- Downstream flag cleanup: designReady, ready, executed, testsPassed, codeReview, _goalkeeper
- repair descriptions, null result, empty result, all-5-artifacts verification, backward compat

**Continuous Regression (9 gap-filling tests):**
- No require/readFileSync/writeFileSync in Phase 8 functions
- No Date.now/Math.random in checkpointDesign
- Dist exports verified for all Phase 8 functions
- Harness availability for all testable functions

### Defect Found and Fixed

**DataKey derivation mismatch in checkpointDesign:** `checkpointDesign('define', 'definitionPath')`
derived dataKey as `_definition` (via `'_' + 'definitionPath'.replace('Path', '')`), but the actual
result field is `_define`. This caused the artifact digest to be computed from the file path string
instead of the definition content object. Fixed in `main.mjs` by special-casing `definitionPath`
to map to `_define`; all other path keys follow the standard ` replace('Path', '')` convention.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: every task has automated verify
- [x] No MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-22

---

## Validation Audit 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 68 |
| Resolved | 68 |
| Escalated | 0 |
| Defects fixed | 1 (dataKey derivation for definitionPath) |
| Pre-existing tests | 22 (design-checkpoints.test.mjs) |
| New gap-filling tests | 68 (phase08-nyquist-validation.test.mjs) |
| Total Phase 8 tests | 90 |
| Full suite after validation | 1271 pass / 0 fail |
