---
phase: 19
name: Compatibility & Proof
requirements: [PROOF-01]
depends_on: [18]
wave: 1
files_modified: []
files_created:
  - tests/v16-e2e-characterization.test.mjs
  - tests/v16-regression-proof.test.mjs
autonomous: true
---

# Phase 19: Compatibility & Proof

**Status:** Planned
**Date:** 2026-07-24
**Requirements:** PROOF-01
**Depends on:** Phase 18 (D3/D4 upsert entrypoints + v1.5 migration)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §Tests + `.planning/ROADMAP.md` Phase 19

## Overview

This is the FINAL phase of milestone v1.6.0. It is a TEST/PROOF phase —
analogous to v1.5.0 Phase 7 (Compatibility and Project-Scale Proof). No new
source modules. It adds cross-cutting E2E characterization tests that exercise
the full v1.6 surface end-to-end (chaining multiple operations across phases
12-18 into integrated scenarios), and verifies the v1.5.0 continuous regression
suite still passes. If a real defect surfaces, fix it; otherwise no production
code changes.

**Baseline:** 2388 tests green (after Phase 18). Expected exit: 2388 + Phase 19
new tests, zero regressions, build drift-free.

## RED Gate (must fail before implementation)

1. The v1.6 E2E characterization test file
   (`tests/v16-e2e-characterization.test.mjs`) does NOT exist — the full
   cross-cutting pipeline flow (preflight → identity → registry → ownership →
   change detection → invalidation → upsert → adopt) is untested as an
   integrated sequence.
2. The v1.6 regression proof file
   (`tests/v16-regression-proof.test.mjs`) does NOT exist — no explicit gate
   verifies that the v1.5 continuous regression gates (build drift, version
   lockstep, six-mode compatibility, resume/migration) survived the v1.6
   source changes as a cohesive assertion block.
3. No test exercises a two-worktree deterministic-folder convergence scenario
   (same scope → same folder path in independent derivations).
4. No test chains: extract → rename-all-files → re-lookup → same folder
   (full-rename registry match as an integrated flow).
5. No test chains: extract → ambiguous-shared-config → blocked → `--feature`
   override → correct feature selected.
6. No test chains: extract → 1-byte-edit → auto-update → changed-slice
   re-extraction → unchanged-slice skip (in-place update E2E).
7. No test chains: extract → empty-slice → parent-view-update →
   removed-slice-not-re-extracted (removal E2E).
8. No test chains: v1.5-folder → `--adopt` → fresh-lookup convergence
   (adopt convergence E2E).
9. No test chains: update → crash-mid-invalidation → resume → gates-rerun →
   publish/persist regenerated (crash-resume after invalidation E2E).

## GREEN Evidence (must pass after implementation)

### v1.5 Continuous Regression Gates (regression-proof)

1. `npm run build` produces both dist entries with zero drift
   (`validate:build` passes).
2. Version lockstep: `plugin.json` version, dist headers, and marketplace
   manifest agree.
3. Six-mode compatibility: `resolveMode` returns correct mode for
   design/implement/tune/extract/review/status; `gateModeActive` prevents
   extract gates in non-extract modes and vice versa.
4. v1.4.5 legacy state hydrates through migration; `validatePipelineState`
   accepts both legacy and v1.5/v1.6 state shapes.
5. Resume contract: `--resume <planDir>` loads `pipeline-state.json` correctly
   after v1.6 source changes (no shape regression from registry/identity fields).
6. All 2388 pre-Phase-19 tests remain green (zero regressions).

### v1.6 E2E Characterization (e2e-characterization)

#### E2E-FOLDER-01: Deterministic folder across runs/worktrees

7. Same resolved scope derived twice yields identical `featureId` and `planDir`.
8. Two independent `deriveFeatureFolder` calls with identical file sets +
   content hashes produce the same folder path (cross-worktree simulation).
9. Folder path follows `<area>/<featureId>` format where `<area>` is first
   2 path segments of the anchor file.
