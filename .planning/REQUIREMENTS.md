# Requirements: feature-workflows v1.6.0

**Defined:** 2026-07-23
**Milestone:** v1.6.0 Design-Extract Determination
**Status:** Approved scope (converted from `plans/260723-extract-deterministic-folders-upsert/plan.md`), ready for phase planning

## Core Value

One user command must drive a trustworthy feature workflow from intent to durable, verifiable artifacts — without silently losing work or overstating completion. v1.6.0 extends that to **extract-mode folder stability + change-aware upsert**: a feature maps to one durable folder for its lifetime, and re-extraction updates only what changed.

## v1.6.0 Requirements

Derived from the plan's Goals (G1–G3) and Design (D0–D4). All decisions are baked (no open questions).

### Pending-Confirmation & Promotion

- [ ] **PROMO-01**: A user can resume the pre-`planDir` scope-confirmation checkpoint via an explicit, addressable `--confirm <pendingId>`, and promotion to an authoritative folder is atomic and crash-idempotent (replaying `--confirm` never creates a duplicate folder or re-promotes). (D0)
- [ ] **PROMO-02**: When the resolved scope matches an existing feature, the run loads and updates that feature's state (revision) without overwriting its immutable ownership identity or creating a new folder; only a genuinely new feature creates a folder + immutable identity. (D0)
- [ ] **LOCATOR-01**: A compact permanent `pendingId → planDir` locator lets `--confirm <pendingId>` always resolve, while the bulky scratch payload is TTL-expired (30 days) — bounded growth without breaking confirmation replay. (D0)

### Deterministic Identity & Folders

- [ ] **IDENT-01**: Before any folder/feature selection, the engine has complete, schema-valid per-file `contentSha256` and a full `scopeDigest` (agent-computed SHA-256); missing/malformed hashes block identity selection (no silent folder split). (D1.1)
- [ ] **FOLDER-01**: Each feature maps to one deterministic folder `docs/extract/<area>/<featureId>/` (no LLM in the path), where `<area>` = first-2-segments of the anchor file's repo-relative path and `featureId` derives from the lex-smallest file + `scopeId16`; the folder is stable across clones/worktrees and fixed for the feature's lifetime. (D1.1, G1)

### Registry, Lookup & Integrity

- [ ] **REGISTRY-01**: A feature-identity registry (`.registry.json`) plus per-folder immutable `.identity.json` record each feature's ownership identity, folder, and current file set. (D1.2)
- [ ] **MATCH-01**: Feature lookup is rename-resilient (matches by path OR `contentSha256`) and requires a **defensible** match — anchor equality OR a majority of the smaller scope's files; weak/minority-only matches (e.g. a single shared `package.json`/`tsconfig.json`) and ties are **blocked** for explicit `--feature`/`--new` selection, never silently mismerged. (D1.2)
- [ ] **COLLISION-01**: New-folder creation guards against overwriting another feature by comparing the **full** ownership digest (not a truncated id) across different features; mismatch → abort upsert. (D1.4)
- [ ] **INTEGRITY-01**: Registry/sidecar/state writes are atomic (temp-then-rename) with a root-last readiness commit (status→current only after extraction+publish+persist are durable); startup recovery rebuilds mutable `files`/fingerprints from **current** pipeline-state/source-digest (ownership from sidecars) and fails closed when current revision evidence is unavailable. (D1.3)

### Ownership Reconciliation

- [ ] **OWN-01**: Slice ownership is reconciled by a pure, fully-deterministic algorithm — stable sliceIds, exactly-one-owner partition, prefix-score assignment (removed slices excluded as candidates), zero-score files clustered by 2-segment directory into permutation-invariant new slices, moves detected via content fingerprint (duplicate content → conservative remove+add). (D2.1)

### Change Detection

- [ ] **CHANGE-01**: On update, source changes (added/removed/moved/renamed) are detected by comparing full 64-hex SHA-256 digests over framed per-file `(path, contentSha256)`; hash failure/missing/malformed is **fail-closed** (treated as changed → re-extract, never skip), and an unverifiable slice blocks with `extractReady=false`. (D2.2, G2)

### Invalidation Chain

