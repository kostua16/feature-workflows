---
phase: 18
name: Upsert Entrypoints & v1.5 Migration
requirements: [UPSERT-01, MIGRATE-01]
depends_on: [17]
wave: 1
files_modified:
  - plugins/feature-workflows/workflows/src/extract-scope.mjs
  - plugins/feature-workflows/workflows/src/main.mjs
  - plugins/feature-workflows/workflows/src/schemas.mjs
  - plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs
  - plugins/feature-workflows/commands/extract-design.md
  - tests/harness.mjs
  - plugins/feature-workflows/workflows/feature-pipeline.js
  - plugins/feature-workflows/workflows/fp-extract-slice.js
files_created:
  - tests/upsert-entrypoints.test.mjs
  - tests/v15-migration.test.mjs
autonomous: true
---

# Phase 18: Upsert Entrypoints & v1.5 Migration

**Status:** Planned
**Date:** 2026-07-24
**Requirements:** UPSERT-01, MIGRATE-01
**Depends on:** Phase 17 (D2.3 invalidation chain)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D3 + §D4

## RED Gate (must fail before implementation)

1. `resolveUpsertMode`, `deriveForkedFeatureId`, `isLegacyRoot`,
   `scanForLegacyFolders`, and `adoptLegacyFolder` do NOT exist — calling any
   of them throws ReferenceError.
2. A bare re-run of an existing folder must NOT refresh — without the update
   flow wired in, the registry lookup returns `reuse` and overrides `planDir`
   but does NOT trigger change detection or invalidation. The existing flow
   proceeds directly to scope-confirmation or extraction-skip, never running
   `reconcileSlices` / `runChangeDetection` / `invalidateSliceChain`.
3. `--new` must NOT derive the same `featureId` — without
   `deriveForkedFeatureId`, a `--new` run produces the same deterministic id
   and overwrites/aliases the existing feature.
4. `--new` + `--feature` must NOT both be accepted — without
   `resolveUpsertMode`, no mutual-exclusion check exists.
5. Migration must NOT register slice children — without `isLegacyRoot`
   qualifying roots, a scan of `docs/extract/` matches every `slices/<id>/`
   subfolder as a candidate.
6. Adoption must NOT be non-idempotent — without the idempotence check,
   re-adopting an already-adopted folder writes a duplicate registry entry.
7. `reconcileSlices`, `runChangeDetection`, `invalidateSliceChain`, and
   `markStaleForSlice` are NOT imported in main.mjs (source assertion — the
   import line at the top of main.mjs does NOT include them before Phase 18).

## GREEN Evidence (must pass after implementation)

### resolveUpsertMode(args, findResult)

1. PURE function — no agent calls, no I/O, no `async`, no `Date.now`,
   no `Math.random`.
2. `--new` + `--feature` present simultaneously → returns
   `{ mode: 'error', reason: 'mutually-exclusive' }`.
3. `--new` present → returns `{ mode: 'new' }` regardless of findResult.
4. `--feature=<id>` present → returns `{ mode: 'feature', featureId: <id> }`.
5. `--force` present → returns `{ mode: 'force' }`.
6. `--no-update` present → returns `{ mode: 'continue-incomplete' }`.
7. `--update` present and findResult.decision is `'reuse'` → returns
   `{ mode: 'auto-update' }`.
8. No flags, findResult.decision is `'reuse'` → returns
   `{ mode: 'auto-update' }` (DEFAULT).
9. No flags, findResult.decision is `'new'` → returns
   `{ mode: 'new' }` (first extraction).
10. No flags, findResult.decision is `'blocked'` → returns
    `{ mode: 'blocked', reason: findResult.reason }`.

### deriveForkedFeatureId(baseFeatureId, registry)

