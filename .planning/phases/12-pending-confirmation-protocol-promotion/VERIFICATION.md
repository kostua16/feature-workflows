# Phase 12 — UAT Verification (Goal-Backward)

**Date:** 2026-07-23
**Verdict:** GOAL MET
**Method:** Autonomous goal-backward UAT — start from user-visible requirements (PROMO-01, PROMO-02, LOCATOR-01), trace each backward to source code, verify behavior matches specification.
**Commits verified:** `21b8796` (feat), `c8cc972` (Nyquist tests)

---

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PROMO-01 | MET | `resolveScopePreflight` write-free + `--confirm <pendingId>` + atomic crash-idempotent promotion |
| PROMO-02 | MET | NEW vs EXISTING branch in `promotePendingRecord`; existing never overwrites identity |
| LOCATOR-01 | MET | Permanent locator + 30-day payload TTL; `--confirm` always resolves |

---

## PROMO-01 — Pending-Confirmation & Atomic Promotion

### Goal
A user can resume the pre-planDir scope-confirmation checkpoint via `--confirm <pendingId>`, and promotion is atomic and crash-idempotent (replaying never creates a duplicate folder or re-promotes).

### Verified Behavior

**Preflight (write-free):**
- `resolveScopePreflight({ task, result, timestamp })` in `extract-scope.mjs:251` runs the code-explorer agent with `SCOPE_VERDICT` schema, captures verdict in-memory, returns `{ pendingId, task, verdict, state:'PENDING', createdAt }`.
- WRITES NOTHING to disk — the pending record is persisted later by main.mjs only after scope resolves successfully.
- `generatePendingId(task, timestamp)` uses `computeDigest` (djb2-based, no Math.random/Date.now) — deterministic.

**Fresh extract run:**
- main.mjs Gate X0 calls `resolveScopePreflight` → `writePendingRecord(PENDING_DIR, preflight, result)` → returns `awaiting-scope-confirm` handoff WITH `pendingId`.
- `pipeline-state.json` intentionally NOT written (RED gate: `--resume <planDir>` cannot resume a not-yet-promoted checkpoint).

**`--confirm <pendingId>` handler (main.mjs:44-90):**
- Reads pending record from `docs/extract/.pending/<pendingId>.json`.
- PENDING → sets `confirmRecord`, falls through to extract flow → `promotePendingRecord` at Gate X0.
- PROMOTED → redirects to `--resume <planDir>` (no re-promote).
- EXPIRED + locator entry → redirect to `--resume <planDir>`.
- EXPIRED without locator → blocked (`confirm-expired`).
- Not found + locator → redirect to `--resume <planDir>`.
- Not found anywhere → blocked (`confirm-not-found`).

**Atomic promotion (`promotePendingRecord` in extract-scope.mjs:398):**
- Each write uses temp-then-rename (via file-writer agent).
- Root-last ordering: identity + manifest BEFORE pipeline-state.json (NEW branch).
- Crash-idempotent: re-confirm from PENDING re-promotes (writePendingRecord overwrites idempotently); re-promote after PROMOTED redirects to --resume.

### Result: MET

---

## PROMO-02 — New vs Existing Promotion

### Goal
When the resolved scope matches an existing feature, the run loads and updates that feature's state (revision) without overwriting its immutable ownership identity. Only a genuinely new feature creates a folder + immutable identity.

### Verified Behavior

**Branching logic (`promotePendingRecord`):**
- Checks for `pipeline-state.json` at `planDir` via `ARTIFACT_CHECK` schema agent.
- **NEW branch** (no existing pipeline-state.json):
  1. `writeScopeManifestFromVerdict` — serializes scope verdict to `scope-manifest.md`
  2. `writeIdentityStub` — writes `.identity.json` with `{ featureId, planDir, ownershipScopeDigest: null, createdAt }` (placeholder; Phase 13 fills the digest)
  3. `flushPipelineState` — root-last write of `pipeline-state.json`
- **EXISTING branch** (pipeline-state.json exists):
  1. `writeScopeManifestFromVerdict` — writes revised scope-manifest.md
  2. Does NOT create folder, does NOT overwrite `.identity.json`, does NOT call `flushPipelineState`
  3. pipeline-state.json preserved (updated later by extract flow)

**Identity protection:**
- `writeIdentityStub` sets `ownershipScopeDigest: null` — the immutable ownership digest placeholder.
- EXISTING branch never touches `.identity.json`.

