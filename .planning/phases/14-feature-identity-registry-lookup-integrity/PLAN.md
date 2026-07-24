# Phase 14: Feature-Identity Registry, Lookup & Integrity

**Status:** Planned
**Date:** 2026-07-23
**Requirements:** REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01
**Depends on:** Phase 13 (D1.1 deterministic identity/hashing)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D1.2, §D1.3, §D1.4

## RED Gate (must fail before implementation)

1. A full rename of every file in a feature does NOT create a second folder —
   `findFeature` must find the existing feature by content hash (or block if
   the match is ambiguous).
2. Two features sharing only a config file (`package.json`/`tsconfig.json`) are
   NOT silently mismerged — the weak-only match is blocked.
3. A tie in match counts (two features with equal strong match counts) is
   blocked, not silently resolved.
4. New-folder creation that collides with an existing different feature (same
   `planDir`, different `ownershipScopeDigest`) aborts the upsert — does NOT
   overwrite.
5. A crash between registry writes leaves no torn JSON (atomic temp-then-rename).
6. A registry entry with `status: 'extracting'` and missing pipeline-state at
   startup is NOT silently promoted to `current` — recovery fails closed.

## GREEN Evidence (must pass after implementation)

1. `readRegistry` loads `docs/extract/.registry.json`; `writeRegistry` writes it
   atomically (temp-then-rename via file-writer agent).
2. `findFeature({ currentFiles, currentAnchor, registryFeatures })` is a PURE
   function returning `{ decision: 'reuse'|'new'|'blocked', featureId?, matchCount?, reason? }`.
3. `findFeature` reuses when: anchor match OR match count >= majority of
   `min(currentCount, featureCount)` AND strictly-highest among candidates.
4. `findFeature` blocks when: tie (2+ candidates with same match count),
   multiple strong candidates, or weak-only match (no anchor, no majority).
5. `findFeature` returns `'new'` when zero strong candidates exist.
6. `checkFolderCollision` compares full `ownershipScopeDigest` (64-hex) —
   mismatch on an existing folder → abort; match → idempotent safe.
7. `recoverRegistry` restores immutable ownership from `.identity.json` sidecars,
   rebuilds mutable `files`/fingerprints from current `pipeline-state.json` +
   `.source-digest.json`, fails closed if current evidence missing.
8. Registry writes use root-last readiness commit: status → `current` only after
   extraction + publish + persist are durable.
9. All registry/sidecar writes are atomic (temp-then-rename — no torn JSON).

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**REGISTRY_ENTRY** — a single feature in the registry:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['featureId', 'planDir', 'ownershipScopeDigest', 'scopeId16', 'files', 'status', 'updatedAt'],
  properties: {
    featureId: { type: 'string', description: 'Deterministic feature id' },
    planDir: { type: 'string', description: 'Repo-relative POSIX folder path' },
    ownershipScopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 scope digest (immutable, mirrors .identity.json)' },
    scopeId16: { type: 'string', description: '16-hex display/folder id' },
    files: {
      type: 'array',
      description: 'Current file set with content hashes',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string' },
          contentSha256: { type: 'string' },
        },
      },
    },
    anchorPath: { type: 'string', description: 'Anchor file path (lex-smallest, immutable ownership evidence)' },
    status: { type: 'string', enum: ['extracting', 'current', 'stale'], description: 'Registry lifecycle status' },
    updatedAt: { type: 'string', description: 'ISO timestamp of last registry update' },
  },
}
```

**REGISTRY_FILE** — the top-level registry shape:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['features'],
  properties: {
    features: {
      type: 'object',
      description: 'Map of featureId → REGISTRY_ENTRY',
      additionalProperties: { /* REGISTRY_ENTRY shape */ },
    },
  },
}
```

Export `REGISTRY_FILE` and `REGISTRY_ENTRY` in the schema export block.

### Step 2: `findFeature` pure function (`extract-scope.mjs`)

Add `findFeature(arg)` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

**PURE** — no agent calls, no LLM, no I/O.

Input:
```js
{
  currentFiles: [{ path, contentSha256 }],   // from preflight hashSources
  currentAnchor: string,                       // from deriveFeatureFolder anchorPath
  registryFeatures: [{ featureId, files: [{ path, contentSha256 }], anchorPath }]
}
```

