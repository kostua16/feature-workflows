# Phase 15: Slice Ownership Reconciliation — Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Source:** Design plan §D2.1 (`plans/260723-extract-deterministic-folders-upsert/plan.md`)

<domain>
## Phase Boundary

A pure, fully-deterministic `reconcileSlices(persistedSlices, currentFiles)`
function decides which slice owns each file when scope membership changes.
No LLM, no flags, no decomposer hint. Stable sliceIds; every current file
owned by exactly one slice (partition, validated). The algorithm uses:
prefix-score assignment (removed slices excluded as candidates), zero-score
files clustered by first-2-segment directory (union-find) into
permutation-invariant new slices, content-fingerprint move detection
(duplicate content → conservative remove+add), and overlap conflict
resolution (lex-smallest sliceId wins).

This is D2.1 ONLY — it does NOT implement change detection (D2.2, Phase 16),
invalidation chain (D2.3, Phase 17), upsert entrypoints (D3, Phase 18), or
migration/adopt (D4, Phase 18). The `onSliceRemoved` parent invalidation
(D2.3) is Phase 17; Phase 15 only records the removed-slice delta.
</domain>

<decisions>
## Implementation Decisions

### Algorithm (D2.1 — locked by 5-round review)

- **Prefix score**: `score(file, slice)` = max over slice's persisted files
  of common-leading-path-segment count between the file's directory and that
  file's directory.
- **Removed slices excluded**: slices with status `removed` are never
  assignment candidates for new/added files.
- **Zero-score files → union-find clustering**: group by first-2-segment
  directory (same rule as `area` derivation in Phase 13). Each distinct
  2-seg dir → one cluster; fewer than 2 segments or unique dir → singleton.
  Permutation-invariant.
- **New-slice sliceId**: `slice-<lexSmallest(cluster contentSha256s).slice(0,12)>`
  — uses agent-provided per-file hashes (no engine hashing). Collision
  (two clusters share that contentSha256) → deterministic counter `-<n>`.
- **Move detection**: old path gone + current file's `contentSha256` matches
  a persisted per-file fingerprint → new path assigned to old owner, logged
  as move. Duplicate content (≥2 old files share a digest) → conservative
  remove+add (cannot determine which one moved).
- **Removed-slice state machine**: slice still owns ≥1 file but content
  changed → status `pending` (re-extract via D2.3). Slice emptied by
  membership loss → status `removed` (terminal for re-extraction; parent
  invalidation `onSliceRemoved` is D2.3/Phase 17).
- **Overlap conflict**: lex-smallest sliceId wins, logged.
- **Partition invariant**: every current file owned by exactly one slice.

### Function signature (locked)

```js
reconcileSlices(persistedSlices, currentFiles) → { slices, delta }
```

PURE — no agent calls, no LLM, no I/O, no `Math.random`, no `Date.now`.

### Claude's Discretion

- Internal helper decomposition (prefix-score, union-find, move-detection,
  collision-probe, partition-validation).
- Exact `delta` field shapes beyond the required categories (added, removed,
  moved, newSlices, removedSlices, overlaps).
- Test fixture file sets.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D2.1 —
  authoritative algorithm specification (5-round review-hardened)

### Prior-phase context (input types this phase consumes)
- `.planning/phases/13-deterministic-identity-and-hashing/PLAN.md` —
  per-file `contentSha256` + `scopeDigest` shape, `HASH_SOURCES_VERDICT`
- `.planning/phases/14-feature-identity-registry-lookup-integrity/PLAN.md` —
  `REGISTRY_ENTRY.files` shape `{path, contentSha256}[]`, `findFeature` pure-function pattern

### Source code to build on
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` —
  existing pure functions (`deriveFeatureFolder`, `findFeature`, `validateHashes`),
  `seedExtractQueue` (slice queue shape)
- `plugins/feature-workflows/workflows/src/schemas.mjs` —
  existing schema patterns (`additionalProperties: false` convention)
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` —
  phase-label declarations

### Requirements
- `.planning/REQUIREMENTS.md` — OWN-01

### Roadmap
- `.planning/ROADMAP.md` — Phase 15 entry with RED/GREEN/success criteria

</canonical_refs>

<specifics>
## Specific Ideas

- The `reconcileSlices` function lives in `extract-scope.mjs` alongside the
  other pure extract-mode functions (`findFeature`, `deriveFeatureFolder`).
- The `persistedSlices` input carries per-file `{path, contentSha256}`
  fingerprints (from Phase 16's `.source-digest.json` persistence — Phase 15
  defines the type, Phase 16 wires the I/O).
- The `currentFiles` input is the preflight hash result
  (`[{path, contentSha256}]` from Phase 13's `hashSources`).
- New-slice `sliceId` derivation reuses the same lex-smallest-contentSha256
  principle as Phase 13's `featureId` derivation — consistent determinism.

</specifics>

<deferred>
## Deferred Ideas

- D2.2 change detection (full-digest comparison) — Phase 16
- D2.3 invalidation chain (`invalidateSliceChain`, `onSliceRemoved`) — Phase 17
- D3 upsert entrypoints (`--update`, `--force`) — Phase 18
- D4 migration/adopt — Phase 18
- Integration of `reconcileSlices` into the extract-mode update flow — Phase 16/17

</deferred>

---

*Phase: 15-slice-ownership-reconciliation*
*Context gathered: 2026-07-24 — autonomous /gsd-plan-phase 15 --auto*
