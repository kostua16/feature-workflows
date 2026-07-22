---
phase: 4
slug: checkpointed-feature-leaf
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 4 — Validation Strategy

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
| 4-01-01 | 04 | 1 | CHECKPOINT-01 | unit | `npm test` | tests/checkpointed-leaf.test.mjs | green |
| 4-01-02 | 04 | 1 | CHECKPOINT-01 | unit + behavioral | `npm test` | tests/phase04-nyquist-validation.test.mjs | green |
| 4-01-03 | 04 | 1 | ORCH-01 | structural | `npm test` | tests/phase04-nyquist-validation.test.mjs | green |
| 4-01-04 | 04 | 1 | ORCH-01 | integration | `npm run validate:build` | build + drift (both entries) | green |

---

## Requirement Coverage

### ORCH-01: Leaf processes one feature, no composition, top-level retains authority

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/checkpointed-leaf.test.mjs | 6 (structural) | Workflow spawn exists, fallback to direct call, lifecycle via shared reducer, lifecycle field init, leaf entry exports, multi-entry consistency |
| tests/phase04-nyquist-validation.test.mjs | 15 | Leaf source has no Workflow spawn, leaf dist has no spawn (comment only), top-level dist HAS spawn, leaf has no readiness derivation, leaf has no scheduling calls, leaf extractSlice body has no synthesis calls, Workflow spawn guard (3 conditions), direct fallback, sliceState init fields, extractSliceMain return shape (mode/sliceId/status/lifecycle/gateCheckpoints/sliceState), lifecycle init, done→complete transition, transition failure handling, exactly-one-slice validation |

**Status:** COVERED — all success criteria have automated verification at twice the behavior frequency.

### CHECKPOINT-01: Durable checkpoint before/after each gate, resume at first incomplete gate

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/checkpointed-leaf.test.mjs | 13 | Per-gate checkpoint recording, artifact path per gate type, review gate null path, idempotent replay, non-blocking flush failure, lifecycle transitions, skip semantics (4 tests), revision invalidation (2 tests), structural assertions |
| tests/phase04-nyquist-validation.test.mjs | 18 | Behavioral resume (all-gates-done → no agent calls, partial resume → facts skipped), per-gate blocked return values (facts/e2e/design/arch), audit gate checkpoint, artifact key mapping completeness (7 gates), seq monotonicity across gates, _gateCheckpoints survival on resume, empty-state initialization, null-result handling, evidence preservation on blocked, dist structural assertions |

**Status:** COVERED — all gate boundaries tested before and after, resume behavior verified, evidence preservation confirmed.

---

## E2E Matrix Coverage (Phase 4 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-LEAF-01 | tests/checkpointed-leaf.test.mjs + tests/phase04-nyquist-validation.test.mjs (behavioral resume, evidence preservation, per-gate blocked returns) | green |
| E2E-LEAF-02 | tests/checkpointed-leaf.test.mjs + tests/phase04-nyquist-validation.test.mjs (idempotent replay, duplicate completion terminal, blocked/failed convergence, invalid output routing) | green |
| E2E-SKIP-01 | tests/checkpointed-leaf.test.mjs + tests/phase04-nyquist-validation.test.mjs (feature-level, policy-disabled, required-gate, isIncomplete classification) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 9 |
| Resolved | 9 |
| Escalated | 0 |

### Gaps Identified and Filled

1. **CHECKPOINT-01 behavioral resume — gate-skip-on-resume** (MISSING → COVERED)
   - Gap: Original tests verified checkpoints are *recorded* but never tested that `extractSlice` actually *skips* completed gates on resume. The Nyquist criterion requires testing the resume signal path, not just the checkpoint storage.
   - Fix: Added 2 behavioral tests — all-gates-completed resume (agent never called, status=done) and partial resume (facts gate skipped when factsPath pre-set).

