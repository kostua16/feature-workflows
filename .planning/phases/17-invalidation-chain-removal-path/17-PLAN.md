---
phase: 17
name: Invalidation Chain & Removal Path
requirements: [INVALIDATE-01, REMOVED-01]
depends_on: [16]
wave: 1
files_modified:
  - plugins/feature-workflows/workflows/src/observe-persist.mjs
  - plugins/feature-workflows/workflows/src/extract-slice.mjs
  - plugins/feature-workflows/workflows/src/synthesis.mjs
  - plugins/feature-workflows/workflows/src/main.mjs
  - plugins/feature-workflows/workflows/src/schemas.mjs
  - plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs
  - tests/harness.mjs
  - plugins/feature-workflows/workflows/feature-pipeline.js
  - plugins/feature-workflows/workflows/fp-extract-slice.js
files_created:
  - tests/invalidation-chain.test.mjs
  - tests/invalidation-chain-nyquist.test.mjs
autonomous: true
---

# Phase 17: Invalidation Chain & Removal Path

**Status:** Planned
**Date:** 2026-07-24
**Requirements:** INVALIDATE-01, REMOVED-01
**Depends on:** Phase 16 (D2.2 change detection)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.3

## RED Gate (must fail before implementation)

1. `invalidatePersistenceEvidence`, `invalidateSliceChain`, `onSliceRemoved`,
   and `markStaleForSlice` do NOT exist — calling any of them throws
   ReferenceError.
2. Clearing only `_gateCheckpoints` must NOT skip gates — the artifact-path
   guards (`factsPath`/`useCasePath`/`designPath`/`archPath`/`requirementsPath`/
   `auditPath`) remain set, so `extractSlice` still skips on their presence.
   A separate `invalidateSliceChain` is required to reset them all.
3. Publish/persist must NOT skip on stale `result.published`/`result.persist` —
   these are the actual gate-predicate guards checked at `main.mjs:1716` and
   `main.mjs:1722`. Clearing only `_publishVerified`/`_persistVerified` leaves
   the predicates intact, so the gates still skip on resume.
4. `invalidatePersistenceEvidence` must NOT demote a durably-verified write
   (OBSERVE-01 violation). It must supersede (version + history), never set
   a `DURABLY_VERIFIED` write back to `ATTEMPTED`.
5. A removed slice must NOT linger in parent views — if `onSliceRemoved` is
   not called, the coverage denominator and synthesis views retain the stale
   slice entry.

## GREEN Evidence (must pass after implementation)

### invalidatePersistenceEvidence(state, sliceId)

1. PURE function — no agent calls, no I/O, no `async`, no `Date.now`,
   no `Math.random`. Operates on the `state` object in-place (returns void
   or the mutated state).
2. BEFORE clearing artifact paths, enumerates affected durable keys: the
   slice's feature shard, synthesis views, project-index entries.
3. For each key: versions or removes it in the persistence tracker +
   appends an invalidation-history event to `state._invalidations[]`.
4. Respects OBSERVE-01 no-demote: a `DURABLY_VERIFIED` write is never
   demoted back to `ATTEMPTED` — it is superseded (versioned + history
   event appended, state left as-is or marked superseded).
5. Resets `state._publishVerified` to `false`.
6. Resets `state._persistVerified` to `false`.
7. Clears/versions the actual gate-predicate guard `state.published` (sets
   to `null` or a superseded-marker object).
8. Clears/versions the actual gate-predicate guard `state.persist` (sets
   to `null` or a superseded-marker object).

### invalidateSliceChain(state, sliceId, queueEntry)

9. Resets the durable queue entry: `status` set to `'pending'`,
   `artifacts` set to `{}`, `_gateCheckpoints` cleared (set to `{}`).
10. Resets slice-local artifact-path guards: `factsPath`, `useCasePath`,
    `designPath`, `archPath`, `requirementsPath`, `auditPath` all set to
    `null`.