10. No LLM in the path — `deriveFeatureFolder` is pure (no agent/IO source
    assertion).

#### E2E-MATCH-01: Full-rename registry match

11. Chained flow: register feature with files `[a.mjs, b.mjs]` → simulate
    full rename to `[c.mjs, d.mjs]` with SAME content hashes → `findFeature`
    returns `decision: 'reuse'` (content-aware match survives full rename).
12. Anchor equality: when the anchor file's content hash matches, the match
    is strong regardless of path change.

#### E2E-MATCH-02: Blocked ambiguous match

13. Two features sharing only `package.json` (1 file out of many) →
    `findFeature` returns `decision: 'blocked'` (weak/minority match blocked).
14. `resolveUpsertMode` with a blocked findResult returns
    `{ mode: 'blocked', reason: ... }`.
15. `--feature=<id>` override on a blocked match selects the specified feature
    (disambiguation works end-to-end).

#### E2E-CHANGE-01: In-place update of changed slices

16. Chained flow: extract feature with slices `[slice-A, slice-B]` →
    1-byte edit to a file in slice-A → `reconcileSlices` assigns correctly →
    `runChangeDetection` marks slice-A changed, slice-B unchanged →
    `invalidateSliceChain` resets slice-A → slice-A re-extracts, slice-B skips.
17. Framed distinctness: `["ab","c"]` vs `["a","bc"]` produce different
    digests (no false skip on content boundary shift).
18. Hash failure → fail-closed: `runChangeDetection` treats missing/malformed
    hash as CHANGED (never skip).

#### E2E-INVAL-01: Crash-resume after invalidation

19. Chained flow: update changed slice → `invalidateSliceChain` runs →
    simulate crash (state saved mid-invalidation) → resume → gates re-run
    (not skipped by stale artifact-path guards).
20. After invalidation + resume: `result.published`, `result.persist`,
    `_publishVerified`, `_persistVerified` are ALL false → publish/persist
    + handoff durability regenerated.
21. `extractReady` is false until the invalidation chain completes
    (no overstated completion).

#### E2E-REMOVED-01: Removed-slice parent update

22. Chained flow: extract feature with slices `[slice-A, slice-B]` →
    remove all files from slice-B → `reconcileSlices` marks slice-B
    `removed` (terminal) → `onSliceRemoved` fires → parent views
    (synthesis/overview/coverage) updated → slice-B NOT re-extracted.
23. Coverage denominator decremented; parent publish/persist rerun.
24. Removed slice's lifecycle marked `excluded`; its evidence superseded
    (not deleted — history preserved).

#### E2E-UPSERT-01: Auto-update default

25. Chained flow: extract feature → bare re-run (no flags) with identical
    scope → `resolveUpsertMode` returns `'auto-update'` → change detection
    runs → no changes → all slices skip (idempotent re-run).
26. `--no-update` on a re-run → mode `'continue-incomplete'` → no change
    detection, loads existing state.
27. `--force` → mode `'force'` → all slices invalidated regardless of digest.
28. `--new` on existing feature → `deriveForkedFeatureId` → distinct folder
    `<featureId>-2`.

#### E2E-ADOPT-01: v1.5 → v1.6 adopt convergence

29. Chained flow: simulate v1.5 folder (pipeline-state.json, no
    .identity.json, no registry) → `--adopt <planDir>` → `adoptLegacyFolder`
    writes identity + registry → fresh `findFeature` lookup converges on the
    SAME folder (no duplicate created).
30. Old `--resume <planDir>` after adoption still loads state correctly
    (both paths converge).
31. Multi-slice legacy fixture: `scanForLegacyFolders` offers ONLY the root
    (not each slice child).
32. Re-adoption is idempotent (`already-adopted` no-op).

#### E2E-PROOF-01: Full suite integration