Algorithm:
1. Build `currentPathSet` and `currentHashSet` from `currentFiles`.
2. For each registry feature, compute:
   - `pathMatches` = count of current files whose path appears in feature.files
   - `hashMatches` = count of current files whose contentSha256 appears in
     feature.files (survives full rename)
   - `totalMatches` = count of current files that match by path OR hash
     (deduplicated — a file matching both counts once)
   - `anchorMatch` = (currentAnchor === feature.anchorPath)
   - `isStrong` = anchorMatch OR totalMatches >= ceil(majority of
     min(currentFiles.length, feature.files.length))
     - majority = `Math.floor(min / 2) + 1`
3. Collect strong candidates.
4. Decision:
   - Zero strong → `{ decision: 'new' }`
   - Exactly one strong, strictly-highest match count → `{ decision: 'reuse',
     featureId, matchCount: totalMatches }`
   - Multiple strong OR tie in match counts → `{ decision: 'blocked',
     reason: 'ambiguous-match', candidates: [...] }`
   - Only weak matches (no strong candidate but some path/hash overlap) →
     `{ decision: 'blocked', reason: 'weak-only-match', weakMatches: [...] }`

Return `{ decision, featureId?, matchCount?, reason?, candidates?, weakMatches? }`.

### Step 3: Registry read/write helpers (`extract-scope.mjs`)

Add to `extract-scope.mjs`:

**`readRegistry(registryPath, result)`**
- Calls a file-reader agent to read `docs/extract/.registry.json`.
- If file does not exist → return `{ features: {} }` (empty registry — no error).
- If file exists but is invalid JSON → return null (caller fails closed).
- Validates against `REGISTRY_FILE` schema.

**`writeRegistry(registryPath, registry, result)`**
- Calls file-writer agent with temp-then-rename.
- JSON.stringify with 2-space indent.
- Returns `{ ok: true, path: registryPath }` or null.

**`upsertRegistryEntry(registry, entry)`**
- Pure function — takes a registry object and a REGISTRY_ENTRY, returns a new
  registry with `registry.features[entry.featureId] = entry`.
- Does NOT mutate the input registry.

**`readIdentitySidecar(identityPath, result)`**
- Calls file-reader agent to read `<planDir>/.identity.json`.
- Validates against `IDENTITY_RECORD` schema.
- Returns the identity object or null.

### Step 4: Collision guard (`extract-scope.mjs`)

Add `checkFolderCollision(arg)` to `extract-scope.mjs`:

Input:
```js
{
  planDir: string,                  // derived planDir for the new feature
  requesterDigest: string,          // full 64-hex ownershipScopeDigest from preflight
  result: object,                   // workflow result for agent calls
}
```

Algorithm:
1. Check if `<planDir>/.identity.json` exists (file-reader agent).
2. If not exists → `{ collision: false }` (no existing feature — safe to create).
3. If exists → read identity sidecar, compare `requesterDigest` against
   `identity.ownershipScopeDigest`:
   - Same → `{ collision: false, idempotent: true }` (same feature — safe).
   - Different → `{ collision: true, existingFeatureId: identity.featureId }`
     (ABORT — would overwrite another feature).

### Step 5: Startup recovery (`extract-scope.mjs`)

Add `recoverRegistry(arg)` to `extract-scope.mjs`:

Input:
```js
{
  registryPath: string,
  result: object,
}
```

Algorithm:
1. Read current registry via `readRegistry`.
2. If registry is null (corrupt/missing) → scan `docs/extract/` for all
   `.identity.json` sidecars to rebuild the feature map.
3. For each registry entry with `status: 'extracting'`:
   a. Read `<planDir>/pipeline-state.json` (file-reader agent).
   b. If pipeline-state exists and is complete (has `_gateCheckpoints` or
      equivalent durable extraction evidence):
      - Read `<planDir>/.source-digest.json` or current file hashes from
        pipeline-state.
      - Update entry: `files` from current source-digest, `status: 'current'`
        (or `'stale'` if source-digest indicates changes), `updatedAt: timestamp`.
   c. If pipeline-state missing or incomplete → **fail-closed**: set
      `status: 'stale'`, add `recoveryError: 'missing-pipeline-state'`. The
      caller blocks with a repair handoff.
4. For each entry: verify `.identity.json` still exists. If missing → set
   `status: 'stale'`, add `recoveryError: 'missing-identity'`.
