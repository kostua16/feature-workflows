# Phase 4 — UAT Verification (Goal-Backward)

**Phase:** 4 — Checkpointed Feature Leaf
**Milestone:** v1.5.0 (gh sub-issue #23)
**Verification date:** 2026-07-22
**Verifier:** autonomous UAT agent (`/gsd-verify-work 4 --auto`)
**Method:** Goal-backward — examine delivered source against the stated ORCH-01 and CHECKPOINT-01 goals, then run live behavioral checks (clean rebuild drift, dist content match, no-composition invariant, full test suite), not just test existence. No human interaction; all defaults taken autonomously.

---

## Verdict: GOAL MET

Phase 4's two requirements (ORCH-01 leaf composition boundary, CHECKPOINT-01 per-gate durable
checkpointing) are genuinely delivered. `fp-extract-slice` processes exactly one feature,
owns no Workflow composition, and leaves scheduling/readiness/synthesis/continuation authority
at the top level. Every one of the 7 material extraction gates is durably acknowledged via
`checkpointSlice()` with artifact evidence and non-blocking `flushPipelineState()`; an
interrupted leaf resumes at the first incomplete gate. Lifecycle transitions route through
the shared `applyLifecycleEvent` reducer (Phase 1 contract). The top-level orchestrator
spawns the leaf via `Workflow({name:'fp-extract-slice', ...})` under a 3-condition guard with
a direct-call fallback. 69 Phase 4 tests pass; full milestone suite 1448 pass / 0 fail;
clean rebuild is drift-free. No defects found during this verification.

---

## Requirements Verified

### ORCH-01 — Leaf processes one feature, no composition, top-level retains authority — MET

**Goal:** A user can extract one admitted feature through `fp-extract-slice`, which owns
exactly that feature's extraction gates while the top-level workflow alone owns discovery,
scheduling, reconciliation, synthesis, continuation, and readiness, and the leaf performs no
further workflow composition.

**Evidence (source):**

| File | Role |
|------|------|
| `plugins/feature-workflows/workflows/src/extract-slice.mjs` | `extractSlice()` (lines 52–260) — takes exactly one `slice`, iterates no feature queue, calls no `Workflow()`, performs no synthesis/scheduling/readiness calls. Imports the shared lifecycle/revision primitives. |
| `plugins/feature-workflows/workflows/src/extract-slice-entry.mjs` | `extractSliceMain()` (lines 15–83) — parses sandbox `args`, validates one slice (`slice.id` + `slice.planDir`), initializes lifecycle, delegates to `extractSlice`, transitions done→complete via shared reducer; returns `{mode, sliceId, status, gate, lifecycle, sliceState, logLines, gateCheckpoints}`. |
| `plugins/feature-workflows/workflows/src/main.mjs` | Top-level orchestrator spawns the leaf at line 1308 under guard `typeof Workflow === 'function' && !single && Workflow.name !== ''` — passes `{slice, task, config, sliceState, retryBudget, refineSubcap, decisionCap}` to the leaf and unpacks the leaf result. Retains all scheduling/readiness authority. |

**Live no-composition invariant (negative check):**

- `grep "Workflow(" plugins/feature-workflows/workflows/src/extract-slice.mjs plugins/feature-workflows/workflows/src/extract-slice-entry.mjs` → **zero matches** (leaf source composes no child workflow).
- Leaf dist (`fp-extract-slice.js`): only match is the line-7 install-documentation comment header (`//   Workflow({ scriptPath: ... })`) — no runtime spawn call.
- Top-level dist (`feature-pipeline.js`): runtime spawn present at line 8385 (`const leafResult = await Workflow({`) — contrast confirms the composition boundary is honored.

### CHECKPOINT-01 — Durable checkpoint before/after each gate, resume at first incomplete gate — MET

**Goal:** A user can resume an interrupted feature at its first incomplete material extraction
gate because the leaf durably acknowledges before/after, retry, invalidation, and terminal
transitions together with artifact evidence using the shared state reducer.

**Evidence (source — `plugins/feature-workflows/workflows/src/extract-slice.mjs`):**

`checkpointSlice(slice, sliceState, gateName, result)` (lines 16–42):

1. Lazily initializes `sliceState._gateCheckpoints`.
2. Increments a module-level `_checkpointSeq` for monotonic ordering across the slice.
3. Maps `gateName` → artifact key (`factsPath`, `useCasePath`, `designPath`, `archPath`,
   `requirementsPath`, `auditPath`); records `{seq, acknowledged: true, artifactPath}`.
