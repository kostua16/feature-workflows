---
phase: 6
slug: synthesis-publish-persist-and-status-truth
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 6 — Validation Strategy

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
| 6-01-01 | 06 | 1 | SYNTH-01 | unit | `npm test` | tests/synthesis-status.test.mjs | green |
| 6-01-02 | 06 | 1 | SYNTH-01 | unit (nyquist) | `npm test` | tests/phase06-nyquist-validation.test.mjs | green |
| 6-02-01 | 06 | 1 | OBSERVE-01 | unit | `npm test` | tests/synthesis-status.test.mjs | green |
| 6-02-02 | 06 | 1 | OBSERVE-01 | unit (nyquist) | `npm test` | tests/phase06-nyquist-validation.test.mjs | green |
| 6-03-01 | 06 | 1 | STATUS-01 | unit | `npm test` | tests/synthesis-status.test.mjs | green |
| 6-03-02 | 06 | 1 | STATUS-01 | unit (nyquist) | `npm test` | tests/phase06-nyquist-validation.test.mjs | green |
| 6-04-01 | 06 | 1 | ALL | integration | `npm test` | tests/synthesis-status.test.mjs | green |
| 6-04-02 | 06 | 1 | ALL | integration (nyquist) | `npm test` | tests/phase06-nyquist-validation.test.mjs | green |
| 6-05-01 | 06 | 1 | ALL | structural | `npm test` | tests/synthesis-status.test.mjs | green |
| 6-05-02 | 06 | 1 | ALL | build drift | `npm run validate:build` | both entries | green |

---

## Requirement Coverage

### SYNTH-01: Incremental synthesis with selective revision invalidation

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/synthesis-status.test.mjs | 18 | createSynthesisState, synthesizeProjectViews (4 view types, idempotent identity, no-op, changed-feature rebuild, stale detection, empty summaries), isSynthesisCurrent, invalidateStaleViews (source/scope affected), synthesisSummary, deriveCoverageIndex/DependencyMap/CrossCutting/SystemOverview, REGRESSION dist exports |
| tests/phase06-nyquist-validation.test.mjs | 29 | VIEW_TYPES structure, non-array/null/missing-param defaults, revision-only rebuild, feature add/remove triggers, isSynthesisCurrent null/extra-key, invalidateStaleViews graph/artifact/deps/unknown/unsynthesized/null, synthesisSummary null, deriveCoverageIndex in-progress/remaining/skipped/default-lifecycle/empty, deriveDependencyMap missing-field/empty, deriveCrossCutting missing-field/sorting, deriveSystemOverview missing-fields, digest-content-vs-reference |

**Status:** COVERED — all view types, all invalidation input types, all default-fallback paths, empty/null edge cases, feature-set membership changes, and structural constants tested.

### OBSERVE-01: Attempted-vs-durable persistence tracking

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/synthesis-status.test.mjs | 20 | createPersistenceTracker, recordAttemptedWrite, verifyDurableWrite (upgrade/idempotent/throws-unknown), failWrite, demotion-prevention (cannot demote/fail durably verified), retry-after-fail, isRetrySafe (untracked/attempted/verified), isDurablyVerified, persistenceReport (counts/byType/null), no-duplicate-on-retry, REGRESSION dist exports |
| tests/phase06-nyquist-validation.test.mjs | 23 | PERSISTENCE_STATES/PERSIST_UNIT_TYPES structure (incl. CONTINUATION_ACK fix), all throw paths (null tracker, missing key for record/verify/fail), failWrite no-prior-attempt/default-reason, unitType default/preservation/preservation-on-fail, isRetrySafe/isDurablyVerified null/undefined, persistenceReport byType-total/empty, full lifecycle chains (attempt→verify, attempt→fail→retry→verify), history audit trail |

**Status:** COVERED — all error/throw paths, all default-fallback behaviors, unitType preservation across re-attempts, full lifecycle transitions, and structural constants tested.

### STATUS-01: Truthful readiness and status projection

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/synthesis-status.test.mjs | 17 | deriveExtractReadiness (ready + all 5 not-ready reasons), feature-level/required-gate/policy-disabled-optional skip handling, null state, projectStatusProjection (frozen/null), projectionsMatch (identical/different), readinessSummary, countLifecycleStates, handoff-status-identity, REGRESSION dist exports |
| tests/phase06-nyquist-validation.test.mjs | 18 | deriveExtractReadiness undefined/non-object/empty-features, all-5-conditions independent toggle, mixed-incomplete-states, excluded-denominator, READINESS_REASONS structure, projectStatusProjection missing-optional-fields, projectionsMatch null/undefined, readinessSummary NOT-READY/null/incomplete-count, countLifecycleStates empty/null/unknown-state, frozen-projection immutability, lifecycleOutcomes 8-key completeness |

**Status:** COVERED — all readiness failure paths exercised independently, all null/undefined/empty edge cases, projection immutability, skip-policy matrix, and structural constants tested.

---

## E2E Matrix Coverage (Phase 6 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-SYNTH-01 | tests/synthesis-status.test.mjs (4-view, idempotent, stale-detection, selective-invalidation) + tests/phase06-nyquist-validation.test.mjs (feature add/remove, all input types, empty/null) | green |
| E2E-PERSIST-01 | tests/synthesis-status.test.mjs (attempted/durable/failed, demotion-prevention, retry-safety) + tests/phase06-nyquist-validation.test.mjs (throw paths, unitType preservation, lifecycle chains, history audit) | green |
| E2E-STATUS-01 | tests/synthesis-status.test.mjs (all readiness reasons, projection identity, skip policies) + tests/phase06-nyquist-validation.test.mjs (independent condition toggles, null/undefined, frozen immutability) | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 75 |
| Resolved | 75 |
| Escalated | 0 |

