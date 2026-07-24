---
phase: 14
slug: feature-identity-registry-lookup-integrity
status: verified
verdict: MET
verified_at: 2026-07-24
verified_by: autonomous-uat
method: goal-backward UAT
tests_pass: 1927
tests_fail: 0
---

# Phase 14 — UAT Verification

> Goal-backward UAT of Phase 14 (REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01 / D1.2–D1.4).
> Autonomously verified; no human interaction required.

## Goal

> A registry makes folders sticky for life — surviving full renames — with safe,
> recoverable state.

## Verdict: MET

All three goal components verified against delivered source with passing tests
and concrete source-line evidence.

## Goal Decomposition (backward)

### 1. "safe, recoverable state" — INTEGRITY-01 — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| Atomic writes (temp-then-rename) | `extract-scope.mjs:761` — writeRegistry instructs file-writer agent to use temp-then-rename | 19, 42 |
| Root-last readiness commit | `main.mjs:1844-1865` — status set to `current` only inside `if (readiness.ready)` block, after extraction+publish+persist | 38, 39, 44 |
| Startup recovery reconciles extracting entries | `main.mjs:1163-1168` calls `recoverRegistry`; `extract-scope.mjs:818-970` rebuilds mutable from pipeline-state, immutable from sidecar | 45-53 |
| Fail-closed on missing evidence | `extract-scope.mjs:919-936` — missing pipeline-state → stale+recoveryError; missing identity → stale+recoveryError | 41, 46, 47 |
| Immutable fields from sidecar (not stale registry) | `extract-scope.mjs:894-897` — identity fields overwritten from `.identity.json` read | 48 |
| Mutable fields from current pipeline-state (not creation-time) | `extract-scope.mjs:940-948` — files rebuilt from `_sourceDigest` / extractScope | 49 |
| Corrupt registry rebuilt from sidecar scan | `extract-scope.mjs:826-857` — scans `docs/extract/` for `.identity.json` files | 50, 51 |
| Registry path | `docs/extract/.registry.json` (REGISTRY_PATH constant, extract-scope.mjs export) | 58 |

### 2. "surviving full renames" — MATCH-01 — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| Rename-resilient matching (path OR contentSha256) | `extract-scope.mjs:666-672` — builds path+hash sets, counts match by `matchByPath \|\| matchByHash` | 5, 14, 60 |
| Deduplication (path+hash dual match counts once) | `extract-scope.mjs:668` — single `if (matchByPath \|\| matchByHash) totalMatches++` | 14, 60 |
| Defensible threshold (anchor OR majority) | `extract-scope.mjs:684` — `isStrong = anchorMatch \|\| totalMatches >= majority` where `majority = floor(min/2)+1` | 6, 11 |
| Weak-only match blocked | `extract-scope.mjs:722-724` — `{ decision: 'blocked', reason: 'weak-only-match' }` | 2, 10 |
| Tie (equal match counts) blocked | `extract-scope.mjs:728-732` — `{ decision: 'blocked', reason: 'ambiguous-match' }` | 3, 9 |
| Zero strong → new | `extract-scope.mjs:725` — `{ decision: 'new' }` | 7, 12 |
| findFeature is pure (no agent/async/I/O) | `extract-scope.mjs:634` — plain `function findFeature(arg)`, no safeAgent/flexibleAgent calls | 54 |
| No Math.random/Date.now in findFeature | source assertion | 56 |

