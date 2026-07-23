# Phase 17: Invalidation Chain & Removal Path - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Source:** Autonomous extraction from plan §D2.3 + REQUIREMENTS (INVALIDATE-01, REMOVED-01)

<domain>
## Phase Boundary

Phase 17 implements the full invalidation chain (§D2.3) so that invalidating a
changed slice resets the whole extraction pipeline — durable queue, slice-local
artifact/review guards, persistence evidence (OBSERVE-01 no-demote), and parent
aggregates — and the removal parent path (`onSliceRemoved`) for slices emptied by
membership loss. Scope is D2.3 ONLY: no D3 upsert flags, no D4 migration.

Built on Phase 16 change-decision output, Phase 4/8 gate checkpoints, Phase 6
OBSERVE-01 observe-persist, and Phase 9 publish/persist verified booleans.

</domain>

<decisions>
## Implementation Decisions

### D2.3-core: invalidateSliceChain(state, sliceId)
- Resets the durable queue entry: `status='pending'`, `artifacts={}`, `_gateCheckpoints` cleared.
- Resets slice-local artifact-path guards: `factsPath`/`useCasePath`/`designPath`/`archPath`/`requirementsPath`/`auditPath` set to null + caches (`_facts`) cleared + review flags cleared + slice-local `_gateCheckpoints` cleared.
- Calls `invalidatePersistenceEvidence(state, sliceId)` (below).
- Marks parent aggregates stale: synthesis `markStaleForSlice(sliceId)`, `overviewPath` set to null (regenerate), `_sourceDigest` cleared, `extractReady=false`, status/handoff rebuilt.
- Durable — persists immediately via flushPipelineState.
- `--force` invalidates regardless of digest (caller decides; this function always invalidates).

### D2.3-core: invalidatePersistenceEvidence(state, sliceId) — NEW pure op
- BEFORE clearing artifact paths, enumerates affected durable keys: the slice's feature shard, synthesis views, project-index entries.
- For each key: version or remove the key + append an invalidation-history event to `_invalidations[]`.
- Respects OBSERVE-01 no-demote: supersede (version+history), never demote a durably-verified write back to attempted.
- Resets the live booleans `_publishVerified`/`_persistVerified` to false.
- Clears/versions the actual gate-predicate guards `result.published` and `result.persist` (the extract tail at main.mjs:1716/1722 skips publish/persist on these predicates, not just the booleans) — so republication/repersistence actually re-run.
- Pure function — no I/O, no agent calls; operates on the state object passed in.

### D2.3-core: onSliceRemoved(state, sliceId) — removal parent path
- DISTINCT from invalidateSliceChain (which handles changed slices that still own files).
- For a `removed` slice (emptied by membership loss): supersede its feature/index/synthesis evidence, mark lifecycle `excluded`, drop from coverage denominator, rerun parent publish/persist + handoff.
- Slice-local history preserved (artifacts retained as history, NOT re-extracted).
- Lifecycle set to `excluded` via the existing `applyLifecycleEvent` from lifecycle.mjs.

### D2.3-core: markStaleForSlice(sliceId) — synthesis stale-marking
- New function in synthesis.mjs: marks synthesis views stale for a specific slice so the next synthesis call rebuilds affected views.
- Complements the existing `invalidateStaleViews` (which operates on revision deltas) with a slice-targeted variant.

### Test strategy
- After update AND crash-resume: gates re-run; `result.published`/`result.persist` AND `_publishVerified`/`_persistVerified` all false → publish/persist + handoff durability regenerated; no-demote invariant intact; removal → parent views/index/coverage updated + parent publish/persist rerun, removed slice not re-extracted; `extractReady=false` until complete.
- Slice-level first (YAGNI) — no gate-level granularity.

### Claude's Discretion
- Exact internal representation of `_invalidations[]` history events (shape, fields).
- Whether `onSliceRemoved` calls `invalidatePersistenceEvidence` internally or duplicates the supersede logic (design: it should call it — DRY).
- Exact function signatures for helper internals (as long as the public API matches §D2.3).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.3 (lines 73-82) — the spec for invalidateSliceChain, invalidatePersistenceEvidence, onSliceRemoved
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.1 (lines 55-65) — removed-slice state machine (removed=terminal, parent invalidation trigger)

### Requirements
- `.planning/REQUIREMENTS.md` INVALIDATE-01, REMOVED-01

