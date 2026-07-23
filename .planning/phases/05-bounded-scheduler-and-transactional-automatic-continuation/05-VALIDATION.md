---
phase: 5
slug: bounded-scheduler-and-transactional-automatic-continuation
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 5 — Validation Strategy

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
| 5-01-01 | 05 | 1 | BUDGET-01 | unit | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-01-02 | 05 | 1 | BUDGET-01 | unit (nyquist) | `npm test` | tests/phase05-nyquist-validation.test.mjs | green |
| 5-02-01 | 05 | 1 | RETRY-01 | unit | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-02-02 | 05 | 1 | RETRY-01 | unit (nyquist) | `npm test` | tests/phase05-nyquist-validation.test.mjs | green |
| 5-03-01 | 05 | 1 | ISOLATE-01 | unit | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-03-02 | 05 | 1 | ISOLATE-01 | unit (nyquist) | `npm test` | tests/phase05-nyquist-validation.test.mjs | green |
| 5-04-01 | 05 | 1 | CONT-01 | unit | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-04-02 | 05 | 1 | CONT-01 | unit (nyquist) | `npm test` | tests/phase05-nyquist-validation.test.mjs | green |
| 5-05-01 | 05 | 1 | ALL | integration | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-05-02 | 05 | 1 | ALL | integration (nyquist) | `npm test` | tests/phase05-nyquist-validation.test.mjs | green |
| 5-06-01 | 05 | 1 | ALL | structural | `npm test` | tests/bounded-scheduler.test.mjs | green |
| 5-06-02 | 05 | 1 | ALL | build drift | `npm run validate:build` | both entries | green |

---

## Requirement Coverage

### BUDGET-01: Budget admission with non-spendable reserve

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/bounded-scheduler.test.mjs | 14 | Default/custom limits, zero-start accountant, setReserve subtraction, multi-category accumulation, admitSegment allow/reject, reserve-not-spent invariant, canFinishNextGate (call dimension), spendBudget purity, budgetSummary fields, tokensRemaining Infinity, 100+ stress fixture |
| tests/phase05-nyquist-validation.test.mjs | 8 | Token-ceiling rejection, both-dimensions admission, canFinishNextGate token dimension, setReserve overwrite (replace not accumulate), zero/null cost admission, spendBudget no-args no-op, budgetSummary 4-category completeness, budget exhaustion boundary |

**Status:** COVERED — all budget paths tested at twice the behavior frequency: call dimension, token dimension, reserve invariant, exhaustion boundary, and structural completeness.

### RETRY-01: Bounded retry with persistent attempt history

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/bounded-scheduler.test.mjs | 14 | Default policy, monotonic sequence, immutability, gateAttemptCount exhausting-only, gate exhaustion at limit, feature exhaustion across gates, permanent-failure terminal, blocked-dependency terminal, exhausted-retry terminal, never-reclassified-as-completed, terminalReason, attemptSummary fields, empty-feature summary |
| tests/phase05-nyquist-validation.test.mjs | 7 | Zero-attempt isTerminalFailure=false, zero-attempt terminalReason=null, cross-feature isolation in gateAttemptCount, over-limit exhaustion boundary, success-does-not-count explicit, featureAttemptCount across gates, terminalReason fallback to outcome |

**Status:** COVERED — all outcome types, all exhaustion boundaries, zero-attempt edge cases, cross-feature isolation, and terminal-reason fallback paths tested.

### ISOLATE-01: Failure isolation preserving independent work

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/bounded-scheduler.test.mjs | 11 | isolateFailure updates only failed feature, preserves artifacts, no mutation, eligibleIndependents excludes dependents, no-edges returns all non-failed, shouldContinueAfterFailure true/false, preserveVerifiedArtifacts truthy-only, segmentOutcome status counts, one-failure-preserves-independents |
| tests/phase05-nyquist-validation.test.mjs | 8 | Timeout→blocked (resumable), undefined failure type→failed, null failure type→failed, segmentOutcome 'completed' status convention, unknown status→pending, empty queue→zeros, eligibleIndependents excludes completed/failed/blocked, transitive chain depth>2, preserveVerifiedArtifacts null-safe, all-blocked shouldContinue=false |