### 3. "sticky for life" — REGISTRY-01 + COLLISION-01 — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| Registry schema (REGISTRY_FILE + REGISTRY_ENTRY) | `schemas.mjs:1102-1142` — additionalProperties:false, 7 required fields, status enum, files items additionalProperties:false | 28-32 |
| Registry + sidecar record ownership identity | `.registry.json` index + per-folder `.identity.json` (Phase 13) | — |
| Collision guard: full 64-hex digest comparison | `extract-scope.mjs:803` — `identity.ownershipScopeDigest === requesterDigest` | 26, 27 |
| Collision: different digest → abort | `extract-scope.mjs:807-810` — returns `{ collision: true, existingFeatureId }` | 4, 26 |
| Collision: same digest → idempotent safe | `extract-scope.mjs:804-805` — returns `{ collision: false, idempotent: true }` | 25 |
| Collision: no existing identity → safe create | `extract-scope.mjs:799-801` — returns `{ collision: false }` | 24 |
| Integration: reuse → sticky folder | `main.mjs:1293-1300` — overrides planDir to reused feature's planDir | 34 |
| Integration: new → collision guard before promotion | `main.mjs:1322-1344` — checkFolderCollision called before writePendingRecord | 35 |
| Integration: blocked → blocked handoff, no promotion | `main.mjs:1301-1319` — sets result.blockedAt, returns early | 36 |
| Integration: registry upserted after promotion | `main.mjs:1206-1224` — upsertRegistryEntry + writeRegistry, status='extracting' | 37, 38 |
| upsertRegistryEntry pure (no mutation, no agents) | `extract-scope.mjs:734-738` — Object.assign copy, no agent calls | 21-23, 55 |
| Meta phases declared | `meta/feature-pipeline.meta.mjs:46-47` — Registry Lookup, Registry Recovery | 57 |
| Command doc updated | `commands/extract-design.md:206-234` — registry, rename-resilience, collision, recovery, atomic writes | — |

## RED Gate Verification (all must fail before implementation — confirmed fixed)

| RED Gate | Status | Evidence |
|----------|--------|----------|
| Full rename must not create a second folder | PASS | findFeature matches by contentSha256; test 5 confirms reuse on full rename |
| Shared config file must not mismerge two features | PASS | weak-only match blocked; test 10 confirms |
| Concurrent/corrupt state must not silently lose entries | PASS | atomic writes (temp-then-rename); fail-closed recovery; tests 41-43, 46-47 |

## E2E Scenario Coverage (from ROADMAP)

| Scenario | Phase | Status | Evidence |
|----------|-------|--------|----------|
| E2E-MATCH-01: Full rename of every file in a feature → reuses same folder | 14 | PASS | findFeature content-hash matching (test 5), source extract-scope.mjs:666-672 |
| E2E-MATCH-02: Two features sharing package.json only → blocked | 14 | PASS | weak-only match blocked (test 10), source extract-scope.mjs:722-724 |

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| feature-identity-registry.test.mjs | 47 | 47 | 0 |
| registry-integrity-recovery.test.mjs | 25 | 25 | 0 |
| phase14-nyquist-validation.test.mjs | 50 | 50 | 0 |
| **Phase 14 subtotal** | **122** | **122** | **0** |
| **Full suite** | **1927** | **1927** | **0** |

Build drift: clean (both dist files up to date, 33 modules, 352 top-level names).

## Scope Boundary Confirmation

Phase 14 implements ONLY D1.2 (registry + rename-resilient lookup), D1.3 (registry
integrity + recovery), and D1.4 (collision guard). The following are NOT in scope
and correctly absent from the delivered code:
- D2.1 (ownership reconciliation) — Phase 15
- D2.2 (change detection) — Phase 16
- D2.3 (invalidation chain) — Phase 17
- D3 (upsert entrypoints + flags) — Phase 18
- D4 (migration/adopt) — Phase 18

## Commits Verified

- `a10260d` — plan (D1.2-D1.4)
- `5d11715` — feat(extract): implementation (D1.2-D1.4)
- `ef5d553` — test(phase-14): Nyquist validation (50 characterization tests)

## Notes

- The 14-VALIDATION.md cited "1928 pass" but actual count is 1927 (1805 baseline +
  122 Phase 14 = 1927). The doc's baseline arithmetic (1878+50) was incorrect.
  All 1927 tests pass with 0 failures. Documentation-only discrepancy; no
  functional impact.

## Conclusion

Phase 14 goal is **MET**. All four requirements (REGISTRY-01, MATCH-01,
COLLISION-01, INTEGRITY-01) are fully implemented, integrated, and tested. The
feature-identity registry makes folders sticky for life with rename-resilient
content-hash matching, defensible thresholds blocking ambiguous/weak matches,
full-digest collision prevention, atomic writes with root-last readiness, and
fail-closed startup recovery. No defects found.
