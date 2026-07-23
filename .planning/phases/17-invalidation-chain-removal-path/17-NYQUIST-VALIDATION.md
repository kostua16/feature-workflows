# Phase 17 Nyquist Validation Report

**Date:** 2026-07-24
**Phase:** 17 — Invalidation Chain & Removal Path (D2.3)
**Commit:** 9a3af00
**Test total:** 2287 pass / 0 fail
**Build drift:** clean (both dist files up to date)

## Defect Found and Fixed

### DEFECT-1: Substring key collision in `invalidatePersistenceEvidence`

**Severity:** High — cross-slice data corruption

**Root cause:** Key matching used `key.indexOf(sliceId)` (raw substring), so
`slice-1` falsely matched `slice-10`'s keys. The key format is
`type:sliceId:component` (colon-delimited), but the match ignored delimiters.

**Impact:**
- Invalidating `slice-1` incorrectly removed `slice-10`'s ATTEMPTED/FAILED writes.
- Invalidating `slice-1` appended false `superseded` events for `slice-10`'s
  DURABLY_VERIFIED writes (the no-demote invariant held — the write state stayed
  `durably-verified` — but a false audit event was generated).
- The false-positive also affected the next slice up numerically
  (`s1` vs `s10`, `slice-1` vs `slice-10`).

**Fix:** Changed to delimiter-aware match `key.indexOf(':' + sliceId + ':')`.
This respects the `type:sliceId:component` colon boundaries.

**File:** `plugins/feature-workflows/workflows/src/observe-persist.mjs`

## Sampling Gaps Filled (14 new characterization tests)

### GAP-8: Key isolation — substring collision prevention (3 tests)

- Invalidating `slice-1` does NOT affect `slice-10` ATTEMPTED writes
- Invalidating `slice-1` does NOT supersede `slice-10` DURABLY_VERIFIED writes
- Unrelated slice writes fully preserved (3 key types for alpha, 1 for beta)

### GAP-9: Synthesis state behavioral after invalidateSliceChain (3 tests)

- `staleSlices` contains the invalidated sliceId (with a synthesized state)
- `staleViews` set to all 4 view types (behavioral, not just source assertion)
- Unsynchronized state (`synthesized: false`) correctly NOT marked stale

### GAP-10: Lifecycle/status distinction behavioral (2 tests)

- `invalidateSliceChain` does NOT set lifecycle to `excluded` (slice will
  be re-extracted, not terminal)
- `onSliceRemoved` does NOT set status to `pending` (slice is terminal)

### GAP-11: All caches cleared by invalidateSliceChain (1 test)

- Verifies `_e2e`, `_design`, `_arch`, `_requirements` are cleared
  (existing tests only checked `_facts`)

### GAP-12: No-demote with 4th unit type (1 test)

- DURABLY_VERIFIED `continuation-ack` write → superseded, state stays verified
  (existing tests covered feature-shard, synthesis-view, project-index)

### GAP-13: Re-invalidation sequence (1 test)

- After invalidate → add new verified write → invalidate again: new write
  superseded, original event preserved in history (append-only audit trail)

### GAP-14: Crash-resume completeness (3 tests)

- After `invalidateSliceChain` + crash-resume: all guard fields verified
  (status=pending, all 6 artifact paths null, extractReady=false, overviewPath=null,
  _sourceDigest=null, synthesis staleViews=4, published/persist null,
  _publishVerified/_persistVerified false)
- After `onSliceRemoved` + crash-resume: removed slice stays terminal
  (lifecycle=excluded, status NOT pending, artifact paths preserved, parent
  published/persist cleared for rerun)

## Areas Audited — No Gaps Found

- **No-demote invariant:** all 3 persistence states × 4 unit types covered
  (DURABLY_VERIFIED → superseded; ATTEMPTED/FAILED → removed)
- **Gate-predicate guards + booleans:** all 4 fields (`_publishVerified`,
  `_persistVerified`, `published`, `persist`) verified cleared under
  multiple initial conditions (object, null, undefined, true)
- **invalidateSliceChain completeness:** all 6 artifact paths, all caches,
  review flags, queue entry reset, parent aggregates — all verified
- **onSliceRemoved vs invalidateSliceChain distinctness:** source assertions
  (no cross-calls) + behavioral contrast (artifact preservation, lifecycle,
  status) + shared evidence primitive
- **Schema validation:** INVALIDATION_EVENT shape, enum, required fields,
  additionalProperties:false
- **History accumulation:** append-only, cross-slice ordering, schema-conformance

## Risk Assessment

| Item | Status |
|------|--------|
| Substring collision (FIXED) | Fixed and characterized — delimiter-aware match |
| No-demote invariant under every path | Verified — 4 unit types × 3 states |
| Both predicates AND booleans cleared | Verified — crash-resume tests assert all 4 |
| Removed vs invalidate distinctness | Verified — behavioral + source assertions |
| Parent-aggregate staleness | Verified — synthesis staleViews, overview, digest, extractReady |
| Crash-resume after invalidation | Verified — full state assertion for both paths |
