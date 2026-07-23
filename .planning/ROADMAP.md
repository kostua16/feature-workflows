# Roadmap: feature-workflows

## Milestones

- ✅ **v1.6.0 Design-Extract Determination** — Phases 12-19 (shipped 2026-07-24). Source plan: [`../plans/260723-extract-deterministic-folders-upsert/plan.md`](../plans/260723-extract-deterministic-folders-upsert/plan.md)
- ✅ **v1.5.0 Project-Scale Extract Design** — Phases 1-11 (shipped 2026-07-22). Full details: [`milestones/v1.5.0-ROADMAP.md`](milestones/v1.5.0-ROADMAP.md)
- ✅ **v1.4.5 Pre-GSD Baseline** — shipped before the GSD planning ledger.

## Roadmap v1.6.0: Design-Extract Determination

### Overview

Milestone v1.6.0 makes `/feature-workflows:extract-design` map each feature to **one deterministic, stable folder for its lifetime** — across fresh runs, resumes, full path/entry-point renames, and the v1.5→v1.6 upgrade — and re-extract only what changed when sources change, recomputing all downstream state truthfully. The user experience stays one command; the folder path is derived deterministically (no LLM), and a feature-identity registry makes folders sticky for life.

### Milestone-Wide TDD Contract

Every phase follows RED → GREEN → refactor under unchanged evidence, with generated-dist + drift validation on every source change (`npm run build` / `npm run validate:build`), `npm test` green, and the v1.5.0 continuous regression gates preserved.

### Continuous Regression Gates (carried from v1.5.0)

Build/drift, version lockstep, six-mode compatibility (design/implement/tune/extract/review/status), resume + migration, and the v1.5.0 1470-test suite must stay green at every phase exit.

### Phases

- [x] **Phase 12: Pending-Confirmation Protocol & Promotion** — addressable `--confirm`, atomic crash-idempotent promotion, new-vs-existing branches.
- [x] **Phase 13: Deterministic Identity & Hashing** — per-file `contentSha256` + `scopeDigest`, validated up front; deterministic folder derivation.
- [x] **Phase 14: Feature-Identity Registry, Lookup & Integrity** — registry + rename-resilient defensible lookup + collision guard + atomic recovery.
- [x] **Phase 15: Slice Ownership Reconciliation** — pure deterministic partition + clustering + move detection.
- [x] **Phase 16: Change Detection** — fail-closed full-digest comparison.
- [x] **Phase 17: Invalidation Chain & Removal Path** — full chain incl. publish/persist evidence + removal parent path.
- [x] **Phase 18: Upsert Entrypoints & v1.5 Migration** — auto-update default + flags + `--adopt`.
- [x] **Phase 19: Compatibility & Proof** — regression + E2E characterization + adopt dogfood.

### Phase Details

#### Phase 12: Pending-Confirmation Protocol & Promotion
**Goal**: Users resume the pre-`planDir` checkpoint via `--confirm <pendingId>`, and promotion atomically + crash-idempotently yields the authoritative folder — branching new (create immutable ownership) vs existing (load → update).
**Depends on**: v1.5.0 extract flow (Phase 4/8 checkpoints).
**Requirements**: PROMO-01, PROMO-02, LOCATOR-01.
**RED Gate**: preflight writes nothing; `--resume <planDir>` cannot resume a not-yet-promoted checkpoint; promotion crashes leave no durable mapping.
**GREEN Evidence**: write-free `resolveScopePreflight`; `--confirm <pendingId>` resumes; atomic promotion (temp-rename, root-last); permanent compact locator + 30-day payload TTL; crash-idempotent at every boundary; new vs existing branches distinct.
**Success Criteria**: (1) `--confirm <pendingId>` always resolves (incl. after payload TTL); (2) replay never creates a duplicate folder or re-promotes; (3) existing-feature promotion never overwrites immutable ownership.

#### Phase 13: Deterministic Identity & Hashing
**Goal**: A feature's folder is derived deterministically from its resolved scope (no LLM), stable across clones/worktrees, fixed for life.
**Depends on**: Phase 12.
**Requirements**: IDENT-01, FOLDER-01.
**RED Gate**: missing/malformed preflight hashes must not select a folder; categorizer-derived paths must not be used.
**GREEN Evidence**: per-file `contentSha256` + full `scopeDigest` (agent-computed, schema-validated before selection); `area` = first-2-segments of anchor file; `featureId` = lex-smallest-file slug + `scopeId16`; repo-relative POSIX paths.
**Success Criteria**: (1) same resolved scope → same folder across runs and across two worktree checkouts; (2) identity selection blocks on bad hashes; (3) no LLM in the path.