11. Clears slice-local caches: `_facts`, review flags.
12. Clears slice-local `_gateCheckpoints`.
13. Calls `invalidatePersistenceEvidence(state, sliceId)`.
14. Marks parent aggregates stale: calls `markStaleForSlice` on the
    synthesis state, sets `overviewPath` to `null` (regenerate), clears
    `_sourceDigest`, sets `extractReady = false`.
15. Source assertion: calls `invalidatePersistenceEvidence`.

### markStaleForSlice(synthesisState, sliceId)

16. PURE function — no agent calls, no I/O.
17. Marks the synthesis state as stale for the given slice so the next
    `synthesizeProjectViews` call rebuilds affected views.
18. Sets a `staleSlices` array (or equivalent) on the synthesis state
    containing the sliceId.

### onSliceRemoved(state, sliceId, queueEntry)

19. DISTINCT from `invalidateSliceChain` — does NOT reset the queue entry
    to `pending` (the slice is terminal, not re-extracted).
20. Calls `invalidatePersistenceEvidence(state, sliceId)` to supersede its
    feature/index/synthesis evidence.
21. Marks lifecycle `excluded` via `applyLifecycleEvent` (using the
    existing lifecycle.mjs `EXCLUDED` state and the `'exclude'` event type).
22. Drops the slice from the coverage denominator (automatic via lifecycle
    `excluded` — `deriveCoverageIndex` already subtracts `excluded`).
23. Triggers parent publish/persist rerun by clearing `result.published`/
    `result.persist` (done via `invalidatePersistenceEvidence`).
24. Preserves slice-local history (does NOT clear artifact paths — the
    extracted docs remain as history).
25. Source assertion: does NOT set `queueEntry.status` to `'pending'`.

### Meta + cross-cutting

26. Meta phases include `'Invalidation'`.
27. `_invalidations[]` history events have a consistent shape:
    `{sliceId, key, action, timestamp}` or equivalent.
28. All new pure functions have no `safeAgent`/`flexibleAgent`/`async` calls
    (source assertion).
29. All new functions are exported from their respective modules.
30. `INVALIDATION_EVENT` schema has `additionalProperties: false`.
31. `INVALIDATION_EVENT` schema is exported from schemas.mjs.

## Implementation Steps

