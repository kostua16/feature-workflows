---
phase: 12
slug: pending-confirmation-protocol-promotion
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-23
---

# Phase 12 — Validation Strategy

> Retroactive Nyquist validation for completed Phase 12 (PROMO-01, PROMO-02, LOCATOR-01).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in test runner) |
| **Config file** | package.json `test` script |
| **Quick run command** | `node --test tests/pending-confirmation.test.mjs tests/pending-confirmation-nyquist.test.mjs` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~14 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/pending-confirmation.test.mjs tests/pending-confirmation-nyquist.test.mjs`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01 | 12-PLAN | 1 | PROMO-01 | Crash-idempotent | resolveScopePreflight writes nothing; --confirm promotes atomically | unit + source-assertion | `node --test tests/pending-confirmation.test.mjs` | YES | GREEN |
| 12-02 | 12-PLAN | 1 | PROMO-02 | Identity overwrite | NEW vs EXISTING promotion branch; identity never overwritten | source-assertion | `node --test tests/pending-confirmation.test.mjs` | YES | GREEN |
| 12-03 | 12-PLAN | 1 | LOCATOR-01 | Payload TTL | Permanent locator resolves after 30-day expiry; bounded growth | unit + source-assertion | `node --test tests/pending-confirmation.test.mjs` | YES | GREEN |
| 12-04 | 12-PLAN | 1 | PROMO-01, PROMO-02, LOCATOR-01 | Nyquist sampling | Edge-case characterization: boundary conditions, schema deep, crash ordering | unit + source-assertion | `node --test tests/pending-confirmation-nyquist.test.mjs` | YES | GREEN |

---

## Validation Audit 2026-07-23

| Metric | Count |
|--------|-------|
| Gaps found | 56 |
| Resolved | 56 |
| Escalated | 0 |

### Gap Categories Filled

**generatePendingId (10 tests):**
- Unicode/CJK characters in task text
- Emoji in task text
- Very long task strings (2000 chars)
- Pipe character (separator) does not cause ambiguity
- Newlines/tabs in task
- Numeric timestamp coercion
- Null/undefined task and timestamp
- Always lowercase hex output
- Similar tasks do not collide

**buildPendingRecord (8 tests):**
- Null verdict passes through
- Undefined verdict passes through
- Verdict object reference preserved (not cloned)
- Each call returns a NEW object (no shared state)
- Numeric task coerced to string
- State always PENDING regardless of input
- Numeric createdAt coerced to string
- Complex nested verdict data preserved

**isPendingExpired (10 tests):**
- Exactly 30 days boundary (NOT expired — strict > comparison)
- 30 days + 1 second IS expired
- maxAgeDays=0 defaults to 30 (falsy guard)
- Negative maxAgeDays defaults to 30
- Fractional maxAgeDays (1.5 days) boundary
- Future createdAt (negative age) not expired
- Date-only createdAt (no timezone)
- CONFIRMED state uses createdAt comparison
- PROMOTED state uses createdAt comparison

**resolveLocatorEntry (8 tests):**
- First entry matches (early return)
- Last entry matches (worst case scan)
- Duplicate pendingId: first wins
- Null entry in array skipped without crash
- Entry with null pendingId skipped
- Empty-string pendingId can be matched
- Large locator (100 entries) scan
- Entry missing planDir still returned

**Schema deep characterization (13 tests):**
- PREFLIGHT_VERDICT: additionalProperties=false, optional promotedAt/planDir, type checks
- PENDING_RECORD: additionalProperties=false, expiredAt property, state enum exactly 4 values, optional fields
- LOCATOR_ENTRY: additionalProperties=false, exactly 4 properties all required, all type string

**Source assertions: agent-calling functions (7 tests):**
- resolveScopePreflight uses SCOPE_VERDICT schema
- resolveScopePreflight phase is Pending Confirm
- resolveScopePreflight uses gm('scopeResolver') model
- resolveScopePreflight returns null on empty files
- resolveScopePreflight sets scopePath to 'pending'
- writePendingRecord/readPendingRecord wiring (schema, agentType, phase)
- appendLocatorEntry/resolveLocator wiring (temp-then-rename, delegation, phases)

**Source assertions: identity + manifest helpers (5 tests):**
- writeIdentityStub sets ownershipScopeDigest to null
- writeIdentityStub derives featureId from planDir basename
- writeIdentityStub phase is Promote
- writeScopeManifestFromVerdict formats markdown with files list
- writeScopeManifestFromVerdict includes summary

**Source assertions: promotePendingRecord ordering + branches (12 tests):**
- Uses ARTIFACT_CHECK for existing-folder check
- NEW branch: scope-manifest written BEFORE identity
- NEW branch: flushPipelineState root-last
- EXISTING branch: does NOT call flushPipelineState
- EXISTING branch: writes scope-manifest (revision)
- Updates record state to PROMOTED
- Sets promotedAt and planDir on record
- Locator featureId = planDir basename
- Returns { promoted: true, isNew }
- Logs NEW/EXISTING label
- Pending record updated BEFORE locator (crash order)

**Source assertions: --confirm handler (8 tests):**
- Calls phase('Pending Confirm')
- PROMOTED redirect sets args.resume, clears confirm
- EXPIRED with locator redirects to resume
- EXPIRED without locator returns blocked confirm-expired
- PENDING sets confirmRecord and task from record
- CONFIRMED falls through to promote (else branch)
- Not found checks locator as fallback
- Not found anywhere returns blocked confirm-not-found

**Source assertions: fresh extract preflight (7 tests):**
- Calls phase('Pending Confirm')
- Passes args.timestamp to resolveScopePreflight
- Null preflight → blocked at extract-scope
- Pending record written via writePendingRecord
- Handoff includes scopeSummary with correct fields
- stateCheckpoint Pending Confirm awaiting-confirm
- Intentionally does NOT call consolidate (no pipeline-state)

**Source assertions: promotion during --confirm (6 tests):**
- Calls phase('Promote')
- Guard: confirmRecord && !result.scopeManifestPath
- Sets result.scopeManifestPath to planDir + scope-manifest.md
- Sets result.scopeConfirmed to true
- Writes ambiguities to open-questions
- stateCheckpoint Promote done

**Cross-cutting wiring (5 tests):**
- main calls promotePendingRecord in confirm path
- main references PENDING_DIR and PENDING_LOCATOR_PATH
- Meta phases include Pending Confirm and Promote
- Crash-safe writes (temp-then-rename)
- PENDING_DIR and PENDING_LOCATOR_PATH are distinct paths

### Defects Fixed

None — Phase 12 implementation is sound. No real defects found during validation.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-23