4. Durably persists via `flushPipelineState(slice.planDir, sliceState, {mode:'extract-slice', profile:'checkpoint', useChunker:false})`.
5. Wrapped in try/catch — flush failure is non-blocking (in-memory state still advances);
   failure reason logged via `plogFromResult`.

Per-gate call sites (all 7 material gates covered):

| Gate | Call line | Artifact key |
|------|-----------|--------------|
| extract-facts | 87 | `factsPath` |
| extract-e2e | 125 | `useCasePath` |
| extract-design | 154 | `designPath` |
| extract-arch | 181 | `archPath` |
| extract-review | 216 | (null — review records `_reviewedDesign`/`_reviewedArch` flags) |
| extract-requirements | 246 | `requirementsPath` |
| extract-audit | 256 | `auditPath` |

**Resume semantics:** Each gate checks `if (!sliceState.XxxPath)` before invoking the agent —
so a gate whose artifact path is already set (because `checkpointSlice` persisted it) is
skipped on resume. Evidence and prior checkpoints survive because `_gateCheckpoints` is part
of the persisted `sliceState`.

---

## UAT Scenarios Confirmed

### Goal 1 — Leaf processes one feature, composes no child, top-level retains authority

- **Single-feature scope:** `extractSlice({slice, ...})` accepts exactly one slice; the body
  has no `for...of` over a feature queue and no recursive `Workflow()` call. The sliceState
  init at `main.mjs:1299-1300` initializes `lifecycle: 'in-progress'` and
  `_gateCheckpoints: {}` per slice — each feature gets its own state.
- **No-composition invariant:** confirmed live (negative grep above) — leaf source and leaf
  dist contain zero runtime `Workflow()` calls.
- **Authority boundary:** the leaf source contains no readiness-derivation calls, no
  scheduling/queue calls, and no synthesis calls — confirmed by the ORCH-01 structural tests
  in `tests/phase04-nyquist-validation.test.mjs`.

### Goal 2 — Interrupting before/after any gate resumes at first incomplete gate

- **Per-gate durable acknowledgment:** all 7 material gates call `checkpointSlice()` after
  setting their artifact path (live grep confirms 8 occurrences per dist = 1 definition +
  7 call sites, matching source).
- **Non-blocking flush:** `checkpointSlice` wraps `flushPipelineState` in try/catch; on flush
  failure the in-memory `_gateCheckpoints` entry is still recorded, so the slice can continue
  and the next resume attempt re-attempts persistence.
- **Resume at first incomplete gate:** each gate body is guarded by
  `if (!sliceState.XxxPath)` — a checkpointed gate with its artifact path set is skipped,
  resuming at the first gate missing its artifact.

### Goal 3 — Duplicate completion, invalid output, source drift converge through shared reducer

- **Shared reducer routing:** `extractSliceMain` transitions done→complete via
  `applyLifecycleEvent({lifecycle: sliceState.lifecycle}, {type: 'complete'})` — the same
  Phase 1 reducer used everywhere. An illegal transition (e.g. duplicate complete) is caught
  in try/catch, logged, and the current state is preserved — never thrown, never advances
  stale state.
- **Idempotent checkpoint replay:** `checkpointSlice` overwrites `sliceState._gateCheckpoints[gateName]`
  with a fresh `{seq, acknowledged, artifactPath}` entry — replaying the same gate's checkpoint
  updates `seq` but does not duplicate the entry or duplicate writes.
- **Revision-aware invalidation:** Phase 1 revision reducer handles selective invalidation;
  Phase 4 tests verify a source change preserves independent gates' checkpoints while
  invalidating the changed gate.

### Goal 4 — Skip semantics (feature-level, policy-disabled optional, required-gate)

Verified by 3 dedicated skip tests in `tests/checkpointed-leaf.test.mjs` plus the E2E-SKIP-01
rows in `tests/e2e-matrix.test.mjs` (lines 280, 290, 299):

- Feature-level skip → lifecycle stays `in-progress` (incomplete, blocks readiness).
- Policy-disabled optional gate with recorded evidence → may complete.
- Required-gate skip → blocks completion permanently.

---

## E2E Matrix Coverage (Phase 4 Rows)

