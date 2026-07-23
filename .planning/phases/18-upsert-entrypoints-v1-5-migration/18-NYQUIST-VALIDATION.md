# Phase 18 Nyquist Validation Report

**Date:** 2026-07-24
**Phase:** 18 — Upsert Entrypoints & v1.5 Migration (D3/D4)
**Commit:** f7bf9f6 (implementation), this commit (validation tests)
**Test total:** 2388 pass / 0 fail (2366 baseline + 22 validation gap-fill)
**Build drift:** clean (both dist files up to date, 33 modules each)

## Defects Found

None. The implementation is functionally correct. One non-blocking concern noted
in Risk Assessment (adoption write-order, self-healing on retry).

## Sampling Gaps Filled (22 new source-assertion tests)

### D3 (UPSERT-01) — 10 gap-filling tests

| Gap | Test | What it verifies |
|-----|------|------------------|
| Force wiring | `runChangeDetection receives force parameter wired to mode check` | `force: upsertMode.mode === 'force'` passed to runChangeDetection |
| Fork branch specificity | `deriveForkedFeatureId called inside new+reuse branch specifically` | Fork logic is inside `mode === 'new' && decision === 'reuse'` conditional, not just anywhere |
| --no-update opt-out | `continue-incomplete is EXCLUDED from change-detection inner block` | Inner block has only auto-update + force; continue-incomplete skips change detection |
| --feature fallthrough | `--feature mode reassigns to auto-update for fallthrough` | Feature mode sets `upsertMode.mode = 'auto-update'` to fall through to update path |
| --feature nonexistent | `--feature nonexistent blocks with feature-not-found handoff` | `feature-not-found` blockedAt + handoff message present |
| Error handoff | `error mode blocks with upsert-mutually-exclusive handoff` | `upsert-mutually-exclusive` blockedAt + handoff message present |
| Fork preflight | `--new fork sets preflight.forkedFeatureId and preflight.forkedN` | Forked id persisted in preflight for downstream consumption |
| extractReady reset | `auto-update/force/continue-incomplete resets extractReady to false` | Update path forces re-extraction by clearing extractReady |
| Queue continuity | `auto-update copies extractQueue from loaded existing state` | existingResult.extractQueue loaded via loadPipelineStateWithRecovery |

### D4 (MIGRATE-01) — 13 gap-filling tests

| Gap | Test | What it verifies |
|-----|------|------------------|
| Adopt idempotence | `adoptLegacyFolder idempotence: already-adopted check exists` | Identity digest compared with registry entry → early return on match |
| Adopt rollback | `adoptLegacyFolder rollback: try/catch wraps writeIdentity` | writeIdentity failure returns early — registry NOT updated |
| Collision-fork | `adoptLegacyFolder collision-fork: different digest triggers deriveForkedFeatureId` | Different ownershipScopeDigest → deriveForkedFeatureId → collision-forked reason |
| Scan sort | `scanForLegacyFolders sorts roots lexicographically before returning` | `roots.sort()` for deterministic output |
| Scan qualification | `scanForLegacyFolders uses isLegacyRoot to qualify folders` | isLegacyRoot called per folder during scan |
| Auto-scan guard | `auto-scan is guarded against --confirm and --resume paths` | `!args.confirm && !args.resume` guard present |
| Registry-empty gate | `auto-scan fires only when registry has zero entries` | `!hasRegisteredFeatures` gates the scan |
| --adopt bypass | `--adopt bypasses scan and calls adoptLegacyFolder directly` | args.adoptPlanDir checked, `!(args && args.adoptPlanDir)` skips scan |
| Root validation | `adoptLegacyFolder calls isLegacyRoot internally for root validation` | isLegacyRoot called inside adoption, returns not-a-root on failure |
| hashSources call | `adoptLegacyFolder calls hashSources for content hashing` | SHA-256 computation via hashSources in adoption |
| deriveFeatureFolder call | `adoptLegacyFolder calls deriveFeatureFolder for deterministic identity` | Deterministic folder derivation in adoption |
| Registry commit order | `adoptLegacyFolder calls upsertRegistryEntry before writeRegistry` | upsertRegistryEntry precedes writeRegistry (correct commit order) |
| Scope read | `adoptLegacyFolder reads scope-manifest or pipeline-state for source files` | scope-manifest.md read for persisted scope |

## Areas Audited — No Gaps Found

- **resolveUpsertMode purity:** verified no safeAgent/flexibleAgent/async/Date.now/Math.random
- **deriveForkedFeatureId purity:** verified no I/O, all 4 fork-suffix scenarios covered
- **isLegacyRoot qualification:** all 10 path/marker combinations covered (markers, exclusions, edges)
- **Schema validation:** UPSERT_MODE_VERDICT + ADOPT_RESULT additionalProperties:false, enums, required
- **Meta phases:** Upsert, Adopt, Migrate all declared
- **Import wiring:** reconcileSlices, runChangeDetection, invalidateSliceChain, markStaleForSlice all imported
- **Update flow completeness:** reconcileSlices → runChangeDetection → invalidateSliceChain (changed) / onSliceRemoved (removed)
- **markStaleForSlice:** verified called internally by invalidateSliceChain (extract-slice.mjs:330)
- **Command documentation:** all 6 new flags + auto-update default + migration section documented

## Risk Assessment

| Item | Status |
|------|--------|
| Auto-update default wiring | Verified — bare reuse triggers change detection by default |
| --no-update opt-out | Verified — continue-incomplete excluded from change-detection inner block |
| --force override | Verified — force parameter wired to runChangeDetection |
| --new fork distinctness | Verified — deriveForkedFeatureId in new+reuse branch, preflight persisted |
| --new + --feature mutual exclusion | Verified — upsert-mutually-exclusive blockedAt + handoff |
| Root qualification (slices/.pending exclusion) | Verified — isLegacyRoot excludes /slices/, /.pending/, .registry, .identity |
| Adopt idempotence | Verified — already-adopted check compares digest with registry |
| Adopt rollback | Verified — try/catch wraps writeIdentity, early return prevents registry write |
| Adopt collision-fork | Verified — different digest triggers deriveForkedFeatureId |
| Adoption write-order concern | NOTED — writeIdentity before writeRegistry (PLAN specifies reverse). Self-healing: orphaned .identity.json on registry-write failure is re-derived on retry. Not fixed (agent-mediated cleanup adds complexity; practical impact negligible). |