### Defects Found and Fixed

1. **deriveCoverageIndex lifecycle key mismatch** (synthesis.mjs)
   - Defect: Used `inProgress` (camelCase) as property key but canonical lifecycle string is `'in-progress'` (hyphenated, matching `LIFECYCLE_STATES.IN_PROGRESS`). Features in 'in-progress' state were silently uncounted in the coverage index, and `remaining` excluded them.
   - Fix: Changed property key from `inProgress` to `'in-progress'` and updated `remaining` calculation.

2. **CONTINUUATION_ACK typo** (observe-persist.mjs)
   - Defect: Constant name had double 'U' (`CONTINUUATION_ACK`). Accessing the correctly spelled `CONTINUATION_ACK` would return `undefined`.
   - Fix: Corrected to `CONTINUATION_ACK`.

3. **Feature removal not triggering rebuild** (synthesis.mjs)
   - Defect: `synthesizeProjectViews` only checked digests of features present in the new summaries. Removed features (present in prev but absent from new) were not detected, so views retained stale data.
   - Fix: Added feature-set membership size check comparing `prev.featureDigests` key count against `newDigests` key count.

4. **unitType not preserved on re-attempt** (observe-persist.mjs)
   - Defect: `recordAttemptedWrite` defaulted `unitType` to `FEATURE_SHARD` when the parameter was omitted, even if the existing entry had a different type (e.g., `SYNTHESIS_VIEW`). This caused type information loss across retry cycles.
   - Fix: Changed fallback to use `existing.unitType` when the parameter is omitted: `unitType || (existing ? existing.unitType : PERSIST_UNIT_TYPES.FEATURE_SHARD)`.

### Gaps Identified and Filled

**SYNTH-01 (29 gaps):**
- VIEW_TYPES frozen constant with exactly 4 entries
- synthesizeProjectViews: non-array input, null oldState, null revisions, revision-only change, feature add/remove, digest content (not reference) detection
- isSynthesisCurrent: null/undefined/empty currentRevisions, extra revision key not in viewRevisions
- invalidateStaleViews: graph/artifact/deps input types, unknown input, unsynthesized state, null revisionDelta
- synthesisSummary: null state
- deriveCoverageIndex: in-progress lifecycle (after fix), remaining field, skipped, default-lifecycle fallback, empty array
- deriveDependencyMap: missing dependencies field, empty array
- deriveCrossCutting: missing crossCuttingConcerns field, alphabetical sorting
- deriveSystemOverview: missing name/lifecycle/artifacts fields

**OBSERVE-01 (23 gaps):**
- PERSISTENCE_STATES/PERSIST_UNIT_TYPES structure (including CONTINUATION_ACK fix)
- All throw paths: null tracker and missing key for recordAttemptedWrite/verifyDurableWrite/failWrite
- failWrite: no-prior-attempt, default reason
- recordAttemptedWrite: default unitType, unitType preservation on re-attempt and on failWrite
- failWrite: unitType preservation from existing entry
- isRetrySafe/isDurablyVerified: null and undefined tracker
- persistenceReport: byType total field, empty tracker
- Full lifecycle chains: attempt→verify→cannot-retry, attempt→fail→retry→verify
- History audit trail (4 actions)

**STATUS-01 (18 gaps):**
- deriveExtractReadiness: undefined state, non-object state, empty features, all 5 conditions independently toggled, mixed incomplete states, excluded denominator
- READINESS_REASONS: 6 frozen entries
- projectStatusProjection: missing optional fields
- projectionsMatch: null and undefined inputs
- readinessSummary: NOT READY projection, null projection, incomplete count > 0
- countLifecycleStates: empty array, null features, unknown lifecycle state
- Frozen projection immutability, lifecycleOutcomes 8-key completeness

**REGRESSION (5 gaps):**
- Synthesis source uses hyphenated 'in-progress' key
- Dist uses correct CONTINUATION_ACK spelling
- All Phase 6 exports present in dist
- No forbidden tokens in source modules

---

## Success Criteria Verification

1. **Repeated or selectively changed verified summaries produce idempotent, revision-current project views without rebuilding unaffected outputs.** Feature add/remove/change paths tested; digest-content detection verified; revision-only change triggers rebuild; idempotent identity for unchanged inputs.

2. **Persistence fault injection distinguishes attempted from durably verified writes; retry never produces duplicate index, synthesis, or continuation state.** Full lifecycle chains tested; demotion prevention verified; throw paths covered; unitType preserved across retries; history audit trail verified.

3. **Command handoff and read-only status report identical denominators, lifecycle outcomes, revisions, budgets, failures, and continuation evidence.** projectionsMatch tests for identical/different/null/undefined; frozen projection immutability; shared projection identity from same state.

4. **Readiness is true only for exhausted discovery, valid graph, current verified required artifacts, current synthesis, and no incomplete feature-level outcome.** All 5 conditions independently toggled; skip-policy matrix (feature-level, required-gate, policy-disabled-optional with/without evidence); excluded denominator handling; mixed incomplete states.

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

**Test totals after validation:** 1083 pass / 0 fail (1008 pre-validation + 75 new validation tests)