| E2E ID | Verified | Evidence |
|--------|----------|----------|
| E2E-LEAF-01 | MET | `tests/e2e-matrix.test.mjs:251` exercises `checkpointSlice` live and asserts `_gateCheckpoints['extract-facts'].acknowledged === true`. Paired with 18 Phase 4 Nyquist behavioral tests covering partial resume, per-gate blocked returns, audit gate checkpoint, 7-gate artifact key mapping, seq monotonicity, `_gateCheckpoints` survival on resume. |
| E2E-LEAF-02 | MET | `tests/e2e-matrix.test.mjs:267` verifies duplicate lifecycle completion is rejected as an illegal transition. Paired with Phase 4 Nyquist tests covering idempotent replay, blocked→start→complete convergence, failed→start→complete convergence, `isTerminal` classification, invalid-output routing. |
| E2E-SKIP-01 | MET | `tests/e2e-matrix.test.mjs:280,290,299` verify all three skip classifications. Paired with Phase 4 tests covering feature-level skip, policy-disabled optional skip, required-gate skip, `isIncomplete` classification. |

All three E2E IDs are registered in the coverage list at `tests/e2e-matrix.test.mjs:485`.

---

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| `tests/checkpointed-leaf.test.mjs` | 24 | all pass — per-gate checkpoint recording, artifact path per gate type, review gate null path, idempotent replay, non-blocking flush, lifecycle transitions, skip semantics, revision invalidation, structural assertions |
| `tests/phase04-nyquist-validation.test.mjs` | 45 | all pass — behavioral resume (gate-skip-on-resume), per-gate blocked return values, audit gate checkpoint, 7-gate artifact key mapping, seq monotonicity, `_gateCheckpoints` survival on resume, empty-state init, null-result handling, evidence preservation on blocked, no-composition invariant (leaf source/dist), Workflow spawn guard conditions, direct-call fallback, return shape, lifecycle init/transition, exactly-one-slice validation |
| `tests/e2e-matrix.test.mjs` (Phase 4 rows) | 5 | all pass — E2E-LEAF-01 checkpoint record, E2E-LEAF-02 duplicate-completion-rejected, E2E-SKIP-01 three skip classifications |
| **Phase 4 total** | **74** | **all pass** |
| Full milestone suite | 1448 | pass / 0 fail |

Build validation: `npm run validate:build` — both entries drift-free (`feature-pipeline.js`
+ `fp-extract-slice.js` each 33 modules, 314 top-level names, engine-version 1.4.5).

---

## Live Behavioral Checks

1. **Clean rebuild drift-free:** `npm run validate:build` → both entries `up to date`; no diff
   after rebuild (the checked-in dist files are byte-identical to a fresh build).
2. **Dist content match:** `grep -c "checkpointSlice(" fp-extract-slice.js` → 8 (1 definition
   + 7 call sites); same count in `feature-pipeline.js`. Workflow spawn guard
   (`typeof Workflow === 'function' && !single && Workflow.name !== ''`) present at
   `feature-pipeline.js:8384`. `_gateCheckpoints` init present at `feature-pipeline.js:5288`
   (inside `checkpointSlice`), `:5298` (assignment), `:8376` (sliceState init in main).
3. **No-composition invariant (negative):** leaf source + leaf entry source have zero runtime
   `Workflow()` calls; leaf dist has only the line-7 documentation-comment reference.
4. **Per-gate checkpoint call sites:** all 7 material gates in `extract-slice.mjs` source
   call `checkpointSlice()` immediately after setting their artifact path — confirmed by
   reading the function bodies at lines 87, 125, 154, 181, 216, 246, 256.

---

## Success Criteria Verification

1. **The installed `fp-extract-slice` processes exactly one admitted feature, composes no
   child workflow, and leaves project scheduling/readiness authority at the top level.** —
   VERIFIED. Source: `extractSlice` takes one slice, iterates no queue. Live negative grep:
   zero runtime `Workflow()` calls in leaf source and leaf dist. Top-level dist has the only
   runtime spawn at line 8385. Leaf has no readiness/scheduling/synthesis calls (structural
   tests confirm).

2. **Interrupting before or after any material extraction gate resumes at the first incomplete
   gate without repeating verified work.** — VERIFIED. All 7 gates call `checkpointSlice()`
   which persists `_gateCheckpoints[gate] = {seq, acknowledged, artifactPath}` via
   `flushPipelineState`. Each gate body is guarded by `if (!sliceState.XxxPath)` so a
   checkpointed gate is skipped on resume. Behavioral tests verify the agent is not called
   for pre-completed gates.