11. PURE function — no I/O, no agent calls.
12. Scans registry for existing `<baseFeatureId>-<n>` entries.
13. Returns the next available `n` (starts at 2 if base exists, increments).
14. Returns `{ featureId: '<baseFeatureId>-<n>', n: <n> }`.
15. If no fork exists yet, returns `{ featureId: '<baseFeatureId>-2', n: 2 }`.
16. If `<base>-2` and `<base>-3` exist, returns `{ featureId: '<base>-4', n: 4 }`.

### isLegacyRoot(folderPath, markerFiles)

17. PURE function — operates on strings only.
18. Returns `true` if `markerFiles` includes `pipeline-state.json` OR `plan.md`.
19. Returns `false` if `folderPath` contains `/slices/`.
20. Returns `false` if `folderPath` contains `/.pending/`.
21. Returns `false` if `folderPath` ends with `.registry.json`.
22. Returns `false` if `folderPath` ends with `.identity.json`.
23. Returns `false` if no marker file is present.

### scanForLegacyFolders({ docsRoot, result })

24. Returns a list of root folder paths in deterministic sorted order.
25. Multi-slice fixture: a parent with `slices/<id>/` subfolders yields ONLY
    the parent root (children excluded by `/slices/` rule).
26. Excludes `.pending/` directories.
27. Excludes the registry file.
28. Excludes identity sidecars.
29. Empty docs root → returns `{ roots: [] }`.

### adoptLegacyFolder({ planDir, result, config, timestamp })

30. Validates `planDir` is a root (calls `isLegacyRoot` internally).
31. Non-root path → returns `{ adopted: false, reason: 'not-a-root' }`.
32. Reads the folder's persisted scope via agent (scope-manifest.md or
    pipeline-state.json file lists).
33. Calls `hashSources` to compute per-file `contentSha256` + `scopeDigest`.
34. Calls `deriveFeatureFolder` to derive the deterministic identity.
35. Idempotent: if `.identity.json` already exists AND registry has matching
    entry → returns `{ adopted: false, reason: 'already-adopted' }` (no-op).
36. Writes `.identity.json` via `writeIdentity`.
37. Upserts registry entry via `upsertRegistryEntry` + `writeRegistry` root-last.
38. Temp-then-rename for atomicity (agent-mediated file writes).
39. On any failure: rollback (delete partial `.identity.json` if written,
    do NOT update registry).
40. Collision: derived `featureId` matches existing different-digest entry →
    calls `deriveForkedFeatureId` → writes with forked id.
41. Returns `{ adopted: true, featureId, planDir }`.

### Update flow wiring (main.mjs)

42. `reconcileSlices`, `runChangeDetection`, `invalidateSliceChain`,
    `markStaleForSlice` are imported from their respective modules (source
    assertion — import line includes them).
43. When `resolveUpsertMode` returns `'auto-update'` or `'force'`:
    a. Load persisted pipeline-state for the existing feature.
    b. Run `reconcileSlices(persistedSlices, currentFiles)`.
    c. Run `runChangeDetection({ reconciledSlices, fileHashes, force, result })`.
    d. For each changed slice: call `invalidateSliceChain`.
    e. For each removed slice: call `onSliceRemoved`.
    f. Continue extraction (invalidated slices re-extract; unchanged skip).
44. When `resolveUpsertMode` returns `'continue-incomplete'`: skip steps b-e,
    load existing state, continue extraction from where it left off.
45. When `resolveUpsertMode` returns `'new'`: proceed with new-folder flow
    (apply `deriveForkedFeatureId` if base exists).
46. When `resolveUpsertMode` returns `'feature'`: override `findResult` to
    force-select the specified feature, then proceed to auto-update.
47. When `resolveUpsertMode` returns `'error'`: block with handoff message
    about mutual exclusion.
48. When `resolveUpsertMode` returns `'blocked'`: block with handoff message
    from findResult (ambiguous/weak match).

### Auto-scan trigger (main.mjs)

49. Auto-scan runs ONLY when registry has zero entries AND `docs/extract/`
    exists (first post-upgrade run).
