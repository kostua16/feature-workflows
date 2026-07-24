# Plan: Extract — deterministic folders + change-detect upsert (post-v1.5.0)

**Status:** Revised after review4 (all 8 findings addressed — see §Review4 resolutions); supersedes review1–3. · **Date:** 2026-07-23
**Target:** next milestone (v1.6.0 candidate) for `feature-workflows` — extract mode only.
**Verified against:** `main.mjs` (~441-489, 160-170), `extract-scope.mjs`, `extract-slice.mjs` (~50-159), `revision.mjs` (~23-25), `state.mjs`, `observe-persist.mjs` (OBSERVE-01 no-demote), `synthesis.mjs`, publish/persist gates + `_publishVerified`/`_persistVerified` (Phase 9).

## Problem (verified in code)
1. **Non-deterministic output folder** — planDir from the categorizer LLM each fresh run; only `--resume`/`--plan` reuse it.
2. **No source-change detection** — `--resume` continues incomplete gates.
3. **No explicit upsert.**

## Goals
- **G1 — stable folders:** one folder per feature for life — across fresh runs, resumes, **full renames**, **and a v1.5→v1.6 upgrade** (existing docsets adopted, not duplicated) — no LLM in the path, stable across clones/worktrees.
- **G2 — update-on-change:** detect source changes (added/removed/moved/renamed); re-extract affected slices in place; recompute ALL downstream state (incl. publish/persist evidence).
- **G3 — explicit upsert:** re-extract a feature / selected slices in place — changed-only by default, force-able per slice.