5. Write recovered registry atomically.
6. Return `{ recovered: N, failed: M, registry }`.

**Key invariant:** immutable fields (`featureId`, `planDir`,
`ownershipScopeDigest`) are ALWAYS sourced from `.identity.json` sidecars, NEVER
from the potentially-stale registry. Mutable fields (`files`, `status`,
`updatedAt`) are rebuilt from current pipeline-state/source-digest.

### Step 6: Integrate findFeature into extract flow (`main.mjs`)

**Fresh extract run (Gate X0 preflight section):**

After `resolveScopePreflight` returns with `fileHashes`, `scopeDigest`,
`featureId`, `derivedPlanDir`:
1. Read the registry via `readRegistry`.
2. Build `registryFeatures` array from registry entries.
3. Call `findFeature({ currentFiles: preflight.fileHashes, currentAnchor:
   preflight.anchorPath, registryFeatures })`.
4. If `decision === 'reuse'`:
   - Set `planDir` to the reused feature's `planDir`.
   - Flag as an update (existing feature revision, not new).
   - Skip collision guard (no folder creation).
5. If `decision === 'new'`:
   - Set `planDir` to `preflight.derivedPlanDir`.
   - Run collision guard (Step 4) before promotion.
   - If collision → blocked handoff: "Folder `<planDir>` is owned by feature
     `<existingFeatureId>`. Use `--feature=<existingFeatureId>` to update it,
     or `--new` to create a distinct folder."
6. If `decision === 'blocked'`:
   - Blocked handoff with reason: "Feature identity is ambiguous
     (`reason`). Use `--feature=<featureId>` to select a specific feature, or
     `--new` to create a new folder."
   - Do NOT proceed to promotion.

**`--confirm` promotion path:**

When promoting a pending record:
1. If the preflight recorded `findFeatureDecision`:
   - `'reuse'` → use the reused feature's `planDir` (existing-feature branch in
     `promotePendingRecord`).
   - `'new'` → use `derivedPlanDir` (new-feature branch), run collision guard.
   - `'blocked'` → do not promote; return the blocked handoff.

**Registry update after promotion:**

After `promotePendingRecord` succeeds:
1. Build a `REGISTRY_ENTRY` from the promotion result:
   - `featureId`, `planDir`, `ownershipScopeDigest`, `scopeId16` from identity.
   - `files` = `preflight.fileHashes` (current file set).
   - `anchorPath` = `preflight.anchorPath`.
   - `status: 'extracting'` (will be set to `'current'` after root-last
     readiness commit).
   - `updatedAt: timestamp`.
2. `upsertRegistryEntry(registry, entry)`.
3. `writeRegistry(registryPath, updatedRegistry)` — atomic.
4. **Root-last readiness commit:** after extraction + publish + persist are
   durable, update the registry entry `status` from `'extracting'` to
   `'current'` and `writeRegistry` again.

### Step 7: Startup recovery integration (`main.mjs`)

At the start of the extract-mode flow (before Gate X0):
1. Check if `docs/extract/.registry.json` exists.
2. If exists → call `recoverRegistry({ registryPath, result })`.
3. If recovery reports failures (`failed > 0`) → log warnings but do not block
   (entries are marked `'stale'`; the user can re-extract to recover).
4. If recovery reports corrupt registry that cannot be rebuilt → fail-closed
   blocked handoff with repair guidance.

### Step 8: Meta phase declarations

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase titles to the `phases` array:
- `{ title: 'Registry Lookup' }` — findFeature + collision guard
- `{ title: 'Registry Recovery' }` — startup recovery

### Step 9: Command doc update (`extract-design.md`)

Update `plugins/feature-workflows/commands/extract-design.md`:
- Document the feature-identity registry (`.registry.json` + `.identity.json`).
- Document rename-resilient lookup: folders are sticky across renames (content
  hash matching).
- Document the defensible threshold: weak/ambiguous matches require explicit
  `--feature=<id>` or `--new`.
- Document the collision guard: prevents overwriting another feature's folder.
- Document startup recovery: extracting entries are reconciled from current
  state; missing evidence → fail-closed.
- Note: concurrent same-feature invocations are unsupported.