**Status:** COVERED — all failure-type classifications, status-mapping conventions, transitive dependency chains at depth > 2, and edge cases for empty/null inputs tested.

### CONT-01: Transactional automatic continuation

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/bounded-scheduler.test.mjs | 25 | Monotonic segmentId, no-mutation, idempotencyKey deterministic/differs-by-revision, createSegmentIntent, duplicate intent convergence, acknowledgeSegment, duplicate ack convergence, resolveConvergence dedup, unacknowledged intent detection, shouldContinue true/false, resumeCommand, segmentCounts aggregation, isOutOfOrder detected/in-order, canAutoRelaunch budget/crash-loop, continuationSummary, 120-feature lifecycle, duplicate delivery convergence, crash-before-ack recoverable, crash-after-ack safe, no-progress wave, integration+resume-counts, structural assertions (4) |
| tests/phase05-nyquist-validation.test.mjs | 12 | Null revision key→'none', empty feature list key, sorted feature storage, acknowledge marks intent, empty-state convergence, canAutoRelaunch boundary (2=true, 3=false), empty segmentCounts, empty continuationSummary, multi-gap out-of-order, resumeCommand no-acks, acknowledge-without-intent, shouldContinue in-progress |

**Status:** COVERED — all convergence paths (duplicate, lost, out-of-order, multi-gap), boundary conditions (2 vs 3 unacknowledged), empty-state edge cases, and sorting/idempotency properties tested.

---

## E2E Matrix Coverage (Phase 5 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-BUDGET-01 | tests/bounded-scheduler.test.mjs (100+ stress, reserve invariant) + tests/phase05-nyquist-validation.test.mjs (multi-wave reserve preservation, exhaustion boundary) | green |
| E2E-FAIL-01 | tests/bounded-scheduler.test.mjs (retryable, exhausted, permanent, blocked, invalid) + tests/phase05-nyquist-validation.test.mjs (all 5 failure types explicitly classified, terminal-never-completed) | green |
| E2E-CONT-01 | tests/bounded-scheduler.test.mjs (duplicate/lost/out-of-order/crash) + tests/phase05-nyquist-validation.test.mjs (out-of-order multi-gap convergence, first-ack-wins duplicate) | green |
| E2E-SCALE-01 | tests/bounded-scheduler.test.mjs (120-feature lifecycle, no duplicates, 15+ segments) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 12 |
| Resolved | 12 |
| Escalated | 0 |

### Gaps Identified and Filled

1. **BUDGET-01 token-ceiling rejection path** (MISSING → COVERED)
   - Gap: `admitSegment` has a `token-ceiling` rejection branch, but all existing tests used `tokenCeiling: 0` (uncharacterized → Infinity), so the token rejection path was never exercised.
   - Fix: Added test with characterized `tokenCeiling` where segment token cost exceeds remaining token budget but call cost fits, verifying `admitted: false` and `reason: 'token-ceiling'`.

2. **BUDGET-01 canFinishNextGate token dimension** (MISSING → COVERED)
   - Gap: `canFinishNextGate` checks both call and token dimensions, but only the call dimension was tested. The token binding-constraint path was untested.
   - Fix: Added test where calls fit but tokens don't (returns false) and both fit (returns true), exercising the token check independently.

3. **BUDGET-01 setReserve overwrite semantics** (MISSING → COVERED)
   - Gap: No test verified that setting the same reserve category twice replaces the old value rather than accumulating. The code uses property assignment, but this invariant was untested.
   - Fix: Added test calling `setReserve` twice on the same category, verifying the second value replaces the first.

4. **BUDGET-01 budget exhaustion boundary** (MISSING → COVERED)
   - Gap: The 100+ stress test stopped before exhaustion but never tested the exact boundary where `callsRemaining === 0` and even 1 call cannot be admitted.
   - Fix: Added test spending all non-reserved budget, verifying `callsRemaining === 0`, `admitSegment({calls:1}).admitted === false`, and `canFinishNextGate({calls:1}) === false`.

5. **RETRY-01 zero-attempt edge cases** (MISSING → COVERED)
   - Gap: `isTerminalFailure` and `terminalReason` were never tested for a feature with zero recorded attempts. The zero-length filter path was untested.
   - Fix: Added tests verifying `isTerminalFailure` returns false and `terminalReason` returns null for unknown features.

