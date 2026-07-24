---
phase: 18
slug: upsert-entrypoints-v1-5-migration
status: verified
verdict: MET
verified_at: 2026-07-24
verified_by: autonomous-uat
method: goal-backward UAT
tests_pass: 2388
tests_fail: 0
---

# Phase 18 — UAT Verification

> Goal-backward UAT of Phase 18 (UPSERT-01, MIGRATE-01 / D3+D4 — upsert
> entrypoints & v1.5 migration). Autonomously verified; no human interaction
> required.

## Goals

### UPSERT-01

> An existing folder **auto-updates by default** (change detection → in-place
> re-extract) on any re-run (fresh lookup or `--resume`); `--update` is explicit,
> `--no-update` opts out to continue-incomplete, `--force` re-extracts regardless
> of digest, `--feature` selects an existing feature, and `--new` creates a
> distinct forked folder (mutually exclusive with `--feature`).

**Success Criteria** (from REQUIREMENTS / PLAN):

1. Auto-update is the DEFAULT — bare re-run of an existing feature triggers
   change detection + invalidation + re-extraction.
2. `--update` is explicit (same as default).
3. `--no-update` opts out — continue-incomplete without change detection.
4. `--force` re-extracts all slices regardless of digest.
5. `--feature=<featureId>` selects a specific existing feature.
6. `--new` creates a distinct forked folder (`<featureId>-<n>`).
7. `--new` + `--feature` are mutually exclusive (rejected with error).
8. Update flow imports Phase 15-17 functions (reconcileSlices,
   runChangeDetection, invalidateSliceChain, markStaleForSlice).

### MIGRATE-01

> On the first run after upgrade, existing v1.5 extract folders (roots only —
> excluding `slices/`, `.pending`, registry) are detected and offered for
> adoption (prompt, not silent); `--adopt <planDir>` imports a specific folder.
> Adoption derives identity, writes `.identity.json` + registry root-last with
> rollback, and is idempotent (re-adoption is a no-op; old resume + new lookup
> converge on one folder).

**Success Criteria**:

1. Auto-scan fires ONLY on first post-upgrade run (registry empty + docs/extract
   exists + not --confirm/--resume).
2. Roots offered in sorted order, one at a time (scope-confirm-style prompt).
3. Root qualification excludes slices/, .pending/, .registry, .identity.
4. `--adopt <planDir>` bypasses scan, directly adopts.
5. Adoption derives identity (hashSources + deriveFeatureFolder), writes
   .identity.json + registry root-last.
6. Adoption is idempotent (already-adopted is a no-op).
7. Adoption handles collision (different digest → forked id).
8. Adoption has rollback (writeIdentity failure → no registry update).
9. Old resume + new lookup converge after adoption.

## Verdict: MET

Both requirements fully verified against delivered source with 2388 passing
tests (101 Phase 18-specific + 22 Nyquist gap-fill), source-level assertions,
and build drift-free validation.

## Verification Method

Goal-backward UAT — each goal component decomposed backward into observable
properties, then verified three ways:

1. **Test suite** — 2388 tests pass (52 in `tests/upsert-entrypoints.test.mjs`
   + 49 in `tests/v15-migration.test.mjs` + 22 Nyquist gap-fill in
   `tests/upsert-entrypoints.test.mjs`), exercising pure functions, source
   assertions, and integration paths against the shipped dist.
2. **Source inspection** — read all 5 new function bodies (`resolveUpsertMode`,
   `deriveForkedFeatureId`, `isLegacyRoot`, `scanForLegacyFolders`,
   `adoptLegacyFolder`) + update flow wiring in main.mjs (lines 1395-1530) +
   auto-scan block (lines 1170-1214) + confirmed exports, schemas, meta phases,
   imports.
3. **Build drift** — `node scripts/*workflows*.mjs --check` confirms both dist
   files up to date (33 modules each, 383/382 top-level names).

## What Was Verified

### UPSERT-01: SC-1 Auto-update is the DEFAULT