### Step 1: Schema addition (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**INVALIDATION_EVENT** — the shape of each entry in `_invalidations[]`:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'key', 'action'],
  properties: {
    sliceId: { type: 'string', description: 'Slice whose evidence was invalidated' },
    key: { type: 'string', description: 'Durable key that was versioned or removed' },
    action: { type: 'string', enum: ['versioned', 'removed', 'superseded'], description: 'How the key was invalidated (no-demote: never demoted)' },
    reason: { type: 'string', description: 'Why the evidence was invalidated' },
  },
}
```

Export `INVALIDATION_EVENT` in the schema export block.

### Step 2: invalidatePersistenceEvidence (`observe-persist.mjs`)

Add `invalidatePersistenceEvidence(state, sliceId)` to
`plugins/feature-workflows/workflows/src/observe-persist.mjs`:

**PURE** — no agent calls, no I/O. Respects OBSERVE-01 no-demote.

Algorithm:
1. Initialize `state._invalidations = state._invalidations || []`.
2. Enumerate affected durable keys from the persistence tracker
   (`state.persistenceTracker`): filter `writes` for keys containing
   the sliceId (feature shard, synthesis views, project-index entries).
3. For each affected key:
   - If the write is `DURABLY_VERIFIED`: append a history event with
     `action: 'superseded'` (never demote — the write stays verified,
     but a supersede record is added so re-publication knows to re-run).
   - If the write is `ATTEMPTED` or `FAILED`: remove it from the tracker
     and append a history event with `action: 'removed'`.
4. Reset `state._publishVerified = false`.
5. Reset `state._persistVerified = false`.
6. Clear the gate-predicate guard `state.published = null`.
7. Clear the gate-predicate guard `state.persist = null`.

Key constraint: a `DURABLY_VERIFIED` write is NEVER set back to `ATTEMPTED`.
The supersede history event is the signal that re-publication must re-run,
even though the durable write itself is retained (OBSERVE-01).

### Step 3: invalidateSliceChain (`extract-slice.mjs`)

Add `invalidateSliceChain(state, sliceId, queueEntry)` to
`plugins/feature-workflows/workflows/src/extract-slice.mjs`:

**PURE** (operates on state/queueEntry objects, no I/O) — but calls
`invalidatePersistenceEvidence`.

Algorithm:
1. Reset the durable queue entry: `queueEntry.status = 'pending'`,
   `queueEntry.artifacts = {}`, `queueEntry._gateCheckpoints = {}`.
2. Reset slice-local artifact-path guards on `queueEntry` (or `state`
   for single-slice): `factsPath`, `useCasePath`, `designPath`,
   `archPath`, `requirementsPath`, `auditPath` all set to `null`.
3. Clear slice-local caches: `queueEntry._facts = undefined` (or
   `delete queueEntry._facts`).
4. Clear slice-local review flags.
5. Call `invalidatePersistenceEvidence(state, sliceId)`.
6. Mark parent aggregates stale:
   - Call `markStaleForSlice(state.synthesisState, sliceId)`.
   - Set `state.overviewPath = null` (regenerate on next pass).
   - Clear `state._sourceDigest = null`.
   - Set `state.extractReady = false`.

### Step 4: markStaleForSlice (`synthesis.mjs`)

Add `markStaleForSlice(synthesisState, sliceId)` to
`plugins/feature-workflows/workflows/src/synthesis.mjs`:

**PURE** — no agent calls, no I/O.

```js
// Mark synthesis views as stale for a specific slice so the next
// synthesizeProjectViews call rebuilds affected views. Complements
// invalidateStaleViews (revision-delta based) with a slice-targeted variant.
function markStaleForSlice(synthesisState, sliceId) {
  if (!synthesisState || !synthesisState.synthesized) return synthesisState
  var newState = Object.assign({}, synthesisState)
  newState.staleSlices = (synthesisState.staleSlices || []).concat([sliceId])
  // Mark all view types stale — a slice change affects every view that
  // includes per-feature data (overview, dependency, cross-cutting, coverage).
  newState.staleViews = ['systemOverview', 'dependencyMap', 'crossCutting', 'coverageIndex']
  return newState
}
```

### Step 5: onSliceRemoved (`main.mjs`)

Add `onSliceRemoved(state, sliceId, queueEntry)` to
`plugins/feature-workflows/workflows/src/main.mjs`:

**PURE** (operates on state/queueEntry objects) — calls
`invalidatePersistenceEvidence` and `applyLifecycleEvent`.

Algorithm:
1. Call `invalidatePersistenceEvidence(state, sliceId)` to supersede
   feature/index/synthesis evidence.
2. Mark lifecycle `excluded`:
   `applyLifecycleEvent(queueEntry, {type: 'exclude', payload: {rationale: 'slice-removed-empty'}})`.
3. Do NOT reset queue entry to `pending` — the slice is terminal.
4. Do NOT clear artifact paths — slice-local history is preserved.
5. The coverage denominator drops automatically (lifecycle `excluded`
   is subtracted by `deriveCoverageIndex`).
6. Parent publish/persist rerun is triggered by step 1 clearing
   `result.published`/`result.persist`.

### Step 6: Meta phase declaration

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase title `{ title: 'Invalidation' }` to the `phases` array.

### Step 7: Harness candidate registration

In `tests/harness.mjs`, add the new function names to the `CANDIDATES` array:

```
'invalidatePersistenceEvidence',
'invalidateSliceChain',
'markStaleForSlice',
'onSliceRemoved',
'INVALIDATION_EVENT',
```

### Step 8: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add INVALIDATION_EVENT; export it |
| `plugins/feature-workflows/workflows/src/observe-persist.mjs` | Add invalidatePersistenceEvidence |
| `plugins/feature-workflows/workflows/src/extract-slice.mjs` | Add invalidateSliceChain |
| `plugins/feature-workflows/workflows/src/synthesis.mjs` | Add markStaleForSlice |
| `plugins/feature-workflows/workflows/src/main.mjs` | Add onSliceRemoved |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Invalidation' phase |
| `tests/harness.mjs` | Add new function names to CANDIDATES |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/invalidation-chain.test.mjs` | D2.3 behavioral tests (pure functions + source assertions) |
| `tests/invalidation-chain-nyquist.test.mjs` | D2.3 Nyquist validation characterization tests |

