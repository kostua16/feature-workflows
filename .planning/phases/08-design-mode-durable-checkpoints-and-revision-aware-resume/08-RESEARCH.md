# Phase 8: Design-Mode Durable Checkpoints and Revision-Aware Resume — Research

**Researched:** 2026-07-22
**Scope:** Design-mode gate-level durability, atomic state writes, digest-driven resume.
**Source:** `.planning/research/DESIGN-MODE-FINDINGS.md` (full evidence base for F1-F3).

## Findings (Phase 8 scope)

### F1. No mid-chain state persistence (DCKPT-01)
`stateCheckpoint` only advances an in-memory cursor (main.mjs:589-595); `flushPipelineState`
runs only inside `consolidate()` (state.mjs:13-29), called only at hard-block/terminal exits.
A non-throw interruption mid-design persists nothing; resume restarts from Define even though
artifact `.md` files exist on disk. Extract mode already flushes per slice via `checkpointSlice`
(extract-slice.mjs) — the fix pattern exists in-engine.

**Material design gates needing per-gate checkpoint:** Define, Knowledge, Codebase Facts,
E2E Use Cases, Requirements (+ Requirements Review), Architecture (+ Arch Review), Detailed
Design (+ Design Review), Plan (+ TDD Enforce), Reconcile, Review/Refine, Chunk Plan.

### F2. Non-atomic chunked state writes (DSTATE-01)
`writeChunkedFile` stops on first chunk failure leaving a partial file (state.mjs:81-84); resume
checksum catches it (djb2, state.mjs:107-114) but the only outcome is a hard `resume-invalid-state`
block with manual-inspection advice (main.mjs:113-132). No last-good snapshot, no auto-recovery.

### F3. Duplicate work on resume (DRESUME-01)
Every resume runs `repairResumeArtifactFlags` — one LLM file-reader call per recorded artifact
regardless of change (state.mjs:317-362). Approval round-trips reload/re-validate full state per
decision; "edit stages" re-runs the chunker, "reject" re-runs plan + downstream.

## Phase 1-7 Primitives to Adopt

| Primitive | Source | Phase 8 Application |
|-----------|--------|---------------------|
| Gate-level checkpoint + flushPipelineState | Phase 4 `checkpointSlice` | Design-mode `checkpointDesign` after each material gate |
| write-verify-acknowledge | Phase 6 OBSERVE-01 | Atomic state writes with last-good snapshot retention |
| Digest comparison | Phase 1 REV-01 `computeContentDigest` | Digest-driven resume: skip unchanged artifacts |
| Selective invalidation | Phase 1 `compareRevisions`/`selectiveInvalidate` | Only re-verify/re-run gates whose digest changed |

## Implementation Approach

### DCKPT-01: Per-gate durable checkpoint
Add `checkpointDesign(slug, result, config, gateName)` to `main.mjs` that:
1. Records gate completion in `result._designCheckpoints` with artifact digest
2. Calls `flushPipelineState(planDir, result, config)` (try-catch, non-blocking)
3. Insert after each material gate's `stateCheckpoint('X', 'done')` call

### DSTATE-01: Auto-recovering atomic writes
Extend `flushPipelineState` / `writeChunkedFile` with:
1. Before writing new state: copy current `pipeline-state.json` to `pipeline-state.last-good.json`
2. After write: verify checksum matches (write-verify-acknowledge pattern)
3. On resume: if `validatePipelineState` fails, auto-load from `.last-good` before hard-blocking

### DRESUME-01: Digest-driven resume
Extend `repairResumeArtifactFlags` with:
1. Record each artifact's content digest at checkpoint time in `result._artifactDigests`
2. On resume: compare stored digest with re-computed digest
3. If digests match: skip the file-reader verification call entirely
4. If digests differ: re-verify (and null the flag as before)