### Result: MET

---

## LOCATOR-01 — Permanent Locator & Payload TTL

### Goal
A compact permanent `pendingId → planDir` locator lets `--confirm` always resolve, while the bulky scratch payload is TTL-expired (30 days) — bounded growth without breaking confirmation replay.

### Verified Behavior

**Paths:**
- `PENDING_DIR = 'docs/extract/.pending/'` — pending record files
- `PENDING_LOCATOR_PATH = 'docs/extract/.pending-locator.json'` — compact permanent locator

**Locator operations:**
- `appendLocatorEntry(locatorPath, entry, result)` — reads existing array (or `[]`), appends `{ pendingId, featureId, planDir, promotedAt }`, writes atomically (temp-then-rename).
- `resolveLocator(locatorPath, pendingId, result)` — reads locator array, returns matching entry or null.
- `resolveLocatorEntry(locator, pendingId)` — pure lookup, first match wins.

**TTL expiry:**
- `isPendingExpired(record, maxAgeDays, nowTimestamp)` — pure function.
- Default `maxAgeDays = 30`; falsy/negative defaults to 30.
- Strict `>` comparison: exactly 30 days = NOT expired; 30 days + 1ms = expired.
- `EXPIRED` state records return true immediately.
- Future `createdAt` (negative age) = not expired.
- Invalid/unparseable dates = not expired (fails open to avoid false expiry).

**End-to-end TTL behavior:**
- After promotion, pending record state → PROMOTED with `promotedAt` + `planDir` set.
- After 30 days, the bulky payload (task, verdict) expires but the locator entry persists.
- `--confirm <pendingId>` on an expired payload resolves via locator → redirects to `--resume <planDir>`.

### Result: MET

---

## Schemas Verified

All three schemas in `schemas.mjs` are correctly defined with `additionalProperties: false`:

| Schema | Required Fields | Optional Fields | State Enum |
|--------|----------------|-----------------|------------|
| PREFLIGHT_VERDICT | pendingId, task, verdict, state, createdAt | promotedAt, planDir | PENDING, CONFIRMED, PROMOTED |
| PENDING_RECORD | pendingId, task, verdict, state, createdAt | promotedAt, planDir, expiredAt | PENDING, CONFIRMED, PROMOTED, EXPIRED |
| LOCATOR_ENTRY | pendingId, featureId, planDir, promotedAt | (none) | (no state — compact record) |

---

## Test Results

### Full Suite
```
tests 1628  pass 1628  fail 0  duration ~13.4s
```

### Phase 12 Specific
```
tests 158  pass 158  fail 0  duration ~155ms
```

Files: `tests/pending-confirmation.test.mjs` + `tests/pending-confirmation-nyquist.test.mjs`

---

## Build & Drift

- **Build drift check:** PASS — both dist files up to date (33 modules, 336 top-level names each)
- **Phase-label validation:** PASS — 0 undeclared phases
- **Meta phases:** `Pending Confirm` and `Promote` declared in `feature-pipeline.meta.mjs:44-45`
- **ESM validity:** Validated via build drift check (builder self-checks ESM)
- **No forbidden tokens:** No Math.random / Date.now / new Date in Phase 12 code (confirmed by tests)

---

## Documentation

`plugins/feature-workflows/commands/extract-design.md` fully documents:
- `--confirm <pendingId>` argument
- Pending-confirmation protocol (fresh run → pendingId → confirm → promote)
- Primary path vs `--resume` fallback
- 30-day TTL + permanent locator behavior
- Error states: `confirm-not-found`, `confirm-expired`

---

## Cross-Cutting Checks

- No direct FS/shell in the workflow script (all I/O via agent calls) — confirmed
- Six-mode compatibility preserved (design/implement/tune/extract/review/status) — --confirm only active in extract mode
- `scopeConfirmed` fallback preserved for backward compatibility
- Crash-safe writes throughout (temp-then-rename pattern)

---

## Conclusion

Phase 12 (D0) is **COMPLETE and VERIFIED**. All three requirements (PROMO-01, PROMO-02, LOCATOR-01) are fully delivered in the codebase with corresponding source code, schemas, tests, and documentation. 1628 tests pass, build is drift-free, phase-labels are clean.

---

*UAT verification performed: 2026-07-23 — autonomous goal-backward verification*