## Test Specification (tests/invalidation-chain.test.mjs)

### RED tests (must fail before implementation)

1. `invalidatePersistenceEvidence` is not defined — calling it throws
   ReferenceError.
2. `invalidateSliceChain` is not defined — calling it throws ReferenceError.
3. `markStaleForSlice` is not defined — calling it throws ReferenceError.
4. `onSliceRemoved` is not defined — calling it throws ReferenceError.
5. Source assertion: clearing only `_gateCheckpoints` leaves artifact-path
   guards set (the 6 paths remain non-null) — so `extractSlice` would still
   skip gates. This proves a bare checkpoint clear is insufficient.
6. Source assertion: clearing only `_publishVerified`/`_persistVerified`
   leaves `result.published`/`result.persist` set — so the publish/persist
   gates would still skip on resume.

### GREEN tests — invalidatePersistenceEvidence

7. Resets `_publishVerified` to `false`.
8. Resets `_persistVerified` to `false`.
9. Clears `result.published` (sets to `null`).
10. Clears `result.persist` (sets to `null`).
11. Initializes `state._invalidations = []` if not present.
12. Appends an invalidation-history event for each affected durable key.
13. Does NOT demote a `DURABLY_VERIFIED` write (OBSERVE-01 — the write
    state stays `DURABLY_VERIFIED`, a `superseded` history event is
    appended instead).
14. Removes `ATTEMPTED` writes and appends a `removed` history event.
15. Removes `FAILED` writes and appends a `removed` history event.
16. Pure: no `safeAgent`/`flexibleAgent`/`async`/`Date.now`/`Math.random`
    (source assertion).
17. Handles empty/missing persistenceTracker (no throw, no events).
18. Handles state with no prior `_publishVerified`/`_persistVerified`
    (sets them to false anyway).
19. Each history event has shape `{sliceId, key, action}` (INVALIDATION_EVENT
    schema-conformant).

### GREEN tests — invalidateSliceChain

20. Resets `queueEntry.status` to `'pending'`.
21. Resets `queueEntry.artifacts` to `{}`.
22. Clears `queueEntry._gateCheckpoints` to `{}`.
23. Sets all 6 artifact-path guards to `null`: `factsPath`, `useCasePath`,
    `designPath`, `archPath`, `requirementsPath`, `auditPath`.
24. Clears `_facts` cache.
25. Calls `invalidatePersistenceEvidence` (source assertion — the call
    appears in the function body).
26. Calls `markStaleForSlice` (source assertion).
27. Sets `state.overviewPath` to `null`.
28. Clears `state._sourceDigest`.
29. Sets `state.extractReady` to `false`.

### GREEN tests — markStaleForSlice

30. Returns a new synthesis state object (does not mutate input).
31. Adds `sliceId` to `staleSlices` array.
32. Sets `staleViews` to all four view types.
33. Handles uninitialized synthesis state (returns a fresh state).
34. Pure: no agent/I/O calls (source assertion).

### GREEN tests — onSliceRemoved

35. Does NOT set `queueEntry.status` to `'pending'` (terminal, not
    re-extracted).
36. Calls `invalidatePersistenceEvidence` (source assertion).
37. Calls `applyLifecycleEvent` with `{type: 'exclude'}` (source assertion).
38. Does NOT clear artifact paths (history preserved — source assertion:
    the function body does not set artifact paths to null).
39. Coverage denominator drops: after `onSliceRemoved`, a call to
    `deriveCoverageIndex` with the excluded slice returns a denominator
    reduced by 1.
