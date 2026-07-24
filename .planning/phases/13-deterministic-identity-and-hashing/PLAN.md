# Phase 13: Deterministic Identity & Hashing

**Status:** Planned
**Date:** 2026-07-23
**Requirements:** IDENT-01, FOLDER-01
**Depends on:** Phase 12 (D0 pending-confirmation + promotion)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D1.1 + §Hashing

## RED Gate (must fail before implementation)

1. Missing per-file `contentSha256` on any file in the preflight verdict does NOT
   derive a folder — identity selection is blocked (no folder created, no
   `.identity.json` written).
2. Malformed `contentSha256` (not 64-hex) blocks identity selection.
3. Missing or malformed `scopeDigest` blocks identity selection.
4. The categorizer LLM is NOT invoked for extract-mode fresh-run planDir
   derivation (source assertion — the categorizer path is bypassed for extract).
5. No SHA-256 computation runs inside the engine/sandbox (source assertion —
   hashing is exclusively agent-mediated).

## GREEN Evidence (must pass after implementation)

1. `resolveScopePreflight` calls a `hashSources` agent step after scope
   resolution; the agent reads each file and returns per-file `contentSha256`
   (64-hex) + full `scopeDigest` (64-hex SHA-256 over framed sorted
   `(path, contentSha256)` pairs).
2. Pure validation function `validateHashes(fileHashes, scopeDigest)` returns
   `{ valid: true }` only when every `contentSha256` is 64-hex and `scopeDigest`
   is 64-hex; otherwise `{ valid: false, reason }` (fail-closed).
3. Pure derivation function `deriveFeatureFolder({ fileHashes, scopeDigest, entryPoints })`
   returns `{ area, primarySlug, scopeId16, featureId, planDir, anchorPath }` —
   fully deterministic, no agent calls, no LLM.
4. `area` = first 2 path segments of the anchor (lex-smallest non-entry-point)
   file's repo-relative POSIX path; fewer than 2 segments → `uncategorized`.
5. `primarySlug` = slug of the anchor file's basename (using `categorizeSlug`).
6. `scopeId16` = first 16 hex chars of `scopeDigest`.
7. `featureId` = `<primarySlug>-<scopeId16>`.
8. `planDir` = `docs/extract/<area>/<featureId>/` (POSIX, repo-relative).
9. The derived `planDir` replaces the categorizer-derived path for extract mode
   fresh runs AND `--confirm` promotion.
10. `.identity.json` `ownershipScopeDigest` is the real `scopeDigest` (64-hex),
    not the Phase 12 `null` stub.
