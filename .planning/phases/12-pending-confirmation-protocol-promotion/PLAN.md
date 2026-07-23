# Phase 12: Pending-Confirmation Protocol & Promotion

**Status:** Planned
**Date:** 2026-07-23
**Requirements:** PROMO-01, PROMO-02, LOCATOR-01
**Depends on:** v1.5.0 extract flow (Phase 4/8 checkpoints)
**Design source:** `plans/260723-extract-deterministic-folders-upsert/plan.md` §D0

## RED Gate (must fail before implementation)

1. Preflight (`resolveScopePreflight`) writes nothing to disk — no
   `scope-manifest.md`, no `pipeline-state.json`, no folder.
2. `--resume <planDir>` cannot resume a not-yet-promoted checkpoint (no
   `pipeline-state.json` exists yet).
3. A crash during promotion leaves no durable mapping — re-running
   `--confirm <pendingId>` from PENDING state does not duplicate.
4. `--confirm <pendingId>` on an unknown/expired ID fails cleanly (blocked
   result with actionable handoff).

## GREEN Evidence (must pass after implementation)

1. `resolveScopePreflight({ task })` returns `{ pendingId, verdict, state:'PENDING' }`
   and writes zero files.
2. `--confirm <pendingId>` loads the pending record, promotes atomically, and
   hands off to the extraction flow — all within one invocation.
3. Atomic promotion uses temp-then-rename for each write; root-last commit
   (`pipeline-state.json` written only after identity + folder exist).
4. Permanent compact locator (`docs/extract/.pending-locator.json`) resolves
   `--confirm <pendingId>` even after the 30-day bulky-payload TTL.
5. Crash-idempotent at every boundary: re-confirm from PENDING, re-promote
   (tombstone no-op), re-resume extraction.
6. NEW-feature branch creates folder + `.identity.json` stub +
   `pipeline-state.json`; EXISTING-feature branch loads existing state without
   overwriting identity/ownership.
7. Replay of `--confirm <pendingId>` after PROMOTED redirects to
   `--resume <planDir>` (no duplicate folder, no re-promote).

## Implementation Steps

### Step 1: Schema additions (`schemas.mjs`)

Add three new schemas to `plugins/feature-workflows/workflows/src/schemas.mjs`:

**PREFLIGHT_VERDICT** — extends `SCOPE_VERDICT` with:
- `pendingId` (string, required) — the addressable confirmation id
- `state` (string, enum `['PENDING','CONFIRMED','PROMOTED']`, required)

**PENDING_RECORD** — the pending checkpoint file shape:
- `pendingId` (string, required)
- `task` (string, required)
- `verdict` (object, required) — full scope verdict from preflight
- `state` (string, enum `['PENDING','CONFIRMED','PROMOTED']`, required)
- `createdAt` (string, required) — ISO timestamp
- `promotedAt` (string, optional) — set on promotion
- `planDir` (string, optional) — set on promotion

**LOCATOR_ENTRY** — compact locator record:
- `pendingId` (string, required)
- `featureId` (string, required)
- `planDir` (string, required)
- `promotedAt` (string, required)

Export all three in the schemas export block.

### Step 2: Preflight function (`extract-scope.mjs`)

Add `resolveScopePreflight({ task, result })` to
`plugins/feature-workflows/workflows/src/extract-scope.mjs`:

- Wraps the existing `resolveScope` agent call but captures the verdict
  in-memory instead of writing `scope-manifest.md`.
- Generates a `pendingId` (SHA-256 of task+timestamp, 16-hex — deterministic
  enough for uniqueness; no `Math.random`).
- Returns `{ pendingId, task, verdict, state: 'PENDING', createdAt }`.
- Writes NOTHING to disk — the pending record is persisted by the caller
  (main.mjs) only if the scope resolves successfully.

Add helper `generatePendingId(task)` — pure function, SHA-256-based.

### Step 3: Pending record + locator helpers (`extract-scope.mjs`)

Add pure helper functions to `extract-scope.mjs`:

