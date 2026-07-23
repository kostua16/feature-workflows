# Phase 14: Feature-Identity Registry, Lookup & Integrity — Summary

**Phase:** 14
**Completed:** 2026-07-24
**Requirements:** REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01
**Commit:** 5d11715 (feat) · ef5d553 (Nyquist characterization, 50 tests)

## What was built

1. **Pure `findFeature` rename-resilient lookup** — matches the current scope
   against registry entries by path OR contentSha256 (deduplicated count).
   Strong requires anchor match OR `totalMatches >= floor(min(current,
   feature)/2)+1`. Returns `'reuse'` for exactly one strictly-highest
   candidate, `'new'` for zero strong, and `'blocked'` (`ambiguous-match` or
   `weak-only-match`) for ties/shared-config-only cases. No agent/async/IO —
   verified by source assertions.
2. **Registry read/write helpers** — `readRegistry` returns `{features:{}}`
   when the file is absent and `null` on corrupt JSON (fail-closed);
   `writeRegistry` is atomic (temp-then-rename, 2-space indent);
   `upsertRegistryEntry` is pure (no mutation of input). Registry path is
   `docs/extract/.registry.json`.
3. **Collision guard (`checkFolderCollision`)** — compares the FULL 64-hex
   `ownershipScopeDigest` against any existing `.identity.json` at the derived
   `planDir`: same digest → idempotent safe; different digest → abort upsert.
4. **Startup recovery (`recoverRegistry`)** — rebuilds mutable `files`/
   `status` from current `pipeline-state.json` + `.source-digest.json` while
   sourcing immutable fields (`featureId`, `planDir`, `ownershipScopeDigest`)
   from `.identity.json` sidecars. `extracting` entries with missing evidence
   fail-closed to `stale` + `recoveryError`; corrupt registry triggers a
   sidecar scan or blocks when no sidecars exist.
5. **main.mjs integration** — fresh extract runs call `findFeature` after
   preflight; `'reuse'` overrides `planDir`, `'new'` runs the collision guard
   before promotion, `'blocked'` returns a handoff with `--feature=<id>` /
   `--new` guidance. Post-promotion upsert (status `extracting`) + root-last
   readiness commit (status → `current` after publish+persist are durable).
6. **Schemas + meta + docs** — `REGISTRY_FILE`, `REGISTRY_ENTRY`
   (`additionalProperties: false`; `status` enum `extracting|current|stale`);
   `Registry Lookup` + `Registry Recovery` meta phases declared;
   `extract-design.md` documents registry, rename-resilience, collision guard,
   and recovery semantics.

## Test results

- 1927/1927 full suite green (1805 baseline + 122 Phase 14).
- E2E-MATCH-01 (full rename → reuse) and E2E-MATCH-02 (shared config →
  blocked) both pass.