2. **CHECKPOINT-01 per-gate blocked return values** (MISSING → COVERED)
   - Gap: No test verified that each material gate returns the correct `{status: 'blocked', gate: 'extract-XXX'}` when the agent returns null. Only the aggregate "checkpoint recorded" was tested.
   - Fix: Added 4 tests covering facts, e2e, design, and arch gate blocked returns with correct gate names.

3. **CHECKPOINT-01 audit gate checkpoint** (MISSING → COVERED)
   - Gap: The audit gate (`extract-audit`) was the only material gate without a dedicated checkpointSlice test. 5 of 7 gates had direct coverage.
   - Fix: Added test verifying audit gate records auditPath correctly.

4. **CHECKPOINT-01 artifact key mapping completeness** (PARTIAL → COVERED)
   - Gap: Tests covered 5 of 7 gate artifact paths individually but never verified the complete 7-gate mapping in a single test.
   - Fix: Added test exercising all 7 gates in sequence, verifying correct artifact path for each and null for review gate.

5. **CHECKPOINT-01 checkpoint state survival on resume** (MISSING → COVERED)
   - Gap: No test verified that `_gateCheckpoints` from a prior interrupted run are preserved when new checkpoints are added on resume.
   - Fix: Added test with pre-populated `_gateCheckpoints`, verifying prior entries survive after a new checkpoint call.

6. **ORCH-01 leaf composes no child workflow** (PARTIAL → COVERED)
   - Gap: Existing structural test verified Workflow spawn exists in top-level dist, but no test verified the leaf SOURCE and DIST are free of Workflow spawn calls (the no-composition invariant).
   - Fix: Added 4 tests — leaf source has no Workflow spawn, leaf entry source has no spawn, leaf dist has no spawn (only comment reference), top-level dist DOES have spawn (contrast).

7. **ORCH-01 leaf has no readiness/scheduling authority** (MISSING → COVERED)
   - Gap: ORCH-01 requires that the leaf leaves readiness and scheduling authority at the top level. No test verified the leaf source excludes these functions.
   - Fix: Added 3 tests — leaf has no readiness derivation calls, leaf has no scheduling/queue calls, extractSlice body has no synthesis calls.

8. **ORCH-01 Workflow spawn guard conditions** (MISSING → COVERED)
   - Gap: No test verified the three spawn guard conditions (`typeof Workflow === 'function'`, `!single`, `Workflow.name !== ''`) that distinguish real Workflow composition from the inert test-harness stub.
   - Fix: Added 4 tests for each guard condition plus the direct-call fallback.

9. **E2E-LEAF-02 duplicate completion terminal + convergence** (PARTIAL → COVERED)
   - Gap: Idempotent checkpoint replay was tested, but duplicate lifecycle completion and convergence from blocked/failed states were not.
   - Fix: Added 4 tests — duplicate complete throws (terminal state), blocked→start→complete converges, failed→start→complete converges, isTerminal classification.

---

## Success Criteria Verification

1. ✅ **Leaf processes exactly one feature, composes no child:** ORCH-01 tests verify no Workflow spawn in leaf source/dist, extractSlice takes one slice, no iteration over queue/features, leaf has no readiness/scheduling calls.
2. ✅ **Interrupting before/after any gate resumes at first incomplete gate:** CHECKPOINT-01 behavioral resume tests verify agent is not called for pre-completed gates; per-gate blocked tests verify correct gate name on failure; evidence preservation test verifies artifact paths and checkpoints survive.
3. ✅ **Duplicate completion, invalid output, source drift converge through shared reducer:** Idempotent checkpoint replay, duplicate complete terminal, blocked/failed convergence, revision invalidation all tested.
4. ✅ **Skip semantics correct:** Feature-level skip blocks readiness, policy-disabled optional with evidence can complete, required-gate skip blocks permanently — all tested in multi-feature manifest context plus isIncomplete classification.

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
- [x] Build drift: both entries clean
- [x] Version lockstep: both entries report same version

**Approval:** approved 2026-07-22

**Test totals after validation:** 959 pass / 0 fail (914 pre-validation + 45 new validation tests)
