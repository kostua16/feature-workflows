# Phase 6 — UAT Verification (Goal-Backward)

**Phase:** 6 — Synthesis, Publish, Persist, and Status Truth
**Milestone:** v1.5.0 (gh sub-issue #25)
**Verification date:** 2026-07-22
**Verifier:** autonomous UAT agent (`/gsd-verify-work 6 --auto`)
**Method:** Goal-backward — examine delivered source against the stated SYNTH-01,
OBSERVE-01, and STATUS-01 goals, then run live behavioral checks (module imports
via dist harness, pure-function assertions, dist drift, integration points in
main.mjs, E2E matrix rows, and the full test suite), not just test existence. No
human interaction; all defaults taken autonomously.

---

## Verdict: GOAL MET

Phase 6's three requirements are genuinely delivered in source, dist, and
integration. All four Nyquist-validation defects (coverage-index camelCase,
CONTINUUATION typo, feature-removal rebuild, unitType loss) are confirmed fixed
in the post-fix code.

- **SYNTH-01** — `synthesis.mjs` (4 view types, idempotent synthesis, selective
  revision invalidation, per-feature digests) is wired into the extract loop
  after slice completion with feature summaries derived from the extract queue.
- **OBSERVE-01** — `observe-persist.mjs` (3 terminal states, attempt/verify/fail
  lifecycle, demotion prevention, retry-safe, history audit trail) is wired
  around all four consolidate boundaries (budget-exhaustion, budget-ceiling,
  artifact-missing, terminal success).
- **STATUS-01** — `status-truth.mjs` (`deriveExtractReadiness` with 5 independent
  conditions, `projectStatusProjection` frozen immutable, skip-policy matrix)
  replaces the old `extractReady = true` flag; the status mode reads the same
  projection from persisted state (read-only, no writes).

55 Phase 6 tests + 70 Phase 6 Nyquist validation tests + 3 Phase 6 E2E rows all
pass. Full milestone suite 1448 pass / 0 fail. Clean rebuild is drift-free. 35
live behavioral assertions against the actual dist functions all pass. All 4
Nyquist defects verified as genuinely fixed. No new defects found.

---

## Requirements Verified

### SYNTH-01 — Incremental synthesis with selective revision invalidation — MET

**Goal:** A user receives incrementally updated, idempotent project views,
including the system overview, dependency map, cross-cutting concerns, and
coverage index, derived only from verified bounded feature summaries through
the shared revision contract.

**Evidence (source — `plugins/feature-workflows/workflows/src/synthesis.mjs`):**

| Function | Role |
|----------|------|
| `VIEW_TYPES` | Frozen enum: systemOverview, dependencyMap, crossCutting, coverageIndex (exactly 4) |
| `createSynthesisState` | Empty state: views, viewRevisions, featureDigests, synthesized |
| `synthesizeProjectViews` | Derives all 4 views from summaries; idempotent (identity for unchanged inputs); rebuilds on digest change, feature-set membership change (size diff), or revision change |
| `isSynthesisCurrent` | Checks all revision keys match between state and current revisions |
| `invalidateStaleViews` | Marks only affected views stale based on revision-delta input types (source/scope/graph/deps/artifact) |
| `deriveCoverageIndex` | Counts lifecycle states; denominator excludes excluded; remaining = runnable + deferred + in-progress |
| `deriveDependencyMap` | Collects cross-feature dependency edges; sorted deterministically |
| `deriveCrossCutting` | Aggregates shared concerns appearing in 2+ features; alphabetically sorted |
| `deriveSystemOverview` | Aggregates module names, lifecycle, artifacts; sorted by id |
| `synthesisSummary` | Handoff/status report: synthesized, view count, stale views, coverage |

**Nyquist fix #1 verified (coverage-index hyphenated key):**
`deriveCoverageIndex` uses `'in-progress'` (hyphenated, matching
`LIFECYCLE_STATES.IN_PROGRESS`) as the property key, NOT `inProgress`
(camelCase). Verified live: `deriveCoverageIndex([{id:'x',lifecycle:'in-progress'}]).remaining === 1`
and `...['inProgress'] === undefined`.

**Nyquist fix #3 verified (feature-removal rebuild):**
`synthesizeProjectViews` compares `Object.keys(prev.featureDigests).length !==
Object.keys(newDigests).length` to detect removed features. Verified live:
removing a feature from the summaries triggers a rebuild.

**Integration (source — `plugins/feature-workflows/workflows/src/main.mjs`):**
- Lines 1204-1205: synthesis state initialized on first extract entry.
- Lines 1395-1396: `synthesizeProjectViews` called after slice loop completion
  with feature summaries derived from the extract queue.
- Lines 1487-1488: `isSynthesisCurrent` checked against current scope/graph
  revisions for readiness derivation.

**Live behavioral check (35 assertions, all pass):** idempotent identity for
same inputs; changed feature triggers rebuild; feature removal triggers rebuild;
revision-only change triggers rebuild; coverage index counts in-progress via
hyphenated key; denominator excludes excluded; selective invalidation by input
type; isSynthesisCurrent detects stale revisions; dependency map edges correct;
cross-cutting concerns shared across features; system overview aggregates modules.

### OBSERVE-01 — Attempted-vs-durable persistence tracking — MET

**Goal:** A user can publish and persist feature shards, project indexes,
synthesis artifacts, and continuation acknowledgements in bounded retry-safe
units that distinguish attempted writes from durably verified success and expose
budgets, failures, and continuation evidence.

**Evidence (source — `plugins/feature-workflows/workflows/src/observe-persist.mjs`):**

| Function | Role |
|----------|------|
| `PERSISTENCE_STATES` | Frozen enum: ATTEMPTED, DURABLY_VERIFIED, FAILED (exactly 3) |
| `PERSIST_UNIT_TYPES` | Frozen enum: FEATURE_SHARD, PROJECT_INDEX, SYNTHESIS_VIEW, CONTINUATION_ACK (exactly 4) |
| `createPersistenceTracker` | Empty tracker: writes map, history array |
| `recordAttemptedWrite` | Pure — new entry or increment attempt; durably-verified writes cannot be demoted; unitType preserved from existing entry when omitted |
| `verifyDurableWrite` | Pure — upgrades attempted to durably-verified; idempotent for already-verified; throws for unknown key |
| `failWrite` | Pure — marks as failed with reason; durably-verified writes cannot be failed |
| `isRetrySafe` | True for untracked/attempted/failed; false for durably-verified (prevents duplicate state) |
| `isDurablyVerified` | Checks specific key state |
| `persistenceReport` | Handoff/status: attempted/verified/failed counts with byType breakdown |

**Nyquist fix #2 verified (CONTINUATION_ACK spelling):**
`PERSIST_UNIT_TYPES.CONTINUATION_ACK === 'continuation-ack'` (single U).
`PERSIST_UNIT_TYPES['CONTINUUATION_ACK']` is undefined. Verified live.

**Nyquist fix #4 verified (unitType preservation on re-attempt):**
`recordAttemptedWrite` fallback is `unitType || (existing ? existing.unitType :
PERSIST_UNIT_TYPES.FEATURE_SHARD)`. Verified live: after failing a
`synthesis-view` write and re-attempting without specifying unitType, the
unitType is correctly preserved as `synthesis-view`.

**Integration (main.mjs):**
- Lines 1207-1208: persistence tracker initialized on first extract entry.
- Lines 1240-1245: budget-exhaustion block: recordAttemptedWrite then
  verifyDurableWrite for `extract:blocked-budget:`.
- Lines 1267-1272: budget-ceiling block: same pattern for
  `extract:blocked-ceiling:`.
- Lines 1464-1469: artifact-missing block: same pattern for
  `extract:artifact-missing:`.
- Lines 1536-1541: terminal consolidate: recordAttemptedWrite then
  verifyDurableWrite for `extract:consolidate:`.
- Line 1526: terminal handoff includes `persistence:
  persistenceReport(result.persistenceTracker)`.

**Live behavioral check:** full lifecycle (attempt -> verify -> cannot demote ->
cannot fail); retry after fail succeeds; isRetrySafe prevents duplicates;
unitType preserved across retries; history audit trail records all actions;
persistenceReport counts by state and type.

### STATUS-01 — Truthful readiness and status projection — MET

**Goal:** The command handoff and read-only status surface report the same
revision-current coverage denominator and lifecycle outcomes, and set
`extractReady=true` only when discovery is exhausted, the graph is valid, every
in-scope feature and required artifact is verified, required synthesis is
current, and no incomplete lifecycle state remains.

**Evidence (source — `plugins/feature-workflows/workflows/src/status-truth.mjs`):**

| Function | Role |
|----------|------|
| `READINESS_REASONS` | Frozen enum: 6 entries (5 failure reasons + ALL_MET) |
| `deriveExtractReadiness` | Checks ALL 5 conditions independently: discoveryExhausted, graphValid, featuresComplete, synthesisCurrent, artifactsCurrent; ready only when all true |
| `projectStatusProjection` | Frozen immutable projection: denominator, lifecycleOutcomes (8 states), revisions, budget, failures, continuation, readiness proof |
| `projectionsMatch` | Deep JSON comparison for handoff/status identity enforcement |
| `readinessSummary` | Human-readable readiness proof with check marks |
| `countLifecycleStates` | Counts 8 lifecycle states; denominator excludes excluded |

**Skip-policy matrix verified:**
- Feature-level `skipped` → incomplete (blocks readiness).
- `policy-disabled-optional` skip with `policyEvidence` → may complete.
- `policy-disabled-optional` skip without `policyEvidence` → incomplete.
- Any required-gate skip → blocks completion and readiness.

**Integration (main.mjs):**
- Lines 1476-1493: `deriveExtractReadiness` replaces the old `extractReady =
  true` flag; extracts comprehensive project state from the extract queue
  (discovery, graph validity, feature lifecycle, synthesis currency, artifact
  currency).
- Lines 1503-1519: `projectStatusProjection` builds the immutable projection
  from full project state (features, revisions, budget, failures, continuation).
- Lines 49-85 (status mode): reads `state.result.statusProjection` and renders
  `readinessSummary` — read-only, no writes, no stateCheckpoint, no consolidate.
- Lines 491-494: pre-v1.5 resume backfill — `synthesisState`,
  `persistenceTracker`, and `statusProjection` hydrated to null for old state.

**Live behavioral check:** all 5 conditions independently toggled block
readiness; skip-policy matrix (3 cases) verified; frozen projection at top
level; projectionsMatch identical/different/null; null state returns frozen
empty projection; denominator excludes excluded; handoff and status share
identical projection data.

---

## UAT Scenarios Confirmed

### Goal 1 — Idempotent, revision-current project views (SYNTH-01)

- **4 view types:** systemOverview, dependencyMap, crossCutting, coverageIndex —
  all derived from verified feature summaries.
- **Idempotent identity:** same summaries + revisions return the exact same
  state object (`===` identity check).
- **Selective rebuild:** changed feature digest, feature-set membership change
  (add/remove), and revision-only change all trigger rebuild.
- **Selective invalidation:** `invalidateStaleViews` marks only views affected by
  specific input types (source/scope/graph/deps/artifact); unknown inputs do not
  invalidate.
- **Coverage index:** denominator excludes excluded features; remaining =
  runnable + deferred + in-progress (hyphenated key — fix verified).

### Goal 2 — Retry-safe persistence distinguishing attempted from durable (OBSERVE-01)

- **3 terminal states:** ATTEMPTED, DURABLY_VERIFIED, FAILED — each tracked per
  write-unit key.
- **Demotion prevention:** durably-verified writes cannot be demoted to
  attempted or failed (`recordAttemptedWrite` and `failWrite` return the
  unchanged tracker).
- **Retry safety:** `isRetrySafe` returns false for verified writes, preventing
  duplicate state on retry.
- **unitType preservation:** re-attempting a failed write without specifying
  unitType preserves the original unitType (fix verified).
- **4 persist boundaries:** budget-exhaustion, budget-ceiling, artifact-missing,
  terminal consolidate — all wrapped with recordAttemptedWrite +
  verifyDurableWrite in main.mjs.

### Goal 3 — Identical handoff and status projections (STATUS-01)

- **Frozen projection:** `projectStatusProjection` returns `Object.freeze` on
  the top-level projection — handoff and status receive the same immutable
  structure.
- **Identical data:** `projectionsMatch` confirms handoff and status projections
  from the same state are deeply equal.
- **Read-only status:** status mode (main.mjs lines 49-85) performs no writes —
  no `consolidate`, no `stateCheckpoint`, no `failed-launch` writes. It reads
  `state.result.statusProjection` from persisted state and renders
  `readinessSummary`.
- **Denominator excludes excluded:** features with `lifecycle: 'excluded'` are
  subtracted from the denominator.

### Goal 4 — Truthful readiness (STATUS-01)

- **5 independent conditions:** discoveryExhausted, graphValid, featuresComplete,
  synthesisCurrent, artifactsCurrent — each independently blocks readiness.
- **Never `extractReady = true` by default:** the old hardcoded flag is replaced
  by `deriveExtractReadiness` which requires all conditions genuinely met.
- **Skip-policy matrix:** feature-level skipped blocks; policy-disabled-optional
  with evidence may complete; policy-disabled-optional without evidence blocks.
- **Excluded denominator:** excluded features do not count against completion.

---

## E2E Matrix Coverage (Phase 6 Rows)

| E2E ID | Verified | Evidence |
|--------|----------|----------|
| E2E-SYNTH-01 | MET | `tests/e2e-matrix.test.mjs:414` — repeated synthesis is idempotent. Paired with 18 synthesis-status tests + 29 Nyquist validation tests covering 4 view types, non-array defaults, revision-only rebuild, feature add/remove, all invalidation input types, empty/null edge cases, digest content detection. |
| E2E-PERSIST-01 | MET | `tests/e2e-matrix.test.mjs:431` — durably verified writes are never demoted. Paired with 20 synthesis-status tests + 23 Nyquist validation tests covering all throw paths, unitType preservation, lifecycle chains, demotion prevention, history audit trail. |
| E2E-STATUS-01 | MET | `tests/e2e-matrix.test.mjs:442,460` — handoff/status projections identical; readiness false when incomplete. Paired with 17 synthesis-status tests + 18 Nyquist validation tests covering all 5 conditions independently, skip-policy matrix, frozen projection, null/undefined edge cases. |

All three E2E IDs are registered in the coverage list at `tests/e2e-matrix.test.mjs:488`.

---

## Nyquist Defect Fixes Verified (Post-Fix Code)

| Defect | Fix | Verified |
|--------|-----|----------|
| coverage-index `inProgress` camelCase (should be `'in-progress'` hyphenated) | Property key changed to `'in-progress'`; remaining calc updated | Live: `deriveCoverageIndex([{lifecycle:'in-progress'}]).remaining === 1`; `['inProgress'] === undefined` |
| `CONTINUUATION_ACK` typo (double U) | Corrected to `CONTINUATION_ACK` | Live: `PERSIST_UNIT_TYPES.CONTINUATION_ACK === 'continuation-ack'`; `['CONTINUUATION_ACK'] === undefined` |
| Feature removal not triggering rebuild | Added feature-set membership size check | Live: `synthesizeProjectViews([sums[1]], sA, revs) !== sA` |
| `unitType` not preserved on re-attempt | Fallback uses `existing.unitType` when parameter omitted | Live: after fail+retry without unitType, `writes[key].unitType === 'synthesis-view'` |

---

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| `tests/synthesis-status.test.mjs` | 55 | all pass — SYNTH-01 (18), OBSERVE-01 (20), STATUS-01 (17) |
| `tests/phase06-nyquist-validation.test.mjs` | 70 | all pass — SYNTH-01 (29), OBSERVE-01 (23), STATUS-01 (18) |
| `tests/e2e-matrix.test.mjs` (Phase 6 rows) | 3+1 | all pass — E2E-SYNTH-01, E2E-PERSIST-01, E2E-STATUS-01 (2 sub-tests) |
| **Phase 6 direct total** | **128** | **all pass** (55 + 70 + 3) |
| Full milestone suite | 1448 | pass / 0 fail |

Build validation: `npm run validate:build` — both entries drift-free
(`feature-pipeline.js` + `fp-extract-slice.js` each 33 modules, 314 top-level
names, engine-version 1.4.5).

Live behavioral checks: 35 assertions against actual dist functions (synthesis,
observe-persist, status-truth) — all pass, 0 fail. All 27 Phase 6 exports
confirmed present in `feature-pipeline.js` dist.

---

## Live Behavioral Checks

1. **Clean rebuild drift-free:** `npm run validate:build` → both entries
   `up to date`; no diff after rebuild.
2. **Dist content match:** all 27 Phase 6 exports present in
   `feature-pipeline.js` (verified via grep — zero missing).
3. **Integration wiring:** `main.mjs` source confirmed at lines 21-23 (imports),
   491-494 (backward-compat backfill), 599-602 (initial state), 1201-1208
   (synthesis+tracker init), 1240-1272 (persistence at blocked boundaries),
   1395-1400 (synthesis call), 1464-1541 (readiness + projection + handoff +
   terminal persistence), 49-85 (status mode read-only projection).
4. **Module purity:** `recordAttemptedWrite`, `verifyDurableWrite`, `failWrite`
   all return new objects without mutating inputs — verified by 3 dedicated
   purity assertions.
5. **All 4 Nyquist fixes genuinely present:** verified by 4 targeted assertions
   against the dist functions loaded via the test harness.
6. **No forbidden tokens:** `synthesis.mjs` and `status-truth.mjs` contain zero
   FS/shell/require/Date/Math.random references. `observe-persist.mjs` has 3
   false-positive matches ("required" in error messages, not `require()` calls).
7. **VIEW_TYPES and PERSISTENCE_STATES frozen:** `Object.isFrozen` verified on
   both constants.

---

## Success Criteria Verification

1. **Repeated or selectively changed verified summaries produce idempotent,
   revision-current project views without rebuilding unaffected outputs.** —
   VERIFIED. Same summaries + revisions return identity (`===`); changed
   feature digest, feature removal (size diff), and revision-only change all
   trigger rebuild; `invalidateStaleViews` marks only affected views by input
   type; unaffected views retained.

2. **Persistence fault injection distinguishes attempted from durably verified
   writes and retry never produces duplicate index, synthesis, or continuation
   state.** — VERIFIED. 3 terminal states; demotion prevention (verified writes
   cannot be demoted or failed); `isRetrySafe` returns false for verified
   writes; full lifecycle chains (attempt -> fail -> retry -> verify) tested;
   unitType preserved across retries; history audit trail records all actions.

3. **Command handoff and read-only status report identical denominators,
   lifecycle outcomes, revisions, budgets, failures, and continuation
   evidence.** — VERIFIED. `projectStatusProjection` returns frozen projection
   from the same state; status mode reads `state.result.statusProjection`
   (read-only, no writes); `projectionsMatch` confirms deep equality;
   denominator, lifecycleOutcomes (8 states), revisions, budget, failures, and
   continuation all derived from the same immutable projection.

4. **Readiness is true only for exhausted discovery, a valid graph, current
   verified required artifacts, current synthesis, and no incomplete
   feature-level outcome.** — VERIFIED. `deriveExtractReadiness` checks all 5
   conditions independently; each failure reason tested in isolation;
   skip-policy matrix (feature-level/policy-disabled+evidence/policy-disabled-
   no-evidence/required-gate) verified; excluded features subtracted from
   denominator; null/undefined/empty state returns not-ready.

---

## Defects Found During This Verification

None. The original Phase 6 implementation plus the Nyquist gap-fill (75 gaps
closed — see `06-VALIDATION.md`) and the 4 defect fixes deliver a coherent
synthesis, persistence, and status-truth layer. The three modules are purely
functional (no I/O, no side effects), correctly composed in the extract loop,
and the backward-compat backfill ensures pre-v1.5 state resumes cleanly. The
truthful-readiness and attempted-vs-durable persistence patterns established
here are the ones Phase 9 later adopted for design-mode truthful readiness and
terminal outcome blocking (per ROADMAP phase-9 dependencies).

---

## Files Verified

| File | Role |
|------|------|
| `plugins/feature-workflows/workflows/src/synthesis.mjs` | SYNTH-01 — 10 exported functions for 4 view types, idempotent synthesis, selective revision invalidation |
| `plugins/feature-workflows/workflows/src/observe-persist.mjs` | OBSERVE-01 — 9 exported functions for 3-state persistence lifecycle, retry safety, history audit |
| `plugins/feature-workflows/workflows/src/status-truth.mjs` | STATUS-01 — 8 exported functions for truthful readiness, frozen projection, skip-policy matrix |
| `plugins/feature-workflows/workflows/src/main.mjs` | Integration — imports (21-23), backward-compat (491-494), init (1201-1208), persistence boundaries (1240-1272, 1464-1469, 1536-1541), synthesis (1395-1400), readiness+projection (1476-1519), handoff (1526), status mode (49-85) |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated top-level dist — drift-free, all 27 Phase 6 functions present |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated leaf dist — drift-free, all 27 Phase 6 functions present (dead code, never invoked at runtime) |
| `tests/synthesis-status.test.mjs` | 55 Phase 6 tests |
| `tests/phase06-nyquist-validation.test.mjs` | 70 Phase 6 Nyquist validation tests |
| `tests/e2e-matrix.test.mjs` | Phase 6 E2E rows (E2E-SYNTH-01, E2E-PERSIST-01, E2E-STATUS-01) |
| `tests/harness.mjs` | Test harness — 27 Phase 6 export candidates registered |

---

## Concerns (non-blocking)

1. **Shallow freeze on projection.** `projectStatusProjection` calls
   `Object.freeze(projection)` which is shallow — nested objects like
   `lifecycleOutcomes` and `checks` are not individually frozen. A consumer
   could technically mutate `proj.lifecycleOutcomes.completed = 999`. Non-blocking
   — the projection is created fresh each time from the same pure inputs, the
   top-level freeze prevents property reassignment, and the Nyquist validation
   tests confirm top-level freeze. Deep freeze would be a future hardening if a
   mutation bug is ever observed.

2. **`deriveExtractReadiness` uses priority-ordered reason.** When multiple
   conditions fail, only the first reason (in priority order: discovery >
   graph > features > synthesis > artifacts) is returned. This is intentional
   (one reason per invocation is sufficient for handoff/status), but a caller
   needing all failing conditions would need to inspect the `checks` object.
   Non-blocking — `checks` exposes all 5 boolean values.

3. **`synthesizeProjectViews` feature-removal detection uses size comparison.**
   The fix for defect #3 compares `Object.keys(prev.featureDigests).length !==
   Object.keys(newDigests).length`. This catches additions and removals but
   would not detect a feature ID swap (remove A, add B) where the count stays
   the same. However, the per-feature digest comparison catches this because B's
   digest would differ from A's. Non-blocking — the two checks are complementary.

---

## Sign-off

Phase 6 goals are genuinely met. The codebase delivers incremental synthesis
with 4 view types (idempotent, selective revision invalidation, per-feature
digests), attempted-vs-durable persistence tracking (3 terminal states,
demotion prevention, retry safety, history audit, 4 persist boundaries), and
truthful readiness with immutable status projection (5 independent conditions,
skip-policy matrix, frozen projection shared by handoff and read-only status).
All three modules are purely functional and correctly integrated into the
extract loop. All 4 Nyquist-validation defects are confirmed fixed. 128 Phase 6
tests pass; 1448 tests pass overall; clean rebuild is drift-free; 35 live
behavioral assertions pass; no new defects found.

**Status:** VERIFIED
