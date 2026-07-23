# Phase 15: Slice Ownership Reconciliation — Summary

**Phase:** 15
**Completed:** 2026-07-24
**Requirements:** OWN-01
**Commit:** 727db85 (feat) · 20afe3f (Nyquist characterization, 69 tests)

## What was built

1. **Pure `reconcileSlices(persistedSlices, currentFiles)`** — exactly two
   parameters (no flags/LLM/hints), no agent/async/IO, no
   `crypto`/`Math.random`/`Date.now`. Returns `{ slices, delta }` where every
   current file ends up owned by exactly one slice (validated by
   `validatePartition` before return).
2. **Prefix-score assignment** — `computePrefixScore(file, sliceFiles)` counts
   common leading path segments; added files go to the highest-scoring
   **non-removed** slice (ties broken by lex-smallest `sliceId`).
3. **Zero-score clustering** — `clusterByTwoSegDir` union-finds files sharing
   the first 2 path segments; `deriveClusterSliceId` builds
   `slice-<lexSmallest(cluster contentSha256s).slice(0,12)>` with deterministic
   `-<n>` collision-probe (permutation-invariant via `hashes.sort()`).
4. **Content-fingerprint move detection** — `detectMoves` reassigns a file to
   its old owner when the path is gone AND the `contentSha256` uniquely matches
   one gone old path; duplicate content (≥2 old paths share the digest)
   conservatively becomes remove+add, not a move.
5. **Removed-slice state machine + overlap resolution** — a slice emptied by
   membership loss → `status: 'removed'` (terminal for re-extraction, logged
   in `delta.removedSlices`); content change on a surviving slice →
   `status: 'pending'`. Overlap conflicts are resolved by lex-smallest
   `sliceId` with losers logged in `delta.overlaps` (defense-in-depth).
6. **Canonical sort block** — before return, `delta.added`/`removed`/`moved`/
   `newSlices`/`removedSlices`/`overlaps` and the output slices are all
   sorted, giving full permutation invariance (reordering either input array
   produces identical JSON output).

## Test results

- 2055/2055 full suite green (1927 baseline + 128 Phase 15).
- Empirical goal-backward UAT probe (29/29 checks) confirms partition
  invariant, determinism, and permutation invariance across 7 scenarios.