33. `npm run validate:build` — zero drift on both dist entries.
34. `npm test` — all tests pass (2388 baseline + Phase 19 new).
35. Phase-label validation: `undeclared_count=0` for both dist entries.
36. ESM syntax validation passes for both dist entries.

## Implementation Steps

### Step 1: Create v1.6 E2E characterization test file

Create `tests/v16-e2e-characterization.test.mjs`:

Import from `./harness.mjs` all v1.6 functions needed for cross-cutting
scenarios:
`deriveFeatureFolder`, `findFeature`, `resolveUpsertMode`, `reconcileSlices`,
`runChangeDetection`, `invalidateSliceChain`, `onSliceRemoved`,
`deriveForkedFeatureId`, `isLegacyRoot`, `adoptLegacyFolder`,
`scanForLegacyFolders`, `invalidatePersistenceEvidence`, `upsertRegistryEntry`,
`readRegistry`, `writeRegistry`, `writeIdentity`, `readIdentitySidecar`,
`checkFolderCollision`, `canonicalizeIdentity`,
`buildPendingRecord`, `generatePendingId`, `resolveLocatorEntry`.

Structure as grouped test suites — one per E2E scenario ID — each chaining
multiple operations into an integrated flow:

**E2E-FOLDER-01** (deterministic folder):
- Build a file set with content hashes → call `deriveFeatureFolder` twice →
  assert identical results.
- Vary the input order of files → assert same result (sort-stable).

**E2E-MATCH-01** (full-rename match):
- Build a registry with one feature `[a.mjs, b.mjs]` + hashes → build a
  current scope `[c.mjs, d.mjs]` with SAME hashes → `findFeature` → assert
  `decision: 'reuse'`.

**E2E-MATCH-02** (blocked ambiguous):
- Build a registry with two features sharing one `package.json` →
  `findFeature` with a scope containing only the shared file → assert
  `decision: 'blocked'`.