6. **RETRY-01 cross-feature isolation in gateAttemptCount** (MISSING → COVERED)
   - Gap: No test verified that attempts from one feature don't leak into another feature's gate count. The featureId filter was assumed correct but never explicitly verified.
   - Fix: Added test recording attempts for two features at the same gate, verifying each count is independent.

7. **ISOLATE-01 failure type classification completeness** (MISSING → COVERED)
   - Gap: `isolateFailure` distinguishes resumable (timeout, blocked) from terminal (everything else) failure types, but only 'blocked' and 'failed' types were tested. The timeout→blocked path and undefined/null→failed paths were untested.
   - Fix: Added 3 tests — timeout produces 'blocked', undefined produces 'failed', null produces 'failed'.

8. **ISOLATE-01 transitive dependency chain depth > 2** (MISSING → COVERED)
   - Gap: The existing dependency-propagation test had a chain of depth 2 (A→B→C). The while-loop propagation for chains of depth 3+ was untested.
   - Fix: Added test with a 4-feature chain (D→C→B→A) verifying all transitive dependents are blocked when A fails.

9. **ISOLATE-01 eligibleIndependents status filtering** (MISSING → COVERED)
   - Gap: No test verified that `eligibleIndependents` excludes completed, failed, and blocked features (only returning pending/in-progress). The filter condition was assumed but never explicitly tested with mixed statuses.
   - Fix: Added test with all status types, verifying only pending and in-progress features are returned.

10. **CONT-01 canAutoRelaunch boundary (2 vs 3 unacknowledged)** (MISSING → COVERED)
    - Gap: The crash-loop threshold of 3 unacknowledged intents was tested at 3 (returns false) but not at 2 (returns true). The boundary condition `< 3` was only tested from one side.
    - Fix: Added test verifying exactly 2 unacknowledged returns true, complementing the existing 3-unacknowledged test.

11. **CONT-01 out-of-order convergence with multiple gaps** (MISSING → COVERED)
    - Gap: The existing out-of-order test had a single gap (segment 2 acked, segment 1 pending). Multi-gap convergence (3 segments, only the last acked) was untested.
    - Fix: Added test with segments 1,2,3 where only 3 is acknowledged, verifying `isOutOfOrder` returns true and convergence shows 2 unacknowledged.

12. **CONT-01 empty-state edge cases** (MISSING → COVERED)
    - Gap: `resolveConvergence`, `segmentCounts`, and `continuationSummary` were never tested with a fresh continuation state (zero segments). The empty-array iteration paths were untested.
    - Fix: Added tests verifying all three functions return empty/zero results on a fresh state.

---

## Success Criteria Verification

1. ✅ **100+ canonical features complete across multiple segments below characterized limits with measured reserve:** The 120-feature lifecycle test processes all features across 15+ segments, verifying no feature appears twice, all converge, and the multi-wave reserve preservation test confirms reserve is never spent.

2. ✅ **Monotonic IDs and idempotency keys prevent skip/double-apply:** Monotonic segmentId tests, idempotencyKey determinism (order-independent, revision-sensitive), duplicate intent/ack convergence, out-of-order multi-gap convergence, and first-ack-wins duplicate tests all verify this invariant.

3. ✅ **Retry exhaustion or feature failure preserves verified work, stays terminal, and doesn't prevent eligible independents:** Terminal-failure tests (permanent, blocked, exhausted), artifact preservation on failure, failure-type classification (all 5 types), eligibleIndependents filtering, transitive dependency chain depth > 2, and integration test covering retry→isolation→continuation chain.

4. ✅ **Every segment stop reports exact counts and idempotent manual resume command:** resumeCommand tests (with/without acknowledgements, empty state), segmentCounts aggregation, continuationSummary completeness, and integration test verifying exact completed/deferred/blocked/failed counts.

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
- [x] Version lockstep: both entries report engine-version 1.4.5

**Approval:** approved 2026-07-22

**Test totals after validation:** 1008 pass / 0 fail (959 pre-validation + 49 new validation tests)
