# Phase 12: Pending-Confirmation Protocol & Promotion — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Design plan §D0 (`plans/260723-extract-deterministic-folders-upsert/plan.md`)

<domain>
## Phase Boundary

Implement the pending-confirmation protocol and atomic promotion pipeline for
extract mode. Users resolve scope via a write-free preflight, receive a
`pendingId`, then resume via `--confirm <pendingId>` to atomically promote the
confirmed scope into the authoritative extraction folder. Promotion branches
new (create folder + immutable ownership identity) vs existing (load+update
state without overwriting identity). A permanent compact locator keeps
`--confirm` addressable indefinitely while the bulky scratch payload TTL-expires
after 30 days.

This is D0 ONLY — it does NOT implement the registry, deterministic identity
hashing, change detection, or upsert (those are D1–D4 in later phases).
</domain>

<decisions>
## Implementation Decisions

### Preflight (write-free)
- `resolveScopePreflight({ task })` runs the existing `resolveScope` logic but
  writes NOTHING to disk — returns the verdict in-memory with a generated
  `pendingId`.

### Pending record
- Stored at `docs/extract/.pending/<pendingId>.json`
- Shape: `{ pendingId, task, verdict, state:'PENDING', createdAt }`
- States: PENDING → CONFIRMED → PROMOTED

### Resume mechanism
- `--confirm <pendingId>` (NOT `--resume <planDir>`) resumes the pre-`planDir`
  checkpoint
- `--resume <planDir>` remains the durable resume path for post-promotion runs

### Permanent locator
- `docs/extract/.pending-locator.json` — compact array of
  `{ pendingId, featureId, planDir, promotedAt }`
- Retained indefinitely (tiny records)
- `--confirm <pendingId>` always resolves via locator, even after payload TTL

### Bulky payload TTL
- Pending record payload (task, verdict) TTL-expired after 30 days
- Expired payload → tombstone; locator still resolves `--confirm`

### Atomic promotion — two branches
- **NEW feature** (no prior folder): derive featureId/planDir; mkdir; write
  `.identity.json` (immutable ownership identity); add registry entry (D0 stub —
  full registry in Phase 14); write fresh `pipeline-state.json`.
  Order: identity → registry-stub → pipeline-state (root-last), each
  temp-then-rename.
- **EXISTING feature** (folder exists): load existing `pipeline-state.json`;
  record current scope as pending revision; hand off to extraction. Do NOT
  create a folder or overwrite `.identity.json`/ownership.

### Crash-idempotent replay
- Each boundary is idempotent: re-confirm from PENDING; re-promote is a no-op
  (tombstone); resume extraction proceeds normally.

### Claude's Discretion
- Internal UUID generation for `pendingId` (crypto-sha-based, no Math.random)
- Locator file format details (array vs object — array is simpler for append)
- Test fixture organization
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source
- `plans/260723-extract-deterministic-folders-upsert/plan.md` §D0 — authoritative design (5-round review-hardened)

### Roadmap
- `.planning/ROADMAP.md` — Phase 12 entry (RED/GREEN gates, success criteria)

### Requirements
- `.planning/REQUIREMENTS.md` — PROMO-01, PROMO-02, LOCATOR-01

### Source code to modify
- `plugins/feature-workflows/workflows/src/main.mjs` — extract flow entry (~L1099), planDir derivation (~L440), `--resume` handling (~L44)
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — `resolveScope`, `seedExtractQueue`
- `plugins/feature-workflows/workflows/src/schemas.mjs` — `SCOPE_VERDICT`, schema exports
- `plugins/feature-workflows/workflows/src/state.mjs` — state persistence/restoration
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — phase declarations
- `plugins/feature-workflows/commands/extract-design.md` — command flags

### Existing patterns to follow
- Phase 8 checkpoint pattern (`checkpointSlice` / `flushPipelineStateWithSnapshot`)
- Phase 4 scope-confirmation checkpoint (`awaiting-scope-confirm` handoff at ~L1158)
</canonical_refs>

<specifics>
## Specific Ideas

- The pending checkpoint REPLACES the current `awaiting-scope-confirm`
  checkpoint (Gate X0.5). The current mechanism uses `--resume <planDir>` +
  `scopeConfirmed:true`; D0 introduces `--confirm <pendingId>` instead.
- `resolveScopePreflight` is the same `resolveScope` agent call but without
  writing `scope-manifest.md` to disk — the verdict is captured in-memory.
- The categorizer still runs for the folder path derivation in the NEW branch;
  but D0 does NOT change the categorizer to be deterministic (that is Phase 13).
- D0 writes a `.identity.json` stub with the ownership digest placeholder —
  the actual `ownershipScopeDigest` hashing is Phase 13; D0 just creates the
  file structure.
- Meta phases: add `Pending Confirm` and `Promote` to
  `feature-pipeline.meta.mjs`.
</specifics>

<deferred>
## Deferred Ideas

- Deterministic identity/hashing (Phase 13 — D1.1)
- Feature-identity registry (Phase 14 — D1.2–D1.4)
- Change detection / update path (Phase 16–17 — D2)
- Upsert entrypoints (Phase 18 — D3)
- Migration/adopt (Phase 18 — D4)
</deferred>

---

*Phase: 12-pending-confirmation-protocol-promotion*
*Context gathered: 2026-07-23 via autonomous plan-phase*