**E2E-CHANGE-01** (in-place update):
- Build persisted slices `[A, B]` with digests → simulate 1-byte edit in A
  (change A's hash) → `reconcileSlices` → `runChangeDetection` → assert
  A=changed, B=unchanged → `invalidateSliceChain(state, 'A')` → assert A's
  gates cleared, B untouched.

**E2E-INVAL-01** (crash-resume after invalidation):
- Build state with a changed slice → `invalidateSliceChain` → snapshot
  mid-invalidation (only queue+slice cleared, parent NOT yet stale) →
  re-invoke → assert parent aggregates staled, `extractReady=false` →
  assert `invalidatePersistenceEvidence` reset booleans + predicates.

**E2E-REMOVED-01** (removed-slice parent update):
- Build state with slices `[A, B]` → simulate B emptied (all files removed) →
  `reconcileSlices` → assert B has `status: 'removed'` → `onSliceRemoved` →
  assert coverage decremented, parent staled, B NOT in re-extraction queue.

**E2E-UPSERT-01** (auto-update default):
- Build findResult with `decision: 'reuse'` → `resolveUpsertMode({}, ...)`
  → assert `'auto-update'`. Chain with `--no-update` → `'continue-incomplete'`.
  Chain with `--new` + existing → `deriveForkedFeatureId`.

**E2E-ADOPT-01** (adopt convergence):
- Simulate a legacy folder fixture (object with planDir, no identity) →
  `isLegacyRoot` qualifies it → `adoptLegacyFolder` (mock agent for reads) →
  identity + registry written → fresh `findFeature` with same scope →
  `decision: 'reuse'` → same planDir.

Each E2E test should be a single `test(...)` block that chains multiple
function calls with assertions at each stage, proving the operations compose
correctly as an integrated flow.

### Step 2: Create v1.6 regression proof test file

Create `tests/v16-regression-proof.test.mjs`:

This file provides an explicit, cohesive regression-gate block asserting the
v1.5 continuous guarantees survived the v1.6 source changes. It complements
the existing per-phase tests (which cover individual v1.6 features) by
verifying the cross-cutting invariants:

**Build drift** — run `npm run validate:build` via `execFileSync` and assert
zero drift on both dist entries.

**Version lockstep** — read `plugin.json`, both dist headers, and marketplace
manifest; assert version strings agree.

**Six-mode compatibility** — assert `resolveMode` returns correct mode for all
6 modes; assert `gateModeActive` prevents cross-mode gate leakage; source
assertion that extract-specific functions are not called in non-extract mode
paths.

**Resume/migration** — assert `validatePipelineState` accepts v1.4.5 legacy,
v1.5, and v1.6 state shapes; assert `migrateLegacyState` produces valid v1.6
state; assert `repairResumeArtifactFlags` handles all three shapes.

**Full-suite regression sentinel** — a meta-test asserting the test runner
completed all prior tests (relies on node:test execution order; acts as a
documentation gate that Phase 19 is the final regression checkpoint).

### Step 3: Run full suite + validate

- `npm run build` — clean rebuild.
- `npm run validate:build` — zero drift.
- `npm test` — all tests pass (2388 baseline + Phase 19 new).
- ESM syntax check for both dist entries.
- Phase-label validation (`undeclared_count=0`).

### Step 4: Update STATE.md + ROADMAP.md

- STATE.md: Phase 19 complete, milestone v1.6.0 complete.
- ROADMAP.md: Phase 19 checkbox checked; progress table updated.

## Files to Modify

| File | Change |
|------|--------|
| `.planning/STATE.md` | Phase 19 complete, milestone v1.6.0 finished |
| `.planning/ROADMAP.md` | Phase 19 status → complete; progress table updated |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/v16-e2e-characterization.test.mjs` | Cross-cutting E2E characterization for all v1.6 scenarios (FOLDER, MATCH-01/02, CHANGE, INVAL, REMOVED, UPSERT, ADOPT) |
| `tests/v16-regression-proof.test.mjs` | v1.5 continuous regression gate verification (build drift, version lockstep, six-mode compat, resume/migration) |

## Test Specification (tests/v16-e2e-characterization.test.mjs)

### E2E-FOLDER-01: Deterministic folder (3 tests)

1. Same scope → same folder: call `deriveFeatureFolder` twice with identical
   inputs → identical `{ featureId, planDir }`.
2. Input-order independence: shuffle file order → same result.
3. Cross-worktree simulation: two independent derivations with same content
   hashes → same folder path.

### E2E-MATCH-01: Full-rename match (2 tests)

4. Full rename with same content → `findFeature` returns `decision: 'reuse'`.
5. Anchor content-hash match → strong match regardless of path change.

### E2E-MATCH-02: Blocked ambiguous match (3 tests)

6. Two features sharing only `package.json` → `decision: 'blocked'`.
7. `resolveUpsertMode` with blocked → `{ mode: 'blocked' }`.
8. `--feature=<id>` override → selects specified feature.

### E2E-CHANGE-01: In-place update (3 tests)

9. 1-byte edit → slice-A changed, slice-B unchanged → invalidation clears A.
10. Framed distinctness: `["ab","c"]` ≠ `["a","bc"]` digests.
11. Hash failure → fail-closed (CHANGED, never skip).

### E2E-INVAL-01: Crash-resume after invalidation (3 tests)

12. Mid-invalidation crash → resume → gates re-run (not skipped).
13. `result.published`/`result.persist`/`_publishVerified`/`_persistVerified`
    all false after invalidation → publish/persist regenerated.
14. `extractReady=false` until chain completes.

### E2E-REMOVED-01: Removed-slice parent update (3 tests)

15. Emptied slice → `removed` (terminal) → `onSliceRemoved` fires.
16. Parent views (synthesis/coverage) updated; removed slice NOT re-extracted.
17. Coverage denominator decremented.

### E2E-UPSERT-01: Auto-update default (4 tests)

18. Bare re-run → `'auto-update'` → no changes → all slices skip.
19. `--no-update` → `'continue-incomplete'`.
20. `--force` → all slices invalidated.
21. `--new` on existing → forked folder `<featureId>-2`.

### E2E-ADOPT-01: Adopt convergence (4 tests)

22. Legacy folder → `--adopt` → identity + registry written → fresh lookup
    converges on same folder.
23. Old `--resume` after adoption still works (both paths converge).
24. Multi-slice fixture → only root offered.
25. Re-adoption idempotent.

## Test Specification (tests/v16-regression-proof.test.mjs)

### Build drift (2 tests)

26. `npm run validate:build` exits 0, both entries "up to date".
27. Both dist entries exist in workflows directory.

### Version lockstep (2 tests)

28. `plugin.json` version matches dist header `meta.version` for both entries.
29. Marketplace manifest version matches `plugin.json`.

### Six-mode compatibility (3 tests)

30. `resolveMode` returns correct mode for design/implement/tune/extract/
    review/status arguments.
31. `gateModeActive` prevents extract gates in non-extract modes.
32. Source assertion: extract-specific functions (reconcileSlices,
    runChangeDetection) are NOT called in non-extract mode paths.

### Resume/migration (3 tests)

33. `validatePipelineState` accepts v1.4.5 legacy, v1.5, v1.6 state shapes.
34. `migrateLegacyState` produces valid v1.6 state from legacy.
35. `repairResumeArtifactFlags` handles all three state shapes.

### E2E-PROOF-01: Full suite integration (3 tests)

36. Phase-label validation: `undeclared_count=0` for both dist entries.
37. ESM syntax check passes for both dist entries.
38. Meta: full test suite completed without skipped/failed tests.

## Success Criteria

1. v1.5.0 regression gates green (build drift, version lockstep, six-mode
   compatibility, resume/migration — all pass).
2. Every v1.6.0 E2E scenario passes (FOLDER, MATCH-01, MATCH-02, CHANGE,
   INVAL, REMOVED, UPSERT, ADOPT).
3. Build drift-free (`npm run validate:build`).
4. Full test suite green (2388 baseline + Phase 19 new tests).
5. No source modules changed (pure test phase) — unless a real defect
   surfaces, in which case the fix is minimal and targeted.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| E2E tests are too thin (just re-test unit functions) | Each E2E test chains ≥3 operations into an integrated flow; assertions at each stage prove composition |
| Harness doesn't export a needed v1.6 function | Check `CANDIDATES` in harness.mjs; add missing symbols if needed (additive only — no existing exports removed) |
| A real defect surfaces during E2E testing | Fix the defect in the source module (minimal, targeted); re-run full suite; document the fix in VERIFICATION.md |
| Cross-cutting tests are order-dependent | Each E2E test builds its own fixtures from scratch (no shared mutable state); tests are independent |
| v1.5 regression suite has a real failure | Fix the regression in the source module; this is the core deliverable of PROOF-01 — a regression IS the finding |

## Security Considerations

- No secrets in test fixtures (synthetic feature ids, file paths, content hashes only).
- No real FS operations — all tests use pure functions and in-memory fixtures.
- Agent-mediated functions tested via mock-agent integration patterns (same as
  Phase 7/18 conventions).
- No direct FS/shell in the workflow engine (invariant preserved).

## Scope Boundary (PROOF-01 ONLY)

This phase implements ONLY PROOF-01 (compatibility + E2E characterization
proof). It does NOT implement:

- New source modules or production behavior changes (unless a real defect
  surfaces during proof testing).
- Gate-level change-detection granularity — future milestone.
- Concurrent same-feature invocation safety — explicitly unsupported.
- Dynamic slice re-clustering — future milestone.

This is the FINAL phase of milestone v1.6.0. After Phase 19 completes,
the milestone is ready for `/gsd-complete-milestone`.

---

*Phase 19: Compatibility & Proof*
*Planned: 2026-07-24 — autonomous /gsd-plan-phase 19 --auto*
