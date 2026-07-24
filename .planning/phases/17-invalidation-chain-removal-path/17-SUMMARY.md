# Phase 17: Invalidation Chain & Removal Path — Summary

**Phase:** 17
**Completed:** 2026-07-24
**Requirements:** INVALIDATE-01, REMOVED-01
**Commit:** 8d9dcea (feat) · 9a3af00 (Nyquist validation: substring-collision fix + 7 gap-fills) · 6d125de (Nyquist report)

## What was built

1. **Pure no-demote `invalidatePersistenceEvidence(state, sliceId)`** —
   enumerates the slice's durable keys (feature shard, synthesis views,
   project-index) in the persistence tracker. `DURABLY_VERIFIED` writes are
   superseded (history event appended, write state UNCHANGED — never demoted
   to `ATTEMPTED`); `ATTEMPTED`/`FAILED` writes are removed with a `removed`
   event. Clears the actual gate-predicate guards `state.published` and
   `state.persist` (set to `null`) plus the derived booleans
   `_publishVerified`/`_persistVerified` (defense-in-depth).
   Delimiter-aware key matching (`':' + sliceId + ':'`) prevents the
   `slice-1`-inside-`slice-10` substring collision (Nyquist DEFECT-1 fix).
2. **`invalidateSliceChain(state, sliceId, queueEntry)`** — resets the durable
   queue entry (`status='pending'`, `artifacts={}`, `_gateCheckpoints={}`),
   nulls all 6 artifact-path guards (`factsPath`/`useCasePath`/`designPath`/
   `archPath`/`requirementsPath`/`auditPath`), clears caches and review flags,
   calls `invalidatePersistenceEvidence`, and marks parent aggregates stale
   via `markStaleForSlice` (overviewPath=null, `_sourceDigest=null`,
   `extractReady=false`).
3. **Pure `markStaleForSlice(synthesisState, sliceId)`** — appends `sliceId`
   to `staleSlices` and marks all four view types stale
   (`systemOverview`, `dependencyMap`, `crossCutting`, `coverageIndex`).
4. **`onSliceRemoved(state, sliceId, queueEntry)`** — DISTINCT from
   `invalidateSliceChain`: does NOT reset the queue to `pending` (the slice is
   terminal). Calls `invalidatePersistenceEvidence` + `applyLifecycleEvent`
   (`{type:'exclude'}`), which drops the slice from the coverage denominator.
   Artifact paths are preserved (slice history retained).
5. **Append-only `_invalidations[]` audit trail** — each event conforms to the
   `INVALIDATION_EVENT` schema (`additionalProperties: false`; action enum
   `versioned|removed|superseded`). Repeated invalidations accumulate; cross-
   slice ordering preserved.
6. **Schema + meta + harness** — `INVALIDATION_EVENT` exported from
   `schemas.mjs`; `Invalidation` meta phase declared; all four functions
   exported from their respective modules and registered in the harness
   CANDIDATES.

## Test results

- 2287/2287 full suite green (2187 baseline + 100 Phase 17).
- No-demote invariant verified across 4 unit types and 3 persistence states;
  crash-resume completeness verified for both `invalidateSliceChain` and
  `onSliceRemoved` paths.
