---
phase: 13
slug: deterministic-identity-and-hashing
status: verified
verdict: MET
verified_at: 2026-07-23T00:50:00Z
verifier: autonomous /gsd-verify-work 13 --auto
commit_validated: 089d799
requirements: [IDENT-01, FOLDER-01]
design_source: plans/260723-extract-deterministic-folders-upsert/plan.md §D1.1 + §Hashing
---

# Phase 13 — Verification: Deterministic Identity & Hashing

## Verdict: MET

Phase 13 delivers D1.1 (IDENT-01, FOLDER-01): per-file `contentSha256` + `scopeDigest`
(agent-computed, validated before selection, fail-closed) and deterministic folder
derivation (top-2-seg area, lex-smallest-file slug + scopeId16, repo-relative POSIX).
All three success criteria from the ROADMAP are satisfied with full test evidence.

## Phase Goal

> A feature's folder is derived deterministically from its resolved scope (no LLM),
> stable across clones/worktrees, fixed for life.

**Status: MET.** `deriveFeatureFolder` is a pure function (no agent calls, no LLM, no
hashing). Same inputs always produce the same `docs/extract/<area>/<featureId>/` path.
The categorizer LLM is bypassed for extract-mode fresh runs.

## Requirements Verified

### IDENT-01 — Per-file contentSha256 + scopeDigest, validated, fail-closed

**Status: MET.**

- `resolveScopePreflight` calls `hashSources` (agent-mediated SHA-256) after scope
  resolution, then `validateHashes` before `deriveFeatureFolder`.
- `validateHashes` enforces 64-lowercase-hex on every `contentSha256` and `scopeDigest`.
  Missing/malformed/uppercase/wrong-length → `{ valid: false, reason }`.
- On validation failure, the engine blocks at `extract-hash-error` with a handoff
  message instructing re-run or `--feature=<featureId>` override. No folder is created.
- No `crypto`/`createHash` in engine source — all hashing is agent-mediated.
- Evidence: `extract-scope.mjs` L264-287 (validateHashes), L316-340 (hashSources),
  `main.mjs` L1219-1228 (hash-error blocking).

### FOLDER-01 — Deterministic folder, no LLM, stable for life

**Status: MET.**

- `deriveFeatureFolder({ fileHashes, scopeDigest, entryPoints })` is pure:
  - `area` = first 2 path segments of anchor file (lex-smallest, entry points excluded).
  - `primarySlug` = `categorizeSlug(anchorFilename)`.
  - `scopeId16` = first 16 hex of `scopeDigest`.
  - `featureId` = `<primarySlug>-<scopeId16>`.
  - `planDir` = `docs/extract/<area>/<featureId>/` (POSIX, repo-relative).
- Fallback: all-entry-points → full sorted set; <2 segments → `uncategorized`.
- Categorizer bypassed for extract fresh runs (placeholder overridden by preflight).
- `--confirm` promotion uses `confirmRecord.derivedPlanDir`.
- Evidence: spot-checked via harness — deterministic across calls, different digest
  → different featureId.

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Same resolved scope → same folder across runs | MET | `deriveFeatureFolder` pure; spot-check r1==r2=true; 177 Phase 13 tests |
| 2 | Identity selection blocks on bad hashes | MET | `validateHashes` fail-closed; `main.mjs` L1219-1228 blocks at extract-hash-error |
| 3 | No LLM in the path | MET | Categorizer bypassed (L501-506); `deriveFeatureFolder` is pure; no crypto in engine |

## Additional Verified Properties

- `.identity.json` stores real 64-hex `ownershipScopeDigest` (not Phase 12 null stub).
- `writeIdentity` replaces `writeIdentityStub` (no function definition remains).
- All paths normalized to repo-relative POSIX via `normalizeToPosix`.
- Meta phase `Hash Sources` declared.
- `HASH_SOURCES_VERDICT` + `IDENTITY_RECORD` schemas have `additionalProperties: false`.
- Promotion passes all 4 identity fields (scopeDigest, area, scopeId16, featureId).

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| Full suite (`npm test`) | 1805 | 1805 | 0 |
| Phase 13 main (`deterministic-identity.test.mjs`) | 60 | 60 | 0 |
| Phase 13 nyquist (`deterministic-identity-nyquist.test.mjs`) | 117 | 117 | 0 |

## Build Status

- Dist drift-free: `npm run validate:build` passes (342 top-level names each, both files).
- Engine version: 1.4.5.

## UAT File

`.planning/phases/13-deterministic-identity-and-hashing/13-UAT.md` — 6/6 tests passed, 0 issues.

## Scope Boundary

Phase 13 implements D1.1 ONLY. The following are NOT in scope (deferred to Phases 14-18):
D1.2 (registry), D1.3 (integrity), D1.4 (collision guard), D2 (change detection), D3 (upsert), D4 (migration).