50. Calls `scanForLegacyFolders`.
51. If roots found: returns handoff with `awaiting-adopt-confirm` status,
    offering roots one at a time in sorted order (scope-confirm-style).
52. After adoption or dismissal, the normal extract flow proceeds.

### `--adopt` path (main.mjs)

53. `--adopt <planDir>` calls `adoptLegacyFolder` directly.
54. After adoption, the normal extract flow proceeds (lookup now finds the
    adopted feature → auto-update or first-extraction as appropriate).

### Meta + cross-cutting

55. Meta phases include `'Upsert'`, `'Adopt'`, `'Migrate'`.
56. All new pure functions have no `safeAgent`/`flexibleAgent`/`async` calls
    (source assertion for pure functions only).
57. All new functions are exported from their respective modules.
58. `UPSERT_MODE_VERDICT` schema has `additionalProperties: false`.
59. `ADOPT_RESULT` schema has `additionalProperties: false`.
60. Both schemas exported from schemas.mjs.

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**UPSERT_MODE_VERDICT** — the shape of `resolveUpsertMode` return:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: {
      type: 'string',
      enum: ['auto-update', 'continue-incomplete', 'force', 'new', 'feature', 'blocked', 'error'],
      description: 'Resolved update behavior for an existing feature',
    },
    featureId: { type: 'string', description: 'Selected feature id (mode=feature)' },
    reason: { type: 'string', description: 'Block/error reason' },
  },
}
```

**ADOPT_RESULT** — the shape of `adoptLegacyFolder` return:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['adopted'],
  properties: {
    adopted: { type: 'boolean', description: 'Whether adoption occurred' },
    featureId: { type: 'string', description: 'Derived or forked feature id' },
    planDir: { type: 'string', description: 'Adopted folder path' },
    reason: {
      type: 'string',
      enum: ['already-adopted', 'not-a-root', 'collision-forked', 'success'],
      description: 'Why adoption did or did not occur',
    },
  },
}
```

Export both in the schema export block.

### Step 2: resolveUpsertMode (`extract-scope.mjs`)

Add `resolveUpsertMode(args, findResult)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — no agent calls, no I/O, no async.

Algorithm:
1. Check mutual exclusion: if both `args.newFolder` and `args.feature` are
   truthy → return `{ mode: 'error', reason: 'mutually-exclusive' }`.
2. If `args.newFolder` → return `{ mode: 'new' }`.
3. If `args.feature` → return `{ mode: 'feature', featureId: args.feature }`.
4. If `args.force` → return `{ mode: 'force' }`.
5. If `args.noUpdate` → return `{ mode: 'continue-incomplete' }`.
6. If `findResult.decision === 'reuse'` → return `{ mode: 'auto-update' }`
   (whether or not `args.update` is set — auto-update is the default).
7. If `findResult.decision === 'new'` → return `{ mode: 'new' }`.
8. If `findResult.decision === 'blocked'` → return
   `{ mode: 'blocked', reason: findResult.reason || 'ambiguous' }`.
9. Fallback → return `{ mode: 'new' }`.

### Step 3: deriveForkedFeatureId (`extract-scope.mjs`)

Add `deriveForkedFeatureId(baseFeatureId, registry)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — operates on registry object only.

```js
function deriveForkedFeatureId(baseFeatureId, registry) {
  var features = (registry && registry.features) || {}
  var n = 2
  var key = baseFeatureId + '-' + n
  while (features[key]) {
    n++
    key = baseFeatureId + '-' + n
  }
  return { featureId: key, n: n }
}
```

### Step 4: isLegacyRoot (`extract-scope.mjs`)