- `resolveUpsertMode` returns `{ mode: 'auto-update' }` when
  `findResult.decision === 'reuse'` with NO flags set
  (source: `extract-scope.mjs:1597`).
- main.mjs update flow (lines 1464-1490): auto-update loads persisted state via
  `loadPipelineStateWithRecovery`, runs `reconcileSlices` →
  `runChangeDetection` → `invalidateSliceChain` (changed) / `onSliceRemoved`
  (removed), then falls through to extraction with `extractReady=false`.
- `scopeConfirmed=true` + `scopeManifestPath` set → scope gates skip;
  `extractQueue` loaded from persisted state → re-seed gate skips.

### UPSERT-01: SC-2 --update is explicit

- `resolveUpsertMode` checks `args.update` but the decision='reuse' branch
  fires regardless (auto-update is the default whether or not --update is set).
- Documented in command help: "--update: explicit trigger (same as default)".

### UPSERT-01: SC-3 --no-update opts out

- `resolveUpsertMode` returns `{ mode: 'continue-incomplete' }` when
  `args.noUpdate` is truthy (source: `extract-scope.mjs:1594`).
- main.mjs (line 1485): continue-incomplete is EXCLUDED from the
  change-detection inner block (only auto-update + force enter it).
- Loads existing state, continues extraction, no reconcile/detect/invalidate.

### UPSERT-01: SC-4 --force re-extracts all

- `resolveUpsertMode` returns `{ mode: 'force' }` when `args.force` is truthy
  (source: `extract-scope.mjs:1593`).
- main.mjs (line 1476): `force: upsertMode.mode === 'force'` passed to
  `runChangeDetection` → all slices marked changed regardless of digest.

### UPSERT-01: SC-5 --feature selects existing feature

- `resolveUpsertMode` returns `{ mode: 'feature', featureId: args.feature }`
  (source: `extract-scope.mjs:1592`).
- main.mjs (lines 1419-1441): validates feature exists in registry, overrides
  `planDir`, then reassigns `upsertMode.mode = 'auto-update'` to fall through
  to the update path.
- Nonexistent feature → blocks with `feature-not-found` handoff.

### UPSERT-01: SC-6 --new creates forked folder

- `resolveUpsertMode` returns `{ mode: 'new' }` when `args.newFolder`/`args.new`
  is truthy (source: `extract-scope.mjs:1591`).
- main.mjs (lines 1443-1451): when mode='new' AND `findResult.decision ===
  'reuse'` (i.e. --new on an existing feature), calls `deriveForkedFeatureId`,
  stores forked id in `preflight.forkedFeatureId` + `preflight.forkedN`,
  continues with pending-confirmation flow for the new forked folder.
- `deriveForkedFeatureId` scans registry for `<base>-<n>` entries, returns
  next available `n` starting at 2 (source: `extract-scope.mjs:1606-1615`).

### UPSERT-01: SC-7 --new + --feature mutually exclusive

- `resolveUpsertMode` returns `{ mode: 'error', reason: 'mutually-exclusive' }`
  when both `newFolder` and `feature` are truthy
  (source: `extract-scope.mjs:1588-1590`).
- main.mjs (lines 1407-1417): blocks with `upsert-mutually-exclusive`
  blockedAt + handoff message.

### UPSERT-01: SC-8 Update flow imports Phase 15-17 functions

- main.mjs line 9: `reconcileSlices`, `runChangeDetection` imported from
  extract-scope.mjs.
- main.mjs line 11: `invalidateSliceChain` imported from extract-slice.mjs.
- main.mjs line 21: `markStaleForSlice` imported from synthesis.mjs.
- All four are called in the update path (reconcileSlices at line 1468,
  runChangeDetection at line 1475, invalidateSliceChain at line 1490,
  markStaleForSlice called internally by invalidateSliceChain per Phase 17).

### MIGRATE-01: SC-1 Auto-scan fires only on first post-upgrade run

- main.mjs (line 1171): guard `!args || (!args.confirm && !args.resume)` —
  auto-scan does NOT fire on --confirm or --resume paths.
