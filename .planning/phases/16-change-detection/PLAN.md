# Phase 16: Change Detection

**Status:** Planned
**Date:** 2026-07-24
**Requirements:** CHANGE-01
**Depends on:** Phase 15 (D2.1 reconcileSlices)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.2

## RED Gate (must fail before implementation)

1. `frameSliceDigest`, `validateDigest64Hex`, and `detectSliceChanges` do NOT
   exist — calling any of them throws ReferenceError.
2. A hash failure (missing/malformed/empty digest) must NEVER classify changed
   sources as unchanged — `detectSliceChanges` returns `status: 'changed'` with
   a fail-closed reason for every unverifiable slice.
3. No `crypto`/`createHash`/SHA-256 computation in any engine source file —
   all digest computation is agent-mediated (source assertion over `src/*.mjs`).
4. `frameSliceDigest` does NOT compute any hash — it only sorts and JSON-frames
   (source assertion — the function body contains no crypto/createHash).
5. A non-empty membership delta (files added/removed/moved per the
   `reconcileSlices` delta) must NOT be classified as unchanged even if the
   combined digest happens to match (defense in depth — the delta check is
   independent of the digest comparison).

## GREEN Evidence (must pass after implementation)

1. `frameSliceDigest(fileHashes)` is a PURE function returning the
   JSON-stringified sorted `[path, contentSha256]` frame for a slice's files.
   Deterministic: same input always produces the same framed string.
2. `validateDigest64Hex(digest)` returns `{valid: true}` only when the value
   is a 64-lowercase-hex string; otherwise `{valid: false, reason}`.
3. `detectSliceChanges(persistedDigests, currentDigests)` is a PURE function
   returning per-slice change decisions. Fail-closed semantics:
   - Matching digests → `{status: 'unchanged'}`
   - Differing digests → `{status: 'changed', reason: 'digest-mismatch'}`
   - Missing/invalid persisted → `{status: 'changed', reason: 'persisted-invalid'}`
   - Missing/invalid current → `{status: 'changed', reason: 'current-invalid'}`
   - New slice (no persisted entry) → `{status: 'changed', reason: 'new-slice'}`
   - Removed slice (not in current) → `{status: 'changed', reason: 'slice-removed'}`
4. `computeSliceDigests({ sliceFrames, result })` calls an agent to compute
   SHA-256 (64-hex) over each slice's framed string. Returns
   `[{sliceId, digest}]` or null on failure.
5. `writeSliceDigestFile({ sliceDir, files, digest, result })` writes
   `<sliceDir>/.source-digest.json` via file-writer agent with temp-then-rename.
6. `readSliceDigestFile({ sliceDir, result })` reads
   `<sliceDir>/.source-digest.json` via file-reader agent. Returns
   `{files, digest}` or null if the file does not exist.
7. `runChangeDetection({ reconciledSlices, fileHashes, force, result })`
   orchestrates: frame → agent-hash → validate → read-persisted → compare →
   persist new digests. Returns `{decisions, digests, extractReady}`.
8. When `force` is true, all slices are marked `'changed'` regardless of
   digest comparison.
9. Framed distinctness: `["ab","c"]` (two paths "ab" and "c") produces a
   different digest than `["a","bc"]` (two paths "a" and "bc") — the framing
   separates path from hash so different file sets never collide.
10. All persisted digests are schema-validated (64-hex) before writing —
    malformed digests are never written to `.source-digest.json` or
    `pipeline-state.json`.
11. The `_sourceDigest` field on `pipeline-state.json` `result` stores the
    feature-level digest; per-slice digests live in each slice's
    `.source-digest.json` and are referenced from the change decisions.

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**SLICE_DIGEST** — the shape of `<sliceDir>/.source-digest.json`:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['files', 'digest'],
  properties: {
    files: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash (fingerprints for change detection)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string', description: 'Repo-relative POSIX path' },
          contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
        },
      },
    },
    digest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs for this slice' },
  },
}
```

**SLICE_DIGEST_RESULT** — the agent return for per-slice digest computation:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sliceId', 'digest'],
        properties: {
          sliceId: { type: 'string', description: 'Slice identifier' },
          digest: { type: 'string', description: 'Full 64-hex SHA-256 of the framed per-file pairs' },
        },
      },
    },
  },
}
```