Add `isLegacyRoot(folderPath, markerFiles)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — operates on strings only.

```js
function isLegacyRoot(folderPath, markerFiles) {
  if (!folderPath || !Array.isArray(markerFiles)) return false
  // Exclude slice children, pending dirs, registry, sidecars
  if (folderPath.indexOf('/slices/') !== -1) return false
  if (folderPath.indexOf('/.pending/') !== -1) return false
  if (folderPath.endsWith('.registry.json')) return false
  if (folderPath.endsWith('.identity.json')) return false
  // Must contain a root marker
  return markerFiles.indexOf('pipeline-state.json') !== -1
    || markerFiles.indexOf('plan.md') !== -1
}
```

### Step 5: scanForLegacyFolders (`extract-scope.mjs`)

Add `scanForLegacyFolders({ docsRoot, result })` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

Agent-mediated: uses a file-reader agent to recursively list
`docs/extract/` and check each folder for marker files.

Algorithm:
1. Agent lists `docsRoot` recursively (depth-limited to avoid huge trees).
2. For each folder path, collect the set of files directly in it.
3. Apply `isLegacyRoot` to determine qualification.
4. Sort qualified roots lexicographically.
5. Return `{ roots: [...sortedPaths...] }`.

### Step 6: adoptLegacyFolder (`extract-scope.mjs`)

Add `adoptLegacyFolder({ planDir, result, config, timestamp })` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

Agent-mediated (reads/writes via agents).

Algorithm:
1. Read the folder's file list via agent (check for marker files → validate root).
2. If not a root → return `{ adopted: false, reason: 'not-a-root' }`.
3. Check idempotence: read `.identity.json` if it exists.
   If identity exists AND registry has matching entry with same digest →
   return `{ adopted: false, reason: 'already-adopted' }`.
4. Read the folder's persisted scope (scope-manifest.md or pipeline-state.json).
5. Call `hashSources` to compute per-file hashes + scope digest.
6. Call `deriveFeatureFolder` to get the deterministic `featureId` + `planDir`.
7. Collision check: if registry has the `featureId` with a different
   `ownershipScopeDigest` → call `deriveForkedFeatureId`.
8. Write `.identity.json` via `writeIdentity` (temp-then-rename).
9. Upsert registry entry via `upsertRegistryEntry`.
10. Write registry via `writeRegistry` root-last (temp-then-rename).
11. On any failure: rollback (delete partial writes, do not commit registry).
12. Return `{ adopted: true, featureId, planDir }`.

### Step 7: Update flow wiring (`main.mjs`)

In `plugins/feature-workflows/workflows/src/main.mjs`:

**7a. Add imports** at the top:
```js
import { ..., reconcileSlices, runChangeDetection, ... } from './extract-scope.mjs'
import { ..., invalidateSliceChain, ... } from './extract-slice.mjs'
import { ..., markStaleForSlice, ... } from './synthesis.mjs'
```
Also import the new functions: `resolveUpsertMode`, `deriveForkedFeatureId`,
`isLegacyRoot`, `scanForLegacyFolders`, `adoptLegacyFolder`.

**7b. Modify the registry lookup block** (around line 1295):
After `findFeature` returns, call `resolveUpsertMode(args, findResult)`:

- If mode is `'error'`: block with mutual-exclusion handoff.
- If mode is `'blocked'`: block with ambiguity handoff (same as current).
- If mode is `'new'` with `findResult.decision === 'reuse'` (i.e. `--new`
  on an existing feature): call `deriveForkedFeatureId`, update `featureId`
  and `planDir` to the forked folder, proceed with new-folder flow.
- If mode is `'feature'`: override `findResult` to force-select the
  specified feature (validate it exists in registry), then fall through
  to auto-update.
- If mode is `'auto-update'` or `'force'`:
  1. Set `planDir` to the reused feature's folder.
  2. Load persisted `pipeline-state.json` via `loadPipelineStateWithRecovery`.
  3. Run `reconcileSlices(persistedState.slices, preflight.fileHashes)`.
  4. Run `runChangeDetection({ reconciledSlices, fileHashes: preflight.fileHashes, force: mode === 'force', result })`.
  5. For each slice with `status === 'changed'` and not `'slice-removed'`:
     call `invalidateSliceChain(state, sliceId, queueEntry)`.
  6. For each slice with `status === 'slice-removed'`:
     call `onSliceRemoved(state, sliceId, queueEntry)`.
  7. Set `result.scopeManifestPath` (already exists from prior extraction).
  8. Set `result.scopeConfirmed = true` (scope is already confirmed for updates).
  9. Continue to the extraction loop — invalidated slices re-extract;
     unchanged slices skip via checkpoint guards.
- If mode is `'continue-incomplete'`:
  Set `planDir` to the reused feature's folder, load existing state,
  proceed with extraction (no change detection, no invalidation).

### Step 8: Auto-scan trigger (`main.mjs`)

After the Registry Recovery block (around line 1165), before the
`--confirm` promotion block:

```js
// Auto-scan for legacy v1.5 folders on first post-upgrade run.
// Fires ONLY when registry is empty AND docs/extract/ exists.
phase('Migrate')
var registryForScan = await readRegistry(REGISTRY_PATH, result)
var hasRegisteredFeatures = registryForScan
  && registryForScan.features
  && Object.keys(registryForScan.features).length > 0
