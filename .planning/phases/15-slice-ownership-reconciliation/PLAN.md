# Phase 15: Slice Ownership Reconciliation

**Status:** Planned
**Date:** 2026-07-24
**Requirements:** OWN-01
**Depends on:** Phase 14 (D1.2-D1.4 registry/lookup/identity)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.1

## RED Gate (must fail before implementation)

1. `reconcileSlices` does NOT exist — calling it throws ReferenceError; any
   update-flow code path that would need it cannot proceed.
2. Ownership must NOT depend on an LLM, a flag, or a decomposer hint — the
   function signature accepts only `(persistedSlices, currentFiles)` with no
   flags/hints parameter (source assertion on the exported function).
3. A slice already marked `removed` in the persisted input does NOT receive
   any newly added files (removed slices are excluded as assignment candidates).
4. A move is NOT falsely detected on duplicate content — when two old files
   share a `contentSha256`, the reconciler treats the new-path file as an
   ADD (conservative remove+add), not a move.
5. No `crypto`/`createHash`/`Math.random`/`Date.now` in `reconcileSlices` or
   any helper it calls — it is purely deterministic and consumes only
   agent-provided hashes (source assertion).

## GREEN Evidence (must pass after implementation)

1. `reconcileSlices(persistedSlices, currentFiles)` is a PURE function
   returning `{ slices, delta }` — no agent calls, no async, no I/O.
2. **Prefix-score assignment**: `score(file, slice)` = max over the slice's
   files of common-leading-path-segment count between the file's directory
   and that file's directory. Added files go to the highest-scoring
   **non-removed** slice; ties broken by lex-smallest `sliceId`.
3. **Zero-score clustering**: files with zero score against all non-removed
   slices are clustered via **union-find by first-2-segment directory** into
   permutation-invariant new slices.
4. **New-slice `sliceId`**: `slice-<lexSmallest(cluster contentSha256s).slice(0,12)>`
   using already-computed agent per-file hashes; collision (two clusters
   share that contentSha256) resolved by deterministic counter `-<n>`.
5. **Move detection**: old path gone + current file's `contentSha256` matches
   exactly one persisted per-file fingerprint → new path to old owner, logged
   as move. Duplicate content (≥2 old files share the digest) → remove+add.
6. **Removed path** → dropped from owner.
7. **Removed-slice state machine**: slice still owns ≥1 file but content
   changed → status `pending`; slice emptied by membership loss → status
   `removed` (terminal for re-extraction).
8. **Overlap conflict** → lex-smallest `sliceId` wins, logged in delta.
9. **Partition invariant**: every current file is owned by exactly one slice
   in the output (validated by `validatePartition`; throws on violation).
10. **Permutation invariance**: reordering `persistedSlices` or `currentFiles`
    input arrays produces identical `{ slices, delta }` output.

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**RECONCILE_FILE** — a file with its content fingerprint (shared input/output shape):
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['path', 'contentSha256'],
  properties: {
    path: { type: 'string', description: 'Repo-relative POSIX path' },
    contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
  },
}
```

**RECONCILE_DELTA** — the change record returned by `reconcileSlices`:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['added', 'removed', 'moved', 'newSlices', 'removedSlices', 'overlaps'],
  properties: {
    added: {
      type: 'array',
      description: 'Files assigned to an existing non-removed slice via prefix score',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256', 'sliceId'],
        properties: {
          path: { type: 'string' },
          contentSha256: { type: 'string' },
          sliceId: { type: 'string', description: 'Slice that received the file' },
        },
      },
    },
    removed: {
      type: 'array',
      description: 'Files dropped from their owner (old path no longer in current set)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sliceId'],
        properties: {
          path: { type: 'string' },
          sliceId: { type: 'string', description: 'Slice that lost the file' },
        },
      },
    },
    moved: {
      type: 'array',
      description: 'Files whose path changed but contentSha256 uniquely matches a gone old path',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['oldPath', 'newPath', 'contentSha256', 'sliceId'],
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
          contentSha256: { type: 'string' },
          sliceId: { type: 'string', description: 'Original owner (unchanged)' },
        },
      },
    },
    newSlices: {
      type: 'array',
      description: 'New slices created from zero-score clusters',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sliceId', 'files'],
        properties: {
          sliceId: { type: 'string' },
          files: { type: 'array', items: { /* RECONCILE_FILE shape */ } },
        },
      },
    },
    removedSlices: {
      type: 'array',
      description: 'Slices emptied by membership loss (terminal for re-extraction)',
      items: { type: 'string' },
    },
    overlaps: {
      type: 'array',
      description: 'Overlap conflicts resolved by lex-smallest sliceId',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'winnerSliceId', 'loserSliceId'],
        properties: {
          path: { type: 'string' },
          winnerSliceId: { type: 'string' },
          loserSliceId: { type: 'string' },
        },
      },
    },
  },
}
```