3. **Duplicate completion, invalid output, and source drift converge through the shared reducer
   without duplicating evidence or advancing stale state.** — VERIFIED. `extractSliceMain`
   routes done→complete through `applyLifecycleEvent`; illegal transitions (duplicate
   complete) are caught and logged, current state preserved. `checkpointSlice` overwrites
   the gate's checkpoint entry on replay (no duplication). Phase 1 revision reducer handles
   selective invalidation on source drift.

4. **A feature-level skipped outcome remains incomplete; only a policy-disabled optional gate
   with recorded evidence may be skipped while completing; a skipped required gate blocks
   feature completion.** — VERIFIED by 6 dedicated tests (3 in `checkpointed-leaf.test.mjs`,
   3 in `e2e-matrix.test.mjs`) covering all three skip classifications plus
   `isIncomplete`/`isTerminal` classification.

---

## Defects Found During This Verification

None. The original Phase 4 implementation plus the Nyquist gap-fill (9 gaps closed — see
`04-VALIDATION.md`) deliver a coherent checkpointed feature leaf. The no-composition invariant
holds cleanly in both source and dist. The checkpoint pattern established here is the one
Phase 8 later adopted for design-mode durable checkpoints (per ROADMAP phase-8 dependencies).

---

## Files Verified

| File | Role |
|------|------|
| `plugins/feature-workflows/workflows/src/extract-slice.mjs` | `checkpointSlice()` (16–42) + 7 per-gate call sites + `extractSlice()` leaf body (52–260) |
| `plugins/feature-workflows/workflows/src/extract-slice-entry.mjs` | `extractSliceMain()` (15–83) — lifecycle reducer integration, return shape |
| `plugins/feature-workflows/workflows/src/main.mjs` | Workflow() spawn guard + fallback (1308–1322), sliceState init with `lifecycle` + `_gateCheckpoints` (1299–1300) |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated leaf dist — drift-free, 8 checkpointSlice occurrences, zero runtime Workflow calls |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated top-level dist — drift-free, runtime Workflow spawn at line 8385 |
| `tests/checkpointed-leaf.test.mjs` | 24 Phase 4 tests |
| `tests/phase04-nyquist-validation.test.mjs` | 45 Phase 4 Nyquist validation tests |
| `tests/e2e-matrix.test.mjs` | Phase 4 E2E rows (E2E-LEAF-01, E2E-LEAF-02, E2E-SKIP-01) |
| `tests/harness.mjs` | Test harness — `checkpointSlice` and `extractSlice` registered as engine export candidates |

---

## Concerns (non-blocking)

1. **Module-level `_checkpointSeq` counter.** `extract-slice.mjs:15` declares
   `let _checkpointSeq = 0` at module scope. The counter is not persisted across host
   restarts — on a fresh module load it resets to 0, so resumed checkpoints after a host
   relaunch may have lower `seq` values than the pre-crash checkpoints. This is cosmetic:
   the `seq` field is used only for monotonicity-within-a-single-run assertions in tests, and
   the durable `_gateCheckpoints[gate]` map (keyed by gate name, not seq) is what actually
   drives resume correctness. Non-blocking — the checkpoint's `acknowledged` flag and
   `artifactPath` are the resume signal, not `seq`.

2. **Review gate records null artifact path.** `extract-review` produces boolean
   `_reviewedDesign`/`_reviewedArch` flags rather than a file artifact, so its checkpoint
   entry has `artifactPath: null`. This is intentional (the gate's evidence is the boolean
   flag, not a file) and tested explicitly. Non-blocking — noted only because a future
   consumer of `_gateCheckpoints` that assumes all entries have a non-null `artifactPath`
   would need to handle the review gate specially.

3. **Dead code in leaf dist (carried from Phase 3).** The leaf dist still carries the full
   shared-module set (33 modules including discovery, schedulability, synthesis), most of
   which the leaf never invokes at runtime. This is the deliberate Phase 3 trade-off (dead
   code is harmless; ensures correctness without per-leaf dependency tracing). Non-blocking —
   the leaf declares only its 2 used phase labels and the 298 KB file is well under any
   practical limit.

---

## Sign-off

Phase 4 goals are genuinely met. The codebase delivers a checkpointed feature leaf that
processes exactly one admitted feature, composes no child workflow, durably acknowledges
every material gate boundary with artifact evidence via the shared state reducer, and resumes
at the first incomplete gate. The top-level orchestrator spawns the leaf via `Workflow()`
under a 3-condition guard with a direct-call fallback, retaining all scheduling, readiness,
synthesis, and continuation authority. 74 Phase 4 tests pass; 1448 tests pass overall;
clean rebuild is drift-free; no defects found.

**Status:** VERIFIED