Export `SLICE_DIGEST` and `SLICE_DIGEST_RESULT` in the schema export block.

### Step 2: Pure framing function (`extract-scope.mjs`)

Add `frameSliceDigest(fileHashes)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — no agent calls, no I/O, no crypto, no hashing.

```js
// Frame a slice's per-file hashes into a deterministic JSON string for
// agent-mediated SHA-256 computation. Sorts by path ascending so the frame
// is order-independent (permutation-invariant), then JSON-stringifies as
// an array of [path, contentSha256] pairs. The framing separates path from
// hash so different file sets never collide: ["ab","c"] != ["a","bc"].
function frameSliceDigest(fileHashes) {
  var pairs = (fileHashes || [])
    .slice()
    .sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0 })
    .map(function (fh) { return [fh.path, fh.contentSha256] })
  return JSON.stringify(pairs)
}
```

### Step 3: Pure digest validation (`extract-scope.mjs`)

Add `validateDigest64Hex(digest)`:

**PURE** — reuses the existing `HEX64` regex from Phase 13.

```js
// Validate that a digest is a 64-lowercase-hex SHA-256 string.
// Returns { valid: true } or { valid: false, reason }.
function validateDigest64Hex(digest) {
  if (typeof digest !== 'string' || !digest) {
    return { valid: false, reason: 'digest is missing or empty' }
  }
  if (!HEX64.test(digest)) {
    return { valid: false, reason: 'digest is not 64-lowercase-hex' }
  }
  return { valid: true }
}
```

### Step 4: Pure change detection (`extract-scope.mjs`)

Add `detectSliceChanges(persistedDigests, currentDigests)`:

**PURE** — no agent calls, no I/O. Fail-closed: any missing/invalid digest
is classified as `'changed'`.

Input:
- `persistedDigests`: `Map<sliceId, {digest, valid}>` or object
- `currentDigests`: `Map<sliceId, {digest, valid}>` or object

```js
// Compare persisted vs current per-slice digests. Fail-closed: any
// missing/invalid/unverifiable digest → 'changed' (never skip).
// Returns { decisions: [{sliceId, status, reason}], changedCount, unchangedCount }.
function detectSliceChanges(persistedDigests, currentDigests) {
  var persisted = persistedDigests || {}
  var current = currentDigests || {}
  var decisions = []
  var changedCount = 0
  var unchangedCount = 0

  // Check every current slice
  for (var sliceId in current) {
    var cur = current[sliceId]
    var old = persisted[sliceId]

    if (!cur || !cur.valid) {
      decisions.push({ sliceId: sliceId, status: 'changed', reason: 'current-invalid' })
      changedCount++
    } else if (!old) {
      decisions.push({ sliceId: sliceId, status: 'changed', reason: 'new-slice' })
      changedCount++
    } else if (!old.valid) {
      decisions.push({ sliceId: sliceId, status: 'changed', reason: 'persisted-invalid' })
      changedCount++
    } else if (cur.digest === old.digest) {
      decisions.push({ sliceId: sliceId, status: 'unchanged', reason: 'digest-match' })
      unchangedCount++
    } else {
      decisions.push({ sliceId: sliceId, status: 'changed', reason: 'digest-mismatch' })
      changedCount++
    }
  }

  // Check for removed slices (in persisted but not in current)
  for (var oldSliceId in persisted) {
    if (!(oldSliceId in current)) {
      decisions.push({ sliceId: oldSliceId, status: 'changed', reason: 'slice-removed' })
      changedCount++
    }
  }

  return { decisions: decisions, changedCount: changedCount, unchangedCount: unchangedCount }
}
```

### Step 5: Agent-mediated digest computation (`extract-scope.mjs`)

Add `computeSliceDigests({ sliceFrames, result })`:

Calls an agent (label: `slice-digest`, phase: `Change Detection`) to compute
SHA-256 of each slice's framed string. The agent uses Node's `crypto` module
(available to agents) — the engine never hashes.

- Input: `sliceFrames` = `[{sliceId, frame}]` where `frame` is from
  `frameSliceDigest`.
- Agent prompt: instruct the agent to compute `crypto.createHash('sha256')`
  of each frame string, return lowercase hex, and package as
  `SLICE_DIGEST_RESULT`.
- Returns `{slices: [{sliceId, digest}]}` or null on failure.

Key constraint: the engine NEVER computes SHA-256. The framing recipe (sorted
by path, `[path, hash]` pairs, JSON.stringify) is already applied by the pure
`frameSliceDigest` function. The agent only hashes the given frame string.

### Step 6: Agent-mediated slice digest persistence (`extract-scope.mjs`)

Add `writeSliceDigestFile({ sliceDir, files, digest, result })`:

- Validates `digest` via `validateDigest64Hex` before persisting.
- If invalid → returns null (fail-closed — no malformed digest written).
- Uses file-writer agent with temp-then-rename pattern to write
  `<sliceDir>/.source-digest.json` with `SLICE_DIGEST` shape.
- Returns `{ok: true}` or null on failure.

Add `readSliceDigestFile({ sliceDir, result })`:

- Uses file-reader agent to read `<sliceDir>/.source-digest.json`.
- Returns `{files, digest}` (validated as `SLICE_DIGEST`-shaped) or null
  if the file does not exist.
- Validates the read digest via `validateDigest64Hex` — returns the validity
  flag alongside the data so `detectSliceChanges` can make fail-closed
  decisions.

### Step 7: Orchestrator — `runChangeDetection` (`extract-scope.mjs`)

Add `runChangeDetection({ reconciledSlices, fileHashes, force, result })`:

**Async** — calls agents for hashing and file I/O.

Algorithm:

1. **Partition file hashes by slice:** For each slice in `reconciledSlices`,
   extract the slice's file hashes from `fileHashes` by matching paths.

2. **Frame each slice:** Call `frameSliceDigest(sliceFileHashes)` for each
   slice → collect `[{sliceId, frame}]`.

3. **Compute current digests:** Call `computeSliceDigests({ sliceFrames,
   result })` → `[{sliceId, digest}]`.

4. **Validate current digests:** For each, call `validateDigest64Hex(digest)`.
   Build `currentDigests` map: `{sliceId: {digest, valid}}`.

5. **Read persisted digests:** For each slice, call `readSliceDigestFile` →
   build `persistedDigests` map: `{sliceId: {digest, valid}}`. Missing files
   → not in map (treated as new slice by `detectSliceChanges`).

6. **Detect changes:** Call `detectSliceChanges(persistedDigests,
   currentDigests)` → `{decisions, changedCount, unchangedCount}`.

7. **Force override:** If `force` is true, override all decisions to
   `{status: 'changed', reason: 'forced'}`.

8. **Persist new digests:** For each slice with a valid current digest, call
   `writeSliceDigestFile({ sliceDir, files: sliceFileHashes, digest, result })`.
   Invalid digests are NOT persisted (fail-closed).

9. **Update pipeline state:** Set `result._sourceDigest = {files: fileHashes,
   digest: featureDigest}` where `featureDigest` is the combined digest over
   ALL files (already computed by Phase 13's `hashSources` as `scopeDigest`).

10. **Mark extractReady:** If any slice is unverifiable (current digest
    invalid AND force is false), set `extractReady = false` on the result.

11. **Return:** `{decisions, digests: currentDigests, extractReady}`.

The invalidation call (`invalidateSliceChain` for changed slices) is NOT
implemented in this phase — Phase 17 (D2.3) will add it. For now,
`runChangeDetection` produces the decisions + persisted digests. The caller
(main.mjs update flow, Phase 18) will wire the decisions to the invalidation
chain once Phase 17 delivers it.

### Step 8: Meta phase declaration

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase title `{ title: 'Change Detection' }` to the `phases` array.

### Step 9: Harness candidate registration

In `tests/harness.mjs`, add the new function names to the `CANDIDATES` array:

```
'frameSliceDigest',
'validateDigest64Hex',
'detectSliceChanges',
'computeSliceDigests',
'writeSliceDigestFile',
'readSliceDigestFile',
'runChangeDetection',
```

### Step 10: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline 2055 + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add SLICE_DIGEST, SLICE_DIGEST_RESULT; export them |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add frameSliceDigest, validateDigest64Hex, detectSliceChanges, computeSliceDigests, writeSliceDigestFile, readSliceDigestFile, runChangeDetection |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Change Detection' phase |
| `tests/harness.mjs` | Add new function names to CANDIDATES |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/change-detection.test.mjs` | D2.2 behavioral tests (pure functions + source assertions) |
| `tests/change-detection-nyquist.test.mjs` | D2.2 Nyquist validation characterization tests |

