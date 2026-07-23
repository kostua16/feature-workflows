# Phase 6: Synthesis, Publish, Persist, and Status Truth — Plan

**Phase:** 6
**Requirements:** SYNTH-01, OBSERVE-01, STATUS-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 5 (bounded scheduler and transactional continuation)

## Overview

Add incremental synthesis with selective revision invalidation, retry-safe
persistence tracking distinguishing attempted from durably verified writes,
and a single truthful readiness/status projection shared by handoff and
read-only status.

## Task 1: Incremental synthesis (SYNTH-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/synthesis.mjs`

**What will be built:**
- `createSynthesisState` — initialize empty synthesis state with view digests
- `synthesizeProjectViews` — derive system overview, dependency map, cross-cutting concerns, and coverage index from bounded verified feature summaries
- `isSynthesisCurrent` — check if synthesis views are current against revisions
- `invalidateStaleViews` — selectively invalidate only views affected by revision changes
- `synthesisSummary` — expose synthesis state for handoff/status reporting

## Task 2: Attempted-vs-durable persistence (OBSERVE-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/observe-persist.mjs`

**What will be built:**
- `PERSISTENCE_STATES` — ATTEMPTED, DURABLY_VERIFIED, FAILED
- `createPersistenceTracker` — track write lifecycle states
- `recordAttemptedWrite` / `verifyDurableWrite` / `failWrite` — state transitions
- `isRetrySafe` — check if retrying won't duplicate durably verified state
- `persistenceReport` — expose attempted/durable/failed counts for handoff/status

## Task 3: Truthful readiness and status projection (STATUS-01)

**Files created:**
- `plugins/feature-workflows/workflows/src/status-truth.mjs`

**What will be built:**
- `deriveExtractReadiness` — comprehensive readiness: discovery exhausted + graph valid + features complete + synthesis current + artifacts current
- `projectStatusProjection` — immutable projection for handoff AND status (same data structure)
- `readinessSummary` — human-readable readiness proof

## Task 4: Main.mjs integration

**Files modified:**
- `plugins/feature-workflows/workflows/src/main.mjs`

**What will be built:**
- Synthesis state initialization and incremental synthesis call after slice completion
- Persistence tracker around durable write boundaries
- Truthful readiness derivation replacing the simple extractReady flag
- Status projection shared between handoff and status mode

## Task 5: Tests

**Files created:**
- `tests/synthesis-status.test.mjs`

## Success Criteria

1. Repeated or selectively changed verified summaries produce idempotent, revision-current project views without rebuilding unaffected outputs.
2. Persistence fault injection distinguishes attempted from durably verified writes; retry never produces duplicate index, synthesis, or continuation state.
3. Command handoff and read-only status report identical denominators, lifecycle outcomes, revisions, budgets, failures, and continuation evidence.
4. Readiness is true only for exhausted discovery, a valid graph, current verified required artifacts, current synthesis, and no incomplete feature-level outcome.
