# Phase 4: Checkpointed Feature Leaf — Plan

**Phase:** 4
**Requirements:** ORCH-01, CHECKPOINT-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 3 (multi-entry build, leaf dist, version lockstep)

## Overview

Wire the top-level orchestrator to spawn `fp-extract-slice` via `Workflow()` for each
admitted feature, and add gate-level durable checkpoint/resume to the leaf using the shared
lifecycle/revision reducer from Phase 1. The leaf processes exactly one feature, composes
no child workflow, and leaves project scheduling/readiness authority at the top level.

## Canonical References

- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — leaf gate sequence (extractSlice)
- `plugins/feature-workflows/workflows/src/extract-slice-entry.mjs` — leaf entry (extractSliceMain)
- `plugins/feature-workflows/workflows/src/main.mjs` — top-level orchestrator (extract queue loop ~line 1137)
- `plugins/feature-workflows/workflows/src/lifecycle.mjs` — Phase 1 lifecycle reducer
- `plugins/feature-workflows/workflows/src/revision.mjs` — Phase 1 selective invalidation
- `plugins/feature-workflows/workflows/src/state.mjs` — flushPipelineState, validatePipelineState

## Key Insight

The `extractSlice()` function already has in-memory gate-skip-on-resume (each gate checks
`if (!sliceState.factsPath)`). What's missing is DURABLE per-gate checkpoint persistence —
the slice state is only flushed to disk AFTER the full slice completes. Phase 4 inserts a
checkpoint acknowledgement after each material gate boundary so an interrupted leaf resumes
at the first incomplete gate without repeating verified work.

The top-level orchestrator currently calls `extractSlice()` directly as a function. Phase 4
replaces this with `Workflow({name:'fp-extract-slice', args:{...}})` composition, with a
fallback to direct call when `Workflow` is not available (test harness, older runtime).

---

## Task 1: Per-gate durable checkpoint in extractSlice()

**Files to modify:**
- `plugins/feature-workflows/workflows/src/extract-slice.mjs`

**Changes:**
- Import `flushPipelineState`, `stateChecksum`, `applyLifecycleEvent`, `computeDigest`
- Add `checkpointSlice(slice, sliceState, gateName, result)` helper that:
  1. Records gate completion with artifact digest in sliceState._gateCheckpoints
  2. Durably persists sliceState to `<slice.planDir>/pipeline-state.json`
  3. Called after each material gate: facts, e2e, design, arch, review, requirements
- Call `checkpointSlice()` after each gate sets its artifact path
- On entry: log the gate being entered for audit trail

**RED:** Interrupting after any gate loses that gate's work on resume.
**GREEN:** Each gate boundary is durably acknowledged; resume starts at first incomplete gate.

---

## Task 2: Lifecycle reducer integration in the leaf

**Files to modify:**
- `plugins/feature-workflows/workflows/src/extract-slice-entry.mjs`

**Changes:**
- Import lifecycle reducer functions
- On leaf entry: apply `start` transition (runnable → in-progress)
- On all-gates-done: apply `complete` transition (in-progress → completed)
- On blocked: stay in-progress (not terminal — resumable)
- On unrecoverable failure: apply `fail` transition
- Return lifecycle state in the result

**RED:** Leaf does not track lifecycle transitions through the shared reducer.
**GREEN:** Leaf uses applyLifecycleEvent for all state transitions; idempotent replay.

---

## Task 3: Revision-aware gate skip on resume

**Files to modify:**
- `plugins/feature-workflows/workflows/src/extract-slice.mjs`

**Changes:**
- When a gate's artifact path is already set (resume scenario), compute the artifact digest
- Compare against the digest recorded at checkpoint time
- If digests match: skip the gate (artifact is still valid)
- If digests differ: re-run the gate (artifact was modified or source changed)
- Use `computeContentDigest` from revision.mjs for stable comparison

**RED:** A changed artifact or source file is not detected on resume.
**GREEN:** Only gates with changed inputs re-run; valid evidence is retained.

---

## Task 4: Top-level Workflow() spawn for the leaf

**Files to modify:**
- `plugins/feature-workflows/workflows/src/main.mjs`

**Changes:**
- Replace direct `extractSlice()` call with `Workflow({name:'fp-extract-slice', args:{...}})`
- Add fallback: if `typeof Workflow === 'function' && hasLeafEntry`, spawn via Workflow;
  otherwise call `extractSlice()` directly (backward compat)
- The Workflow spawn passes: { slice, task, config, sliceState, retryBudget, ... }
- The return value is unpacked from the leaf result
- Top-level retains all scheduling, readiness, and continuation authority

**RED:** Top-level calls extractSlice() directly — no Workflow composition.
**GREEN:** Top-level spawns fp-extract-slice via Workflow() with graceful fallback.

---

## Task 5: Phase 4 tests

**Files to create:**
- `tests/checkpointed-leaf.test.mjs`

**Coverage:**
- Per-gate checkpoint: each material gate produces a durable state acknowledgment
- Resume at first incomplete gate (before/after each gate boundary)
- Idempotent replay: duplicate completion event does not duplicate writes
- Invalid output routes through shared reducer (does not advance stale state)
- Revision-aware skip: unchanged artifact skips gate; changed artifact re-runs
- Skip semantics: feature-level skip = incomplete; policy-disabled optional = can complete;
  required-gate skip = blocks completion
- Workflow spawn integration (mock Workflow in test harness)

---

## Success Criteria

1. The installed `fp-extract-slice` processes exactly one admitted feature, composes no
   child workflow, and leaves project scheduling/readiness authority at the top level.
2. Interrupting before or after any material extraction gate resumes at the first incomplete
   gate without repeating verified work.
3. Duplicate completion, invalid output, and source drift converge through the shared reducer
   without duplicating evidence or advancing stale state.
4. Feature-level skipped remains incomplete; only a policy-disabled optional gate with
   recorded evidence may be skipped while completing; a skipped required gate blocks completion.