**`writePendingRecord(pendingDir, record)`** — writes
`docs/extract/.pending/<pendingId>.json` via an agent file-writer call
(temp-then-rename pattern).

**`readPendingRecord(pendingDir, pendingId)`** — reads + validates the pending
record file.

**`appendLocatorEntry(locatorPath, entry)`** — appends to
`docs/extract/.pending-locator.json` (array of LOCATOR_ENTRY objects).
Reads existing array (or `[]`), appends entry, writes atomically.

**`resolveLocator(locatorPath, pendingId)`** — looks up `pendingId` in the
locator array; returns `{ featureId, planDir, promotedAt }` or null.

**`expirePendingPayload(pendingDir, pendingId, maxAgeDays=30)`** — checks
`createdAt`; if older than 30 days, replaces the bulky payload with a tombstone
`{ pendingId, state: 'EXPIRED', expiredAt }` while the locator entry persists.

### Step 4: Promotion logic (`extract-scope.mjs`)

Add `promotePendingRecord({ pendingDir, record, planDir, result })`:

- **NEW-feature branch** (no existing folder at `planDir`):
  1. Create folder (`mkdir`)
  2. Write `.identity.json` stub: `{ featureId, planDir, ownershipScopeDigest: null, createdAt }`
     (actual digest computed in Phase 13; D0 writes the placeholder structure)
  3. Write `scope-manifest.md` (the scope verdict, now persisted)
  4. Write fresh `pipeline-state.json` (root-last — after identity + manifest)
  5. Update pending record: `state = 'PROMOTED'`, set `promotedAt`, `planDir`
  6. Append locator entry

- **EXISTING-feature branch** (folder + `pipeline-state.json` already exists):
  1. Load existing `pipeline-state.json`
  2. Record the current scope as a pending revision in the loaded state
  3. Do NOT create a folder, do NOT overwrite `.identity.json`
  4. Update pending record: `state = 'PROMOTED'`, set `promotedAt`, `planDir`
  5. Append locator entry

Each write uses temp-then-rename. The root-last commit (pipeline-state.json
on NEW branch, or state update on EXISTING branch) is the final write.

### Step 5: `--confirm <pendingId>` leg in `main.mjs`

In `plugins/feature-workflows/workflows/src/main.mjs`:

- Parse `args.confirm` as the pendingId at the top of `main()` (alongside
  `args.resume`).
- Before the existing extract-mode branch, add a `--confirm` handler:
  1. Read pending record from `docs/extract/.pending/<pendingId>.json`
  2. If not found → check locator; if locator has entry → redirect to
     `--resume <planDir>` flow (already promoted)
  3. If found and `state === 'PENDING'`:
     - Derive featureId/planDir (from the scope verdict — categorizer runs
       here for D0; Phase 13 makes this deterministic)
     - Call `promotePendingRecord` with the appropriate branch
     - Set `task` from the pending record
     - Fall through to the existing extract flow (scope is already confirmed)
  4. If found and `state === 'PROMOTED'`:
     - Read `planDir` from the record
     - Redirect to `--resume <planDir>` flow
  5. If not found anywhere → blocked result with actionable handoff

- Modify the extract-mode Gate X0/X0.5 section:
  - On a FRESH run (no `--confirm`, no `--resume`): run
    `resolveScopePreflight` → write pending record → return
    `awaiting-scope-confirm` handoff WITH `pendingId` (instead of planDir)
  - The `scopeConfirmed` mechanism (via `--resume`) remains as a fallback but
    `--confirm` is the primary path

### Step 6: Meta phase declarations

In `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs`:

Add two phase titles to the `phases` array:
- `{ title: 'Pending Confirm' }` — the preflight + pending-checkpoint gate
- `{ title: 'Promote' }` — the atomic promotion gate

These appear in the `phase()` calls in the `--confirm` handler and the fresh-run
preflight section.

### Step 7: Command doc update (`extract-design.md`)

Update `plugins/feature-workflows/commands/extract-design.md`:

