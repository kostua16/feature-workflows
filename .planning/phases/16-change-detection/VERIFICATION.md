---
phase: 16
slug: change-detection
status: verified
verdict: MET
verified_at: 2026-07-24
verified_by: autonomous-uat
method: goal-backward UAT
tests_pass: 2187
tests_fail: 0
---

# Phase 16 — UAT Verification

> Goal-backward UAT of Phase 16 (CHANGE-01 / D2.2 — fail-closed full-digest change detection).
> Autonomously verified; no human interaction required.

## Goal

> On update, source changes (added/removed/moved/renamed) are detected by
> comparing full 64-hex SHA-256 digests over framed per-file
> `(path, contentSha256)`; hash failure/missing/malformed is fail-closed
> (treated as changed — re-extract, never skip), and an unverifiable slice
> blocks with `extractReady=false`.

**Success Criteria** (from ROADMAP / PLAN):
1. Unchanged sources → skip (correct unchanged decision).
2. Any change (added/removed/moved/renamed bytes) → invalidate + re-extract
   in place (correct changed decision).
3. Framed distinctness: `["ab","c"]` vs `["a","bc"]` produce different
   digests — no false negatives from path-hash ambiguity.

**RED Gate**: A hash failure must NEVER classify changed sources as unchanged.

**GREEN Evidence**: full 64-hex SHA-256 over framed `(path, contentSha256)`;
fail-closed (failure/missing/malformed → changed; unverifiable →
`extractReady=false`); schema-validated before persist.

## Verdict: MET

All three success criteria verified against delivered source with 2187
passing tests (132 new for D2.2), source-level assertions, and build
drift-free validation.

## Verification Method

Goal-backward UAT — each goal component was decomposed backward into
observable properties, then verified three ways:

1. **Test suite** — 2187 tests pass (77 behavioral in
   `tests/change-detection.test.mjs` + 55 Nyquist in
   `tests/change-detection-nyquist.test.mjs`), exercising pure functions
   with real inputs against the shipped dist.
2. **Source assertions** — regex/structural checks on both dist and source
   modules confirming no crypto in engine, agent-mediated hashing, fail-closed
   semantics, force override, extractReady guard, and Phase 17 boundary.
3. **Build drift** — `npm run validate:build` confirms both dist files
   are up to date (33 modules, 371 top-level names each).

## What Was Verified

### SC-1: Unchanged → skip

- `detectSliceChanges` with matching digests returns `{status: 'unchanged',
  reason: 'digest-match'}` (test line 196).
- `unchangedCount` tallied correctly; all-unchanged case yields
  `unchangedCount === N, changedCount === 0` (test lines 305-314).

### SC-2: Any change → invalidate + re-extract

- **Digest mismatch** → `changed / digest-mismatch` (test line 199).
- **New slice** (in current, not in persisted) → `changed / new-slice`
  (test line 203).
- **Removed slice** (in persisted, not in current) → `changed /
  slice-removed` (test line 211).
- **Invalid current digest** → `changed / current-invalid` (fail-closed,
  test line 219).
- **Invalid persisted digest** → `changed / persisted-invalid` (fail-closed,
  test line 227).
- **Missing current entry** (undefined) → `changed / current-invalid`
  (test line 235).
- **Both invalid** → `current-invalid` takes precedence (checked first,
  test line 327 — Nyquist GAP-2).
- **Null persisted digest** → `persisted-invalid` (Nyquist test line 75).
- **Undefined persisted digest** → `persisted-invalid` (Nyquist line 80).
- **Empty string persisted** → `persisted-invalid` (Nyquist line 85).
- **32-hex (MD5-length) persisted** → `persisted-invalid` (Nyquist line 90).
- **64-uppercase-hex persisted** → `persisted-invalid` (Nyquist line 95).
- **All 4 fail-closed reasons exercised in one run** (Nyquist GAP-3 line 143).

### SC-3: Framed distinctness

- `["ab","c"]` vs `["a","bc"]` produce different frames — the JSON pair
  structure `[path, hash]` prevents path-hash ambiguity (test line 108).
- Same content hash at different paths → different frames (test line 115,
  Nyquist line 32).
- Different content hash at same path → different frames (Nyquist line 37).
- Path with slashes vs backslashes → different frames (Nyquist line 42).
- Unicode path preserved in UTF-8 (Nyquist line 47).
- Prefix collision: `"src/a"` vs `"src/ab"` → different frames (Nyquist
  GAP-1 line 65).
- Two-file vs one-file with same hash → different (test line 112).
- Multi-file framing: two-file vs concatenated, path-hash swap (Nyquist
  GAP-13).

### RED Gate: hash failure never skips

- Source assertion: `detectSliceChanges` is PURE — no `safeAgent`,
  `flexibleAgent`, `async`, `Date.now`, `Math.random` in function body
  (test line 57).
