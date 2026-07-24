---
phase: 17
slug: invalidation-chain-removal-path
status: verified
verdict: MET
verified_at: 2026-07-24
verified_by: autonomous-uat
method: goal-backward UAT
tests_pass: 2287
tests_fail: 0
---

# Phase 17 — UAT Verification

> Goal-backward UAT of Phase 17 (INVALIDATE-01, REMOVED-01 / D2.3 — invalidation
> chain & removal path). Autonomously verified; no human interaction required.

## Goals

### INVALIDATE-01

> Invalidating a changed slice resets the durable queue entry, slice-local
> artifact-path/review guards, **and** all parent aggregates — clearing/versioning
> the actual publish/persist gate predicates (`result.published`/`result.persist`)
> plus `_publishVerified`/`_persistVerified` via a no-demote evidence primitive
> (version/remove keys + history event), and marking synthesis/overview/
> readiness/status stale so they regenerate.

**Success Criteria** (from REQUIREMENTS / PLAN):

1. Queue entry reset (`status='pending'`, `artifacts={}`, `_gateCheckpoints={}`).
2. All 6 artifact-path guards nulled + caches/review flags cleared.
3. Gate-predicate guards `result.published`/`result.persist` cleared (NOT just
   booleans) — verified against actual gate predicates in `main.mjs`.
4. `_publishVerified`/`_persistVerified` also reset (defense-in-depth).
5. No-demote (OBSERVE-01): DURABLY_VERIFIED → superseded, never demoted.
6. Parent aggregates stale: synthesis staleSlices/staleViews, overviewPath,
   _sourceDigest, extractReady.
7. `_invalidations[]` append-only audit trail.

### REMOVED-01

> A slice emptied by membership loss is terminal for re-extraction but triggers
> a parent invalidation (`onSliceRemoved`): lifecycle marked excluded, its
> feature/index/synthesis evidence superseded, coverage denominator updated,
> and parent publish/persist + handoff rerun.

**Success Criteria**:

1. `onSliceRemoved` is DISTINCT from `invalidateSliceChain` (no re-extraction).
2. Lifecycle `excluded` via `applyLifecycleEvent`.
3. Evidence superseded (not demoted) via `invalidatePersistenceEvidence`.
4. Coverage denominator drops (excluded subtracted by `deriveCoverageIndex`).
5. Parent publish/persist rerun (gate predicates cleared).
6. Artifact paths preserved (slice history retained).

## Verdict: MET

Both requirements fully verified against delivered source with 2287 passing
tests (100 new for D2.3), source-level assertions, and build drift-free
validation.

## Verification Method

Goal-backward UAT — each goal component decomposed backward into observable
properties, then verified three ways:

1. **Test suite** — 2287 tests pass (52 behavioral in
   `tests/invalidation-chain.test.mjs` + 48 Nyquist characterization in
   `tests/invalidation-chain-nyquist.test.mjs`), exercising pure functions
   with real inputs against the shipped dist.
2. **Source inspection** — read all 4 function bodies (`invalidatePersistenceEvidence`,
   `invalidateSliceChain`, `markStaleForSlice`, `onSliceRemoved`) + confirmed
   exports, schema, and meta phase. Cross-referenced gate-predicate guards
   (`main.mjs:1717/1723`) against cleared fields.
3. **Build drift** — `node scripts/*workflows*.mjs --check` confirms both dist
   files up to date (33 modules, 376/375 top-level names).

## What Was Verified

### INVALIDATE-01: SC-1 Queue entry reset

