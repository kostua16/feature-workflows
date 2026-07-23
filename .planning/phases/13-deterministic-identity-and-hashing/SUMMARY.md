# Phase 13: Deterministic Identity & Hashing — Summary

**Phase:** 13
**Completed:** 2026-07-23
**Requirements:** IDENT-01, FOLDER-01
**Commit:** e7850bb (feat) · 089d799 (Nyquist characterization, 117 tests)

## What was built

1. **Agent-mediated `hashSources`** — after scope resolution, an agent reads
   each file and returns per-file `contentSha256` (64-hex) plus a combined
   `scopeDigest` (64-hex SHA-256 over framed sorted `[path, contentSha256]`
   pairs). No `crypto`/`createHash` in any engine source file — hashing is
   exclusively agent-mediated.
2. **Pure `validateHashes` (fail-closed)** — every `contentSha256` and the
   `scopeDigest` must match `/^[0-9a-f]{64}$/` (64 lowercase hex); any
   missing/malformed/uppercase/wrong-length value returns
   `{ valid: false, reason }`, and the engine blocks at `extract-hash-error`
   with a `--feature=<featureId>` override hint.
3. **Pure `deriveFeatureFolder`** — deterministic folder derivation: `area` =
   first 2 path segments of the lex-smallest non-entry-point anchor;
   `primarySlug` = slug of the anchor filename; `scopeId16` = first 16 hex of
   `scopeDigest`; `featureId` = `<primarySlug>-<scopeId16>`; `planDir` =
   `docs/extract/<area>/<featureId>/`. All paths normalized to repo-relative
   POSIX via `normalizeToPosix`. Fallbacks: all-entry-points → full sorted
   set; <2 segments → `uncategorized`.
4. **Identity upgrade + extract-mode wiring** — `writeIdentity` replaces the
   Phase 12 stub and persists the real 64-hex `ownershipScopeDigest`
   (`IDENTITY_RECORD` schema). Extract-mode fresh runs bypass the categorizer
   LLM (placeholder `planDir` overridden by the preflight-derived path);
   `--confirm` promotion consumes `confirmRecord.derivedPlanDir`.
5. **Schemas + meta + docs** — `HASH_SOURCES_VERDICT`, `IDENTITY_RECORD`
   added (both `additionalProperties: false`); `PREFLIGHT_VERDICT` +
   `PENDING_RECORD` extended with `fileHashes`/`scopeDigest`/`featureId`/
   `derivedPlanDir`; `Hash Sources` meta phase declared; `extract-design.md`
   documents deterministic folders and the hash-validation gate.

## Test results

- 1805/1805 full suite green (1628 baseline + 177 Phase 13).
- Same resolved scope → same `planDir` (deterministic across calls).
