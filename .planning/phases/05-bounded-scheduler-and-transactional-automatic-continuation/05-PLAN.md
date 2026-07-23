# Phase 5: Bounded Scheduler and Transactional Automatic Continuation — Plan

**Phase:** 5
**Requirements:** BUDGET-01, RETRY-01, ISOLATE-01, CONT-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 4 (checkpointed feature leaf)

## Overview

Add budget admission with non-spendable reserve, bounded retry with persistent
attempt history, failure isolation preserving independent work, and transactional
automatic continuation with monotonic segment IDs and idempotency keys.

## Task 1: Budget admission (BUDGET-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/budget-admission.mjs`

**What was built:**
- `createBudgetLimits` / `createBudgetAccountant` — characterize and track limits
- `setReserve` / `totalReserve` — non-spendable reserve for checkpoint, reconciliation, synthesis, handoff
- `admitSegment` — segment admission against remaining budget after reserve
- `canFinishNextGate` — per-gate admission check
- `spendBudget` / `budgetSummary` — pure spend tracking and reporting

## Task 2: Bounded retry policy (RETRY-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/retry-policy.mjs`

**What was built:**
- `createRetryPolicy` — per-gate (3) and per-feature (10) limits
- `createAttemptHistory` / `recordAttempt` — monotonic sequence journal
- `gateAttemptCount` / `featureAttemptCount` — exhaustion checks
- `isTerminalFailure` — permanent failure, blocked dependency, exhausted retries
- `terminalReason` / `attemptSummary` — handoff/status reporting

## Task 3: Failure isolation (ISOLATE-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/failure-isolation.mjs`

**What was built:**
- `isolateFailure` — updates only the failed feature's shard; preserves verified artifacts
- `eligibleIndependents` — transitive dependency propagation blocks dependents
- `preserveVerifiedArtifacts` — truthy artifact paths retained on failure
- `shouldContinueAfterFailure` — eligible independents remain
- `segmentOutcome` — exact completed/blocked/failed/deferred counts

## Task 4: Transactional continuation (CONT-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/continuation.mjs`

**What was built:**
- `nextSegmentId` — monotonic identifiers
- `idempotencyKey` — deterministic convergence key (segmentId + sorted featureIds + revision)
- `createSegmentIntent` / `acknowledgeSegment` — intent-then-commit lifecycle
- `resolveConvergence` — deduplicates acks; detects unacknowledged intents
- `resumeCommand` — exact idempotent manual resume fallback
- `shouldContinue` — no-progress detection
- `isOutOfOrder` / `canAutoRelaunch` — out-of-order and crash-loop safety

## Task 5: Main.mjs integration

**Files modified:**
- `plugins/feature-workflows/workflows/src/main.mjs`

**What was built:**
- Budget accountant initialized with 4 reserve categories (5 calls each)
- Segment intent + acknowledgement lifecycle in the extract loop
- Budget admission check before each slice (canFinishNextGate)
- Attempt recording for each slice outcome
- Failure isolation on blocked slices
- Segment acknowledgement with exact counts after the loop
- Continuation/budget summary in the terminal handoff

## Task 6: Tests

**Files created:**
- `tests/bounded-scheduler.test.mjs` — 68 tests

## Success Criteria

1. Budget admission preserves non-spendable reserve; segments crossing the ceiling are rejected.
2. Retry policy persists attempt history with monotonic sequence; exhausted retries remain terminal.
3. One feature failure updates only its shard; eligible independent features continue.
4. Segment intents and completions use monotonic IDs plus idempotency keys; duplicate/lost/out-of-order converge.
5. 100+ feature stress fixture completes across multiple segments with no feature duplicated or lost.