## Test Specification (tests/change-detection.test.mjs)

### RED tests (must fail before implementation)

1. `frameSliceDigest` is not defined — calling it throws ReferenceError.
2. `validateDigest64Hex` is not defined — calling it throws ReferenceError.
3. `detectSliceChanges` is not defined — calling it throws ReferenceError.
4. Source assertion: no `crypto`/`createHash` in `frameSliceDigest` (it only
   sorts and JSON-frames).
5. Source assertion: `computeSliceDigests` calls `safeAgent` or `flexibleAgent`
   (agent-mediated hashing — engine never hashes).
6. Source assertion: `detectSliceChanges` is pure (no `safeAgent`/`async`/
   `Date.now`/`Math.random`).

### GREEN tests — frameSliceDigest

7. Single file: `[{path: "src/a.ts", contentSha256: "a...64hex"}]` →
   `'[["src/a.ts","a...64hex"]]'` (JSON string with sorted pair).
8. Multiple files: sorted by path ascending — `b/c.ts` before `b/d.ts`
   before `c/a.ts`.
9. Permutation invariance: reordering input files produces identical output.
10. Empty array: `[]` → `'[]'`.
11. Framed distinctness: `[{path:"ab",contentSha256:"c..."}]` produces a
    different frame than `[{path:"a",contentSha256:"bc..."}]` — path and
    hash are separated by the array pair structure.