40. `result.published`/`result.persist` cleared (via
    `invalidatePersistenceEvidence`) — parent publish/persist will rerun.

### GREEN tests — crash-resume

41. After `invalidateSliceChain` + simulate crash-resume (re-read state):
    `result.published`/`result.persist` AND `_publishVerified`/
    `_persistVerified` all false/null → publish/persist gates do NOT skip
    on resume.
42. After `invalidateSliceChain` + simulate crash-resume: queue entry is
    `pending` with cleared artifacts → `extractSlice` re-runs all gates
    from the beginning.
43. After `onSliceRemoved` + simulate crash-resume: the removed slice
    remains `excluded` and is NOT re-extracted.

### GREEN tests — schema validation

44. `INVALIDATION_EVENT` schema has `additionalProperties: false`.
45. `INVALIDATION_EVENT` requires `sliceId`, `key`, `action`.
46. `INVALIDATION_EVENT.action` is an enum of `['versioned', 'removed', 'superseded']`.
47. `INVALIDATION_EVENT` is exported from schemas.

### GREEN tests — meta + cross-cutting

48. Meta phases include `'Invalidation'`.
49. All new pure functions exported from their respective modules
    (source assertion — export block includes them).
50. No `crypto`/`createHash` in any Phase 17 function (source assertion).
51. `_invalidations[]` accumulates across multiple invalidation calls
    (history is append-only).

## Test Specification (tests/invalidation-chain-nyquist.test.mjs)

Nyquist characterization tests filling sampling gaps:

### GAP-1: No-demote invariant (extensive)

1. A `DURABLY_VERIFIED` feature-shard write → `superseded` event, state
   remains `DURABLY_VERIFIED`.
2. A `DURABLY_VERIFIED` synthesis-view write → `superseded` event, state
   remains `DURABLY_VERIFIED`.
3. A `DURABLY_VERIFIED` project-index write → `superseded` event, state
   remains `DURABLY_VERIFIED`.
4. Multiple `DURABLY_VERIFIED` writes for the same slice → all superseded,
   none demoted.
5. A mixed set (1 verified + 1 attempted) → verified is superseded,
   attempted is removed.

### GAP-2: Gate-predicate reset coverage

6. `result.published` is an object `{published: true}` → cleared to `null`.
7. `result.published` is `null` already → stays `null` (idempotent).
8. `result.persist` is an object `{persisted: true}` → cleared to `null`.
9. `result.persist` is `null` already → stays `null` (idempotent).
10. `_publishVerified` is `true` → `false`.
11. `_publishVerified` is `undefined` → `false`.
12. `_persistVerified` is `true` → `false`.
13. `_persistVerified` is `undefined` → `false`.

### GAP-3: invalidateSliceChain completeness

14. All 6 artifact paths set to non-null values → all 6 cleared to `null`.
15. `artifacts` object with nested keys → reset to `{}`.
16. `_gateCheckpoints` with multiple gate entries → cleared to `{}`.
17. `_facts` cache with data → cleared.
18. Review flags set → cleared.
19. `extractReady` was `true` → set to `false`.

### GAP-4: onSliceRemoved vs invalidateSliceChain distinction

20. `onSliceRemoved` does not call `invalidateSliceChain` (source assertion).
21. `invalidateSliceChain` does not call `onSliceRemoved` (source assertion).
22. `onSliceRemoved` preserves artifact paths; `invalidateSliceChain` clears
    them (behavioral contrast).
23. `onSliceRemoved` sets lifecycle `excluded`; `invalidateSliceChain` sets
    queue `status` to `pending` (behavioral contrast).
24. Both call `invalidatePersistenceEvidence` (shared evidence primitive).

### GAP-5: markStaleForSlice edge cases

25. Called with `null` synthesisState → returns a fresh state with the
    slice marked stale.
26. Called with an already-stale synthesisState → appends to existing
    `staleSlices` (no duplication if same sliceId twice — idempotent or
    appended, documented).
27. Called with a synthesized state → marks all 4 view types stale.
28. Called with `synthesized: false` → returns state as-is (nothing to
    mark stale).

