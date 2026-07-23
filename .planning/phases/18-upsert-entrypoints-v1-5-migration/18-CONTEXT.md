# Phase 18: Upsert Entrypoints & v1.5 Migration - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Source:** Autonomous extraction from plan §D3 + §D4 + REQUIREMENTS (UPSERT-01, MIGRATE-01)

<domain>
## Phase Boundary

Phase 18 wires the CLI upsert flags (§D3) and the v1.5 migration/adopt flow
(§D4) into the extract pipeline. This is the INTEGRATION phase: it imports
Phase 15-17 pure functions (reconcileSlices, detectSliceChanges,
runChangeDetection, invalidateSliceChain) into main.mjs and routes the
extract-mode flow through the update path (auto-update default). It also
delivers the migration scan + adopt entrypoint so existing v1.5 folders
converge with the new registry-based lookup.

Built on Phase 12 promotion/locator, Phase 13 identity/hashing, Phase 14
registry/lookup, Phase 15 ownership reconciliation, Phase 16 change detection,
Phase 17 invalidation chain. No Phase 19 (proof) in scope.

</domain>

<decisions>
## Implementation Decisions

### D3-core: resolveUpsertMode(args, findResult) — NEW pure function
- Resolves the update behavior from CLI flags + registry lookup result.
- Returns `{ mode: 'auto-update'|'continue-incomplete'|'force'|'new'|'feature' , featureId, force, blocking }`.
- Decision ladder:
  1. `--new` + `--feature` → error (mutually exclusive).
  2. `--new` → mode `'new'` (fork: append `-<n>` disambiguator).
  3. `--feature=<id>` → mode `'feature'` (select specific existing feature).
  4. `--force` → mode `'force'` (invalidate regardless of digest).
  5. `--no-update` → mode `'continue-incomplete'` (legacy `--resume` behavior).
  6. `--update` → mode `'auto-update'` (same as default but explicit).
  7. Default (no flag) when `findResult.decision === 'reuse'` → mode `'auto-update'`.
  8. Default when `findResult.decision === 'new'` → mode `'new'` (first extraction).
- PURE: no I/O, no agent calls, no async.

### D3-core: deriveForkedFeatureId(baseFeatureId, registry) — NEW pure function
- For `--new`: appends `-<n>` where `<n>` is the next integer for that base id.
- Scans registry for existing `<baseFeatureId>-<n>` entries, picks next available.
- Returns `{ featureId, n }`.
- PURE: operates on registry object only.

### D3-core: wireUpdateFlow — main.mjs integration
- After registry lookup yields `reuse`, instead of just overriding `planDir`,
  the flow runs:
  1. Load persisted pipeline-state for the existing feature.
  2. Run `resolveScopePreflight` for the current source state (new hashes).
  3. `reconcileSlices(persistedSlices, currentFiles)` — D2.1 pure partition.
  4. `runChangeDetection({ reconciledSlices, fileHashes, force, result })` — D2.2.
  5. For each changed slice: `invalidateSliceChain(state, sliceId, queueEntry)` — D2.3.
  6. For each removed slice: `onSliceRemoved(state, sliceId, queueEntry)` — D2.3.
  7. Continue extraction (gates re-run for invalidated slices; unchanged skip).
- When `--no-update`: skip steps 2-6, load existing state, continue-incomplete.
- When `--force`: step 4 passes `force=true` → all slices invalidated.

### D4-core: scanForLegacyFolders({ docsRoot, result }) — NEW agent-mediated
- Scans `docs/extract/` for folders qualifying as v1.5 extraction roots.
- Root qualification (PURE predicate `isLegacyRoot`):
  - Contains `pipeline-state.json` OR `plan.md`.
  - Path does NOT contain `/slices/`.
  - Path does NOT contain `/.pending/`.
  - Path is not the registry file (`.registry.json`).
  - Path is not an identity sidecar (`.identity.json`).
- Returns roots in deterministic sorted order.
- Agent-mediated: uses file-reader agent to list + check for marker files.
- Multi-slice fixture: a parent folder with `slices/<id>/` subfolders qualifies
  only the parent root (the children are excluded by the `/slices/` rule).

### D4-core: adoptLegacyFolder({ planDir, result, config, timestamp }) — NEW
- Validates `planDir` is a root (calls `isLegacyRoot`).
- Reads the folder's persisted scope (`scope-manifest.md` or slice file lists).
- Calls `hashSources` to compute per-file `contentSha256` + `scopeDigest`.
- Calls `deriveFeatureFolder` to derive the deterministic identity.
- Writes `.identity.json` via `writeIdentity`.
- Upserts registry entry via `upsertRegistryEntry` + `writeRegistry` root-last.
- Temp-then-rename for atomicity; rollback on any failure.
- Idempotent: if folder already has `.identity.json` + matching registry entry,
  returns `{ adopted: false, reason: 'already-adopted' }` (no-op).
- Collision handling: if derived `featureId` collides with different ownership
  digest → disambiguate via `deriveForkedFeatureId`.

### D4-core: auto-scan trigger — main.mjs integration
- On the first run after upgrade (detected: registry has zero entries AND
  `docs/extract/` exists), auto-scan for legacy folders.
- If roots found: prompt per root (scope-confirm-style — return handoff with
  `awaiting-adopt-confirm` status, one root at a time in sorted order).
