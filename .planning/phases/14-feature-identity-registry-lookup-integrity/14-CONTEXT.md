# Phase 14: Feature-Identity Registry, Lookup & Integrity — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Design plan §D1.2 + §D1.3 + §D1.4 (`plans/260723-extract-deterministic-folders-upsert/plan.md`)

<domain>
## Phase Boundary

A feature-identity registry makes folders sticky for life — surviving full
renames — with safe, recoverable state. A registry (`docs/extract/.registry.json`)
plus per-folder immutable `.identity.json` (already written by Phase 13) record
each feature's ownership identity, folder, and current file set. A pure
`findFeature` function matches current scope files to existing features by path
OR content hash, using a **defensible threshold** (anchor equality OR majority of
min(currentCount, featureCount); weak/minority-only and ties → blocked). A
collision guard prevents new-folder creation from overwriting another feature by
comparing the full ownership digest. Registry/sidecar/state writes are atomic
(temp-then-rename) with root-last readiness commit, and startup recovery rebuilds
mutable fields from current pipeline-state (ownership from sidecars), failing
closed when current evidence is missing.

This is D1.2–D1.4 ONLY — it does NOT implement ownership reconciliation (D2.1,
Phase 15), change detection (D2.2, Phase 16), invalidation chain (D2.3, Phase 17),
upsert entrypoints (D3, Phase 18), or migration/adopt (D4, Phase 18).
</domain>

<decisions>
## Implementation Decisions

### Registry format (D1.2)
- `docs/extract/.registry.json`: `{ features: { featureId: { planDir,
  ownershipScopeDigest, scopeId16, files:[{path,contentSha256}], status,
  updatedAt } } }`.
- Per-folder `.identity.json` already exists (Phase 13 — immutable ownership
  identity + canonical inputs). Phase 14 does NOT change its shape; it adds the
  registry as an index on top.
- Registry entries mirror identity-sidecar ownership (featureId, planDir,
  ownershipScopeDigest, scopeId16) but add mutable runtime fields (files,
  status, updatedAt) that change on each extract/update.

### findFeature — defensible threshold (D1.2)
- **Pure function** — no agent calls, no LLM, no I/O.
- A current file *matches* a feature if its path OR `contentSha256` appears in
  the feature's stored `files` array (survives full rename via content match).
- A feature is a **candidate** only if the match is **strong**:
  - (a) the current scope's anchor path matches the feature's stored anchor path
    (immutable ownership evidence), OR
  - (b) match count >= **majority** of `min(currentCount, featureCount)`.
- Rank candidates by match count; **strictly-highest** → reuse (sticky, update
  files); zero strong candidates → new; **tie / >=2 strong / only-weak**
  (e.g. a single shared `package.json`/`tsconfig.json`) → **blocked**
  (`--feature=<id>`/`--new`).
- Weak-only matches (shared config/index files without anchor or majority) are
  explicitly NOT auto-attached.

### Collision guard (D1.4)
- Applies **only on NEW-feature folder creation** (when `findFeature` returns
  zero strong candidates and the engine is about to create a folder).
- If the derived `planDir` already exists, compare the requester's
  `ownershipScopeDigest` against the existing `.identity.json` ownership
  identity (full 64-hex digest, not truncated `featureId`).
- Different → abort upsert (do NOT overwrite another feature).
- Same → idempotent re-creation (safe — same feature).
- For EXISTING-feature reuse (no folder creation), no guard needed.

### Registry integrity — authority + atomicity (D1.3)
- **Authority order:** `pipeline-state.json` (run truth) > `.registry.json`
  (index) > `.identity.json` (backup).
- **Atomic per-file writes:** temp-then-rename (Phase 8
  `flushPipelineStateWithSnapshot` pattern + Phase 13 file-writer agents).
  Prevents torn JSON.
- **Root-last readiness commit:** registry status → `current` only after
  extraction + publish + persist are durable (not after partial writes).
- **Concurrency DOWNSCOPED:** no busy-lock (TOCTOU). Concurrent same-feature
  invocations are UNSUPPORTED — documented. Atomic writes + root-last +
  recovery are the mitigations.

### Startup recovery (D1.3)
- A feature whose registry status is `extracting` with incomplete pipeline-state
  → resume or recover.
- On registry rebuild: restore **immutable ownership** (featureId, planDir,
  ownershipScopeDigest) from `.identity.json` sidecars; rebuild **mutable**
  `files`/fingerprints from **current** `pipeline-state.json` +
  `.source-digest.json` — NEVER from creation-time sidecars (which go stale after
  renames/revisions).
