---
phase: 7
slug: compatibility-and-project-scale-proof
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert`) |
| **Config file** | `package.json` scripts.test |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 07 | 1 | COMPAT-01 | unit | `npm test` | tests/compatibility-regression.test.mjs | green |
| 7-01-02 | 07 | 1 | COMPAT-01 | unit (nyquist) | `npm test` | tests/phase07-nyquist-validation.test.mjs | green |
| 7-02-01 | 07 | 1 | QUAL-01 | integration | `npm test` | tests/e2e-matrix.test.mjs | green |
| 7-02-02 | 07 | 1 | QUAL-01 | integration (nyquist) | `npm test` | tests/phase07-nyquist-validation.test.mjs | green |
| 7-03-01 | 07 | 1 | DOGFOOD-01 | integration | `npm test` | tests/dogfood-scale.test.mjs | green |
| 7-03-02 | 07 | 1 | DOGFOOD-01 | integration (nyquist) | `npm test` | tests/phase07-nyquist-validation.test.mjs | green |
| 7-04-01 | 07 | 1 | ALL | structural | `npm test` | tests/e2e-matrix.test.mjs | green |
| 7-04-02 | 07 | 1 | ALL | build drift | `npm run validate:build` | both entries | green |

---

## Requirement Coverage

### COMPAT-01: Continuous mode compatibility regression

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/compatibility-regression.test.mjs | 42 | Mode resolution (6 modes from args/config/state), gate partitioning (extract off in non-extract, design off in extract), validatePipelineState (legacy + v1.5 + malformed), migration (pending/skipped/completed mapping, idempotent, root-last boundary), status reporting (summarizeGates, renderStatusReport, deriveNextCommand for legacy + v1.5), engine version skew, repairResumeArtifactFlags (legacy + v1.5 shapes), seedExtractQueue (pure, deterministic), LIFECYCLE_STATES/SKIP_REASONS stability, skip readiness outcomes, structural source assertions (mode strings, guard variables, flushPipelineState, extract field isolation), deriveFeatureId determinism |
| tests/phase07-nyquist-validation.test.mjs | 40 | resolveMode defaults/null/invalid/precedence chain, gateModeActive shared-in-all-modes/design-in-tune/null-group/review-only, validatePipelineState checksum-mismatch/correct-checksum/non-object-config/absent-config, migrateLegacyState throws-on-null/non-object/no-result/failed-status/excluded-status/unknown-status/engineVersion-preservation, validateMigrationBoundary null-state/unknown-phase/missing-childId/unknown-childId, deriveFeatureId null/undefined/name-only/empty-name, detectResumeEngineSkew null-saved/null-current/matching/mismatch, summarizeGates null/empty, renderStatusReport null/failed-validation, deriveNextCommand committed/ready/handoff/blocked, seedExtractQueue no-slices, source structure assertions (VALID enumeration, guardModeActive groups, resolveMode default) |

**Status:** COVERED — all mode resolution edge cases, all gate partitioning combinations, all migration status mappings with throw/null/empty paths, all validatePipelineState error conditions, all status reporting degenerate inputs, and structural source assertions verified.

### QUAL-01: Complete E2E matrix characterization

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/e2e-matrix.test.mjs | 27 | Clean build drift (both entries), symlink + copy install resolution, version lockstep (manifest ↔ headers), sandbox safety (no require/Date), E2E-STATE-01 (root-last migration 3-child), E2E-REV-01 (source change), E2E-DISC-01 (deterministic inventory reorder), E2E-GRAPH-01 (collision + dangling edge), E2E-QUEUE-01 (23-feature cap 8 deferred), E2E-DEFER-01 (exact 8/15→8/7→7/0 progression), E2E-LEAF-01 (checkpoint), E2E-LEAF-02 (duplicate complete throws), E2E-SKIP-01 (3 classifications), E2E-BUDGET-01 (reserve preserved), E2E-FAIL-01 (retry exhaustion), E2E-CONT-01 (duplicate ack convergence), E2E-SCALE-01 (120 features × 3 segments), E2E-SYNTH-01 (idempotent synthesis), E2E-PERSIST-01 (durable-vs-retry-safe), E2E-STATUS-01 (projection identity + readiness false), matrix coverage tracker (all 18 IDs) |
| tests/phase07-nyquist-validation.test.mjs | 44 | classifyPath (generated dist/vendor/third_party/node_modules/.git/null/empty/normal-source), constant sets (GENERATED_SEGMENTS/IGNORE_SEGMENTS/GENERATED_EXTENSIONS membership), graph validation ownership-overlap (paths field), detectCycle (simple cycle/DAG), classifyCycle unsupported-unowned, compareRevisions (scope/graph/no-change), continuation out-of-order convergence, lost-ack re-ack convergence, isolateFailure timeout-blocked/blocked-resumable/error-terminal/no-mutation/artifact-preservation, shouldContinueAfterFailure true/false/transitive-blocking, eligibleIndependents transitive-closure, extractReadiness false-paths (discovery/graph/synthesis/artifacts/blocked/failed/null), countLifecycleStates all-types/empty/unknown, queueDenominator empty/all-excluded |

**Status:** COVERED — all 18 Phase 1-6 E2E matrix IDs have representative assertions, path classification covers generated/vendor/ignore/normal/null/empty, graph validation covers overlap/cycle/dangling, failure isolation covers all failure-type semantics, and readiness false-paths cover all 6 independent failure conditions.

### DOGFOOD-01: Whole-repository dogfood scale characterization

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/dogfood-scale.test.mjs | 11 | 120-feature multi-segment extraction (budget admission, continuation convergence, coverage verification, segment counts), interruption recovery (mid-gate resume), duplicate continuation convergence (no double-apply), final truthful readiness (synthesis + coverage + projection), readiness false with incomplete features, persistence tracking (8 writes durably verified), coverage denominator (excludes excluded), budget headroom (3×280=840 spent, 100 remaining, 60 reserve), failure isolation (1 failure preserves 5 completed), v1.5 shard mode compatibility, lifecycle event replay byte-stability |
| tests/phase07-nyquist-validation.test.mjs | 36 | shouldContinue (all-completed/pending/in-progress/empty), canAutoRelaunch (budget-exhausted/too-many-unacked/budget-available), resumeCommand (idempotent command + counts), continuationSummary (segment data), isTerminalFailure (permanent/blocked-dependency/retryable/exhausted/no-attempts), terminalReason (last-reason/null), segmentOutcome (all-statuses/empty), budget admission rejection/admission/reserve-total, mixed lifecycle replay stability, 200-feature irregular-cap exact-once, deriveReadiness mixed-completed-excluded/empty/null, selectiveInvalidate source-change/no-change, E2E-COMPAT-01 all-five-modes, E2E-DOGFOOD-01 multi-segment-with-duplicate-convergence |

**Status:** COVERED — full dogfood scenario with injected interruption and duplicate convergence, continuation decision logic, auto-relaunch refusal conditions, terminal failure detection for all outcome types, budget admission boundary conditions, large-scale exact-once with irregular caps, and explicit Phase 7 E2E matrix row coverage.

---

## E2E Matrix Coverage (Phase 7 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-COMPAT-01 | tests/compatibility-regression.test.mjs (all 5 modes + gate partitioning + migration) + tests/phase07-nyquist-validation.test.mjs (all-five-modes-hydrate-v1.4.5, null/invalid mode resolution, shared-gate-in-all-modes, design-active-in-tune) | green |
| E2E-DOGFOOD-01 | tests/dogfood-scale.test.mjs (120-feature multi-segment with interruption + duplicate convergence) + tests/phase07-nyquist-validation.test.mjs (200-feature irregular-cap, continuation decision, auto-relaunch, resume command, terminal failure, E2E-DOGFOOD-01 compact integration) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 120 |
| Resolved | 120 |
| Escalated | 0 |

### Defects Found and Fixed

None — Phase 7 is a proof/test phase with no source modules. All gaps were missing test coverage, not code defects.

### Gaps Identified and Filled

**COMPAT-01 (40 gaps):**
- resolveMode: null/undefined/empty inputs, invalid mode strings (fallthrough), args-over-saved-state precedence, saved-state-only fallback
- gateModeActive: shared group in all 6 modes, design gates active in tune, review gates only in review, null/undefined group defaults to shared
- validatePipelineState: checksum mismatch detection, correct checksum pass, non-object config rejection, absent config acceptance
- migrateLegacyState: null/non-object throw, no-result empty features, failed/excluded/unknown status mapping, legacyEngineVersion preservation/null
- validateMigrationBoundary: null state, unknown phase, missing childId, unknown childId
- deriveFeatureId: null/undefined/name-only/missing-arrays/empty-name
- detectResumeEngineSkew: null saved/current, matching versions, mismatch with null current
- summarizeGates/renderStatusReport/deriveNextCommand: null/empty/committed/handoff/blocked edge cases
- seedExtractQueue: no-slices single-main-entry behavior
- Source structure: VALID enumeration, guardModeActive groups, resolveMode default fallback

**QUAL-01 (44 gaps):**
- classifyPath: generated (dist/vendor/third_party/node_modules), ignored (.git), null, empty, normal-source
- Constant sets: GENERATED_SEGMENTS, IGNORE_SEGMENTS, GENERATED_EXTENSIONS membership verification
- Graph validation: ownership overlap (paths field, not files), detectCycle (cycle + DAG), classifyCycle (unsupported unowned)
- compareRevisions: scope change, graph change, no-change
- Continuation: out-of-order ack convergence, lost-ack re-ack convergence
- Failure isolation: timeout→blocked (resumable), blocked→blocked, error→failed (terminal), no-mutation, artifact preservation
- shouldContinueAfterFailure/eligibleIndependents: true/false/transitive-closure
- extractReadiness: false for discovery-not-exhausted, invalid-graph, stale-synthesis, stale-artifacts, blocked, failed, null
- countLifecycleStates: all 8 types, empty, unknown
- queueDenominator: empty, all-excluded

**DOGFOOD-01 (36 gaps):**
- shouldContinue: all-completed, pending, in-progress, empty
- canAutoRelaunch: budget exhausted, too-many-unacked, budget-available
- resumeCommand: idempotent command with counts
- continuationSummary: correct segment data
- isTerminalFailure: permanent-failure, blocked-dependency, retryable (not terminal), feature-exhausted, no-attempts
- terminalReason: last-reason, null
- segmentOutcome: all terminal statuses, empty
- Budget admission: rejection when exceeding, admission when within, reserve total correctness
- Lifecycle replay: mixed event sequence determinism
- Large-scale: 200-feature irregular-cap (37) exact-once across 6+ segments
- deriveReadiness: mixed completed+excluded, empty, null
- selectiveInvalidate: source change, no-change
- E2E matrix rows: explicit E2E-COMPAT-01 and E2E-DOGFOOD-01 Phase 7 coverage

---

## Success Criteria Verification

1. **Every exact E2E matrix scenario passes against clean generated output plus copy and symlink installed-plugin surfaces.** All 18 Phase 1-6 IDs covered by e2e-matrix.test.mjs (27 tests) + 44 nyquist gap-filling tests. Build drift, sandbox safety, version lockstep, and both install modes verified.

2. **Design, implement, tune, review, and read-only status preserve established gates, artifacts, hydration, and handoffs for v1.4.5 migration and v1.5 shards.** compatibility-regression.test.mjs (42 tests) + 40 nyquist gap-filling tests covering all mode resolution, gate partitioning, migration mapping, validation, and status reporting edge cases.

3. **One observed whole-repository command processes its full natural inventory across multiple automatically acknowledged segments with no duplicate/missing coverage and measured reserve headroom.** dogfood-scale.test.mjs (11 tests, 120 features × 3 segments) + 36 nyquist gap-filling tests including 200-feature irregular-cap scenario, continuation decision logic, budget boundary conditions.

4. **The observed run recovers from an injected gate interruption and duplicate continuation delivery without manual state repair and reaches truthful verified readiness.** dogfood-scale.test.mjs tests both interruption recovery and duplicate convergence explicitly. Nyquist tests add continuationSummary, resumeCommand idempotency, and canAutoRelaunch refusal conditions.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] All MISSING references covered by gap-filling tests
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Build drift: both entries clean
- [x] Version lockstep: both entries report engine-version 1.4.5

**Approval:** approved 2026-07-22

**Test totals after validation:** 1203 pass / 0 fail (1083 pre-validation + 120 new validation tests)