11. Same resolved scope → same `planDir` across runs (deterministic).
12. All paths are repo-relative POSIX (forward slashes, no leading `./` or `/`).

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**HASH_SOURCES_VERDICT** — the hash-sources agent return shape:
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['files', 'scopeDigest'],
  properties: {
    files: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash',
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
    scopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs' },
  },
}
```

**IDENTITY_RECORD** — the `.identity.json` shape (extends the Phase 12 stub):
```js
{
  type: 'object',
  additionalProperties: false,
  required: ['featureId', 'planDir', 'ownershipScopeDigest', 'area', 'createdAt'],
  properties: {
    featureId: { type: 'string' },
    planDir: { type: 'string' },
    ownershipScopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 scope digest (immutable at creation)' },
    area: { type: 'string', description: 'First-2-segment area, fixed at creation' },
    scopeId16: { type: 'string', description: '16-hex display/folder id' },
    createdAt: { type: 'string' },
  },
}
```

Extend **PREFLIGHT_VERDICT** and **PENDING_RECORD** with optional fields:
- `fileHashes` (array of `{path, contentSha256}`) — per-file hashes from the
  hash-sources agent.
- `scopeDigest` (string) — full 64-hex combined digest.
- `featureId` (string) — derived deterministic feature id.
- `derivedPlanDir` (string) — the deterministic `docs/extract/<area>/<featureId>/`
  path (distinct from the existing optional `planDir` which is set at promotion).

Export `HASH_SOURCES_VERDICT` and `IDENTITY_RECORD` in the schema export block.

### Step 2: Hash-sources agent function (`extract-scope.mjs`)

Add `hashSources({ files, result })` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

- Takes the resolved file paths (string array from the scope verdict).
- Calls an agent (label: `hash-sources`, phase: `Hash Sources`) with the
  `HASH_SOURCES_VERDICT` schema and model `gm('todo')`.
- Agent prompt: instruct the agent to read each file at the given paths using
  Serena tools or shell, compute SHA-256 of each file's content using Node's
  `crypto` module (available to agents), then sort all `(path, contentSha256)`
  pairs by path ascending, frame as `JSON.stringify(pairs)` where each pair is
  `[path, contentSha256]`, and compute SHA-256 of that framed string →
  `scopeDigest`.
- Returns `{ files: [{path, contentSha256}], scopeDigest }` or null on failure.

Key constraint: the engine NEVER computes SHA-256. All hashing is agent-mediated.
The framing recipe (sorted-by-path array of `[path, hash]` pairs, JSON.stringify,
SHA-256) is described in the agent prompt so the agent produces a deterministic
result.

### Step 3: Pure validation + derivation functions (`extract-scope.mjs`)

Add pure (no agent calls) functions to `extract-scope.mjs`:

**`validateHashes(fileHashes, scopeDigest)`**
- Checks every `contentSha256` matches `/^[0-9a-f]{64}$/` (64 lowercase hex).
- Checks `scopeDigest` matches `/^[0-9a-f]{64}$/`.
- Checks `fileHashes` is a non-empty array of `{path, contentSha256}` objects.
- Returns `{ valid: true }` or `{ valid: false, reason: '...' }`.

**`deriveFeatureFolder({ fileHashes, scopeDigest, entryPoints })`**
- `entryPointSet` = Set of entry point paths (may be empty).
- `candidatePaths` = fileHashes paths sorted ascending, excluding any path in
  `entryPointSet`. If all files are entry points, falls back to all paths sorted.
- `anchorPath` = `candidatePaths[0]` (lex-smallest).
- `segments` = `anchorPath` split by `/`, filtered Boolean.
- `area` = `segments.length >= 2 ? segments[0] + '/' + segments[1]` :
  `'uncategorized'`.
- `primarySlug` = `categorizeSlug(segments[segments.length - 1])` (slug of the
  filename — last segment).
- `scopeId16` = `scopeDigest.slice(0, 16)`.
- `featureId` = `primarySlug + '-' + scopeId16`.
- `planDir` = `'docs/extract/' + area + '/' + featureId + '/'`.
- Returns `{ area, primarySlug, scopeId16, featureId, planDir, anchorPath }`.

**`normalizeToPosix(path)`**
- Replaces backslashes with forward slashes.
- Strips leading `./` and `/`.
- Returns repo-relative POSIX path.

### Step 4: Integrate hashing into `resolveScopePreflight` (`extract-scope.mjs`)

Modify `resolveScopePreflight` to add hash+derive steps after scope resolution:

1. Call existing code-explorer agent (unchanged — resolves scope, returns
   `SCOPE_VERDICT` with file paths).
2. If verdict has files, call `hashSources({ files: verdict.files, result })`.
3. If `hashSources` returns null → return null (blocked — can't hash).
4. Call `validateHashes(hashResult.files, hashResult.scopeDigest)`.
5. If invalid → return a blocked preflight result with
   `{ state: 'PENDING', hashError: validation.reason }` — the caller writes the
   pending record and returns a blocked handoff instructing the user to
   re-preflight or use `--feature=<featureId>`.
6. If valid → normalize all paths to POSIX, call `deriveFeatureFolder(...)`.
7. Return the extended preflight result:
   ```
   { pendingId, task, verdict, state: 'PENDING', createdAt,
     fileHashes, scopeDigest, featureId, derivedPlanDir }
   ```

### Step 5: Identity writer upgrade (`extract-scope.mjs`)

Rename/replace `writeIdentityStub` → `writeIdentity`:

- Accepts `{ identityPath, featureId, planDir, scopeDigest, area, scopeId16, createdAt, result }`.
- Writes `IDENTITY_RECORD`-shaped JSON with the real `ownershipScopeDigest`
  (the full 64-hex `scopeDigest`), not `null`.
- Uses the same file-writer agent + temp-then-rename pattern.

### Step 6: Extract-mode planDir override (`main.mjs`)

**Fresh extract run (Gate X0 preflight section, ~L1156+):**

After `resolveScopePreflight` returns:
- If preflight has `derivedPlanDir`, override `planDir` with the deterministic
  path for the rest of the extract flow.
- Store `result.fileHashes`, `result.scopeDigest`, `result.featureId` for
  promotion.
- The `awaiting-scope-confirm` handoff uses the deterministic `planDir`.

**`--confirm` promotion path (~L1158):**

When `confirmRecord` is set (PENDING state) and the pending record has
`derivedPlanDir`:
- Override `planDir` with `confirmRecord.derivedPlanDir` before calling
  `promotePendingRecord`.
- Pass `fileHashes`, `scopeDigest`, `featureId`, `area`, `scopeId16` from the
  pending record to `promotePendingRecord` → `writeIdentity`.

**Categorizer bypass for extract mode (~L492):**

For extract mode fresh runs, the categorizer should NOT be the source of
`planDir`. Two approaches (pick the simpler):
- (A) Skip the categorizer block entirely when `isExtractMode && !explicitPlanPath
  && !resumeArg && !confirmRecord` — the preflight will set `planDir` later.
- (B) Let the categorizer run but unconditionally override `planDir` after
  preflight with the deterministic value.

Approach (A) is cleaner. When extract mode skips the categorizer, set a
temporary placeholder `planDir` (e.g. `'docs/extract/.pending/'`) that gets
overridden after preflight. The placeholder is never visible to the user because
the preflight returns `awaiting-scope-confirm` with the real derived `planDir`.

For `--resume` in extract mode, the persisted `planDir` is authoritative (no
change — resume path already skips re-categorization).

### Step 7: Modify `promotePendingRecord` (`extract-scope.mjs`)

Update `promotePendingRecord` to accept and use identity fields:

- Accept `identityFields` arg: `{ scopeDigest, area, scopeId16, featureId }`.
- NEW branch: call `writeIdentity` (not `writeIdentityStub`) with the real
  `ownershipScopeDigest = scopeDigest`.
- EXISTING branch: unchanged (never touches `.identity.json`).

### Step 8: Meta phase declaration

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add phase title `{ title: 'Hash Sources' }` to the `phases` array.

### Step 9: Command doc update (`extract-design.md`)

Update `plugins/feature-workflows/commands/extract-design.md`:
- Document that extract folders are now deterministic (no categorizer LLM).
- Note the folder structure: `docs/extract/<area>/<featureId>/`.
- Document the hash-validation gate (missing/malformed hashes block identity
  selection; use `--feature=<featureId>` to override).

### Step 10: Generate dist + validate

- `npm run build` — regenerate both dist entries.
- `npm run validate:build` — verify drift-free.
- `npm test` — full suite must pass (baseline 1628 + new tests).

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add HASH_SOURCES_VERDICT, IDENTITY_RECORD; extend PREFLIGHT_VERDICT + PENDING_RECORD with hash/folder fields |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add hashSources, validateHashes, deriveFeatureFolder, normalizeToPosix, writeIdentity; modify resolveScopePreflight + promotePendingRecord |
| `plugins/feature-workflows/workflows/src/main.mjs` | Extract-mode categorizer bypass; deterministic planDir override after preflight; pass identity fields through promotion |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Hash Sources' phase |
| `plugins/feature-workflows/commands/extract-design.md` | Document deterministic folders + hash validation |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/deterministic-identity.test.mjs` | D1.1 tests (hashing, validation, derivation, identity, integration) |