- Add `--confirm <pendingId>` to the argument-hint line
- Document the pending-confirmation protocol:
  - Fresh run returns a `pendingId` for scope confirmation
  - `--confirm <pendingId>` resumes and promotes
  - `--confirm` works even after the 30-day payload TTL (via permanent locator)
  - `--resume <planDir>` remains for post-promotion resume
- Note: concurrent same-feature invocations are unsupported

### Step 8: Generate dist + validate

- `npm run build` — regenerate both dist entries
- `npm run validate:build` — verify drift-free
- `npm test` — full suite must pass (baseline 1470 + new tests)

## Files to Modify

| File | Change |
|------|--------|
| `plugins/feature-workflows/workflows/src/schemas.mjs` | Add PREFLIGHT_VERDICT, PENDING_RECORD, LOCATOR_ENTRY |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Add resolveScopePreflight, pending/locator helpers, promotePendingRecord |
| `plugins/feature-workflows/workflows/src/main.mjs` | Add --confirm leg, modify Gate X0/X0.5 to use preflight+pending |
| `plugins/feature-workflows/workflows/src/state.mjs` | Add pending record + locator persistence helpers (if needed beyond extract-scope.mjs) |
| `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` | Add 'Pending Confirm' and 'Promote' phases |
| `plugins/feature-workflows/commands/extract-design.md` | Document --confirm, pending protocol |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist (rebuild) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated dist (rebuild) |

## Files to Create

| File | Purpose |
|------|---------|
| `tests/pending-confirmation.test.mjs` | D0 protocol tests (preflight, confirm, promote, crash-idempotent, TTL, locator) |

## Test Specification (tests/pending-confirmation.test.mjs)

### RED tests (must fail before implementation)
1. `resolveScopePreflight` writes nothing to disk
2. `--resume <planDir>` on a pending (not-yet-promoted) checkpoint → blocked
3. Crash during promotion → no durable mapping; re-confirm does not duplicate

### GREEN tests
4. `resolveScopePreflight` returns `{ pendingId, verdict, state:'PENDING' }`
5. `--confirm <pendingId>` on PENDING → promotes → hands off to extraction
6. NEW branch: creates folder + `.identity.json` + `pipeline-state.json`
7. EXISTING branch: loads existing state, does NOT overwrite identity/ownership
8. Replay `--confirm <pendingId>` after PROMOTED → redirects to `--resume <planDir>`
9. Locator resolves `--confirm` after 30-day payload TTL expiry
10. Crash-idempotent at each boundary (PENDING re-confirm, PROMOTED re-promote)
11. `--confirm` on unknown pendingId → blocked with actionable handoff
12. Atomic writes (temp-then-rename) — no torn JSON on simulated crash

## Success Criteria

1. `--confirm <pendingId>` always resolves (including after payload TTL expiry
   — via permanent locator)
2. Replay never creates a duplicate folder or re-promotes
3. Existing-feature promotion never overwrites immutable ownership identity
4. Full test suite green (1470 baseline + new D0 tests)
5. Build drift-free (`npm run validate:build`)
6. Six-mode compatibility preserved (design/implement/tune/extract/review/status)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Pending record grows unbounded | 30-day TTL on bulky payload; compact locator is tiny |
| Crash between identity write and pipeline-state | Root-last ordering; re-promote is idempotent (tombstone check) |
| Categorizer still non-deterministic in D0 | Expected — Phase 13 replaces with deterministic hashing; D0 uses categorizer for NEW branch only |
| Existing extract flow regression | Comprehensive test suite (1470 baseline); Gate X0.5 modification is backward-compatible (scopeConfirmed fallback preserved) |

## Security Considerations

- No secrets in pending records (task text and scope verdict only)
- File writes use temp-then-rename (no torn JSON)
- `pendingId` is SHA-256-derived (not predictable/forgeable)

---

*Phase 12: Pending-Confirmation Protocol & Promotion*
*Planned: 2026-07-23 — autonomous /gsd-plan-phase 12 --auto*