if (!hasRegisteredFeatures && args && args.adoptPlanDir) {
  // --adopt <planDir> — manual adoption path
  phase('Adopt')
  var adoptResult = await adoptLegacyFolder({
    planDir: args.adoptPlanDir, result, config,
    timestamp: args && args.timestamp,
  })
  if (adoptResult && adoptResult.adopted) {
    plog('Adopted legacy folder: ' + adoptResult.planDir + ' -> ' + adoptResult.featureId)
  }
  stateCheckpoint('Adopt', 'done')
}
if (!hasRegisteredFeatures && !args.adoptPlanDir) {
  // Auto-scan for legacy roots
  var scanResult = await scanForLegacyFolders({
    docsRoot: 'docs/extract/', result,
  })
  if (scanResult && scanResult.roots && scanResult.roots.length > 0) {
    // Offer first root (scope-confirm-style)
    result.handoff = {
      from: 'extract',
      status: 'awaiting-adopt-confirm',
      message: 'Found ' + scanResult.roots.length + ' legacy extraction folder(s). '
        + 'Adopt: /extract-design --adopt ' + scanResult.roots[0],
      nextMode: 'extract',
      legacyRoots: scanResult.roots,
    }
    stateCheckpoint('Migrate', 'awaiting-adopt')
    await consolidate(slug, result, config)
    return result
  }
}
stateCheckpoint('Migrate', 'done')
```

### Step 9: Meta phase declarations

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase titles: `{ title: 'Upsert' }`, `{ title: 'Adopt' }`,
`{ title: 'Migrate' }`.

### Step 10: Command documentation (`extract-design.md`)

Add to the argument-hint and document the new flags:
- `--update` — explicit update trigger (default behavior, useful in scripts).
- `--no-update` — opt out of auto-update, continue-incomplete only.
- `--force` — re-extract all slices regardless of digest changes.
- `--feature=<featureId>` — select a specific existing feature (disambiguate).
- `--new` — create a distinct forked folder (mutually exclusive with `--feature`).
- `--adopt <planDir>` — adopt a legacy v1.5 folder into the registry.

Add a section documenting the auto-update default behavior and migration flow.

### Step 11: Harness candidate registration

In `tests/harness.mjs`, add to `CANDIDATES`:
```
'resolveUpsertMode',
'deriveForkedFeatureId',
'isLegacyRoot',
'UPSERT_MODE_VERDICT',
'ADOPT_RESULT',
```
(`scanForLegacyFolders` and `adoptLegacyFolder` are agent-mediated — tested
via integration tests, not the pure-function harness.)

### Step 12: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add UPSERT_MODE_VERDICT, ADOPT_RESULT; export them |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add resolveUpsertMode, deriveForkedFeatureId, isLegacyRoot, scanForLegacyFolders, adoptLegacyFolder; add to exports |
| `plugins/feature-workflows/workflows/src/main.mjs` | Import reconcileSlices/runChangeDetection/invalidateSliceChain/markStaleForSlice + new functions; wire update flow after registry lookup; wire auto-scan + --adopt |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Upsert', 'Adopt', 'Migrate' phases |
| `plugins/feature-workflows/commands/extract-design.md` | Document --update/--no-update/--force/--feature/--new/--adopt flags + auto-update default + migration flow |
| `tests/harness.mjs` | Add new function names to CANDIDATES |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/upsert-entrypoints.test.mjs` | D3 behavioral tests (resolveUpsertMode, deriveForkedFeatureId, update flow source assertions) |
| `tests/v15-migration.test.mjs` | D4 behavioral tests (isLegacyRoot, idempotent adoption, multi-slice root qualification, rollback) |