12. Two files with same hash, different paths → different frame than one
    file (membership matters).
13. `frameSliceDigest` does NOT hash — returns a string, not a digest
    (source assertion: function body has no `createHash`/`crypto`).

### GREEN tests — validateDigest64Hex

14. Valid 64-lowercase-hex → `{valid: true}`.
15. Uppercase hex → `{valid: false}`.
16. 63-hex (too short) → `{valid: false}`.
17. 65-hex (too long) → `{valid: false}`.
18. Empty string → `{valid: false}`.
19. Non-string (null/undefined/number) → `{valid: false}`.
20. Non-hex characters (e.g., 'z' in position 0) → `{valid: false}`.

### GREEN tests — detectSliceChanges

21. Matching digests → `{status: 'unchanged', reason: 'digest-match'}`.
22. Differing digests → `{status: 'changed', reason: 'digest-mismatch'}`.
23. New slice (in current, not in persisted) → `{status: 'changed', reason: 'new-slice'}`.
24. Removed slice (in persisted, not in current) → `{status: 'changed', reason: 'slice-removed'}`.
25. Invalid current digest → `{status: 'changed', reason: 'current-invalid'}` (fail-closed).
26. Invalid persisted digest → `{status: 'changed', reason: 'persisted-invalid'}` (fail-closed).
27. Missing current digest (undefined entry) → `{status: 'changed', reason: 'current-invalid'}`.
28. Multiple slices: mix of unchanged + changed + new → all decisions correct.
29. Empty persisted + non-empty current → all new-slice.
30. Empty current + non-empty persisted → all slice-removed.
31. Both empty → no decisions, zero counts.
32. `changedCount` and `unchangedCount` tallied correctly.
33. All slices unchanged → `unchangedCount === N`, `changedCount === 0`.
34. All slices changed → `changedCount === N`, `unchangedCount === 0`.
35. Null/undefined inputs → treated as empty objects, no throw.

### GREEN tests — computeSliceDigests (source assertions + behavioral)

36. `computeSliceDigests` is defined and callable.
37. Source assertion: calls `safeAgent` or `flexibleAgent` with the
    `SLICE_DIGEST_RESULT` schema.
38. Source assertion: agent label includes `slice-digest`.
39. Source assertion: agent phase is `Change Detection`.
40. Source assertion: no `crypto`/`createHash` in the function body (the
    agent hashes, not the engine).
41. Source assertion: function is `async`.