Export `RECONCILE_FILE` and `RECONCILE_DELTA` in the schema export block.

### Step 2: Prefix-score helper (`extract-scope.mjs`)

Add pure helper `computePrefixScore(filePath, sliceFiles)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — no agent calls, no LLM, no I/O.

```js
// score(file, slice) = max over slice's files of common-leading-path-segment
// count between the file's directory and that file's directory.
// "src/auth/login.ts" vs "src/auth/session.ts" → 2 (src + auth).
// "src/auth/login.ts" vs "src/core/db.ts" → 1 (src only).
function computePrefixScore(filePath, sliceFiles) {
  const fileDir = directorySegments(filePath)
  let best = 0
  for (const sf of sliceFiles) {
    const sfDir = directorySegments(sf.path)
    let common = 0
    const len = Math.min(fileDir.length, sfDir.length)
    for (let i = 0; i < len; i++) {
      if (fileDir[i] === sfDir[i]) common++
      else break
    }
    if (common > best) best = common
  }
  return best
}
```

Where `directorySegments(filePath)` splits the path by `/`, drops the last
element (the filename), and returns the directory segments array. A file at
the repo root (`README.md`) yields `[]` (zero segments → zero score against
everything except root-level siblings).

### Step 3: Zero-score clustering helper (`extract-scope.mjs`)

Add pure helpers for union-find clustering:

```js
// Cluster zero-score files by first-2-segment directory via union-find.
// Same rule as area derivation: first 2 path segments of repo-relative path.
// Fewer than 2 segments or a unique dir → singleton cluster.
function clusterByTwoSegDir(files) {
  // Union-find: each file starts as its own root.
  const parent = files.map((_, i) => i)
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }

  // Two files share a cluster if their first-2-segment directory matches.
  const dirs = files.map(f => twoSegDir(f.path))
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (dirs[i] === dirs[j] && dirs[i] !== null) union(i, j)
    }
  }
  // Group by root.
  const clusters = {}
  for (let i = 0; i < files.length; i++) {
    const r = find(i)
    ;(clusters[r] || (clusters[r] = [])).push(files[i])
  }
  return Object.values(clusters)
}
```

Where `twoSegDir(path)` returns the first 2 path segments joined by `/`
(e.g. `"src/auth/login.ts"` → `"src/auth"`), or `null` for fewer than 2
segments (root-level files are singletons).

### Step 4: New-slice sliceId derivation (`extract-scope.mjs`)

Add pure helper `deriveClusterSliceId(cluster, existingIds)`:

```js
// sliceId = slice-<lexSmallest(cluster contentSha256s).slice(0,12)>.
// Collision (two clusters share that contentSha256 prefix) → counter -<n>.
function deriveClusterSliceId(cluster, existingIds) {
  const hashes = cluster.map(f => f.contentSha256).sort()
  const base = 'slice-' + hashes[0].slice(0, 12)
  if (!existingIds.has(base)) return base
  let n = 1
  while (existingIds.has(base + '-' + n)) n++
  return base + '-' + n
}
```

Uses agent-provided per-file hashes — no engine hashing. Collision-probe is
deterministic (ascending counter). Permutation-invariant because
`hashes.sort()` makes the lex-smallest selection independent of input order.

### Step 5: Move detection helper (`extract-scope.mjs`)

Add pure helper `detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)`:

```js
// For each current file whose path is NOT in oldPathMap:
//   - Look up contentSha256 in oldHashMap.
//   - If exactly ONE old path had this digest AND that old path is gone
//     (not in currentPathSet) → MOVE: assign to old owner.
//   - If ≥2 old paths share this digest → DUPLICATE: treat as ADD
//     (conservative — cannot determine which one moved).
//   - If no match → ADD.
function detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet) {
  const moves = []
  const adds = []
  for (const cf of currentFiles) {
    if (oldPathMap.has(cf.path)) continue // unchanged path — handled elsewhere
    const oldPaths = oldHashMap.get(cf.contentSha256)
    if (oldPaths && oldPaths.length === 1) {
      const oldPath = oldPaths[0]
      if (!currentPathSet.has(oldPath)) {
        // Unique content match, old path gone → MOVE
        moves.push({ newPath: cf.path, oldPath, contentSha256: cf.contentSha256,
                     sliceId: oldPathMap.get(oldPath).sliceId })
      } else {
        adds.push(cf) // old path still exists with same content — duplicate at new path
      }
    } else {
      adds.push(cf) // no match or ambiguous (≥2 old paths) → ADD
    }
  }
  return { moves, adds }
}
```

### Step 6: Main `reconcileSlices` function (`extract-scope.mjs`)

Add `reconcileSlices(persistedSlices, currentFiles)` to `extract-scope.mjs`:

**PURE** — no agent calls, no LLM, no I/O, no `Math.random`, no `Date.now`.

**Input:**
- `persistedSlices`: `[{ sliceId, files: [{path, contentSha256}], status, planDir }]`
- `currentFiles`: `[{ path, contentSha256 }]`

**Algorithm:**

1. **Build lookup structures:**
   - `oldPathMap`: `Map<path, {sliceId, contentSha256}>` from all persisted files.
   - `oldHashMap`: `Map<contentSha256, path[]>` from all persisted files.
   - `currentPathSet`: `Set<path>` from current files.
   - `removedSliceIds`: `Set<sliceId>` from persisted slices with `status === 'removed'`.
   - `nonRemovedSlices`: persisted slices whose status is NOT `'removed'`.

2. **Classify current files:**
   - `unchanged`: path exists in `oldPathMap` with matching `contentSha256`.
   - `modified`: path exists in `oldPathMap` but `contentSha256` differs.
   - `moves` + `adds`: from `detectMoves(...)` for paths NOT in `oldPathMap`.

3. **Assign added files to non-removed slices:**
   For each add:
   - Compute `computePrefixScore(add.path, slice.files)` for each non-removed slice.
   - Best score > 0 → assign to best slice (tie → lex-smallest `sliceId`).
   - Zero score → collect into `zeroScoreFiles` for clustering.

4. **Cluster zero-score files:**
   - `clusters = clusterByTwoSegDir(zeroScoreFiles)`.
   - Each cluster → new slice with `deriveClusterSliceId(cluster, existingIds)`.
   - New slices get `status: 'pending'`, `planDir` derived from parent convention.

5. **Resolve overlaps:**
   If any file was assigned to multiple slices (can happen via both move +
   prefix-score paths), lex-smallest `sliceId` wins; losers logged in
   `delta.overlaps`.

6. **Determine output slice statuses:**
   For each persisted slice (non-removed):
   - If it owns ≥1 current file AND any file was modified/added/removed →
     `status: 'pending'`.
   - If it owns ≥1 current file AND all are unchanged → keep original status.
   - If it owns 0 current files → `status: 'removed'` (terminal); add
     `sliceId` to `delta.removedSlices`.

7. **Build output:**
   - `slices`: array of `{ sliceId, files, status, planDir }` — includes
     surviving persisted slices, new slices, and removed slices (with empty
     files array + `status: 'removed'`).
   - `delta`: `{ added, removed, moved, newSlices, removedSlices, overlaps }`.

8. **Validate partition:**
   Call `validatePartition(slices, currentFiles)` — asserts every current
   file appears in exactly one output slice. Throws on violation.

**Return:** `{ slices, delta }`

### Step 7: Partition validation helper (`extract-scope.mjs`)

Add pure helper `validatePartition(slices, currentFiles)`:

```js
// Asserts every currentFile is owned by exactly one slice. Throws on violation.
function validatePartition(slices, currentFiles) {
  const ownerCount = new Map()
  for (const s of slices) {
    if (s.status === 'removed') continue // removed slices have empty files
    for (const f of s.files) {
      ownerCount.set(f.path, (ownerCount.get(f.path) || 0) + 1)
    }
  }
  for (const cf of currentFiles) {
    const count = ownerCount.get(cf.path) || 0
    if (count === 0) throw new Error('Partition violation: ' + cf.path + ' has no owner')
    if (count > 1) throw new Error('Partition violation: ' + cf.path + ' has ' + count + ' owners')
  }
}
```

### Step 8: Meta phase declaration

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase title `{ title: 'Reconcile Slices' }` to the `phases` array.

### Step 9: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline 1927 + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add RECONCILE_FILE, RECONCILE_DELTA |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add reconcileSlices + helpers (computePrefixScore, clusterByTwoSegDir, deriveClusterSliceId, detectMoves, validatePartition) |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Reconcile Slices' phase |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/slice-ownership-reconciliation.test.mjs` | D2.1 tests (all algorithm properties) |