## Test Specification (tests/upsert-entrypoints.test.mjs)

### RED tests (must fail before implementation)

1. `resolveUpsertMode` is not defined — calling it throws ReferenceError.
2. `deriveForkedFeatureId` is not defined — calling it throws ReferenceError.
3. Source assertion: `reconcileSlices` is NOT in the import line of main.mjs
   (grep for `reconcileSlices` in the import from extract-scope.mjs → absent).
4. Source assertion: `runChangeDetection` is NOT in the import line of main.mjs.
5. Source assertion: `invalidateSliceChain` is NOT in the import line of
   main.mjs (from extract-slice.mjs).
6. Source assertion: the registry lookup block in main.mjs does NOT call
   `resolveUpsertMode` (grep → absent before implementation).

### GREEN tests — resolveUpsertMode

7. `--new` + `--feature` → `{ mode: 'error', reason: 'mutually-exclusive' }`.
8. `--new` → `{ mode: 'new' }`.
9. `--feature=my-feat` → `{ mode: 'feature', featureId: 'my-feat' }`.
10. `--force` → `{ mode: 'force' }`.
11. `--no-update` → `{ mode: 'continue-incomplete' }`.
12. `--update` + findResult.decision='reuse' → `{ mode: 'auto-update' }`.
13. No flags + findResult.decision='reuse' → `{ mode: 'auto-update' }` (DEFAULT).
14. No flags + findResult.decision='new' → `{ mode: 'new' }`.
15. No flags + findResult.decision='blocked' →
    `{ mode: 'blocked', reason: <findResult.reason> }`.
16. Pure: no `safeAgent`/`flexibleAgent`/`async`/`Date.now`/`Math.random`
    (source assertion).

### GREEN tests — deriveForkedFeatureId

17. No existing fork → `{ featureId: '<base>-2', n: 2 }`.
18. `<base>-2` exists → `{ featureId: '<base>-3', n: 3 }`.
19. `<base>-2` and `<base>-3` exist → `{ featureId: '<base>-4', n: 4 }`.
20. Empty registry → `{ featureId: '<base>-2', n: 2 }`.
21. Pure: no I/O, no agent calls (source assertion).

### GREEN tests — update flow source assertions

22. `reconcileSlices` IS in the import line of main.mjs from extract-scope.mjs.
23. `runChangeDetection` IS in the import line of main.mjs from extract-scope.mjs.
24. `invalidateSliceChain` IS in the import line of main.mjs from extract-slice.mjs.
25. `markStaleForSlice` IS in the import line of main.mjs from synthesis.mjs.
26. `resolveUpsertMode` IS called in the main.mjs extract block (source assertion).
27. `deriveForkedFeatureId` IS called when mode='new' and base feature exists.
28. The update flow calls `reconcileSlices` then `runChangeDetection` then
    `invalidateSliceChain` for changed slices (source assertion — all three
    appear in the update path block).

### GREEN tests — mutual exclusion + flag parsing

29. `--new` + `--feature` present simultaneously → handoff blocks with
    mutual-exclusion message.