### Prior-phase plans (patterns to follow)
- `.planning/phases/16-change-detection/PLAN.md` — Phase 16 PLAN.md is the structural template: RED Gate / GREEN Evidence / Implementation Steps / Files to Modify / Test Specification / Success Criteria. Phase 17 should mirror this structure exactly.
- `.planning/phases/06-synthesis-publish-persist-and-status-truth/` — OBSERVE-01 observe-persist primitive (no-demote)
- `.planning/phases/08-design-mode-durable-checkpoints-and-revision-aware-resume/` — checkpointSlice pattern (per-gate durable checkpoint)

### Source files to modify (integration points discovered)
- `plugins/feature-workflows/workflows/src/observe-persist.mjs` — add `invalidatePersistenceEvidence`. Existing: `recordAttemptedWrite`, `verifyDurableWrite`, `failWrite`, `isRetrySafe`, `isDurablyVerified`, `persistenceReport`. PERSISTENCE_STATES.DURABLY_VERIFIED is the no-demote guard.
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — add `invalidateSliceChain`. Existing: `checkpointSlice` (lines 16-40) with `_gateCheckpoints` + artifactKey map. The 6 artifact keys: factsPath, useCasePath, designPath, archPath, requirementsPath, auditPath.
- `plugins/feature-workflows/workflows/src/synthesis.mjs` — add `markStaleForSlice`. Existing: `invalidateStaleViews` (revision-delta based), `synthesizeProjectViews`, `deriveCoverageIndex` (lifecycle-counted denominator: `summaries.length - counts.excluded`).
- `plugins/feature-workflows/workflows/src/main.mjs` — add `onSliceRemoved`. Existing publish/persist gates at lines 1716/1722: `if (usePublish && !result.published)` / `if (useKnowledgePersist && !result.persist)`. The `_publishVerified`/`_persistVerified` booleans set at lines 2890/2898.
- `plugins/feature-workflows/workflows/src/schemas.mjs` — add invalidation-history event schema.
- `plugins/feature-workflows/workflows/src/lifecycle.mjs` — existing `applyLifecycleEvent`, `LIFECYCLE_STATES` (excluded state).
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — add 'Invalidation' phase title.
- `tests/harness.mjs` — add new function names to CANDIDATES.
- `plugins/feature-workflows/workflows/feature-pipeline.js` — generated dist (rebuild).
- `plugins/feature-workflows/workflows/fp-extract-slice.js` — generated dist (rebuild).

### Project conventions
- `mem:conventions` — code style (ES module validate, kebab-case files, sub-200-line modules, no direct FS/shell in engine)
- `mem:task_completion` — definition of done (tests pass, build drift-free, ESM valid)

</canonical_refs>

<specifics>
## Specific Ideas

- The gate-predicate guards `result.published` and `result.persist` are the ACTUAL skip conditions at main.mjs:1716 and 1722. Clearing only `_publishVerified`/`_persistVerified` without clearing these predicates means the gates still skip on resume. This was review5 P1.1 / review1 P1.4.
- `onSliceRemoved` must NOT re-extract the removed slice — it is terminal. It only triggers parent-level invalidation (supersede evidence, update coverage, rerun parent publish/persist).
- `_invalidations[]` is a new history array on the result object — each event records what was invalidated, when, and why (supersede, not demote).
- `markStaleForSlice` in synthesis.mjs should set a per-slice stale flag that `synthesizeProjectViews` checks, causing affected views to rebuild on the next synthesis pass.
- Coverage denominator: `deriveCoverageIndex` already subtracts `excluded` from the denominator. Marking a removed slice `excluded` automatically drops it from coverage.

</specifics>

<deferred>
## Deferred Ideas

- D3 upsert entrypoints (`--update`, `--no-update`, `--force`, `--feature`, `--new`) — Phase 18
- D4 migration/adopt (`--adopt`) — Phase 18
- Gate-level change-detection granularity (only re-run gates whose inputs changed) — future milestone
- Integration of invalidateSliceChain into the extract-mode update flow wiring — Phase 18 (this phase delivers the functions + tests; the update flow calls them after Phase 17)

</deferred>

---

*Phase: 17-invalidation-chain-removal-path*
*Context gathered: 2026-07-24 via autonomous §D2.3 extraction (--auto mode)*