## Test Specification (tests/deterministic-identity.test.mjs)

### RED tests (must fail before implementation)

1. `resolveScopePreflight` without hashSources integration → no `fileHashes` or
   `scopeDigest` in result → identity selection blocked.
2. Missing `contentSha256` on a file → `validateHashes` returns invalid.
3. Malformed `contentSha256` (not 64-hex, e.g. 32-hex or uppercase) → invalid.
4. Missing `scopeDigest` → `deriveFeatureFolder` throws/blocks.
5. Malformed `scopeDigest` (not 64-hex) → invalid.
6. Source assertion: categorizer agent (CATEGORY_VERDICT) is NOT called in the
   extract-mode fresh-run path.

### GREEN tests — hash validation

7. `validateHashes`: all 64-hex contentSha256 + 64-hex scopeDigest → valid.
8. `validateHashes`: empty fileHashes array → invalid.
9. `validateHashes`: null/undefined inputs → invalid.
10. `validateHashes`: 63-hex contentSha256 → invalid (too short).
11. `validateHashes`: 65-hex contentSha256 → invalid (too long).
12. `validateHashes`: uppercase hex → invalid (must be lowercase).

### GREEN tests — folder derivation

13. `deriveFeatureFolder`: 3-segment path `src/auth/login.ts` → area `src/auth`.
14. `deriveFeatureFolder`: 1-segment path `README.md` → area `uncategorized`.
15. `deriveFeatureFolder`: 2-segment path `lib/utils.ts` → area `lib/utils`.
16. `deriveFeatureFolder`: entry points excluded from anchor —
    `entryPoints: ['aaa/entry.ts']`, files include `aaa/entry.ts` + `bbb/core.ts`
    → anchor is `bbb/core.ts` (entry point excluded).
17. `deriveFeatureFolder`: all files are entry points → fallback to all paths
    (lex-smallest of the full set).
