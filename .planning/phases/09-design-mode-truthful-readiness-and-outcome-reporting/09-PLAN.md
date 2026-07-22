# Phase 9: Design-Mode Truthful Readiness and Outcome Reporting — Plan

**Phase:** 9
**Requirements:** DREADY-01, DHIST-01, DTERM-01, DQUEST-01, DCHUNK-01, DYAGNI-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 5 (RETRY-01 attempt-history persistence), Phase 6 (STATUS-01 truthful readiness), Phase 8 (durable gate-level state)

## Overview

`designReady=true` and terminal commit/publish/persist outcomes must be true only
when genuinely earned. Six defects: (F4) fail-forward reviews hidden, (F5) force-accepted
plan blockers hidden, (F6) reconcile conflicts ride to readiness, (F10) terminal outcomes
overstate success, (F7) YAGNI BLOCKER dropped under --no-reconcile, (F8) open questions
never enforced, (F9) chunker degradation silent, (F16) no attempt history. Fixes reuse the
Phase 6 truthful-readiness derivation pattern and the Phase 5 attempt-history pattern.

## Canonical References

- `plugins/feature-workflows/workflows/src/main.mjs` — design terminal (designReady assignment), fail-forward flags, force-accept path, commit gate
- `plugins/feature-workflows/workflows/src/status-truth.mjs` — extract-mode readiness derivation (pattern to adopt)
- `plugins/feature-workflows/workflows/src/stages-issues.mjs` — chunkPlanIntoStages (silent degradation)
- `plugins/feature-workflows/workflows/src/agent-core.mjs` — recordAgentFailure (count-only tracking)

---

## Task 1: Truthful design readiness (DREADY-01)

**Files:** `status-truth.mjs`, `main.mjs`

Add `deriveDesignReadiness(result)` pure function that checks:
- No `_reviewed*Forced` flags set (F4)
- No `forceAccepted` with `carriedBlockers` (F5)
- No `reconcile.consistent === false` (F6)

Call it in the design terminal before `designReady = true`. If not ready, record the
exact degradation cause and surface it in the handoff.

## Task 2: Durable degradation/attempt history (DHIST-01)

**Files:** `agent-core.mjs`, `main.mjs`

Add a `_degradationLog` array to `result`, journaled via `recordDegradationEvent()`.
Each entry has `{ seq, type, gate, label, reason }`. Types: fail-forward, retry,
escalation, fallback. Hook into `recordAgentFailure` for retry/escalation/fallback events.
Surface the log in handoff/status.

## Task 3: Truthful terminal outcomes (DTERM-01)

**Files:** `main.mjs`

Fix commit gate: when `committed=false` after a commit attempt, set `blockedAt='commit-failed'`
instead of reporting terminal success. For publish/persist: distinguish attempted from
verified via the existing `published.published` / `persist.persisted` booleans and surface
them as `_publishVerified`/`_persistVerified` in the handoff.

## Task 4: Open questions enforcement (DQUEST-01)

**Files:** `main.mjs`

At design terminal, check if open questions were recorded (`result.openQuestionsPath` set).
If so, verify they are explicitly deferred via `result._openQuestionsDeferred`. If not
deferred, block design completion with the exact unresolved question count.

## Task 5: Chunker degradation surfacing (DCHUNK-01)

**Files:** `stages-issues.mjs`, `main.mjs`

In `chunkPlanIntoStages` fallback path, set `result._chunkerDegraded = true`. In the design
terminal, check `_chunkerDegraded` and surface it in the handoff as an explicit acknowledged
outcome. Require `result._chunkerDegradationAcknowledged` to proceed without warning.

## Task 6: YAGNI blocker routing (DYAGNI-01)

**Files:** `main.mjs`

Ensure BLOCKER-severity YAGNI findings from TDD Enforce reach the plan reviewer prompt even
when `useReconcile = false`. Build a `yagniBlockerContext` from `result.reconcile.conflicts`
entries tagged `[YAGNI BLOCKER]` and inject it into the Review/Refine reviewer prompt
regardless of the reconcile flag.

## Task 7: Tests

**File:** `tests/design-truth.test.mjs`

Coverage for all 6 requirements plus regression assertions.

---

## Success Criteria

1. `designReady=true` never occurs alongside a fail-forwarded review, force-accepted plan
   with carried blockers, or unresolved reconcile conflict.
2. A failed commit is never reported as terminal success; attempted vs verified outcomes
   are distinguishable.
3. Unresolved open questions block completion unless explicitly deferred; chunker degradation
   requires explicit acknowledgement; BLOCKER YAGNI reaches the reviewer regardless of
   reconcile flag.
4. A user can inspect a durable degradation log of every fail-forward, retry, escalation,
   and fallback through the handoff surface.

---

## Verification Evidence

**Status:** COMPLETE
**Date:** 2026-07-22

### GREEN Run
- Full test suite: **700 tests, 0 failures** (646 baseline + 54 new in `tests/design-truth.test.mjs`)
- Build: drift-free (296 top-level names, 31 modules per entry, both entries)
- ESM syntax check: exit 0
- Phase-label validation: undeclared_count=0

### Test Coverage by Requirement

| Requirement | Tests | Coverage |
|-------------|-------|----------|
| DREADY-01 | 16 | deriveDesignReadiness pure function: clean/fail-forward/force-accepted/reconcile/multiple/null/mutation; dist wiring |
| DHIST-01 | 14 | recordDegradationEvent: single/sequential/no-op/defaults; degradationLogSummary: counts/empty/null; dist wiring for fail-forward/fallback/escalation |
| DTERM-01 | 6 | dist: blockedAt on commit failure, early return, _publishVerified, _persistVerified, multi-mode presence |
| DQUEST-01 | 3 | dist: openQuestionsPath check, unresolved-open-questions blocker, _openQuestionsDeferred escape hatch |
| DCHUNK-01 | 5 | dist: _chunkerDegraded, _chunkerDegradationReason, handoff warning, _chunkerDegradationAcknowledged, handoff boolean |
| DYAGNI-01 | 4 | dist: yagniBlockerContext construction, [YAGNI BLOCKER] regex filter, prompt interpolation, reconcile-independent sourcing |
| Integration | 3 | degradation log in ready/not-ready handoff, degradationDetail array |
| Regression | 2 | no FS/shell in deriveDesignReadiness or recordDegradationEvent |

### Files Modified

**Source (6 files):**
- `plugins/feature-workflows/workflows/src/status-truth.mjs` — deriveDesignReadiness + DESIGN_READINESS_REASONS
- `plugins/feature-workflows/workflows/src/agent-core.mjs` — recordDegradationEvent + degradationLogSummary + journal hooks
- `plugins/feature-workflows/workflows/src/review-loop.mjs` — fail-forward event journaling
- `plugins/feature-workflows/workflows/src/stages-issues.mjs` — _chunkerDegraded/_chunkerDegradationReason
- `plugins/feature-workflows/workflows/src/main.mjs` — design terminal readiness gate, commit-failure blocking, publish/persist verification, open-questions gate, chunker warning, YAGNI routing

**Generated dist (2 files, rebuild from source):**
- `plugins/feature-workflows/workflows/feature-pipeline.js`
- `plugins/feature-workflows/workflows/fp-extract-slice.js`

**Test (3 files):**
- `tests/design-truth.test.mjs` — NEW, 54 tests covering all 6 requirements
- `tests/harness.mjs` — added 4 new symbol candidates
- `tests/feature-pipeline-helpers.test.mjs` — added 2 new symbol exports