### GREEN tests — writeSliceDigestFile (source assertions)

42. `writeSliceDigestFile` is defined and callable.
43. Source assertion: calls `safeAgent` or `flexibleAgent` (file-writer agent).
44. Source assertion: validates digest via `validateDigest64Hex` before
    calling the agent (the validation call appears before the agent call).
45. Source assertion: returns null when digest is invalid.
46. Source assertion: function is `async`.

### GREEN tests — readSliceDigestFile (source assertions)

47. `readSliceDigestFile` is defined and callable.
48. Source assertion: calls `safeAgent` or `flexibleAgent` (file-reader agent).
49. Source assertion: function is `async`.
50. Source assertion: validates the read digest via `validateDigest64Hex`
    and includes the validity flag in the return.

### GREEN tests — runChangeDetection (source assertions)

51. `runChangeDetection` is defined and callable.
52. Source assertion: calls `frameSliceDigest` for each slice.
53. Source assertion: calls `computeSliceDigests`.
54. Source assertion: calls `validateDigest64Hex`.
55. Source assertion: calls `detectSliceChanges`.
56. Source assertion: calls `writeSliceDigestFile` for valid digests.
57. Source assertion: `force` parameter overrides all decisions to 'changed'.
58. Source assertion: sets `result._sourceDigest` when fileHashes available.
59. Source assertion: function is `async`.
60. Source assertion: does NOT call `invalidateSliceChain` (Phase 17 scope).

### GREEN tests — schema validation

61. `SLICE_DIGEST` schema has `additionalProperties: false`.
62. `SLICE_DIGEST_RESULT` schema has `additionalProperties: false`.
63. `SLICE_DIGEST` requires `files` and `digest`.
64. `SLICE_DIGEST_RESULT` requires `slices`.
65. `SLICE_DIGEST` is exported from schemas.
66. `SLICE_DIGEST_RESULT` is exported from schemas.

### GREEN tests — meta + cross-cutting

67. Meta phases include `Change Detection`.
68. No `crypto`/`createHash` import in `extract-scope.mjs` (source assertion
    — hashes consumed, not computed).
69. All new pure functions (`frameSliceDigest`, `validateDigest64Hex`,
    `detectSliceChanges`) have no `safeAgent`/`flexibleAgent`/`async` calls
    (source assertion).
70. All new functions exported from `extract-scope.mjs` (export block
    includes them).

## Test Specification (tests/change-detection-nyquist.test.mjs)

Nyquist characterization tests filling sampling gaps:

### GAP-1: Framed distinctness (exensive scenarios)

1. Same content hash at different paths → different frames.
2. Different content hash at same path → different frames.
3. Path with slashes vs path with backslashes → different frames (normalization
   not applied in framing — caller must normalize).
4. Unicode path → frame preserves UTF-8 (no corruption).
5. Very long path (255+ chars) → frame handles it.
6. Two paths where one is a prefix of the other → different frames
   (`"src/a"` vs `"src/ab"` — the JSON pair structure prevents collision).
7. Paths that differ only in case → different frames (case-sensitive sort).

### GAP-2: Fail-closed coverage matrix

8. Persisted digest is `null` → changed (persisted-invalid).
9. Persisted digest is `undefined` → changed (persisted-invalid).
10. Persisted digest is empty string → changed (persisted-invalid).
11. Persisted digest is 32-hex (MD5 length) → changed (persisted-invalid).
12. Persisted digest is 64-uppercase-hex → changed (persisted-invalid).
13. Current digest is `null` → changed (current-invalid).
14. Current digest is `undefined` → changed (current-invalid).
15. Current digest is a non-hex string → changed (current-invalid).
16. Both persisted and current are invalid → changed (current-invalid takes
    precedence — checked first).

### GAP-3: Decision matrix completeness

17. 1 unchanged + 1 changed + 1 new + 1 removed → 4 decisions, correct counts.
18. All 4 fail-closed reasons exercised in one run (new-slice, digest-mismatch,
    persisted-invalid, current-invalid).
19. Slice in both maps with identical digests but different file lists
    (delta non-empty) → still 'unchanged' by digest comparison (the delta
    check is the caller's responsibility via reconcileSlices, not
    detectSliceChanges — but documented in test).