- `invalidateSliceChain` sets `queueEntry.status = 'pending'`,
  `queueEntry.artifacts = {}`, `queueEntry._gateCheckpoints = {}`
  (source: `extract-slice.mjs:306-333`, test: GREEN #20-22).

### INVALIDATE-01: SC-2 Artifact-path guards + caches cleared

- All 6 artifact paths nulled: `factsPath`, `useCasePath`, `designPath`,
  `archPath`, `requirementsPath`, `auditPath`.
- Caches cleared: `_facts`, `_e2e`, `_design`, `_arch`, `_requirements`.
- Review flags cleared: `_reviewedDesign`, `_reviewedArch`.
- Nyquist GAP-11 verifies `_e2e`, `_design`, `_arch`, `_requirements` cleared
  (beyond just `_facts`).

### INVALIDATE-01: SC-3 Gate-predicate guards cleared (the actual skip conditions)

- `invalidatePersistenceEvidence` sets `state.published = null` and
  `state.persist = null`.
- Confirmed against actual gate predicates in `main.mjs`:
  - Line 1717: `if (usePublish && !result.published)` — publish gate
  - Line 1723: `if (useKnowledgePersist && !result.persist)` — persist gate
  - Lines 2886/2894: same predicates in design-mode tail
  - Line 3590: same predicate in standalone persist gate
- Setting `published`/`persist` to `null` makes `!result.published` /
  `!result.persist` evaluate `true` → gates RE-RUN on resume.

### INVALIDATE-01: SC-4 Booleans also reset

- `state._publishVerified = false`, `state._persistVerified = false`
  (defense-in-depth; these are derived booleans set by the gate tails,
  not the gate predicates themselves).

### INVALIDATE-01: SC-5 No-demote invariant (OBSERVE-01)

- DURABLY_VERIFIED writes: `action: 'superseded'` event appended, write state
  NOT modified (stays in `newWrites` unchanged).
- ATTEMPTED writes: deleted from tracker, `action: 'removed'` event.
- FAILED writes: deleted from tracker, `action: 'removed'` event.
- Nyquist GAP-1: 5 tests covering feature-shard, synthesis-view, project-index,
  multiple writes, mixed set.
- Nyquist GAP-12: `continuation-ack` unit type (4th type) also no-demote.
- Nyquist GAP-13: re-invalidation after new durable write — both events
  preserved (append-only).

### INVALIDATE-01: SC-6 Parent aggregates stale

- `markStaleForSlice` sets `staleSlices` (appends sliceId) and `staleViews`
  (all 4 types: `systemOverview`, `dependencyMap`, `crossCutting`,
  `coverageIndex`).
- `state.overviewPath = null` (regenerate).
- `state._sourceDigest = null`.
- `state.extractReady = false`.
- Nyquist GAP-9: behavioral verification of staleSlices + staleViews.

### INVALIDATE-01: SC-7 History audit trail

- `_invalidations[]` initialized if missing.
- Events conform to `INVALIDATION_EVENT` schema: `additionalProperties: false`,
  requires `sliceId`, `key`, `action`; action enum `['versioned', 'removed',
  'superseded']`.
- Append-only: two invalidations of same slice → 2+ entries (Nyquist GAP-6).
- Cross-slice ordering preserved (Nyquist GAP-6).

### INVALIDATE-01: SC-7a Substring collision fix (Nyquist DEFECT-1)

- Original defect: `key.indexOf(sliceId)` matched `slice-1` inside `slice-10`.
- Fix: delimiter-aware `key.indexOf(':' + sliceId + ':')` respecting
  `type:sliceId:component` format.
- Nyquist GAP-8: 3 tests proving `slice-1` invalidation does NOT affect
  `slice-10` ATTEMPTED or DURABLY_VERIFIED writes.

### REMOVED-01: SC-1 Distinct from invalidateSliceChain

- `onSliceRemoved` does NOT call `invalidateSliceChain` (source assertion).
- `invalidateSliceChain` does NOT call `onSliceRemoved` (source assertion).
- `onSliceRemoved` does NOT set `queueEntry.status` to `'pending'` (terminal).
- Nyquist GAP-4: 5 tests verifying source assertions + behavioral contrast.

### REMOVED-01: SC-2 Lifecycle excluded

- `onSliceRemoved` calls `applyLifecycleEvent(queueEntry, {type: 'exclude',
  payload: {rationale: 'slice-removed-empty'}})`.
- Nyquist GAP-10: `onSliceRemoved` does NOT set status to pending; lifecycle
  excluded is terminal.

### REMOVED-01: SC-3 Evidence superseded

- `onSliceRemoved` calls `invalidatePersistenceEvidence(state, sliceId)` —
  same no-demote primitive: DURABLY_VERIFIED → superseded, never demoted.

### REMOVED-01: SC-4 Coverage denominator drops

- Lifecycle `excluded` causes `deriveCoverageIndex` to subtract the slice
  from the denominator (existing behavior: `summaries.length - counts.excluded`).

### REMOVED-01: SC-5 Parent publish/persist rerun

- `invalidatePersistenceEvidence` clears `state.published`/`state.persist` →
  gate predicates (`!result.published`/`!result.persist`) evaluate true →
  parent publish/persist re-runs on resume.

### REMOVED-01: SC-6 Artifact paths preserved

- `onSliceRemoved` does NOT null any artifact paths — slice-local history
  (extracted docs) retained as-is. Contrast: `invalidateSliceChain` clears
  all 6 paths (Nyquist GAP-4 behavioral contrast test).

### Cross-cutting

- **Purity:** all 4 new functions have no `safeAgent`/`flexibleAgent`/`async`/
  `Date.now`/`Math.random` (source assertions, test line ~529).
- **Exports:** all 4 functions + `INVALIDATION_EVENT` exported from their
  respective modules (confirmed in export blocks).
- **Meta:** phase `'Invalidation'` declared in
  `meta/feature-pipeline.meta.mjs:50`.
- **Crash-resume:** Nyquist GAP-14 — after `invalidateSliceChain` + resume,
  all guard fields verified (status=pending, 6 artifact paths null,
  extractReady=false, synthesis staleViews=4, published/persist null,
  _publishVerified/_persistVerified false); after `onSliceRemoved` + resume,
  removed slice stays terminal (lifecycle=excluded, status NOT pending,
  artifact paths preserved, parent published/persist cleared).

## Implementation Summary

| Component | Location | Evidence |
|-----------|----------|----------|
| `invalidatePersistenceEvidence` | `observe-persist.mjs:188-236` | Pure no-demote; delimiter-aware; clears 4 guards |
| `invalidateSliceChain` | `extract-slice.mjs:306-333` | Resets queue + 6 paths + caches + review + parent |
| `markStaleForSlice` | `synthesis.mjs:257-266` | Pure; staleSlices + 4 staleViews; null-safe |
| `onSliceRemoved` | `main.mjs:3664-3669` | Terminal; supersede + lifecycle exclude |
| `INVALIDATION_EVENT` | `schemas.mjs:1282-1292` | `additionalProperties: false`; enum action |
| Meta phase | `meta/feature-pipeline.meta.mjs:50` | `Invalidation` declared |

## Test Totals

| Suite | Tests |
|-------|-------|
| invalidation-chain.test.mjs | 52 |
| invalidation-chain-nyquist.test.mjs | 48 |
| Full suite | 2287 pass / 0 fail |

## Build Status

- Dist drift-free: `feature-pipeline.js` (33 modules, 376 top-level names)
  and `fp-extract-slice.js` (33 modules, 375 top-level names) up to date.
- `node scripts/*workflows*.mjs --check` — exit 0.

## Commits Verified

| Hash | Description |
|------|-------------|
| `25e1068` | Plan: invalidation chain & removal path (D2.3) |
| `8d9dcea` | Feat: add invalidation chain and removal path |
| `9a3af00` | Nyquist validation — fix substring key collision, fill 7 gaps |
| `6d125de` | Docs: Nyquist validation report |

## Scope Boundary

Phase 17 implements ONLY D2.3 (invalidation chain incl. persistence-evidence
primitive + removal parent path). It does NOT implement:

- D3 (upsert entrypoints — `--update`, `--no-update`, `--force`, `--feature`,
  `--new` CLI flags) — Phase 18
- D4 (migration/adopt — `--adopt`) — Phase 18
- Integration of `invalidateSliceChain` into the extract-mode update flow —
  Phase 18
- Gate-level change-detection granularity — future milestone

## Concerns

None. Both requirements MET, no-demote invariant verified across 4 unit types
and 3 persistence states, substring-collision defect fixed and characterized,
crash-resume completeness verified for both paths, build drift-free, full
suite green.

---

*Phase 17: Invalidation Chain & Removal Path — verified 2026-07-24*
