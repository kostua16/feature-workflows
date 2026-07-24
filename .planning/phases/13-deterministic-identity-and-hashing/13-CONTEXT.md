# Phase 13: Deterministic Identity & Hashing — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Design plan §D1.1 + §Hashing (`plans/260723-extract-deterministic-folders-upsert/plan.md`)

<domain>
## Phase Boundary

Make the extract-mode folder derivation fully deterministic — no LLM in the path.
Before any folder/feature selection, the engine has complete, schema-valid
per-file `contentSha256` + full `scopeDigest` (agent-computed SHA-256). Missing
or malformed hashes block identity selection (fail-closed — no silent folder
split). Each feature maps to one deterministic folder
`docs/extract/<area>/<featureId>/` where `<area>` = first-2-segments of the
anchor file's repo-relative path and `featureId` = `<primary-slug>-<scopeId16>`.
The `.identity.json` ownership digest (Phase 12 `null` stub) is filled with the
real `ownershipScopeDigest`.

This is D1.1 ONLY — it does NOT implement the registry (D1.2), integrity (D1.3),
collision guard (D1.4), change detection (D2), upsert (D3), or migration (D4).
</domain>

<decisions>
## Implementation Decisions

### Hash computation (sandbox-aware)
- Per-file `contentSha256` + combined `scopeDigest` are **agent-computed**
  (hash-sources agent has `crypto`; the sandbox engine does NOT).
- No in-engine SHA-256. The existing `computeDigest` (djb2) stays for
  `generatePendingId` only — it is NOT used for identity.
- The hash-sources agent reads each file, computes SHA-256, sorts pairs by path,
  frames as `JSON.stringify([[path, hash], ...])`, and SHA-256s that → scopeDigest.

### Scope verdict unchanged
- `SCOPE_VERDICT.files` stays as `string[]` (file paths only).
- A new `HASH_SOURCES_VERDICT` schema captures `[{path, contentSha256}]` +
  `scopeDigest`.
- The preflight result (PREFLIGHT_VERDICT/PENDING_RECORD) is extended with
  optional hash/folder fields.

### Folder derivation (pure, in-engine)
- `deriveFeatureFolder({ fileHashes, scopeDigest, entryPoints })` is a pure
  function: no agent calls, no LLM, no hashing.
- Anchor file = lex-smallest repo-relative POSIX path, excluding entry points
  (fallback to full set if all are entry points).
- `area` = first 2 path segments of anchor; fewer than 2 → `uncategorized`.
- `primarySlug` = `categorizeSlug(anchorFilename)`.
- `scopeId16` = first 16 hex of `scopeDigest`.
- `featureId` = `<primarySlug>-<scopeId16>`.
- `planDir` = `docs/extract/<area>/<featureId>/`.

### Categorizer bypass (extract mode only)
- For extract-mode fresh runs, the categorizer LLM is NOT invoked for planDir.
- The deterministic planDir is derived after preflight+hashing.
- Non-extract modes (design/implement/tune) keep the categorizer unchanged.
- `--resume` uses the persisted planDir (already authoritative).

### Identity writer upgrade
- Phase 12 `writeIdentityStub` → Phase 13 `writeIdentity`.
- `ownershipScopeDigest` = real 64-hex `scopeDigest` (not `null`).
- Adds `area` + `scopeId16` to `.identity.json` (IDENTITY_RECORD schema).

### Fail-closed validation
- `validateHashes(fileHashes, scopeDigest)` checks 64-hex pattern on every hash.
- Missing/malformed → blocked identity selection (no folder created).
- User can override with `--feature=<featureId>` (Phase 14 feature selection).

### Claude's Discretion
- Whether to skip the categorizer block entirely or override after (chose skip —
  cleaner, avoids unnecessary agent call).
- Temporary placeholder planDir for the brief window before preflight (never
  visible to user — preflight returns before any artifact references it).
- Test fixture organization and naming.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D1.1 (lines 36-38) + §Hashing (lines 95-96)

### Roadmap
- `.planning/ROADMAP.md` — Phase 13 entry (RED/GREEN gates, success criteria)

### Requirements
- `.planning/REQUIREMENTS.md` — IDENT-01, FOLDER-01

### Phase 12 (builds on)
- `.planning/phases/12-pending-confirmation-protocol-promotion/PLAN.md` — D0 complete
- `.planning/phases/12-pending-confirmation-protocol-promotion/VERIFICATION.md` — 1628 tests, verified

### Source code to modify
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — `resolveScopePreflight` (L250-285), `writeIdentityStub` (L376-390), `promotePendingRecord` (L397-450)
- `plugins/feature-workflows/workflows/src/schemas.mjs` — `SCOPE_VERDICT` (L770-800), `PREFLIGHT_VERDICT` (L978-991), `PENDING_RECORD`
- `plugins/feature-workflows/workflows/src/main.mjs` — categorizer planDir (~L492-540), extract Gate X0 (~L1156+), `--confirm` handler (~L44-90)
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — phase declarations
- `plugins/feature-workflows/commands/extract-design.md` — command docs

### Existing patterns to follow
- Phase 12 `resolveScopePreflight` write-free pattern
- Phase 12 `writeIdentityStub` file-writer agent + temp-then-rename
- Phase 8 `flushPipelineState` root-last commit ordering
- `categorizeSlug` from `text-utils.mjs` for slug derivation
</canonical_refs>

<specifics>
## Specific Ideas

- The hash-sources agent is a NEW agent call between scope resolution and folder
  derivation. It is the only place SHA-256 is computed.
- The framing recipe for scopeDigest MUST be deterministic: sort by path
  ascending, frame each pair as `[path, contentSha256]`, JSON.stringify the
  array, SHA-256 the result. The agent prompt specifies this exactly.
- Entry points are excluded from the lex-smallest anchor determination because
  entry points (e.g. `index.ts`) are often alphabetically earlier than the
  actual feature files, which would give misleading area/slug values.
- The `.identity.json` now contains the FULL ownership digest (64-hex), enabling
  Phase 14's collision guard to compare full digests (not truncated ids).
- `computeDigest` (djb2) is NOT used for identity — only `generatePendingId`
  uses it. The plan explicitly drops `hashing.mjs`/FNV for identity.
</specifics>

<deferred>
## Deferred Ideas

- Feature-identity registry + lookup (Phase 14 — D1.2–D1.4)
- Change detection (Phase 16 — D2.2)
- Ownership reconciliation (Phase 15 — D2.1)
- Invalid chain (Phase 17 — D2.3)
- Upsert entrypoints (Phase 18 — D3)
- Migration/adopt (Phase 18 — D4)
</deferred>

---

*Phase: 13-deterministic-identity-and-hashing*
*Context gathered: 2026-07-23 via autonomous plan-phase*
