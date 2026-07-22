# Phase 8: Design-Mode Durable Checkpoints and Revision-Aware Resume — Plan

**Phase:** 8
**Requirements:** DCKPT-01, DSTATE-01, DRESUME-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 1 (CONTRACT-01 pure reducers, REV-01 digest/revision), Phase 4 (CHECKPOINT-01 gate-level checkpoint pattern), Phase 6 (OBSERVE-01 attempted-vs-durable persistence)

## Overview

Adopt the Phase 1-7 extract-mode checkpoint, digest, and atomic-write primitives for the
design-mode flow (and implement/tune where the identical defect is proven). Three defects:
(F1) design gates don't durably checkpoint, losing all progress to a crash mid-chain;
(F2) truncated state writes hard-block instead of auto-recovering; (F3) resume re-verifies
every artifact regardless of change. Fixes reuse the proven `checkpointSlice` pattern,
add last-good snapshot retention to `writeChunkedFile`, and add digest-driven skip to
`repairResumeArtifactFlags`.

## Canonical References

- `plugins/feature-workflows/workflows/src/main.mjs` — design-mode gate sequence, stateCheckpoint (line 589), resume path (line 95-140)
- `plugins/feature-workflows/workflows/src/state.mjs` — flushPipelineState, writeChunkedFile, validatePipelineState, repairResumeArtifactFlags
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — checkpointSlice (Phase 4 pattern to adopt)
- `plugins/feature-workflows/workflows/src/revision.mjs` — computeContentDigest, compareRevisions (Phase 1 digest contract)

## Key Insight

Extract mode already solves this via `checkpointSlice` — one `flushPipelineState` call after
each material gate boundary. Design mode calls `stateCheckpoint` (in-memory only) after each
gate but never flushes to disk except at hard-block/terminal exits via `consolidate`. The fix
is a thin `checkpointDesign` helper that reuses `flushPipelineState` after each material design
gate, wrapped non-blocking (try-catch) exactly like the extract leaf does.

---

## Task 1: Per-gate durable checkpoint in design mode (DCKPT-01)

**Files to modify:**
- `plugins/feature-workflows/workflows/src/main.mjs`

**Changes:**
- Add `checkpointDesign(slug, result, config, gateName)` helper that:
  1. Records gate completion with artifact digest in `result._designCheckpoints`
  2. Computes a digest of the gate's result data via `computeContentDigest`
  3. Calls `flushPipelineState(planDir, result, config)` (try-catch, non-blocking)
- Insert `checkpointDesign` calls after each material design gate's `stateCheckpoint('X','done')`:
  Define, Knowledge, Codebase Facts, E2E Use Cases, Requirements, Requirements Review,
  Architecture, Arch Review, Detailed Design, Design Review, Plan, TDD Enforce,
  Reconcile, Review/Refine, Chunk Plan
- Initialize `result._designCheckpoints = {}` alongside existing result fields

**RED:** Interrupting after any design gate loses that gate's work on resume (state never persisted mid-chain).
**GREEN:** Each material design gate boundary is durably flushed; resume starts at first incomplete gate.

---

## Task 2: Auto-recovering atomic state writes (DSTATE-01)

**Files to modify:**
- `plugins/feature-workflows/workflows/src/state.mjs`

**Changes:**
- Add `flushPipelineStateWithSnapshot(planDir, result, config)` that wraps `flushPipelineState`:
  1. Before writing: copy current `pipeline-state.json` to `pipeline-state.last-good.json` via file-writer agent
  2. Write the new state via existing `writeChunkedFile`
  3. Non-blocking: copy failure warns but does not prevent the write
- Add `loadPipelineStateWithRecovery(planDir)` that wraps `loadPipelineState`:
  1. Load `pipeline-state.json` and validate
  2. If validation fails: load `pipeline-state.last-good.json` and validate
  3. If last-good passes: auto-recover (use it, log the recovery)
  4. If both fail: hard-block as before
- Update `checkpointDesign` to use `flushPipelineStateWithSnapshot`
- Update resume path in `main.mjs` to use `loadPipelineStateWithRecovery`

**RED:** A truncated/partial pipeline-state.json hard-blocks as `resume-invalid-state`.
**GREEN:** Resume auto-recovers from the last durably acknowledged snapshot.

---

## Task 3: Digest-driven resume (DRESUME-01)

**Files to modify:**
- `plugins/feature-workflows/workflows/src/state.mjs`

**Changes:**
- Extend `repairResumeArtifactFlags` to accept an optional `storedDigests` parameter
- Record artifact digests in `result._artifactDigests` at checkpoint time (in `checkpointDesign`)
- On resume, for each artifact with a stored digest:
  1. Compute current digest from the stored result data for that gate
  2. If digests match: skip the file-reader verification call entirely (artifact unchanged)
  3. If digests differ or no digest recorded: fall through to existing verification
- This reduces resume cost from N LLM calls to 0 when nothing changed

**RED:** Resume re-reads every recorded artifact regardless of change.
**GREEN:** Unchanged artifacts skip re-verification; only digest-changed artifacts re-verify.

---

## Task 4: Phase 8 tests

**Files to create:**
- `tests/design-checkpoints.test.mjs`

**Coverage:**
- DCKPT-01: checkpointDesign records gate checkpoint with artifact digest
- DCKPT-01: checkpointDesign calls flushPipelineState (non-blocking on failure)
- DCKPT-01: structural assertion — design gates have checkpoint calls after stateCheckpoint('done')
- DSTATE-01: flushPipelineStateWithSnapshot writes last-good snapshot before new state
- DSTATE-01: loadPipelineStateWithRecovery auto-recovers from last-good on truncation
- DSTATE-01: loadPipelineStateWithRecovery hard-blocks only when both current and last-good fail
- DRESUME-01: repairResumeArtifactFlags skips unchanged artifacts when digests match
- DRESUME-01: repairResumeArtifactFlags re-verifies when digest differs
- DRESUME-01: repairResumeArtifactFlags falls back to existing behavior without stored digests
- Regression: existing resume tests still pass (backward compat with states lacking digests)

---

## Success Criteria

1. Interrupting a design run between any two material gates resumes at the first incomplete gate
   with all prior verified artifacts intact and no gate repeated.
2. A truncated or partially written state file auto-recovers from the last durably acknowledged
   snapshot on resume instead of hard-blocking as `resume-invalid-state`.
3. Resuming a run or applying an approval decision re-verifies or re-runs only artifacts/reviews
   whose durable digest changed; unaffected gates and reviews are skipped.
4. Implement and tune modes exhibit the same gate-level checkpoint durability wherever the
   coarse-checkpoint defect is proven present.