### GAP-6: History accumulation

29. Two invalidations of the same slice → `_invalidations` has 2+ entries
    (append-only, no dedup).
30. Invalidation of slice A then slice B → `_invalidations` has entries
    for both, in order.
31. History event shape validated against `INVALIDATION_EVENT` schema for
    every action type (`versioned`, `removed`, `superseded`).

### GAP-7: Source-assertion robustness

32. `invalidatePersistenceEvidence` source: no `return` before all
    predicate resets (all 4 resets — `_publishVerified`, `_persistVerified`,
    `published`, `persist` — appear in the function body).
33. `onSliceRemoved` source: `applyLifecycleEvent` call appears with
    `'exclude'` event type.
34. `invalidateSliceChain` source: `markStaleForSlice` call appears.
35. No `Math.random` or `Date.now` in any Phase 17 function (source
    assertion across all new functions).

## Success Criteria

1. Gates re-run after invalidation — `extractSlice` does not skip on
   cleared artifact-path guards (all 6 paths null + checkpoints cleared).
2. Publish/persist + handoff durability regenerated after update AND
   crash-resume — `result.published`/`result.persist` AND
   `_publishVerified`/`_persistVerified` all false/null → gates re-run.
3. Removed slice not re-extracted but parent views/coverage updated —
   lifecycle `excluded`, coverage denominator reduced, synthesis stale.
4. No-demote invariant intact — `DURABLY_VERIFIED` writes are superseded,
   never demoted to `ATTEMPTED`.
5. `_invalidations[]` history is append-only (audit trail).
6. Full test suite green (baseline + new D2.3 tests).
7. Build drift-free (`npm run validate:build`).
8. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| `invalidatePersistenceEvidence` accidentally demotes a verified write | OBSERVE-01 guard: check `DURABLY_VERIFIED` before any state change; append `superseded` event without touching the write state |
| `onSliceRemoved` accidentally re-extracts the removed slice | Terminal guard: do NOT set `status` to `pending`; do NOT clear artifact paths |
| `invalidateSliceChain` misses a guard, causing a gate to skip on resume | RED test #5 proves bare checkpoint clear is insufficient; GREEN tests enumerate all 6 artifact paths + 4 publish/persist guards |
| Dist drift after source edits | `npm run build` + `npm run validate:build` on every source change |
| Existing extract tests break | All new functions are additive — no existing function signatures change |
| `_invalidations[]` grows unbounded | Bounded by the number of durable keys per slice (feature shard + synthesis views + project-index entries); append-only audit trail |
| `markStaleForSlice` and `invalidateStaleViews` interact unexpectedly | `markStaleForSlice` is additive — it marks slices stale; `invalidateStaleViews` operates on revision deltas; both set `staleViews` which `synthesizeProjectViews` checks |

## Security Considerations

- No secrets in invalidation payloads (slice IDs + durable keys only).
- The `_invalidations[]` audit trail is tamper-evident: a missing event
  means the invalidation didn't happen; replaying an invalidation appends
  a new event (idempotent at the history level).
- No hashing in the engine — all SHA-256 computation is agent-mediated.
- No direct FS/shell access — all persistence is via `flushPipelineState`
  (agent-mediated).

## Scope Boundary (D2.3 ONLY)

This phase implements ONLY §D2.3 (invalidation chain incl. persistence-evidence
primitive + removal parent path). It does NOT implement:

- **D3** (upsert entrypoints — `--update`, `--no-update`, `--force`,
  `--feature`, `--new` CLI flags) — Phase 18
- **D4** (migration/adopt — `--adopt`) — Phase 18
- Integration of `invalidateSliceChain` into the extract-mode update flow —
  Phase 18 (this phase delivers the functions + tests; the update flow
  wires them after Phase 17 delivers the invalidation chain)
- Gate-level change-detection granularity — future milestone

---

*Phase 17: Invalidation Chain & Removal Path*
*Planned: 2026-07-24 — autonomous /gsd-plan-phase 17 --auto*