## Test Specification (tests/slice-ownership-reconciliation.test.mjs)

### RED tests (must fail before implementation)

1. `reconcileSlices` is not defined — calling it throws ReferenceError.
2. Source assertion: `reconcileSlices` function signature accepts exactly
   `(persistedSlices, currentFiles)` — no flags/hints/LLM parameter.
3. Source assertion: no `crypto`/`createHash`/`Math.random`/`Date.now` in
   `reconcileSlices` or any helper it calls.
4. A persisted slice with `status: 'removed'` does NOT receive any added
   files (it is excluded from prefix-score candidates).

### GREEN tests — prefix score

5. `computePrefixScore`: `"src/auth/login.ts"` vs slice files
   `["src/auth/session.ts"]` → score 2 (`src` + `auth`).
6. `computePrefixScore`: `"src/auth/login.ts"` vs slice files
   `["src/core/db.ts"]` → score 1 (`src` only).
7. `computePrefixScore`: `"src/auth/login.ts"` vs slice files
   `["lib/utils.ts"]` → score 0 (no common leading segment).
8. `computePrefixScore`: root-level file `"README.md"` vs any slice → 0.
9. `computePrefixScore`: takes the MAX across all files in the slice
   (not the first or average).
10. `computePrefixScore`: deeply nested `"a/b/c/d/file.ts"` vs
    `"a/b/c/d/other.ts"` → score 4.