#### Phase 14: Feature-Identity Registry, Lookup & Integrity
**Goal**: A registry makes folders sticky for life — surviving full renames — with safe, recoverable state.
**Depends on**: Phase 13.
**Requirements**: REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01.
**RED Gate**: a full rename must not create a second folder; a shared config file must not mismerge two features; concurrent/corrupt state must not silently lose entries.
**GREEN Evidence**: `.registry.json` + per-folder `.identity.json`; content-aware `findFeature` with anchor-or-majority threshold (weak/tie → block); full-digest collision guard; atomic writes + root-last readiness commit + startup recovery (rebuild mutable from current state, ownership from sidecars, fail-closed).
**Success Criteria**: (1) sticky folder across add/remove/rename/entry-point change; (2) ambiguous/weak matches blocked; (3) recovery rebuilds current (not stale) mutable fields.

#### Phase 15: Slice Ownership Reconciliation
**Goal**: When scope membership changes, each current file is owned by exactly one slice via a pure deterministic algorithm.
**Depends on**: Phase 14.
**Requirements**: OWN-01.
**RED Gate**: ownership must not depend on an LLM/flag; removed slices must not receive new files; moves must be detected without false positives on duplicate content.
**GREEN Evidence**: pure `reconcileSlices` — prefix-score assignment (removed excluded), 2-seg-dir union-find clustering with permutation-invariant ids, content-fingerprint move detection (duplicate → remove+add), exactly-one-owner invariant.
**Success Criteria**: (1) every add/remove/move/empty/new-slice/overlap case deterministic; (2) exactly-one-owner holds; (3) ids permutation-invariant.

#### Phase 16: Change Detection
**Goal**: Updates detect exactly which slices changed (added/removed/moved/renamed bytes) and re-extract only those.
**Depends on**: Phase 15.
**Requirements**: CHANGE-01.
**RED Gate**: a hash failure must never classify changed sources as unchanged.
**GREEN Evidence**: full 64-hex SHA-256 over framed `(path, contentSha256)`; fail-closed (failure/missing/malformed → changed; unverifiable → `extractReady=false`); schema-validated before persist.
**Success Criteria**: (1) unchanged → skip; (2) any change → invalidate + re-extract in place; (3) framed distinctness (`["ab","c"]` vs `["a","bc"]`, rename-same-bytes).

#### Phase 17: Invalidation Chain & Removal Path
**Goal**: Invalidating a slice resets the whole chain so re-extraction actually reruns gates and regenerates all downstream state — including publish/persist evidence and removed-slice parent views.
**Depends on**: Phase 16.
**Requirements**: INVALIDATE-01, REMOVED-01.
**RED Gate**: clearing only `_gateCheckpoints` must not skip gates (artifact-path guards remain); publish/persist must not skip on stale `result.published`/`result.persist`; a removed slice must not linger in parent views.
**GREEN Evidence**: `invalidateSliceChain` (queue + slice artifact/review guards + parent aggregates) + `invalidatePersistenceEvidence` (version/remove keys + history, no-demote; clear `result.published`/`result.persist` + `_publishVerified`/`_persistVerified`) + `onSliceRemoved` (lifecycle excluded, supersede evidence, recompute coverage, rerun parent publish/persist).
**Success Criteria**: (1) gates re-run; (2) publish/persist + handoff durability regenerated after update and crash-resume; (3) removed slice not re-extracted but parent views/coverage updated.

#### Phase 18: Upsert Entrypoints & v1.5 Migration
**Goal**: Users re-extract in place by default and can adopt existing v1.5 folders — one folder per feature across the upgrade.
**Depends on**: Phase 17.
**Requirements**: UPSERT-01, MIGRATE-01.
**RED Gate**: a bare re-run of an existing folder must refresh; `--new` must produce a distinct folder; migration must not register slice children or duplicate.
**GREEN Evidence**: auto-update default (fresh lookup or `--resume`) + `--update`/`--no-update`/`--force`/`--feature`/`--new` (mutually-exclusive semantics); root-qualified auto-scan + offer + `--adopt` (idempotent, rollback, root-last).
**Success Criteria**: (1) existing folder auto-updates; `--no-update` opts out; (2) `--new` forks a distinct folder, never overwrites/aliases; (3) `--adopt` → old resume + new lookup converge; multi-slice fixture offers only the root.