- `--adopt <planDir>` bypasses the scan and directly adopts the specified root.

### Claude's Discretion
- Exact internal representation of the adopt-confirm handoff shape.
- Whether `resolveUpsertMode` lives in extract-scope.mjs or a new module.
- Exact structure of the auto-scan prompt (as long as it's scope-confirm-style).
- Whether the update flow is a single function or inline in main.mjs (design:
  inline is simpler — the flow is tightly coupled to the extract pipeline state).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D3 (lines 81-87) —
  explicit upsert + adopt entrypoints
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D4 (lines 89-99) —
  migration of existing v1.5 docsets
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §Tests (D3/D4 line) —
  test specification
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §Review4 P1.7 —
  migration resolves upgrade duplicates
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §Review5 P1.5 —
  root qualification (exclude `/slices/`, `.pending`, registry)
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §Review5 P2.8 —
  `--new` appends `-<n>` disambiguator
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §Decisions Q1, Q4 —
  auto-scan+offer, auto-update default

### Requirements
- `.planning/REQUIREMENTS.md` UPSERT-01, MIGRATE-01

### Prior-phase plans (patterns to follow)
- `.planning/phases/17-invalidation-chain-removal-path/17-PLAN.md` — structural
  template: RED Gate / GREEN Evidence / Implementation Steps / Test Spec
- `.planning/phases/16-change-detection/PLAN.md` — D2.2 change detection
  (runChangeDetection — called by the update flow)
- `.planning/phases/15-slice-ownership-reconciliation/PLAN.md` — D2.1
  reconcileSlices (called by the update flow)

### Source files to modify (integration points discovered)
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — add
  `resolveUpsertMode`, `deriveForkedFeatureId`, `isLegacyRoot`,
  `scanForLegacyFolders`, `adoptLegacyFolder`. Existing exports (lines 1572):
  all Phase 12-16 functions already exported.
- `plugins/feature-workflows/workflows/src/main.mjs` — wire update flow after
  registry lookup (around line 1295 `findResult.decision === 'reuse'`); wire
  auto-scan at startup (after Registry Recovery, around line 1165); wire
  `--adopt` path. Import `reconcileSlices`, `runChangeDetection`,
  `invalidateSliceChain`, `markStaleForSlice` from their modules (NOT currently
  imported in main.mjs — only `onSliceRemoved` is defined inline at line 3664).
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — export
  `invalidateSliceChain` (already exported at line 335).
- `plugins/feature-workflows/workflows/src/synthesis.mjs` — export
  `markStaleForSlice` (already exported at line 268).
- `plugins/feature-workflows/workflows/src/schemas.mjs` — add
  `UPSERT_MODE_VERDICT`, `ADOPT_RESULT` schemas.
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` —
  add `'Upsert'`, `'Adopt'`, `'Migrate'` phase titles.
- `plugins/feature-workflows/commands/extract-design.md` — add `--update`,
  `--no-update`, `--force`, `--feature=<featureId>`, `--new`, `--adopt <planDir>`
  flag docs.
- `tests/harness.mjs` — add new function names to CANDIDATES.
- `plugins/feature-workflows/workflows/feature-pipeline.js` — generated dist.
- `plugins/feature-workflows/workflows/fp-extract-slice.js` — generated dist.

### Project conventions
- `mem:conventions` — code style (ES module validate, kebab-case files,
  sub-200-line modules, no direct FS/shell in engine)
- `mem:task_completion` — definition of done (tests pass, build drift-free)

</canonical_refs>

<specifics>
## Specific Ideas

- The auto-update default is the BIGGEST behavioral change: a bare re-run of
  `/extract-design <scope>` on an existing feature now triggers change detection
  + invalidation + re-extraction INSTEAD of blocking or silently skipping. This
  is by design (plan §D3, decision Q4) — "re-run = refresh".
- `--new` is the ONLY way to create a second folder for the same scope. It
  appends `-<n>` (e.g. `auth-flow-a1b2-3`) and registers a separate feature.
  The collision guard treats it as a different ownership identity.
- `--feature=<featureId>` bypasses ambiguous/weak match blocking — it directly
  selects the specified feature for update.
- Migration auto-scan runs ONLY when the registry is empty (first post-upgrade
  run). Once any feature is registered, the scan is skipped.
- Adoption is idempotent: re-adopting an already-adopted folder is a no-op
  (detected via existing `.identity.json` + matching registry entry).
- Old `--resume <planDir>` still works after adoption — the old resume path
  and the new registry lookup converge on the same folder.
- The update flow wires Phase 15-17 functions for the first time: before Phase
  18, `reconcileSlices`, `runChangeDetection`, and `invalidateSliceChain` were
  delivered as pure functions with tests but NOT called from the pipeline.

</specifics>

<deferred>
## Deferred Ideas

- Phase 19 (Compatibility & Proof) — E2E characterization tests for the full
  upsert + adopt + update flow across all v1.6.0 scenarios.
- Gate-level change-detection granularity — future milestone.
- Concurrent same-feature invocation safety — explicitly unsupported.

</deferred>

---

*Phase: 18-upsert-entrypoints-v1-5-migration*
*Context gathered: 2026-07-24 via autonomous §D3+§D4 extraction (--auto mode)*