### GREEN tests — zero-score clustering

11. `clusterByTwoSegDir`: files in `src/auth/` cluster together; files in
    `src/core/` form a separate cluster.
12. `clusterByTwoSegDir`: root-level files (`README.md`, `package.json`)
    are singletons (fewer than 2 segments).
13. `clusterByTwoSegDir`: 3 files in `src/auth/` + 2 in `lib/db/` → 2 clusters.
14. `clusterByTwoSegDir`: permutation invariance — reordering input files
    produces the same cluster groupings (same members per cluster).

### GREEN tests — cluster sliceId derivation

15. `deriveClusterSliceId`: produces `slice-<lexSmallest contentSha256 prefix>`.
16. `deriveClusterSliceId`: lex-smallest is independent of cluster file order
    (permutation invariance — sort before picking).
17. `deriveClusterSliceId`: collision → counter suffix `-1`, `-2`, etc.
18. `deriveClusterSliceId`: no collision when hashes differ → no suffix.

### GREEN tests — move detection

19. `detectMoves`: old path gone + unique contentSha256 match → MOVE (new path
    to old owner).
20. `detectMoves`: old path gone + contentSha256 matches ≥2 old paths →
    DUPLICATE → ADD (not move).
21. `detectMoves`: old path still exists + same contentSha256 at new path →
    ADD (not move — old path is not gone).
22. `detectMoves`: no contentSha256 match → ADD.
23. `detectMoves`: unchanged path (in oldPathMap) → neither move nor add
    (skipped by detectMoves).

### GREEN tests — reconcileSlices end-to-end

24. **Unchanged**: all files at same paths with same hashes → slices keep
    original statuses; delta is empty.
25. **Added file**: new file assigned to highest-scoring non-removed slice
    via prefix score.
26. **Added file tie**: two slices with equal prefix score → lex-smallest
    `sliceId` wins.
27. **Added file zero score**: file with no path overlap → new slice via
    clustering.
28. **Multiple zero-score files same dir**: two files in `src/newmod/` →
    one new slice (clustered by 2-seg dir).
29. **Multiple zero-score files different dirs**: one in `src/a/`, one in
    `src/b/` → two new slices.
30. **Removed file**: old path not in currentFiles → file dropped; logged in
    `delta.removed`.
31. **Move**: old path gone, new path with unique matching contentSha256 →
    file moves to old owner; logged in `delta.moved`.
32. **Duplicate content move**: two old files share a digest → new file is
    ADD not MOVE; both old paths logged in `delta.removed`.
33. **Content changed**: same path, different contentSha256 → slice status
    becomes `pending`.
34. **Empty slice**: all files removed from a slice → `status: 'removed'`;
    `sliceId` in `delta.removedSlices`.
35. **Removed slice excluded**: a slice with `status: 'removed'` in input
    does NOT receive any added files.
36. **Overlap**: file assigned to two slices → lex-smallest `sliceId` wins;
    logged in `delta.overlaps`.
37. **Permutation invariance (full)**: reordering both `persistedSlices` and
    `currentFiles` produces identical `{ slices, delta }`.