30. `--feature=<nonexistent>` → blocks with feature-not-found message.
31. `--new` when base feature exists → creates forked folder with `-2` suffix.
32. `--new` when base + `-2` exist → creates forked folder with `-3` suffix.

### GREEN tests — schema validation

33. `UPSERT_MODE_VERDICT` schema has `additionalProperties: false`.
34. `UPSERT_MODE_VERDICT.mode` is an enum with all 7 modes.
35. `UPSERT_MODE_VERDICT` is exported from schemas.
36. `ADOPT_RESULT` schema has `additionalProperties: false`.
37. `ADOPT_RESULT.reason` is an enum with all 4 values.
38. `ADOPT_RESULT` is exported from schemas.

### GREEN tests — meta

39. Meta phases include `'Upsert'`.
40. Meta phases include `'Adopt'`.
41. Meta phases include `'Migrate'`.

## Test Specification (tests/v15-migration.test.mjs)

### RED tests (must fail before implementation)

1. `isLegacyRoot` is not defined — calling it throws ReferenceError.
2. Source assertion: `adoptLegacyFolder` is NOT exported from extract-scope.mjs.
3. Source assertion: `scanForLegacyFolders` is NOT exported from extract-scope.mjs.
4. Source assertion: auto-scan block is NOT present in main.mjs (grep for
   `scanForLegacyFolders` in main.mjs → absent before implementation).

### GREEN tests — isLegacyRoot

5. Path with `pipeline-state.json` in markers → `true`.
6. Path with `plan.md` in markers (no pipeline-state.json) → `true`.
7. Path with no markers → `false`.
8. Path containing `/slices/` → `false` (even with markers).
9. Path containing `/.pending/` → `false`.
10. Path ending with `.registry.json` → `false`.
11. Path ending with `.identity.json` → `false`.
12. Empty path → `false`.
13. Null markerFiles → `false`.
14. Pure: no I/O, no agent calls (source assertion).

### GREEN tests — scanForLegacyFolders (integration, mock-agent)

15. Single root with `pipeline-state.json` → roots has 1 entry.
16. Multi-slice fixture: parent has `pipeline-state.json`, child in
    `slices/<id>/` has `pipeline-state.json` → roots has ONLY the parent
    (review5 P1.5).
17. `.pending/` directory with `pipeline-state.json` → excluded.
18. `.registry.json` at root level → excluded.
19. Two roots in non-sorted order → returned in lexicographic order.
20. Empty docs root → `{ roots: [] }`.

### GREEN tests — adoptLegacyFolder (integration, mock-agent)

21. Valid root → `{ adopted: true, featureId: <derived>, planDir: <path> }`.
22. Non-root path → `{ adopted: false, reason: 'not-a-root' }`.
23. Already-adopted (`.identity.json` exists + registry match) →
    `{ adopted: false, reason: 'already-adopted' }` (idempotent — review4 P1.7).
24. Collision with different digest → forked id via `deriveForkedFeatureId`
    → `{ adopted: true, reason: 'collision-forked' }`.
25. Rollback: simulate agent failure mid-adoption → `.identity.json` NOT
    written, registry NOT updated.
26. After adoption: old `--resume <planDir>` still loads state correctly
    (old resume + new lookup converge — plan §D4 tests).
27. After adoption: fresh `/extract-design <scope>` lookup finds the adopted
    feature via registry → no duplicate folder created.

### GREEN tests — auto-scan trigger (integration, mock-agent)

28. Registry has zero entries + `docs/extract/` exists with legacy roots →
    handoff returns `awaiting-adopt-confirm` with sorted roots list.
29. Registry has entries → auto-scan does NOT fire.
30. `docs/extract/` does not exist → auto-scan does NOT fire.
31. `--adopt <planDir>` bypasses scan, directly adopts.
32. After adopting all roots: subsequent runs do NOT re-scan (registry
    non-empty).

### GREEN tests — `--adopt` path (integration, mock-agent)