- Source assertion: no `crypto`/`createHash` in `frameSliceDigest` body
  (test line 45).
- Source assertion: no `crypto` import in `extract-scope.mjs` source
  module (test lines 53, 560).
- Source assertion: `computeSliceDigests` has no `crypto`/`createHash`
  in body — engine never hashes directly (test line 372).
- Source assertion: `computeSliceDigests` prompt instructs SHA-256
  hashing (test line 364).
- Source assertion: all pure functions have no `safeAgent`/`flexibleAgent`/
  `async` (test line 529).
- Source assertion: no `Math.random` or `Date.now` in any Phase 16
  function (test line 536).

### GREEN Evidence: full 64-hex + fail-closed + schema-validated

- `validateDigest64Hex` boundary tests: exactly 64-hex valid, 63/65
  invalid, uppercase invalid, empty invalid, non-string invalid, non-hex
  invalid (test lines 139-180, Nyquist GAP-5).
- `writeSliceDigestFile` validates digest via `validateDigest64Hex`
  BEFORE calling agent (source assertion, test line 437).
- `writeSliceDigestFile` returns null when digest invalid (source
  assertion, test line 444).
- `runChangeDetection` persists only when `curEntry.valid` is true
  (source assertion, Nyquist GAP-12 line 429).
- `runChangeDetection` sets `extractReady=false` when any slice is
  `current-invalid` (source assertion, Nyquist GAP-12 line 420).
- `runChangeDetection` force override: all decisions → `changed / forced`
  (source assertion, test line 489, Nyquist GAP-10).
- `runChangeDetection` does NOT call `invalidateSliceChain` (Phase 17
  scope — source assertion, test line 497).
- `SLICE_DIGEST` schema: `additionalProperties: false`, requires
  `files` + `digest` (test lines 543-564).
- `SLICE_DIGEST_RESULT` schema: `additionalProperties: false`, requires
  `slices` (test lines 549-564).
- `computeSliceDigests` calls `safeAgent` with `SLICE_DIGEST_RESULT`
  schema, label `slice-digest`, phase `Change Detection` (source
  assertions, test lines 355-390).
- Meta phase `Change Detection` declared (test line 567, source
  confirmed in `meta/feature-pipeline.meta.mjs` line 49).
- Permutation invariance: 5-file slice (120 permutations) and 10-file
  slice (50 shuffles) produce identical frames (Nyquist GAP-4).

## Implementation Summary

| Component | Location | Evidence |
|-----------|----------|----------|
| `frameSliceDigest` | `extract-scope.mjs:1314` | Pure sort + JSON-frame; no crypto |
| `validateDigest64Hex` | `extract-scope.mjs:1324` | 64-lowercase-hex regex; fail-closed |
| `detectSliceChanges` | `extract-scope.mjs:1338` | 6 fail-closed reasons; independent loops |
| `computeSliceDigests` | `extract-scope.mjs:1392` | Agent-mediated SHA-256; engine never hashes |
| `writeSliceDigestFile` | `extract-scope.mjs:1416` | Validates before agent write; fail-closed |
| `readSliceDigestFile` | `extract-scope.mjs:1446` | Returns validity flag; null on missing |
| `runChangeDetection` | `extract-scope.mjs:1474` | Orchestrator; force, extractReady, persist |
| `SLICE_DIGEST` | `schemas.mjs:1239` | `additionalProperties: false` |
| `SLICE_DIGEST_RESULT` | `schemas.mjs:1262` | `additionalProperties: false` |
| Meta phase | `meta/feature-pipeline.meta.mjs:49` | `Change Detection` declared |

## Test Totals

| Suite | Tests |
|-------|-------|
| change-detection.test.mjs | 77 |
| change-detection-nyquist.test.mjs | 55 |
| Full suite | 2187 pass / 0 fail |

## Build Status

- Dist drift-free: both `feature-pipeline.js` and `fp-extract-slice.js`
  up to date (33 modules, 371 top-level names each).
- `npm run validate:build` — exit 0.

## Commits Verified

| Hash | Description |
|------|-------------|
| `07bc0dd` | Plan: change detection (D2.2) |
| `6c0ae80` | Feat: add change detection with SHA-256 slice digests |
| `4c933fc` | Nyquist validation — 22 characterization tests |

## Scope Boundary

Phase 16 implements ONLY D2.2 (change detection primitives + orchestrator +
tests). It does NOT implement:
- D2.3 (invalidation chain) — Phase 17
- D3 (upsert entrypoints / CLI flags) — Phase 18
- D4 (migration / adopt) — Phase 18
- Integration of `runChangeDetection` into the extract-mode update flow —
  Phase 17/18

## Concerns

None. All success criteria MET, all RED gates fail-closed verified,
build drift-free, full suite green.

---

*Phase 16: Change Detection — verified 2026-07-24*