18. `deriveFeatureFolder`: `primarySlug` from anchor filename.
19. `deriveFeatureFolder`: `scopeId16` = first 16 hex of scopeDigest.
20. `deriveFeatureFolder`: `featureId` = `<primarySlug>-<scopeId16>`.
21. `deriveFeatureFolder`: `planDir` = `docs/extract/<area>/<featureId>/`.
22. `deriveFeatureFolder`: same inputs → identical output (deterministic).
23. `deriveFeatureFolder`: different scopeDigest → different featureId/planDir.
24. `normalizeToPosix`: backslash → forward slash.
25. `normalizeToPosix`: strips leading `./`.
26. `normalizeToPosix`: strips leading `/`.

### GREEN tests — identity writer

27. `writeIdentity` writes `ownershipScopeDigest` as the real 64-hex scopeDigest.
28. `writeIdentity` writes `IDENTITY_RECORD` with all required fields.
29. `writeIdentity` uses file-writer agent + temp-then-rename (source assertion).
30. Phase 12 `writeIdentityStub` is replaced (not coexisting — source assertion).

### GREEN tests — preflight integration

31. `resolveScopePreflight` calls `hashSources` after scope resolution (source
    assertion).
32. `resolveScopePreflight` validates hashes before deriving folder (source
    assertion — validateHashes called before deriveFeatureFolder).
33. `resolveScopePreflight` returns `fileHashes`, `scopeDigest`, `featureId`,
    `derivedPlanDir` in the result.
34. `resolveScopePreflight` on hash failure returns blocked result with reason.

### GREEN tests — promotion integration

35. `promotePendingRecord` NEW branch calls `writeIdentity` (not stub) with real
    digest (source assertion).
36. `promotePendingRecord` EXISTING branch does NOT call `writeIdentity` (source
    assertion).
37. Promotion uses `derivedPlanDir` from pending record (not categorizer).

### GREEN tests — cross-cutting

38. No `crypto` / `createHash` / SHA-256 in engine source files (only in agent
    prompts) — grep assertion over `src/*.mjs`.
39. `HASH_SOURCES_VERDICT` schema has `additionalProperties: false`.
40. `IDENTITY_RECORD` schema has `additionalProperties: false`.
41. Meta phases include `Hash Sources`.
42. `PENDING_RECORD` schema accepts new optional fields (`fileHashes`,
    `scopeDigest`, `featureId`, `derivedPlanDir`).

## Success Criteria

1. Same resolved scope → same folder across runs and across two worktree
   checkouts (deterministic).
2. Identity selection blocks on bad/missing/malformed hashes (fail-closed).
3. No LLM/categorizer in the extract folder-derivation path.
4. No in-engine SHA-256 computation (all hashing agent-mediated).
5. `.identity.json` stores the real `ownershipScopeDigest` (64-hex, not null).
6. Full test suite green (1628 baseline + new D1.1 tests).
7. Build drift-free (`npm run validate:build`).
8. Six-mode compatibility preserved (design/implement/tune/extract/review/status).

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Hash-sources agent returns inconsistent scopeDigest (framing mismatch) | Agent prompt specifies exact framing recipe; validation catches non-64-hex; E2E test proves determinism across two calls |
| Performance: hashing every file adds latency | One agent pass per preflight run; acceptable for the typical scope size; file reads are batched |
| Existing extract tests break (SCOPE_VERDICT unchanged, but preflight flow changes) | SCOPE_VERDICT stays as-is; preflight extension is additive; existing Phase 12 tests validate pending protocol without hashes |
| Categorizer bypass affects non-extract modes | Bypass is guarded by `isExtractMode`; design/implement/tune paths unchanged |
| Entry-point exclusion edge case (all files are entry points) | Fallback to full sorted set — tested |

## Security Considerations

- No secrets in hash payloads (file paths + content hashes only).
- SHA-256 is a content fingerprint, not reversible — no sensitive data leaked.
- `.identity.json` ownership digest is immutable at creation — tamper-evident
  (Phase 14 collision guard compares full digest).

## Scope Boundary (D1.1 ONLY)

This phase implements ONLY §D1.1 (identity + hash validation up front) + §Hashing.
It does NOT implement:
- D1.2 (registry + rename-resilient lookup) — Phase 14
- D1.3 (registry integrity + recovery) — Phase 14
- D1.4 (collision guard) — Phase 14
- D2 (ownership reconciliation, change detection, invalidation) — Phases 15-17
- D3 (upsert entrypoints) — Phase 18
- D4 (migration/adopt) — Phase 18

---

*Phase 13: Deterministic Identity & Hashing*
*Planned: 2026-07-23 — autonomous /gsd-plan-phase 13 --auto*