### Step 10: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline 1805 + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add REGISTRY_FILE, REGISTRY_ENTRY |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add findFeature, readRegistry, writeRegistry, upsertRegistryEntry, readIdentitySidecar, checkFolderCollision, recoverRegistry |
| `plugins/feature-workflows/workflows/src/main.mjs` | Integrate findFeature before promotion, collision guard, registry update after promotion, startup recovery, root-last readiness commit |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Registry Lookup' and 'Registry Recovery' phases |
| `plugins/feature-workflows/commands/extract-design.md` | Document registry, lookup, collision, recovery |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/feature-identity-registry.test.mjs` | D1.2 tests (findFeature, registry read/write, collision guard) |
| `tests/registry-integrity-recovery.test.mjs` | D1.3 tests (atomic writes, root-last, startup recovery, fail-closed) |

## Test Specification

### tests/feature-identity-registry.test.mjs

#### RED tests (must fail before implementation)

1. Full rename scenario: all paths changed but contentSha256 unchanged → must
   reuse existing feature (not create new). Without `findFeature`, this creates
   a second folder.
2. Weak-only match: two features sharing only `package.json` → must block (not
   auto-attach the second feature to the first).
3. Tie: two features with equal strong match counts → must block.
4. Collision: new feature derives same `planDir` as existing different feature
   → must abort upsert.

#### GREEN tests — findFeature pure function

5. `findFeature`: anchor match (same anchorPath) → reuse, even if all paths
   changed (content hash match).
6. `findFeature`: majority match (>= majority of min(currentCount, featureCount))
   → reuse.
7. `findFeature`: zero strong candidates → new.
8. `findFeature`: two strong candidates with different match counts →
   strictly-highest reuses.
9. `findFeature`: two strong candidates with same match count → blocked
   (ambiguous-match).
10. `findFeature`: weak-only match (shared config file, no anchor, no majority)
    → blocked (weak-only-match).
11. `findFeature`: single shared file that is a majority for a small feature but
    not for a large one → uses min(currentCount, featureCount) correctly.
12. `findFeature`: empty registry → new (no candidates).
13. `findFeature`: empty currentFiles → blocked (no input to match).
14. `findFeature`: matchCount deduplicates path+hash dual matches (counts once).
15. `findFeature`: returns structured result (decision, featureId, matchCount,
    reason) — does not throw on ambiguous.

#### GREEN tests — registry read/write

16. `readRegistry`: file does not exist → returns `{ features: {} }`.
17. `readRegistry`: valid registry → returns parsed object.
18. `readRegistry`: corrupt JSON → returns null (fail-closed).
19. `writeRegistry`: uses file-writer agent + temp-then-rename (source assertion).
20. `writeRegistry`: JSON.stringify with 2-space indent (source assertion).
21. `upsertRegistryEntry`: pure — does not mutate input registry.
22. `upsertRegistryEntry`: adds new entry to features map.
23. `upsertRegistryEntry`: overwrites existing entry (same featureId).

#### GREEN tests — collision guard

24. `checkFolderCollision`: no existing `.identity.json` → no collision.
25. `checkFolderCollision`: existing identity with SAME digest → no collision
    (idempotent).
26. `checkFolderCollision`: existing identity with DIFFERENT digest → collision
    (abort).
27. `checkFolderCollision`: compares FULL 64-hex digest, not truncated featureId
    (source assertion — uses ownershipScopeDigest field).

#### GREEN tests — schemas

28. `REGISTRY_ENTRY` schema has `additionalProperties: false`.
29. `REGISTRY_ENTRY` schema requires all 7 fields.
30. `REGISTRY_FILE` schema has `features` as object with `additionalProperties`.
31. `REGISTRY_ENTRY.status` enum is `['extracting', 'current', 'stale']`.
32. `REGISTRY_ENTRY.files` items have `additionalProperties: false`.

#### GREEN tests — main.mjs integration

33. Fresh extract run calls `findFeature` after preflight (source assertion).
34. `findFeature` 'reuse' → sets planDir to reused feature's planDir (source
    assertion).
35. `findFeature` 'new' → calls `checkFolderCollision` before promotion (source
    assertion).
36. `findFeature` 'blocked' → returns blocked handoff, does NOT promote (source
    assertion).
37. After promotion, `upsertRegistryEntry` + `writeRegistry` called (source
    assertion).
38. Registry entry initial status is `'extracting'` (source assertion).
39. Root-last readiness commit updates status to `'current'` (source assertion).

### tests/registry-integrity-recovery.test.mjs

#### RED tests

40. Crash between registry writes → no torn JSON (temp-then-rename assertion).
41. Registry entry `status: 'extracting'` with missing pipeline-state at startup
    → NOT promoted to `current` (fail-closed).

#### GREEN tests — atomicity + authority

42. Registry writes use temp-then-rename (source assertion on writeRegistry).
43. Authority order: pipeline-state > registry > sidecar (documented in comments
    — source assertion).
44. Root-last: registry status commit is the final write after publish+persist
    (source assertion — ordering check).

#### GREEN tests — startup recovery

45. `recoverRegistry`: entry with complete pipeline-state → files rebuilt from
    source-digest, status → 'current'.
46. `recoverRegistry`: entry with missing pipeline-state → status → 'stale',
    recoveryError set (fail-closed).
47. `recoverRegistry`: entry with missing `.identity.json` → status → 'stale',
    recoveryError set.
48. `recoverRegistry`: immutable fields sourced from `.identity.json` sidecar
    (not from stale registry entry).
49. `recoverRegistry`: mutable fields rebuilt from current pipeline-state (not
    from creation-time sidecar).
50. `recoverRegistry`: corrupt registry → scan sidecars to rebuild (if any
    sidecars exist).
51. `recoverRegistry`: corrupt registry with no sidecars → fail-closed blocked.
52. `recoverRegistry`: empty registry → no-op (nothing to recover).
53. `recoverRegistry`: multiple extracting entries → each recovered independently.

#### GREEN tests — cross-cutting

54. `findFeature` is pure (no `safeAgent`/`flexibleAgent`/`async` — source
    assertion).
55. `upsertRegistryEntry` is pure (no agent calls — source assertion).
56. No `Math.random` or `Date.now` in `findFeature` or `upsertRegistryEntry`
    (source assertion).
57. Meta phases include `Registry Lookup` and `Registry Recovery`.
58. Registry path is `docs/extract/.registry.json` (source assertion).
59. `readIdentitySidecar` validates against `IDENTITY_RECORD` schema (source
    assertion).
60. `findFeature` matchCount uses deduplication (path OR hash, not path + hash).

## Success Criteria

1. Sticky folder across add/remove/rename/entry-point change (content hash
   matching finds the feature even when all paths change).
2. Ambiguous/weak matches blocked (no silent mismerge of features sharing
   config files).
3. Recovery rebuilds current (not stale) mutable fields from pipeline-state;
   immutable fields from sidecars.
4. Collision guard prevents overwriting another feature's folder.
5. Full test suite green (1805 baseline + new D1.2/D1.3/D1.4 tests).
6. Build drift-free (`npm run validate:build`).
7. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Registry grows unbounded | Entries are keyed by featureId (bounded by feature count); no TTL needed (features are durable) |
| findFeature false positive on shared boilerplate | Defensible threshold requires anchor OR majority; weak-only matches blocked |
| Recovery reads stale source-digest | Recovery reads from pipeline-state.json (run truth), not creation-time sidecars; fail-closed if missing |
| Collision guard TOCTOU (folder created between check and write) | Concurrent invocations unsupported by design; documented |
| Registry write crash between entry update and root-last commit | Atomic temp-then-rename per write; entry stays 'extracting' until root-last; recovery reconciles on next startup |
| Large registry read latency | Single JSON file, typically <100 features; acceptable for CLI scale |

## Security Considerations

- No secrets in registry (file paths + content hashes + feature metadata only).
- `ownershipScopeDigest` is a SHA-256 content fingerprint — tamper-evident
  (collision guard compares full digest).
- Registry file is not executable — JSON only.
- Fail-closed recovery prevents stale/corrupt state from silently overwriting
  current data.

## Scope Boundary (D1.2–D1.4 ONLY)

This phase implements ONLY §D1.2 (registry + rename-resilient lookup), §D1.3
(registry integrity + recovery), and §D1.4 (collision guard). It does NOT
implement:
- D2.1 (ownership reconciliation) — Phase 15
- D2.2 (change detection) — Phase 16
- D2.3 (invalidation chain) — Phase 17
- D3 (upsert entrypoints + flags) — Phase 18
- D4 (migration/adopt) — Phase 18

---

*Phase 14: Feature-Identity Registry, Lookup & Integrity*
*Planned: 2026-07-23 — autonomous /gsd-plan-phase 14 --auto*