- **Fail-closed** if current revision evidence is unavailable (no
  pipeline-state, no source-digest). Corrupt sidecar → fail-closed + signal
  repair.

### Claude's Discretion
- Whether findFeature returns a structured result object or throws on ambiguous
  match (chose structured result — caller decides to block or prompt).
- Registry file locking strategy (none — concurrent invocations unsupported by
  design; documented).
- Recovery trigger timing (startup scan of registry `status` fields).
- Test fixture organization and naming.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D1.2 (lines 40-42),
  §D1.3 (lines 44-48), §D1.4 (lines 50-51)

### Roadmap
- `.planning/ROADMAP.md` — Phase 14 entry (RED/GREEN gates, success criteria, E2E matrix)

### Requirements
- `.planning/REQUIREMENTS.md` — REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01

### Phase 13 (builds on — identity + hashing complete)
- `.planning/phases/13-deterministic-identity-and-hashing/PLAN.md` — D1.1 complete
- `.planning/phases/13-deterministic-identity-and-hashing/VERIFICATION.md` — verified
- Source: `deriveFeatureFolder`, `validateHashes`, `hashSources`, `writeIdentity`,
  `resolveScopePreflight`, `promotePendingRecord` in `extract-scope.mjs`
- Schema: `IDENTITY_RECORD` in `schemas.mjs` (immutable ownership identity)

### Phase 12 (builds on — pending/promotion complete)
- `.planning/phases/12-pending-confirmation-protocol-promotion/PLAN.md` — D0 complete
- `promotePendingRecord` NEW vs EXISTING branch logic

### Phase 8 (atomic-write pattern)
- `flushPipelineStateWithSnapshot` / last-good snapshot pattern — the authority for
  temp-then-rename + root-last writes

### Source code to modify
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — add `findFeature`,
  `checkFolderCollision`, `readRegistry`, `writeRegistry`, `recoverRegistry`
- `plugins/feature-workflows/workflows/src/schemas.mjs` — add `REGISTRY_FILE`,
  `REGISTRY_ENTRY`; extend `IDENTITY_RECORD` if needed
- `plugins/feature-workflows/workflows/src/main.mjs` — integrate `findFeature` into
  extract flow (before promotion), add collision guard, add startup recovery
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — phase declarations
- `plugins/feature-workflows/commands/extract-design.md` — document registry, lookup, recovery

### Existing patterns to follow
- Phase 13 `writeIdentity` file-writer agent + temp-then-rename
- Phase 8 `flushPipelineStateWithSnapshot` root-last commit ordering
- Phase 13 `validateHashes` fail-closed validation pattern
- Phase 13 `deriveFeatureFolder` pure-function pattern (findFeature follows same style)
</canonical_refs>

<specifics>
## Specific Ideas

- `findFeature` is the **core pure function** — it takes `{ currentFiles:
  [{path, contentSha256}], currentAnchor, registryFeatures: [{featureId, files,
  anchorPath}] }` and returns `{ decision: 'reuse'|'new'|'blocked', featureId?,
  matchCount?, reason? }`. No I/O, no agent calls.
- The registry is a flat JSON index at `docs/extract/.registry.json`. It is
  rebuilt/recovered from `.identity.json` sidecars (immutable) + current
  pipeline-state (mutable) on startup.
- The collision guard runs AFTER `findFeature` returns `'new'` but BEFORE
  `promotePendingRecord` creates the folder. It compares the full
  `ownershipScopeDigest` (64-hex) from the requester's preflight against the
  existing `.identity.json` at the derived `planDir`.
- Recovery scans the registry for `status: 'extracting'` entries and reconciles
  them: if pipeline-state exists and is complete → update files from
  source-digest; if missing → fail-closed (blocked handoff with repair guidance).
- The registry write ordering is: sidecar `.identity.json` → registry index →
  root-last `pipeline-state.json` status commit. All via temp-then-rename.
</specifics>

<deferred>
## Deferred Ideas

- Ownership reconciliation (Phase 15 — D2.1)
- Change detection (Phase 16 — D2.2)
- Invalidation chain (Phase 17 — D2.3)
- Upsert entrypoints + flags (Phase 18 — D3)
- Migration/adopt (Phase 18 — D4)
- Concurrent same-feature invocation safety (unsupported by design — would need
  real exclusive locks the sandbox cannot provide)
</deferred>

---

*Phase: 14-feature-identity-registry-lookup-integrity*
*Context gathered: 2026-07-23 via autonomous plan-phase*