- [ ] **INVALIDATE-01**: Invalidating a changed slice resets the durable queue entry, slice-local artifact-path/review guards, **and** all parent aggregates — clearing/versioning the actual publish/persist gate predicates (`result.published`/`result.persist`) plus `_publishVerified`/`_persistVerified` via a no-demote evidence primitive (version/remove keys + history event), and marking synthesis/overview/readiness/status stale so they regenerate. (D2.3)
- [ ] **REMOVED-01**: A slice emptied by membership loss is terminal for re-extraction but triggers a parent invalidation (`onSliceRemoved`): lifecycle marked excluded, its feature/index/synthesis evidence superseded, coverage denominator updated, and parent publish/persist + handoff rerun — so parent views reflect the removal without re-extracting the removed slice. (D2.1/D2.3)

### Upsert & Migration

- [ ] **UPSERT-01**: An existing folder **auto-updates by default** (change detection → in-place re-extract) on any re-run (fresh lookup or `--resume`); `--update` is explicit, `--no-update` opts out to continue-incomplete, `--force` re-extracts regardless of digest, `--feature` selects an existing feature, and `--new` creates a distinct forked folder (mutually exclusive with `--feature`). (D3, G3)
- [ ] **MIGRATE-01**: On the first run after upgrade, existing v1.5 extract folders (roots only — excluding `slices/`, `.pending`, registry) are detected and offered for adoption (prompt, not silent); `--adopt <planDir>` imports a specific folder. Adoption derives identity, writes `.identity.json` + registry root-last with rollback, and is idempotent (re-adoption is a no-op; old resume + new lookup converge on one folder). (D4)

### Compatibility & Proof

- [ ] **PROOF-01**: The changed extract flow preserves all v1.5 continuous regression gates (build drift, version lockstep, six-mode compatibility, resume/migration), and characterization tests prove the end-to-end contracts: deterministic folder across runs/worktrees/renames, full-rename registry match, blocked ambiguous match, in-place update of changed slices, removed-slice parent update, v1.5→v1.6 adopt convergence, and crash-resume after invalidation. (plan §Tests)

## Future Requirements

- Gate-level change-detection granularity (only re-run gates whose specific inputs changed) — deferred (slice-level first; Q2).
- Concurrent same-feature invocation safety (currently explicitly unsupported) — would need real exclusive locking the sandbox cannot provide.
- Dynamic re-clustering of slices across runs when ownership heuristics drift.

## Out of Scope

| Boundary | Reason |
|----------|--------|
| Deterministic free-text scope *resolution* (the `resolveScope` LLM) | LLM step; only folder assignment/ownership/change-detection are made deterministic. Explicit paths/globs give full determinism. |
| Re-extracting unchanged gates | Waste; change detection must be selective. |
| Changing forward design/implement/tune folder schemes | Extract-only milestone. |
| Categorizer LLM in the folder path | Demoted to a display-only label. |
| Multi-writer/distributed registry concurrency (CAS/file locks) | Single-user CLI; the sandbox engine cannot create real exclusive locks. Concurrent same-feature invocation is unsupported by design. |
| External filesystem/lock services | The dependency-free generated-ESM + agent-mediated-JSON model is retained. |

## Traceability

Each v1.6.0 requirement maps to exactly one owning phase (numbering continues from v1.5.0's Phase 11).

| Requirement | Roadmap Phase | Status |
|-------------|---------------|--------|
| PROMO-01 | Phase 12 | Pending |
| PROMO-02 | Phase 12 | Pending |
| LOCATOR-01 | Phase 12 | Pending |
| IDENT-01 | Phase 13 | Pending |
| FOLDER-01 | Phase 13 | Pending |
| REGISTRY-01 | Phase 14 | Pending |
| MATCH-01 | Phase 14 | Pending |
| COLLISION-01 | Phase 14 | Pending |
| INTEGRITY-01 | Phase 14 | Pending |
| OWN-01 | Phase 15 | Pending |
| CHANGE-01 | Phase 16 | Pending |
| INVALIDATE-01 | Phase 17 | Pending |
| REMOVED-01 | Phase 17 | Pending |
| UPSERT-01 | Phase 18 | Pending |
| MIGRATE-01 | Phase 18 | Pending |
| PROOF-01 | Phase 19 | Pending |

**Coverage:** 16/16 v1.6.0 requirements mapped; 0 orphaned; 0 duplicated.

---
*Requirements defined: 2026-07-23 — converted from `plans/260723-extract-deterministic-folders-upsert/plan.md` (5-round review-hardened).*