#### Phase 19: Compatibility & Proof
**Goal**: The changed extract flow preserves all v1.5 guarantees and proves the new end-to-end contracts.
**Depends on**: Phase 18.
**Requirements**: PROOF-01.
**RED Gate**: any v1.5 continuous regression gate fails; any v1.6.0 E2E scenario untested.
**GREEN Evidence**: full suite green (v1.5.0 + v1.6.0 tests), drift-free; E2E characterization for deterministic folders, full-rename match, blocked ambiguity, in-place update, removed-slice parent update, adopt convergence, crash-resume after invalidation.
**Success Criteria**: (1) v1.5.0 regression gates green; (2) every v1.6.0 E2E scenario passes; (3) build drift-free.

### Exact E2E Matrix (v1.6.0)

| ID | Phase | Scenario | Observable outcome |
|----|-------|----------|---------------------|
| E2E-PROMO-01 | 12 | Crash before/during/after promotion, then `--confirm` | Resumes idempotently; no duplicate folder |
| E2E-FOLDER-01 | 13 | Same scope in two worktrees | Identical folder path |
| E2E-MATCH-01 | 14 | Full rename of every file in a feature | Reuses the same folder (content match) |
| E2E-MATCH-02 | 14 | Two features sharing `package.json` only | Blocked (no mismerge) |
| E2E-OWN-01 | 15 | add/remove/move/new-dir files | Deterministic ownership, exactly-one-owner |
| E2E-CHANGE-01 | 16 | 1-byte edit; added file; rename | Only changed slices invalidate + re-extract |
| E2E-INVAL-01 | 17 | Update changed slice; crash-resume | Gates rerun; publish/persist + handoff regenerated |
| E2E-REMOVED-01 | 17 | Slice emptied | Parent views/coverage updated; slice not re-extracted |
| E2E-UPSERT-01 | 18 | Bare re-run of existing folder | Auto-update in place |
| E2E-ADOPT-01 | 18 | v1.5 folder + `--adopt` / auto-scan | Old resume + new lookup converge; only roots offered |
| E2E-PROOF-01 | 19 | Full suite + drift + v1.5 compat | All green, drift-free |

## Phases (history)

<details>
<summary>✅ v1.5.0 Project-Scale Extract Design (Phases 1-11) — SHIPPED 2026-07-22</summary>

- [x] Phase 1: State, Coverage, Migration, and Revision Contracts (1/1 plans)
- [x] Phase 2: Bounded Discovery, Validated Graph, and Schedulability (1/1 plans)
- [x] Phase 3: Multi-Entry Build, Install, and Version Lockstep (1/1 plans)
- [x] Phase 4: Checkpointed Feature Leaf (1/1 plans)
- [x] Phase 5: Bounded Scheduler and Transactional Automatic Continuation (1/1 plans)
- [x] Phase 6: Synthesis, Publish, Persist, and Status Truth (1/1 plans)
- [x] Phase 7: Compatibility and Project-Scale Proof (1/1 plans)
- [x] Phase 8: Design-Mode Durable Checkpoints and Revision-Aware Resume (1/1 plans)
- [x] Phase 9: Design-Mode Truthful Readiness and Outcome Reporting (1/1 plans)
- [x] Phase 10: Design-Mode Bounded Budgets and Prompt Context (1/1 plans)
- [x] Phase 11: Design-Mode Reliability, Verification, and Characterization Proof (1/1 plans)
- [x] Tech-debt cleanup (post-audit)

</details>

## Progress

**Execution order:** 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 12. Pending-Confirmation & Promotion | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 13. Deterministic Identity & Hashing | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 14. Registry, Lookup & Integrity | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 15. Slice Ownership Reconciliation | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 16. Change Detection | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 17. Invalidation Chain & Removal | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 18. Upsert & Migration | v1.6.0 | 1/1 | Complete | 2026-07-24 |
| 19. Compatibility & Proof | v1.6.0 | 1/1 | Complete | 2026-07-24 |

## Deferred to Future Milestones

Carried forward from v1.5.0 (see `milestones/v1.5.0-REQUIREMENTS.md`):

- Project-scale sharding & continuation for non-extract modes; generalized arbitrary-DAG platform; dynamic mid-leaf repartitioning; real token-budget characterization.

From v1.6.0 (see `REQUIREMENTS.md` Future):

- Gate-level change-detection granularity; concurrent same-feature invocation safety; dynamic slice re-clustering.
