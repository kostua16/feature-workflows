---
status: complete
phase: 13-deterministic-identity-and-hashing
source: [PLAN.md, 13-VALIDATION.md, ROADMAP.md, REQUIREMENTS.md]
started: 2026-07-23T00:30:00Z
updated: 2026-07-23T00:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Deterministic Folder Derivation from Scope
expected: Given a resolved scope with per-file contentSha256 + scopeDigest, deriveFeatureFolder produces a deterministic docs/extract/<area>/<featureId>/ path. area = first-2-segments of the anchor file's repo-relative POSIX path (excluding entry points). featureId = slug-of-anchor-basename + scopeId16. Same inputs always produce same output.
result: pass
evidence: |
  Spot-checked via test harness. Input: 3 files (src/auth/login.ts, src/auth/session.ts, src/index.ts),
  entryPoint src/index.ts excluded. Output: area=src/auth, primarySlug=login-ts, scopeId16=0123456789abcdef,
  featureId=login-ts-0123456789abcdef, planDir=docs/extract/src/auth/login-ts-0123456789abcdef/,
  anchorPath=src/auth/login.ts. Deterministic across 2 calls (r1==r2=true). 60+117 tests confirm.

### 2. Fail-Closed Hash Validation
expected: validateHashes returns {valid: false, reason} for missing hash, malformed (not 64-hex), uppercase hex, empty array, null input, bad scopeDigest. Returns {valid: true} only when every contentSha256 is 64-lowercase-hex AND scopeDigest is 64-lowercase-hex. Engine blocks identity selection at extract-hash-error with handoff message mentioning --feature override.
result: pass
evidence: |
  Spot-checked all failure modes: missing=false, 32-hex=false, uppercase=false, empty=false, null=false,
  bad-scopeDigest=false, valid=true. main.mjs L1219-1228: preflight.hashError sets blockedAt=extract-hash-error,
  handoff includes hashError + --feature=<featureId> override message, stateCheckpoint blocked, consolidate+return.

### 3. No LLM in Extract Folder-Derivation Path
expected: The feature-categorizer agent is NOT invoked for extract-mode fresh runs. Extract fresh run uses placeholder docs/extract/.pending/plan.md, overridden by preflight.derivedPlanDir. --confirm path uses confirmRecord.derivedPlanDir. Design/implement/tune modes keep the categorizer unchanged.
result: pass
evidence: |
  main.mjs L501-506: isExtractMode branch sets placeholder + logs "categorizer bypassed".
  L497-500: --confirm branch uses confirmRecord.derivedPlanDir.
  L1234: fresh-run preflight override planDir = preflight.derivedPlanDir.
  Categorizer block (L510+) only runs for non-extract modes (gateModeActive('design', mode)).

### 4. Agent-Mediated Hashing (No In-Engine SHA-256)
expected: All SHA-256 computation happens inside the hash-sources agent (safeAgent call). Engine source files (src/*.mjs) contain NO crypto imports, NO createHash calls. The hash-sources agent prompt specifies the framing recipe (sort by path, JSON.stringify pairs, SHA-256).
result: pass
evidence: |
  grep -rn "import.*crypto\|require.*crypto\|createHash\|crypto\." src/*.mjs → empty.
  extract-scope.mjs L316-340: hashSources delegates to safeAgent with HASH_SOURCES_VERDICT schema,
  model gm('todo'), prompt specifies SHA-256 framing recipe + lowercase hex + do NOT modify files.

### 5. Real Ownership Digest in .identity.json
expected: writeIdentity (replacing Phase 12 writeIdentityStub) writes ownershipScopeDigest as the real 64-hex scopeDigest, NOT null. IDENTITY_RECORD schema requires ownershipScopeDigest. No writeIdentityStub function definition exists in source. Promotion passes all 4 identityFields (scopeDigest, area, scopeId16, featureId) from the pending record.
result: pass
evidence: |
  extract-scope.mjs L527: ownershipScopeDigest: scopeDigest (not null).
  No writeIdentityStub function definition in source (comment-only reference at L499).
  main.mjs L1177-1180: promotion identityFields passes all 4 fields from confirmRecord.
  promotePendingRecord L560-564: writeIdentity called with identityFields scopeDigest/area/scopeId16/featureId.

### 6. Repo-Relative POSIX Paths + Stable Identity
expected: normalizeToPosix converts backslashes to forward slashes, strips leading ./ and /. Different scopeDigest produces different featureId. Short paths (<2 segments) produce uncategorized area. All-entry-points fallback uses full sorted set. planDir always ends with / and starts with docs/extract/.
result: pass
evidence: |
  normalizeToPosix: backslash→forward, ./ stripped, / stripped (spot-checked).
  Different digest (0123... vs ffff...) → different featureId (login-ts-0123456789abcdef vs login-ts-ffffffffffffffff).
  Short path README.md → area=uncategorized.
  All-entry-points → fallback anchor = lex-smallest of full set.

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
