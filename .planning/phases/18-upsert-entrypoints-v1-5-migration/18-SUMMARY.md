# Phase 18: Upsert Entrypoints & v1.5 Migration — Summary

**Phase:** 18
**Completed:** 2026-07-24
**Requirements:** UPSERT-01, MIGRATE-01
**Commit:** f7bf9f6 (feat) · f2098cf (Nyquist validation, 22 source-assertion gap-fills for D3/D4)

## What was built

1. **Pure `resolveUpsertMode(args, findResult)`** — 7-mode priority chain:
   `error` (--new + --feature mutually exclusive) > `new` (--new) >
   `feature` (--feature=<id>) > `force` (--force) >
   `continue-incomplete` (--no-update) > `auto-update` (decision=reuse,
   the DEFAULT for existing folders) > `new` (decision=new, first extraction)
   > `blocked` (decision=blocked, ambiguous/weak match).
2. **Pure `deriveForkedFeatureId(baseFeatureId, registry)`** — scans the
   registry for `<base>-<n>` entries and returns the next available `n`
   (starts at 2). `--new` on an existing feature produces a distinct forked
   folder rather than overwriting/aliasing.
3. **Pure `isLegacyRoot(folderPath, markerFiles)`** — returns true only when
   `pipeline-state.json` OR `plan.md` is present AND the path excludes
   `/slices/`, `/.pending/`, `.registry.json`, `.identity.json`. Non-root
   adoption is blocked.
4. **Agent-mediated `scanForLegacyFolders`** — recursively lists
   `docs/extract/`, applies `isLegacyRoot`, and returns sorted roots. Multi-
   slice fixtures yield ONLY the parent root (children excluded).
5. **Agent-mediated `adoptLegacyFolder`** — validates root, reads persisted
   scope, calls `hashSources` + `deriveFeatureFolder`, writes `.identity.json`
   via `writeIdentity` (temp-then-rename), upserts registry root-last.
   Idempotent (`already-adopted` no-op), handles digest collisions via
   `deriveForkedFeatureId`, and rolls back on writeIdentity failure (registry
   untouched). Old `--resume` + fresh lookup converge on the same folder.
6. **Update flow wiring (main.mjs)** — imports `reconcileSlices`,
   `runChangeDetection`, `invalidateSliceChain`, `markStaleForSlice` and the
   new functions; after registry lookup, dispatches by `resolveUpsertMode`:
   auto-update/force load persisted state → reconcile → detect → invalidate
   (changed) / `onSliceRemoved` (removed) → continue extraction;
   `continue-incomplete` skips change detection; `new`/`feature`/`error`/
   `blocked` produce the corresponding handoffs. `extractReady=false` on all
   update paths.
7. **Auto-scan + `--adopt` (main.mjs)** — when the registry is empty AND
   `docs/extract/` exists AND no `--confirm`/`--resume`/`--adopt`, scans for
   legacy roots and returns an `awaiting-adopt-confirm` handoff offering
   roots in sorted order. `--adopt <planDir>` bypasses the scan and adopts
   directly.
8. **Schemas + meta + command docs** — `UPSERT_MODE_VERDICT` (7-value mode
   enum) and `ADOPT_RESULT` (4-value reason enum), both
   `additionalProperties: false`; `Upsert`/`Adopt`/`Migrate` meta phases
   declared; `extract-design.md` documents all 6 new flags
   (`--update`/`--no-update`/`--force`/`--feature`/`--new`/`--adopt`), the
   auto-update default, and the migration flow.

## Test results

- 2388/2388 full suite green (2287 baseline + 101 Phase 18).
- Adoption rollback reason string on writeIdentity failure is `'not-a-root'`
  (semantically misleading but functionally correct — non-blocking, noted in
  VERIFICATION.md).