33. `--adopt <valid-root>` → adoption succeeds, extract proceeds.
34. `--adopt <non-root>` → blocks with not-a-root message.
35. `--adopt <already-adopted>` → no-op, extract proceeds normally.

### GREEN tests — convergence (integration, mock-agent)

36. Old resume after adopt: `--resume <planDir>` loads pipeline-state.json,
    continues extraction — no identity re-derivation, no duplicate.
37. Fresh lookup after adopt: `findFeature` matches the adopted feature →
    `resolveUpsertMode` returns `'auto-update'` → change detection runs.
38. Both paths converge on the same `planDir` (plan §D4 success criterion).

## Success Criteria

1. Existing folder auto-updates by default — bare re-run triggers change
   detection + invalidation + re-extraction of changed slices.
2. `--no-update` opts out — continues-incomplete without re-detecting changes.
3. `--force` re-extracts all slices regardless of digest.
4. `--feature=<featureId>` selects a specific existing feature (disambiguates).
5. `--new` forks a distinct folder (`<featureId>-<n>`), never overwrites or
   aliases the existing feature.
6. `--new` + `--feature` rejected with mutual-exclusion error.
7. `--adopt <planDir>` imports a v1.5 folder — identity derivation, registry
   root-last, rollback on failure.
8. Auto-scan offers roots in sorted order (multi-slice fixture offers only
   the root).
9. Adoption is idempotent — re-adoption is a no-op.
10. Old `--resume` + new lookup converge on the same folder after adoption.
11. Full test suite green (baseline + new D3/D4 tests).
12. Build drift-free (`npm run validate:build`).
13. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Auto-update default surprises users who expect bare re-run to continue-incomplete | Documented in command help + handoff message; `--no-update` is the explicit opt-out |
| Update flow races with concurrent invocation | Concurrency explicitly UNSUPPORTED (documented); single-user CLI, atomic writes only |
| `deriveForkedFeatureId` infinite loop on registry corruption | Bounded scan: stops at first available `n`; registry entries are finite |
| Adoption rollback leaves partial `.identity.json` | Temp-then-rename: `.identity.json` is written to temp first, renamed only after registry commit succeeds; on failure, temp is deleted |
| Auto-scan is expensive on large docs trees | Depth-limited recursive listing; fires only once (first post-upgrade run with empty registry); agent-mediated with bounded output |
| Existing extract tests break due to import changes | New imports are additive; existing function signatures unchanged; update flow is gated behind `resolveUpsertMode` which defaults to existing behavior for first-extraction (decision='new') |
| `reconcileSlices`/`runChangeDetection` called with wrong state shape | State shape is defined by Phase 15/16 schemas; the update flow loads persisted state via `loadPipelineStateWithRecovery` which validates the shape |

## Security Considerations

- No secrets in upsert/migration payloads (feature ids, file paths, digests only).
- Adoption does NOT execute code from the adopted folder — it only reads
  scope-manifest.md / pipeline-state.json and hashes source files.
- `--adopt` validates the path is a root before any writes — prevents
  adoption of arbitrary directories.
- Registry writes are atomic (temp-then-rename) — no torn JSON on crash.
- No hashing in the engine — all SHA-256 computation is agent-mediated.
- No direct FS/shell access — all file operations via agent-mediated JSON.

## Scope Boundary (D3 + D4 ONLY)

This phase implements ONLY §D3 (explicit upsert entrypoints) and §D4
(migration of existing v1.5 docsets). It does NOT implement:

- **Phase 19** (Compatibility & Proof) — E2E characterization tests for the
  full v1.6.0 flow across all scenarios (deterministic folders, full-rename
  match, blocked ambiguity, in-place update, removed-slice parent update,
  adopt convergence, crash-resume after invalidation).
- Gate-level change-detection granularity — future milestone.
- Concurrent same-feature invocation safety — explicitly unsupported.

---

*Phase 18: Upsert Entrypoints & v1.5 Migration*
*Planned: 2026-07-24 — autonomous /gsd-plan-phase 18 --auto*
