---
phase: 13
slug: deterministic-identity-and-hashing
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-23
---

# Phase 13 — Validation Strategy

> Retroactive Nyquist validation for completed Phase 13 (IDENT-01, FOLDER-01 / D1.1).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in test runner) |
| **Config file** | package.json `test` script |
| **Quick run command** | `node --test tests/deterministic-identity.test.mjs tests/deterministic-identity-nyquist.test.mjs` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~14 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/deterministic-identity.test.mjs tests/deterministic-identity-nyquist.test.mjs`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01 | 13-PLAN | 1 | IDENT-01 | Missing/malformed hash | validateHashes fail-closed; hashSources agent-mediated | unit + source-assertion | `node --test tests/deterministic-identity.test.mjs` | YES | GREEN |
| 13-02 | 13-PLAN | 1 | FOLDER-01 | Non-deterministic folder | deriveFeatureFolder pure; categorizer bypassed for extract | unit + source-assertion | `node --test tests/deterministic-identity.test.mjs` | YES | GREEN |
| 13-03 | 13-PLAN | 1 | IDENT-01, FOLDER-01 | Nyquist sampling | Edge-case characterization: boundaries, schema deep, crash ordering, invariants | unit + source-assertion | `node --test tests/deterministic-identity-nyquist.test.mjs` | YES | GREEN |

---

## Validation Audit 2026-07-23

| Metric | Count |
|--------|-------|
| Gaps found | 117 |
| Resolved | 117 |
| Escalated | 0 |

### Gap Categories Filled

**normalizeToPosix deep edge cases (12 tests):**
- Mixed separators (backslash + forward slash)
- Trailing slash preserved
- All backslashes
- Path with spaces
- Path with dots in filename
- Already-normalized path (identity)
- Repeated leading ./ stripping
- Single dot segment (not stripped)
- Numeric input coercion
- Unicode/CJK characters preserved
- Leading backslash-slash mix (single / stripped)
- Empty string after stripping

**validateHashes boundary characterization (13 tests):**
- All-zeros contentSha256 (valid)
- All-f contentSha256 (valid)
- Whitespace-padded hash invalid
- Hash with newline invalid
- 0x-prefixed hash invalid
- Duplicate paths both validated
- Large array (500 entries)
- Non-object element in array
- Element with extra properties still validated
- scopeDigest matching a contentSha256 (valid)
- Uppercase hex scopeDigest invalid
- Reason string populated on every failure
- Valid result has no reason field

**deriveFeatureFolder deep edge cases (16 tests):**
- Empty fileHashes → empty anchorPath, uncategorized
- Null fileHashes
- Deep path (8 segments)
- Unicode/CJK filename
- Backslash paths normalized before area derivation
- Entry points with backslash variants normalized
- Same basename different directories
- featureId stable across 10 calls
- scopeId16 exactly 16 chars
- Short scopeDigest produces short scopeId16
- planDir always ends with /
- planDir always starts with docs/extract/
- README.md basename slug
- entryPoints null/undefined/missing treated as empty
- Full arg null
- Different content same path → same area, different featureId

**Schema deep characterization (15 tests):**
- HASH_SOURCES_VERDICT: files items additionalProperties=false, exactly 2 properties, required, type checks
- IDENTITY_RECORD: optional scopeId16, all type string, required fields, ownershipScopeDigest description
- PREFLIGHT_VERDICT: fileHashes items additionalProperties=false, state enum 3 values, hash fields optional
- PENDING_RECORD: fileHashes items additionalProperties=false, state enum 4 values (incl EXPIRED), hash fields optional

**hashSources agent characterization (7 tests):**
- Returns null when files is empty
- Normalizes paths before building file list
- Uses safeAgent (not flexibleAgent) — fail-closed
- Model is gm('todo')
- Prompt specifies SHA-256 framing recipe (sort, JSON, SHA-256)
- Prompt lists files via fileList variable
- Phase is Hash Sources

**resolveScopePreflight deep wiring (10 tests):**
- Returns null when verdict has no files
- Returns null when hashSources returns null
- Normalizes entry points before deriveFeatureFolder
- Success returns area, scopeId16, primarySlug, anchorPath
- Uses generatePendingId for pendingId
- Uses flexibleAgent (not safeAgent)
- Uses SCOPE_VERDICT schema
- Uses gm('scopeResolver') model
- validateHashes called before deriveFeatureFolder (ordering)

**writeIdentity deep characterization (8 tests):**
- Builds identity object with all 6 fields
- Coerces createdAt to string
- Uses safeAgent (not flexibleAgent)
- Uses FILE_ACK schema
- AgentType is nsAgent('file-writer')
- Phase is Promote
- JSON.stringify with 2-space indent
- Function body does NOT reference writeIdentityStub

**promotePendingRecord identity integration (7 tests):**
- NEW branch writes identity AFTER scope-manifest
- NEW branch writes pipeline-state AFTER identity (root-last)
- identityFields featureId fallback to planDir basename
- identityFields scopeDigest fallback to empty string
- EXISTING branch does NOT call writeIdentity
- Locator entry uses identityFields featureId
- Logs NEW vs EXISTING

**Extract-mode main.mjs integration (13 tests):**
- Fresh run uses placeholder docs/extract/.pending/plan.md
- --confirm uses confirmRecord.derivedPlanDir
- Fresh run uses preflight.derivedPlanDir for override
- Hash error sets blockedAt to extract-hash-error
- Hash error handoff includes hashError field
- Hash error message mentions --feature override
- Promotion passes identityFields from confirmRecord (all 4 fields)
- --confirm path overrides planDir before promotion
- Fresh run categorizer bypass log message
- --confirm log message mentions deterministic folder
- Preflight null → blocked at extract-scope
- Fresh run writes pending record via writePendingRecord
- Fresh run handoff includes pendingId
- Fresh run NO consolidate before promotion (RED gate)
- --confirm promotion stateCheckpoint Promote done

**Cross-cutting invariants (11 tests):**
- normalizeToPosix accessible via engine harness
- validateHashes accessible via engine harness
- deriveFeatureFolder accessible via engine harness
- hashSources accessible via engine harness
- writeIdentity accessible via engine harness
- writeIdentityStub NOT in export list
- writeIdentityStub function definition NOT in source
- No crypto import in engine source
- No createHash call in engine source
- computeDigest (djb2) NOT used for identity
- deriveFeatureFolder uses categorizeSlug for primarySlug
- HEX64 regex defined for validation
- Meta declares Hash Sources phase
- hashSources prompt mentions lowercase hex
- hashSources prompt mentions do NOT modify files

### Defects Fixed

None — Phase 13 implementation is sound. No real defects found during validation.

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