38. **Empty currentFiles**: no current files → all persisted slices become
    `removed`; delta has all slices in `removedSlices`.
39. **Empty persistedSlices**: all current files → one or more new slices;
    delta has all files in `newSlices`.
40. **Single slice (no decomposition)**: one persisted slice + added files →
    files assigned to the same slice (score > 0 for same-dir files).
41. **Mixed scenario**: some unchanged + some added + some removed + one move
    + one new-slice cluster → delta categories all populated correctly.

### GREEN tests — partition invariant

42. `validatePartition`: every current file in exactly one slice → no throw.
43. `validatePartition`: current file missing from all slices → throws.
44. `validatePartition`: current file in two slices → throws.
45. `reconcileSlices` calls `validatePartition` before returning (source
    assertion).
46. `validatePartition` skips removed slices (empty files array — source
    assertion).

### GREEN tests — delta structure

47. `delta.added` entries have `{path, contentSha256, sliceId}`.
48. `delta.removed` entries have `{path, sliceId}`.
49. `delta.moved` entries have `{oldPath, newPath, contentSha256, sliceId}`.
50. `delta.newSlices` entries have `{sliceId, files}`.
51. `delta.removedSlices` is an array of `sliceId` strings.
52. `delta.overlaps` entries have `{path, winnerSliceId, loserSliceId}`.

### GREEN tests — cross-cutting

53. `reconcileSlices` is pure (no `safeAgent`/`flexibleAgent`/`async` —
    source assertion).
54. All helpers (`computePrefixScore`, `clusterByTwoSegDir`,
    `deriveClusterSliceId`, `detectMoves`, `validatePartition`) are pure
    (no agent calls — source assertion).
55. `RECONCILE_DELTA` schema has `additionalProperties: false`.
56. `RECONCILE_FILE` schema has `additionalProperties: false`.
57. Meta phases include `Reconcile Slices`.
58. `reconcileSlices` is exported from `extract-scope.mjs` (source assertion
    or import test).
59. No new `crypto` import in `extract-scope.mjs` (source assertion — hashes
    are consumed, not computed).

## Success Criteria

1. Every add/remove/move/empty/new-slice/overlap case is deterministic — same
   inputs always produce the same `{ slices, delta }`.
2. Exactly-one-owner invariant holds for all test scenarios (validated by
   `validatePartition`).
3. SliceIds are permutation-invariant — reordering inputs does not change
   output.
4. Removed slices never receive new files.
5. Duplicate content is treated as remove+add, not move.
6. Full test suite green (1927 baseline + new D2.1 tests).
7. Build drift-free (`npm run validate:build`).
8. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Prefix-score false positive (file assigned to wrong slice) | Score is path-segment based, same rule as area derivation; tie-break by lex-smallest sliceId; zero-score → new slice (not forced) |
| Union-find clustering creates too many/few slices | Same 2-seg-dir rule as Phase 13 area derivation — proven stable; singleton fallback for root-level files |
| Move detection false positive on renamed+content-changed file | Move requires EXACT contentSha256 match; any content change → no match → ADD |
| Collision probe non-determinism | Counter is deterministic (ascending from 1); lex-smallest hash prefix is sorted (order-independent) |
| Partition violation from overlapping assignments | `validatePartition` throws before return; overlap resolution (lex-smallest) runs before validation |
| Existing extract tests break | `reconcileSlices` is additive — no existing function signatures change; queue shape unchanged |

## Security Considerations

- No secrets in reconcile inputs/outputs (file paths + content hashes only).
- No hashing in the engine — all `contentSha256` values are agent-provided
  and consumed read-only by the reconciler.
- `validatePartition` is a correctness guard, not a security control — it
  catches logic bugs, not adversarial input.
- The function is pure — no side effects, no file system access, no network.

## Scope Boundary (D2.1 ONLY)

This phase implements ONLY §D2.1 (pure ownership reconciliation). It does NOT
implement:
- D2.2 (change detection — full-digest comparison) — Phase 16
- D2.3 (invalidation chain — `invalidateSliceChain`, `onSliceRemoved`) —
  Phase 17
- D3 (upsert entrypoints — `--update`, `--force`) — Phase 18
- D4 (migration/adopt — `--adopt`) — Phase 18
- Integration of `reconcileSlices` into the extract-mode update flow —
  Phase 16/17 (this phase delivers the pure function + tests only; the
  update flow calls it after Phase 16 wires the I/O)

---

*Phase 15: Slice Ownership Reconciliation*
*Planned: 2026-07-24 — autonomous /gsd-plan-phase 15 --auto*