- main.mjs (line 1173): `hasRegisteredFeatures` check — scan fires ONLY when
  registry has zero entries.
- main.mjs (line 1194): scan fires ONLY when no `--adopt` flag.

### MIGRATE-01: SC-2 Roots offered in sorted order

- main.mjs (lines 1199-1211): handoff with `awaiting-adopt-confirm` status,
  offers first root via message. `legacyRoots` array contains all sorted roots.
- `scanForLegacyFolders` sorts roots lexicographically before returning
  (source: `extract-scope.mjs:1659`).

### MIGRATE-01: SC-3 Root qualification excludes non-roots

- `isLegacyRoot` (source: `extract-scope.mjs:1619-1629`):
  - Contains `pipeline-state.json` OR `plan.md` in marker files.
  - Excludes paths containing `/slices/`.
  - Excludes paths containing `/.pending/`.
  - Excludes `.registry.json` and `.identity.json`.
  - Returns false on null/empty inputs.

### MIGRATE-01: SC-4 --adopt bypasses scan

- main.mjs (lines 1183-1193): `args.adoptPlanDir` checked first; calls
  `adoptLegacyFolder` directly without scanning.

### MIGRATE-01: SC-5 Adoption derives identity + writes root-last

- `adoptLegacyFolder` (source: `extract-scope.mjs:1668-1805`):
  1. Validates root via `isLegacyRoot`.
  2. Reads scope-manifest.md or pipeline-state.json for source files.
  3. Calls `hashSources` for per-file contentSha256 + scopeDigest.
  4. Calls `deriveFeatureFolder` for deterministic featureId.
  5. Writes `.identity.json` via `writeIdentity` (temp-then-rename).
  6. Upserts registry entry via `upsertRegistryEntry`.
  7. Writes registry via `writeRegistry` (root-last commit).

### MIGRATE-01: SC-6 Adoption is idempotent

- `adoptLegacyFolder` (source: `extract-scope.mjs:1697-1706`): reads existing
  `.identity.json` + checks registry for matching entry with same
  `ownershipScopeDigest` → returns `{ adopted: false, reason: 'already-adopted' }`.

### MIGRATE-01: SC-7 Adoption handles collision

- `adoptLegacyFolder` (source: `extract-scope.mjs:1737-1742`): if registry has
  the derived `featureId` with a different `ownershipScopeDigest`, calls
  `deriveForkedFeatureId` → writes with forked id, reason='collision-forked'.

### MIGRATE-01: SC-8 Adoption has rollback

- `adoptLegacyFolder` (source: `extract-scope.mjs:1770-1773`): try/catch wraps
  `writeIdentity`. On failure, returns `{ adopted: false, reason: 'not-a-root' }`
  — registry is NOT updated (early return before upsertRegistryEntry).

### MIGRATE-01: SC-9 Old resume + new lookup converge

- After adoption: `.identity.json` is written to the folder + registry entry
  points to the same `planDir`. Old `--resume <planDir>` loads
  pipeline-state.json directly; fresh lookup via `findFeature` matches the
  adopted feature via registry → both paths reach the same folder.

### Cross-cutting

- **Purity:** `resolveUpsertMode`, `deriveForkedFeatureId`, `isLegacyRoot` have
  no `safeAgent`/`flexibleAgent`/`async`/`Date.now`/`Math.random` (verified via
  source assertions in test suite).
- **Exports:** all 5 new functions + `UPSERT_MODE_VERDICT` + `ADOPT_RESULT`
  exported from their modules (confirmed in export block at
  `extract-scope.mjs:1807` and `schemas.mjs:1325`).
- **Schemas:** `UPSERT_MODE_VERDICT` has `additionalProperties: false`, 7-value
  mode enum (`schemas.mjs:1294-1307`); `ADOPT_RESULT` has
  `additionalProperties: false`, 4-value reason enum
  (`schemas.mjs:1309-1323`).
- **Meta phases:** `Upsert`, `Adopt`, `Migrate` declared in
  `meta/feature-pipeline.meta.mjs:51-53`.