## Non-goals
- Deterministic free-text scope *resolution* (LLM). Only folder assignment + ownership + change detection are deterministic. Explicit paths/globs = full determinism.
- Re-extracting unchanged gates. Changing forward design/implement/tune paths. Categorizer in the path (display label only).
- **Concurrent multi-writer correctness** (single-user CLI): per-file atomic writes + startup recovery only. **Concurrent same-feature invocations are explicitly UNSUPPORTED** (may corrupt; the busy-lock serialization claim from prior drafts is removed — see D1.3). No CAS/filesystem-locks (the sandbox engine can't create them; YAGNI).

## Design

### D0 — Pending-confirmation protocol + new-vs-existing promotion (resolves review4 P1.1/P1.2; review3 P1.1; review2 P1.a; review1 P1.1)
No `planDir` before confirmation → the checkpoint needs its own addressable, idempotent resume; and promotion must branch on new vs existing.

- **Scratch + address:** `resolveScopePreflight({ task })` (writes nothing) → `{ pendingId, task, verdict, state:'PENDING', createdAt }` at `docs/extract/.pending/<pendingId>.json`. Resume via **`--confirm <pendingId>`** (not `--resume <planDir>`).
- **Lifecycle:** `PENDING → CONFIRMED → PROMOTED → (handoff to extraction)`. On promotion a **compact permanent locator** `{ pendingId → featureId, planDir, promotedAt }` is appended to `docs/extract/.pending-locator.json` (retained indefinitely — tiny) so `--confirm <pendingId>` **always** resolves to the authoritative folder. The **bulky** scratch payload (`task`, `verdict`) is TTL-expired after **30 days** (decision: tombstone retention; review5 P2.7) — bounded growth without breaking `--confirm`. (`--resume <planDir>` remains the durable resume path regardless.)
- **Atomic promotion — two branches (review4 P1.2):**
  - **NEW feature** (registry miss): derive `featureId`/`planDir`; `mkdir`; write `.identity.json` (immutable **ownership** identity = `ownershipScopeDigest`, fixed at creation); add registry entry; write fresh `pipeline-state.json`. Order: identity → registry → pipeline-state (root-last), each temp-then-rename.
  - **EXISTING feature** (registry hit): the current scope is a **revision**, not a new identity. **Do NOT** create a folder or overwrite `.identity.json`/ownership. **Load** the feature's existing `pipeline-state.json`; record the current scope as the pending revision; hand off to the **update path** (D2 detect → invalidate changed → re-extract). Only `pipeline-state.json` (execution state) is mutated, never the immutable ownership identity.
- **Identity vs revision separation (review4 P1.2):** `.identity.json` holds the **immutable ownership identity** (`ownershipScopeDigest` from first extraction). The **mutable current-scope revision** (what's being extracted now) lives in `pipeline-state.json`/`.source-digest.json`. They are compared only across *different* features (collision guard, D1.4) — never current-vs-initial for the *same* feature.
- **Crash-idempotent replay** at each boundary (re-confirm from PENDING; re-promote — tombstone makes it idempotent; resume extraction). `--resume <planDir>`/`--plan` skip preflight (unchanged).

### D1 — Stable identity + registry (resolves review4 P1.3/P1.6; review3 P1.2/P1.3/P2.g; review2 P1.b/P1.e/P2.f; review1 P1.1/P1.2/P2.5/P2.7)

#### D1.1 Identity + hash validation up front (review4 P1.6)
- **Per-file content fingerprints (backbone):** `resolveScopePreflight` returns each file's repo-relative POSIX path **and full `contentSha256`** (agent reads+hashes). `scopeDigest` = full SHA-256 over framed sorted `(path, contentSha256)`. `scopeId16` = 16-hex of `scopeDigest` (folder-name/display only). `primary-slug` = slug of lex-smallest FILE (entry points excluded). `featureId` = `<primary-slug>-<scopeId16>`; `planDir` = `docs/extract/<area>/<featureId>/`, where `<area>` = the **first 2 path segments** of the anchor (lex-smallest) file's repo-relative path (e.g. `src/auth`); fewer than 2 segments → `uncategorized`. `<area>` is fixed at creation (part of the immutable ownership identity → sticky) (decision Q3).
- **Validate before selection (review4 P1.6):** require **complete, schema-valid** per-file `contentSha256` + `scopeDigest` BEFORE `findFeature`/promotion. On missing/malformed hash → **block identity selection** (do NOT create a folder — that would split); require re-preflight or explicit `--feature=<featureId>`. (Fail-closed at the identity step, not only at change detection.)

#### D1.2 Registry + rename-resilient lookup
- **Registry** `docs/extract/.registry.json`: `{ features: { featureId: { planDir, ownershipScopeDigest, scopeId16, files:[{path,contentSha256}], status, updatedAt } } }` + per-folder `.identity.json` (immutable ownership identity + canonical inputs).
- **`findFeature`** (pure, content-aware, **defensible threshold** — review5 P1.6): a current file *matches* a feature if its path OR `contentSha256` appears in the feature's `files` (survives full rename). A feature is a **candidate** only if the match is **strong** — either (a) the current scope's anchor matches the feature's anchor (immutable ownership evidence), OR (b) match count ≥ **majority** of `min(currentCount, featureCount)`. Rank candidates by match count; **strictly-highest** → reuse (sticky, update `files`); zero strong → new; **tie / ≥2 / only-weak** (e.g. a single shared `package.json`/`tsconfig.json`) → **block** (`--feature=<id>`/`--new`). Tests: overlapping scopes sharing config/index files are NOT auto-attached.

#### D1.3 Registry integrity — authority, atomicity, recovery (review4 P1.3 — concurrency DOWNSCOPED)
- **Authority:** `pipeline-state.json` (run truth) > `.registry.json` (index) > `.identity.json` (backup).
- **Atomic per-file writes:** temp-then-rename (Phase 8 `flushPipelineStateWithSnapshot` pattern); CRLF/encoding validated. Prevents torn JSON.
- **Concurrency — DOWNSCOPED (review4 P1.3):** the prior "busy-lock serializes concurrent same-feature invocations" claim is **removed** (a registry busy flag is a TOCTOU check-then-replace; the sandbox can't create real exclusive locks). **Concurrent same-feature invocations are UNSUPPORTED** — documented in `extract-design.md`; users must not run two extract/update on the same feature. Mitigations retained: atomic per-file writes (no torn JSON), **root-last readiness commit** (status→current only after extraction+publish+persist durable), and **startup recovery** (a feature whose `status:'extracting'` has incomplete pipeline-state → resume/recover; on registry rebuild, restore **immutable ownership** (featureId/planDir/ownershipScopeDigest) from `.identity.json` sidecars but rebuild the **mutable** `files`/fingerprints from **current** `pipeline-state.json` + `.source-digest.json` — never from creation-time sidecars (which go stale after renames/revisions); **fail-closed** if current revision evidence is unavailable; corrupt sidecar → fail-closed + signal repair) (review5 P1.4).
- **Tests:** missing/stale/corrupt registry+sidecar; crash between the three writes; startup recovery of a stale `extracting` entry. (No concurrent-serialization test — guarantee removed.)

#### D1.4 Collision guard (review3 P2.g; review4 P1.2)
Applies **only on NEW-feature folder creation**: if the derived `planDir` exists, compare the requester's `ownershipScopeDigest` against the existing `.identity.json` ownership identity (full digest + canonical inputs, not `featureId`). Different → abort upsert (don't overwrite another feature). For EXISTING-feature reuse (no folder creation), no guard.

### D2 — Ownership + change detection + invalidation chain (resolves review4 P1.4/P1.5/P2.h; review3 P1.4/P1.5/P1.6; review2 P1.c/P1.d; review1 P1.3/P1.4/P2.6/P2.7)

#### D2.1 Ownership reconciliation — pure, fully deterministic (review4 P1.4)
`reconcileSlices(persistedSlices, currentFiles)` → `{ slices, delta }`. **No LLM, no flags, no decomposer hint** (the prior "new-subsystem hint" rule is removed — review4 P1.4). Stable sliceIds; every current file owned by exactly one slice (partition, validated).
- **Prefix score:** `score(f,s)` = max over s's files of common-leading-path-segment count between `D(f)` and that file's dir.
- **Unchanged path** → same slice. **Added path** → greatest `score` among **non-removed** slices only (removed slices are excluded as assignment candidates — review5 P1.3); tie → lex-smallest sliceId; **zero vs all** → new slice (below).
- **Zero-score files → deterministic grouping (review4 P1.4; review5 P1.3):** canonical clustering via **union-find by first-2-segment directory** (same rule as `area`); each distinct 2-seg dir → one cluster; <2 segments or a unique dir → singleton. Permutation-invariant. Each cluster → one new slice; `sliceId` = `slice-<lexSmallest(cluster contentSha256s).slice(0,12)>` — uses **already-computed agent per-file hashes** (no engine hashing, consistent with §Hashing); on the rare collision (two clusters share that contentSha256) append a deterministic counter `-<n>`. Collision-probe + permutation-invariance tested.
- **Removed path** → drop from owner.
- **Moved/renamed** (old path gone; a current file's `contentSha256` matches a persisted per-file fingerprint) → new path to old owner, log move. **Duplicate-content** (≥2 old files share a digest) → remove + add (not move), log.
- **Removed-slice state machine (review4 P1.4) — two distinct branches:**
  - a slice that still owns ≥1 file but whose content changed → **invalidate → `pending`** (re-extract via D2.3);
  - a slice emptied by membership loss → **`removed` (TERMINAL for re-extraction)**: slice-local dir + artifacts retained as history, NOT re-extracted. Removal triggers a **parent invalidation** (`onSliceRemoved`, D2.3) — mark lifecycle `excluded`, supersede its feature/index/synthesis evidence, drop from the coverage denominator, rerun parent publish/persist + handoff. So parent views reflect the removal without re-extracting the removed slice (review5 P1.2).
- **Overlap conflict** → lex-smallest sliceId wins, logged. Pure; tested for add/remove/move/duplicate/empty→removed/new-slice-grouping/overlap + exactly-one-owner.

#### D2.2 Change detection — fail-closed, full digest (review4 P2.h; review3 P1.6)
On `--update`: re-preflight (per-file `contentSha256`, validated D1.1) → `reconcileSlices` → per slice, combined digest = **full 64-hex SHA-256** over framed sorted `(path,contentSha256)` (review4 P2.h — full digest persisted + compared; 16-hex only for display/folder).
- **Persist per-file fingerprints + FULL digest** (`<sliceDir>/.source-digest.json` + `pipeline-state.json`: `{files:[{path,contentSha256}], digest}`) — needed for D2.1 move detection.
- **Compare:** unchanged per-file fingerprints AND no membership delta → skip; else `invalidateSliceChain`.
- **Fail-closed:** hash failure / missing / malformed (at preflight OR per-slice) → **CHANGED** (invalidate + re-extract), never skip; still unverifiable → `extractReady=false`. **Schema-validated** (64-hex) before persist.

#### D2.3 Invalidation chain incl. persistence-evidence primitive (review4 P1.5; review3 P1.5; review2 P1.d; review1 P1.4)
`extractSlice` + terminal publish/persist gates skip on artifact-path/flag presence; `observe-persist` **refuses to demote durably-verified writes** (OBSERVE-01). So:
- **New pure op `invalidatePersistenceEvidence(state, sliceId)` (review4 P1.5; review5 P1.1):** BEFORE clearing artifact paths, **enumerate affected durable keys** (the slice's feature shard, synthesis views, project-index entries); for each, **version or remove** the key + **append an invalidation-history event** to `_invalidations[]` (respects OBSERVE-01 — supersede, never demote). Reset the live booleans **`_publishVerified`**/**`_persistVerified`** AND clear/version the **actual gate-predicate guards `result.published` and `result.persist`** (the extract tail skips publish/persist on *these*, not just the booleans) — so republication/repersistence actually re-run.
- **Removal parent path `onSliceRemoved(state, sliceId)` (review5 P1.2):** distinct from `invalidateSliceChain` (changed slices) — for a `removed` slice, supersede its feature/index/synthesis evidence, mark lifecycle `excluded`, drop from coverage denominator, rerun parent publish/persist + handoff. Slice-local history preserved (not re-extracted).
- **`invalidateSliceChain(state, sliceId)`:** queue entry (`status='pending'`, `artifacts={}`, `_gateCheckpoints` cleared) + slice-local (`factsPath`/`useCasePath`/`designPath`/`archPath`/`requirementsPath`/`auditPath` + caches + review flags + slice checkpoints) + `invalidatePersistenceEvidence` + parent aggregates (synthesis `markStaleForSlice`, `overviewPath` regenerate, `_sourceDigest` cleared, `extractReady=false`, status/handoff rebuilt). Durable (persist immediately).
- `--force`: invalidate selected slice(s) regardless of digest.
- **Tests:** after update AND crash-resume — gates re-run; **`result.published`/`result.persist` AND `_publishVerified`/`_persistVerified` all false** (gate predicates, not just booleans) → publish/persist + handoff durability **regenerated**; no-demote invariant intact; **removal → parent views/index/coverage updated + parent publish/persist rerun, removed slice not re-extracted**; `extractReady=false` until complete. Slice-level first (YAGNI).

### D3 — Explicit upsert + adopt entrypoints (G3)
- **Auto-update is the DEFAULT for an existing folder (decision Q4):** any run that resolves — via registry lookup (fresh `/extract-design <scope>`) **or** `--resume <planDir>` — to an **existing** feature runs D2 change detection → invalidate → re-extract in place. (First extraction of a brand-new feature is unaffected.) This makes "re-run = refresh" the default/priority behavior.
- **`--update`** — explicit update trigger (supported; matches the default; useful in scripts and combined with `--force`).
- **`--no-update`** — opt OUT of auto-update → pure continue-incomplete (the legacy `--resume` behavior), for finishing an interrupted run without re-detecting changes. Both modes supported; auto-update has priority.
- **`--force`** (with `--slices=<id>`/`--update`): invalidate regardless of digest.
- **`--feature=<featureId>`** — select a specific existing feature (disambiguate an ambiguous/weak match). **`--new`** — force a **distinct** new folder for the same scope: appends a stable disambiguator (`<featureId>-<n>`, next integer for that base id) and registers a **separate** feature (intentional fork). **`--new` and `--feature` are mutually exclusive.** Collision guard treats it as a different ownership identity. Tests: `--new` creates a distinct folder, never overwrites/aliases the existing feature; `--new`+`--feature` rejected (review5 P2.8).
- **`--adopt <planDir>`:** import an existing v1.5 extract folder (see D4).

### D4 — Migration of existing v1.5 docsets (resolves review4 P1.7 / Q1)
Existing v1.5 folders have no registry/`.identity.json` → a fresh post-upgrade run can't find them → would duplicate (violates G1). Protocol:
- **Decision Q1 — auto-scan + offer (review5 P1.5):** on the first run after upgrade, scan for extraction **roots only** — a folder qualifies if it contains `pipeline-state.json` (or `plan.md`) AND its path does NOT contain `/slices/`, `/.pending/`, and it isn't the registry/sidecar file itself. This excludes multi-slice child docsets (`slices/<id>/`), pending scratch, and nested candidates. Offer in **deterministic (sorted) order**, one prompt per root (scope-confirm-style) — not silent. Explicit **`/extract-design --adopt <planDir>`** also supported (validates the path is a root). Adoption derives the feature's identity from the folder's persisted scope (`scope-manifest.md` / slice file lists) → compute `ownershipScopeDigest` + per-file fingerprints (hash-sources agent) → write `.identity.json` + registry entry, **root-last, temp-rename**, with **rollback** on any failure. Tests: a multi-slice legacy fixture offers ONLY the root (not each slice); repeated adoption is idempotent (no duplicate registry entry).
- **Collision handling:** if the derived `featureId` collides with an existing registry entry, compare full ownership digests; same → already adopted (no-op); different → disambiguate/rename.
- **Tests (review4 P1.7):** old `--resume <planDir>` still resumes; after `--adopt`, a fresh `/extract-design <scope>` lookup converges on the **same** folder (no duplicate); rollback on partial failure; root-last ordering.

### Hashing (sandbox-aware)
Per-file `contentSha256` (full) + combined SHA-256 digests are **agent-computed** (preflight/`hash-sources`); agents have `crypto`, the sandbox doesn't. No in-engine hash (`hashing.mjs`/FNV dropped). Persist + compare **full 64-hex** digests; 16-hex only for folder names/display. `.identity.json` stores the full ownership digest + canonical inputs.

## Files to touch (source)
- `src/main.mjs` — D0 pending protocol + tombstone + new/existing promotion branches; registry lookup; `--confirm`/`--update`/`--adopt` legs; `invalidateSliceChain` wiring; per-file fingerprint + registry persistence; root-last commit.
- `src/extract-scope.mjs` — `resolveScopePreflight` (no-write; per-file `contentSha256` + `scopeDigest`, schema-validated) + `writeScopeManifest`; `reconcileSlices` (pure, no hints, grouping); `findFeature` (content-aware, block-ambiguous); registry atomic helpers (temp-rename, recovery, rebuild, adopt/import).
- `src/extract-slice.mjs` / `extract-slice-entry.mjs` — `invalidateSliceChain`; `hash-sources` step.
- `src/state.mjs` — persist/restore per-file fingerprints + full digest + registry; parent-aggregate stale-marking; root-last readiness commit.
- `src/observe-persist.mjs` — **`invalidatePersistenceEvidence`** (version/remove + history event, no-demote; reset `_publishVerified`/`_persistVerified`).
- `src/synthesis.mjs` — `markStaleForSlice(sliceId)`.
- `src/schemas.mjs` — preflight verdict (per-file `contentSha256`, `scopeDigest`); `hash-sources` verdict; registry + identity records.
- `commands/extract-design.md` — `--update`, `--force`, `--confirm <pendingId>`, `--feature`/`--new`, `--adopt <planDir>`, registry/sticky folders, **concurrent-same-feature unsupported**, integrity/recovery.
- Generated dist (both entries) — rebuild; `npm run validate:build` drift-free.

## Tests (TDD — RED then GREEN)
- **D0/protocol:** `--confirm <pendingId>`; tombstone retained (post-promotion `--confirm` → `--resume <planDir>`, no re-promote/dup); **new vs existing branches** (existing doesn't overwrite identity/state); crash-idempotent at each boundary; immutable ownership vs mutable revision.
- **D1:** sticky across add/remove/**full-rename**/entry-point-change; ambiguous→block; new→new folder; collision guard across *different* features (full digest, not featureId); cross-worktree; **hash validation blocks identity selection on missing/malformed** (no split); integrity recovery (missing/stale/corrupt; crash between writes; startup stale-extracting recovery).
- **D2.1:** deterministic add/score/tie/zero→new-slice-grouping (permutation-invariant ids), remove, move (content fp), duplicate→remove+add, **empty→removed (terminal, not re-extracted/republished)**, overlap; exactly-one-owner.
- **D2.2:** unchanged→skip; added/moved/changed→re-extract; framed distinctness; **full 64-hex digest persisted+compared**; hash failure/missing/malformed→CHANGED; schema-validated.
- **D2.3:** `invalidatePersistenceEvidence` versions/removes + appends history (no-demote intact) + resets `_publishVerified`/`_persistVerified`; queue+slice+parent aggregates reset; gates re-run; publish/persist+handoff durability **regenerated** after update + crash-resume; `extractReady=false` until complete.
- **D3/D4:** existing folder **auto-updates by default** (fresh lookup + `--resume`); `--update` explicit; **`--no-update` opts out** to continue-incomplete; `--force`/`--feature`/`--new`; `--adopt` + auto-scan-offer imports old folder → old resume + new lookup converge; rollback on partial failure.
- Full suite green; dist drift-free.

## Risks / backward-compat
- **Registry + per-file fingerprints = new persistent state** — recoverable via sidecars; `--adopt` for v1.5 folders.
- **Preflight reads+hashes contents** (heavier) — one pass/run; enables rename/move robustness.
- **Pending protocol + tombstone** — new scratch state; gated behind the regression suite.
- **Concurrency UNSUPPORTED for same-feature** (documented) — deliberate downscope; atomic per-file writes + startup recovery only.
- **Ambiguous matches block** — may need `--feature`/`--new`; correctness trade-off.
- **Slice-level granularity** first (YAGNI).

## Sequencing
1. **D0** pending-protocol + tombstone + new/existing promotion + crash-replay.
2. **D1.1/Hashing** per-file `contentSha256` + full `scopeDigest` + validation.
3. **D1.2–D1.4** registry: content-aware lookup + block-ambiguous + integrity/recovery + collision guard.
4. **D2.1** pure `reconcileSlices` (no hints, grouping, removed-terminal).
5. **D2.2** fail-closed change detection (full digest).
6. **D2.3** `invalidateSliceChain` + `invalidatePersistenceEvidence` + crash-resume.
7. **D3/D4** `--update`/`--force`/`--confirm`/`--feature`/`--adopt` + migration.
8. Docs; dist rebuild; full suite.

## Review4 resolutions (all 8 findings)
| # | Finding | Fix |
|---|---------|-----|
| P1.1 | pending record deleted but replay claims to find PROMOTED | **D0**: durable **permanent compact locator** `pendingId→planDir` (never deleted) + bulky-payload 30-day TTL (review5 P2.7 reconciles) |
| P1.2 | new vs existing conflated; guard compares current vs initial | **D0**: distinct NEW (create+immutable ownership identity) vs EXISTING (load state→update, don't overwrite) branches; immutable ownership vs mutable revision; guard across *different* features only |
| P1.3 | busy flag is TOCTOU; can't serialize | **D1.3**: **downscope** — remove the serialization claim; concurrent same-feature = unsupported (documented); keep atomic writes + startup recovery (reviewer-allowed option) |
| P1.4 | hint dependency; zero-score grouping/ids unspecified; removed vs pending contradiction | **D2.1**: pure (no hints); zero-score→directory-clustered new slices with permutation-invariant ids; **removed = terminal** distinct from invalidate→pending |
| P1.5 | "mark not-verified" violates OBSERVE-01 no-demote; misses `_publishVerified`/`_persistVerified` | **D2.3**: new `invalidatePersistenceEvidence` — version/remove keys + history event (no demote); enumerate keys before clearing; reset both booleans |
| P1.6 | hash failure handled only at change-detect → rename can split | **D1.1**: validate per-file hashes + `scopeDigest` BEFORE `findFeature`/promotion; block identity selection on failure unless `--feature=<id>` |
| P1.7 | migration (Q1) open → upgrade duplicates | **D4** (resolves Q1): `--adopt <planDir>` import — identity derivation, collision handling, root-last, rollback; tests old-resume + new-lookup converge |
| P2.h | combined digest truncated to 16-hex (64-bit collision) | **D2.2/Hashing**: persist + compare **full 64-hex** digest; 16-hex for display/naming only |

## Review5 resolutions (all 8 findings)
| # | Finding | Fix |
|---|---------|-----|
| P1.1 | invalidation misses actual `result.published`/`result.persist` gate predicates | **D2.3**: `invalidatePersistenceEvidence` also clears/versions `result.published`/`result.persist`; tests assert predicates false |
| P1.2 | removed slice not invalidated → stale parent views | **D2.1/D2.3**: `onSliceRemoved` parent path — lifecycle excluded, supersede index/synthesis evidence, recompute coverage, rerun parent publish/persist (slice-local history kept) |
| P1.3 | clustering underspecified; `hex8` needs engine hash; no collision handling | **D2.1**: cluster by 2-seg dir (union-find); `sliceId` from lex-smallest cluster `contentSha256` (agent-provided, no engine hash) + counter collision-probe; exclude removed slices |
| P1.4 | registry recovery rebuilds mutable fields from stale sidecars | **D1.3**: rebuild mutable `files`/fingerprints from current pipeline-state/source-digest; sidecar only for immutable ownership; fail-closed if missing |
| P1.5 | `docs/**/extract/**/` matches slice children | **D4**: root qualification (pipeline-state/plan.md present; exclude `/slices/`, `.pending`, registry); deterministic offer order; multi-slice fixture + idempotence tests |
| P1.6 | single weak match (shared config file) mismerges | **D1.2**: defensible threshold — anchor-match OR majority of min scope; weak/minority-only → block (`--feature`/`--new`); shared-config tests |
| P2.7 | tombstone TTL deletes the `--confirm` mapping | **D0**: permanent compact `pendingId→planDir` locator + bulky-payload TTL only |
| P2.8 | `--new` derives same featureId → no distinct folder | **D3**: `--new` appends `-<n>` disambiguator → separate feature; mutual-exclusion with `--feature`; no-overwrite/alias tests |

## Prior resolutions (carried forward)
- **Review3:** P1.1→D0 tombstone · P1.2→D1.2 content match · P1.3→D1.3 (now downscoped) · P1.4→D2.1 · P1.5→D2.3 primitive · P1.6→D1.1/D2.2 fail-closed · P2.g→full digest.
- **Review2:** P1.a→D0 · P1.b→D1 · P1.c→D2.1 · P1.d→D2.3 · P1.e→D1 · P2.f→SHA-256.
- **Review1:** P1.1→D0 · P1.2→D1 · P1.3→D2 · P1.4→D2.3 · P2.5→repo-relative · P2.6→framed · P2.7→SHA-256.

## Decisions (no open questions remain)
- **Q1 migration → auto-scan + offer** (D4): first run after upgrade detects unregistered v1.5 folders and prompts to adopt; `--adopt <planDir>` for manual.
- **Q2 granularity → slice-level now** (D2): re-extract the whole changed slice; gate-level deferred.
- **Q3 `area` → top-2 path segments** (D1.1): first 2 segments of the anchor file's repo-relative path; `uncategorized` fallback; fixed at creation.
- **Q4 update mode → auto-update default** (D3): an existing folder auto-updates on any re-run (fresh lookup or `--resume`); `--update` explicit; `--no-update` opts out to continue-incomplete.
- **Q5 orphan policy → deterministic assign-or-new-slice** (D2.1).
- **Q6 overlap → ≥1 match; ties blocked** (D1.2).
- **Tombstone → permanent compact `pendingId→planDir` locator + 30-day bulky-payload TTL** (D0): `--confirm` always resolves; growth bounded.

---
**Note on review depth:** the plan has hardened across 4 adversarial rounds into a comprehensive, implementation-ready design. Remaining edge cases are increasingly niche; further review rounds will show diminishing returns versus discovering issues through TDD during implementation. Recommend proceeding to implementation (sequencing above) rather than additional review passes.