20. Slice appears in currentDigests twice (same sliceId) → last entry wins
    (JavaScript object semantics — documented behavior).

### GAP-4: Frame permutation invariance (extensive)

21. 5-file slice: 120 permutations → identical frame.
22. 10-file slice: shuffled 50 times → identical frame.
23. Slice with duplicate paths (shouldn't happen but defensive) → sorted
    stably, identical frame regardless of input order.

### GAP-5: validateDigest64Hex boundary

24. Exactly 64 hex chars → valid.
25. 63 chars → invalid.
26. 65 chars → invalid.
27. Mixed case (e.g., 'A' at position 0) → invalid.
28. All zeros (64 zeros) → valid (it's a valid SHA-256 value, albeit unlikely).
29. All f's (64 f's) → valid.

### GAP-6: Source-assertion robustness

30. `frameSliceDigest` source: no `return` before the JSON.stringify (single
    expression return).
31. `detectSliceChanges` source: iterates `current` then `persisted` (two
    loops, not one — the removed-slice scan is independent).
32. `computeSliceDigests` source: the agent prompt contains 'sha256' or
    'SHA-256' (instructs the agent to hash).
33. No `Math.random` or `Date.now` in any Phase 16 function (source assertion
    across all new functions).

## Success Criteria

1. Unchanged sources → skip (correct unchanged decision).
2. Any change (added/removed/moved/renamed bytes) → invalidate + re-extract
   in place (correct changed decision).
3. Framed distinctness: `["ab","c"]` vs `["a","bc"]` produce different
   digests — no false negatives from path-hash ambiguity.
4. Hash failure/missing/malformed → CHANGED (fail-closed, never skip).
5. Schema-validated (64-hex) before persist — malformed digests never written.
6. Full 64-hex SHA-256 digests persisted + compared (not truncated).
7. Full test suite green (2055 baseline + new D2.2 tests).
8. Build drift-free (`npm run validate:build`).
9. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Agent returns inconsistent per-slice digests (framing mismatch) | Engine does framing via pure `frameSliceDigest`; agent only hashes the given frame string — deterministic |
| Per-slice digest performance (hashing many slices) | Single agent call batches all slice frames; SHA-256 of a short string is negligible |
| `.source-digest.json` grows unbounded on large scopes | One file per slice, sized to the slice's file count; bounded by scope size |
| `detectSliceChanges` false negative on membership change with same digest | The delta from `reconcileSlices` (Phase 15) is the primary change signal; `detectSliceChanges` is a secondary check. The caller (`runChangeDetection`) receives both and uses the union. |
| Existing extract tests break | All new functions are additive — no existing function signatures change; `_sourceDigest` field was already read by Phase 14 recovery code |
| Missing `.source-digest.json` on first run (no prior extraction) | `readSliceDigestFile` returns null; `detectSliceChanges` treats missing as `new-slice` → changed |

## Security Considerations

- No secrets in digest payloads (file paths + content hashes only).
- SHA-256 is a content fingerprint, not reversible — no sensitive data leaked.
- `.source-digest.json` is evidence of what was extracted — tampering would
  cause a digest mismatch on the next run → changed → re-extract (self-healing).
- No hashing in the engine — all SHA-256 computation is agent-mediated,
  consistent with the project's no-direct-FS/shell invariant.

## Scope Boundary (D2.2 ONLY)

This phase implements ONLY §D2.2 (change detection — fail-closed, full digest).
It does NOT implement:

- **D2.3** (invalidation chain — `invalidateSliceChain`,
  `invalidatePersistenceEvidence`, `onSliceRemoved`) — Phase 17
- **D3** (upsert entrypoints — `--update`, `--no-update`, `--force`,
  `--feature`, `--new` CLI flags) — Phase 18
- **D4** (migration/adopt — `--adopt`) — Phase 18
- Integration of `runChangeDetection` into the extract-mode update flow —
  Phase 17/18 (this phase delivers the pure functions + agent-mediated I/O +
  the orchestrator + tests only; the update flow calls it after Phase 17
  wires the invalidation chain)

---

*Phase 16: Change Detection*
*Planned: 2026-07-24 — autonomous /gsd-plan-phase 16 --auto*