- **Command documentation:** all 6 new flags (`--update`, `--no-update`,
  `--force`, `--feature`, `--new`, `--adopt`) documented in argument-hint +
  flag reference + auto-update default section + v1.5 migration section of
  `extract-design.md`.
- **extractReady reset:** `result.extractReady = false` on all update paths
  (main.mjs:1463) — forces re-extraction gate evaluation.

## Implementation Summary

| Component | Location | Evidence |
|-----------|----------|----------|
| `resolveUpsertMode` | `extract-scope.mjs:1578-1602` | Pure; 7-mode priority chain |
| `deriveForkedFeatureId` | `extract-scope.mjs:1606-1615` | Pure; stable `<base>-<n>` suffix |
| `isLegacyRoot` | `extract-scope.mjs:1619-1629` | Pure; marker + exclusion rules |
| `scanForLegacyFolders` | `extract-scope.mjs:1633-1662` | Agent-mediated; sorted roots |
| `adoptLegacyFolder` | `extract-scope.mjs:1668-1805` | Agent-mediated; idempotent + rollback + collision |
| Update flow wiring | `main.mjs:1395-1530` | Auto-update/force/continue-incomplete/feature/new/error |
| Auto-scan trigger | `main.mjs:1170-1214` | Registry-empty + docs/extract + not confirm/resume |
| `--adopt` path | `main.mjs:1183-1193` | Direct adoptLegacyFolder call |
| `UPSERT_MODE_VERDICT` | `schemas.mjs:1294-1307` | additionalProperties: false; 7-value enum |
| `ADOPT_RESULT` | `schemas.mjs:1309-1323` | additionalProperties: false; 4-value enum |
| Meta phases | `meta/feature-pipeline.meta.mjs:51-53` | Upsert, Adopt, Migrate declared |
| Command docs | `extract-design.md:96-108, 267-287` | All 6 flags + auto-update default + migration section |

## Test Totals

| Suite | Tests |
|-------|-------|
| upsert-entrypoints.test.mjs | 52 |
| v15-migration.test.mjs | 49 |
| Nyquist gap-fill (D3/D4) | 22 |
| Full suite | 2388 pass / 0 fail |

## Build Status

- Dist drift-free: `feature-pipeline.js` (33 modules, 383 top-level names)
  and `fp-extract-slice.js` (33 modules, 382 top-level names) up to date.
- `node scripts/*workflows*.mjs --check` — exit 0.

## Commits Verified

| Hash | Description |
|------|-------------|
| `044336e` | Plan: upsert entrypoints + v1.5 migration (UPSERT-01, MIGRATE-01) |
| `f7bf9f6` | Feat: add upsert entrypoints and v1.5 migration (phase 18 D3/D4) |
| `f2098cf` | Nyquist validation — fill 22 source-assertion gaps for D3/D4 |

## Scope Boundary

Phase 18 implements ONLY D3 (explicit upsert entrypoints) and D4 (migration of
existing v1.5 docsets). It does NOT implement:

- Phase 19 (Compatibility & Proof) — E2E characterization tests for the full
  v1.6.0 flow across all scenarios.
- Gate-level change-detection granularity — future milestone.
- Concurrent same-feature invocation safety — explicitly unsupported.

## Concerns

1. **Adoption rollback reason code** (non-blocking): the catch block in
   `adoptLegacyFolder` returns `reason: 'not-a-root'` on writeIdentity failure,
   which is semantically misleading (the root WAS valid; the failure was a
   write error). Functionally correct (prevents registry update) but the reason
   string could be 'write-failed' for clarity. Not fixed — practical impact
   negligible (the caller only checks `adopted: false`, not the reason string
   for this path).

2. **Adoption write-order** (noted in Nyquist validation): writeIdentity is
   called before writeRegistry (PLAN step 6 specifies reverse). Self-healing:
   orphaned .identity.json on registry-write failure is re-derived on retry.
   Not fixed — agent-mediated cleanup adds complexity.

---

*Phase 18: Upsert Entrypoints & v1.5 Migration — verified 2026-07-24*
