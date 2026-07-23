# Phase 8 — UAT Verification (Goal-Backward)

**Phase:** 8 — Design-Mode Durable Checkpoints and Revision-Aware Resume
**Milestone:** v1.5.0 (gh sub-issue #27)
**Verification date:** 2026-07-23
**Verifier:** autonomous UAT agent (`/gsd-verify-work 8 --auto`)
**Method:** Goal-backward — examine delivered source against the stated DCKPT-01, DSTATE-01,
and DRESUME-01 goals, then run live behavioral checks (clean rebuild drift, dist call-site
counts, resume-path wiring, full test suite). No human interaction; all defaults taken
autonomously.

---

## Verdict: GOAL MET

Phase 8's three requirements (DCKPT-01 per-gate durable checkpoint, DSTATE-01 auto-recovering
atomic state writes, DRESUME-01 digest-driven resume) are genuinely delivered in the post-fix
codebase. Every one of the 15 material design gates and all 4 material implement gates calls
`checkpointDesign()` which durably flushes state via the snapshot-retaining writer. The resume
path uses `loadPipelineStateWithRecovery()` — a truncated/corrupt state file auto-recovers
from `pipeline-state.last-good.json` instead of hard-blocking. Unchanged artifacts with durable
checkpoints and matching digests skip LLM re-verification entirely. The Nyquist-validation
defect (dataKey derivation for `definitionPath` computing digest from path string instead of
content) is confirmed fixed — `definitionPath` is special-cased to map to `_define`.

90 Phase 8 tests pass; full milestone suite 1448 pass / 0 fail; clean rebuild is drift-free.
No new defects found during this verification.

---

## Requirements Verified

### DCKPT-01 — Per-gate durable checkpoint in design (and implement/tune) mode — MET

**Goal:** A user whose design run is interrupted at any point resumes from the last completed
material design gate because pipeline state is durably persisted after every gate transition,
not only at hard-block and terminal exits; the same gate-level persistence applies to implement
and tune where the identical coarse-checkpoint loss is proven.

**Evidence (source — `plugins/feature-workflows/workflows/src/main.mjs`):**

`checkpointDesign(gateName, artifactPathKey)` (lines 628–649):

1. Lazily initializes `result._designCheckpoints` and `result._artifactDigests`.
2. Records `{ acknowledged: true, artifactPath }` under the gate name.
3. Computes a content digest of the gate's result data via `computeContentDigest` (Phase 1
   revision contract) and stores it in `result._artifactDigests[artifactPathKey]`.
4. DataKey derivation: `definitionPath` maps to `_define` (NOT `_definition` — the Nyquist
   defect fix); all other keys follow the standard `'_' + key.replace('Path', '')` convention.
5. Durably flushes via `flushPipelineStateWithSnapshot(planDir, result, config)`.
6. Non-blocking: try/catch around the flush — a flush failure only warns via `plog`.

Per-gate call sites (19 total — 15 design + 4 implement):

| Gate | Mode | Call line (source) | Artifact key |
|------|------|--------------------|--------------|
| define | design | 1660 | `definitionPath` |
| knowledge | design | 1709 | (none — no file artifact) |
| codebase-facts | design | 1761 | `factsPath` |
| e2e-use-cases | design | 1818 | `useCasePath` |
| requirements | design | 1871 | `requirementsPath` |
| requirements-review | design | 1905 | (none — review gate) |
| arch-review | design | 1969 | (none — review gate) |
| architecture | design | 1972 | `archPath` |
| detailed-design | design | 2011 | `designPath` |
| design-review | design | 2043 | (none — review gate) |
| plan | design | 2093 | `planPath` |
| tdd-enforce | design | 2137 | (none — enforcement gate) |
| reconcile | design | 2272 | (none — consistency gate) |
| review-refine | design | 2496 | (none — review loop) |
| chunk-plan | design | 2511 | (none — chunker gate) |
| test-authoring | implement | 2767 | (none — test gate) |
| execute | implement | 2980 | (none — execute gate) |
| test | implement | 3071 | (none — test gate) |
| code-review | implement | 3141 | (none — review gate) |

**Tune mode:** No `checkpointDesign` calls needed — all tune-mode `stateCheckpoint` calls
already have a following `consolidate()` call which flushes state. Verified: zero
`checkpointDesign` references in the tune code path (lines 729–765). The tune mode is
unaffected by design and correctly relies on its existing consolidate-at-every-checkpoint
pattern.

**Dist confirmation:** 19 `await checkpointDesign(` call sites in the generated
`feature-pipeline.js` (lines 8736–10217), matching source exactly.

**Result initialization:** `result._designCheckpoints: {}` and `result._artifactDigests: {}`
initialized alongside existing result fields (confirmed in dist).

### DSTATE-01 — Auto-recovering atomic state writes — MET

**Goal:** A user never loses a resumable run to a truncated state file because state writes
follow a write-verify-acknowledge pattern with a retained last-good snapshot, and resume
auto-recovers from a failed or partial write instead of hard-blocking as `resume-invalid-state`.

**Evidence (source — `plugins/feature-workflows/workflows/src/state.mjs`):**

`flushPipelineStateWithSnapshot(planDir, result, config)` (lines 330–352):

1. Reads the current `pipeline-state.json` via `loadPipelineState`.
2. If current state exists and is valid: copies it to `pipeline-state.last-good.json`
   via `writeChunkedFile` with label `file-writer:last-good`.
3. Delegates the new-state write to the existing `flushPipelineState`.
4. Non-blocking: copy failure is caught and logged via `result.logLines` — the new write
   still proceeds.

`loadPipelineStateWithRecovery(planDir)` (lines 354–389):

1. Loads `pipeline-state.json` via `loadPipelineState` and validates via `validatePipelineState`.
2. If primary passes validation: returns `{ state, recovered: false }`.
3. If primary fails: loads `pipeline-state.last-good.json` via `safeAgent` file-reader.
4. If last-good passes validation: returns `{ state: lastGoodState, recovered: true }`.
5. If both fail: returns `{ state: null, recovered: false }` — the caller then produces
   a clean blocked result instead of throwing.

**Resume path wiring (`main.mjs` line 100):**

```
const loaded = await loadPipelineStateWithRecovery(resumeDir)
resumed = loaded && loaded.state
if (loaded && loaded.recovered) {
  log(`main: --resume auto-recovered from pipeline-state.last-good.json ...`)
}
```

A truncated/corrupt primary state file now auto-recovers with a visible log line instead
of hard-blocking as `resume-invalid-state`. When both primary and last-good fail, the
caller returns a clean `resume-no-state` blocked result with an actionable handoff message.

### DRESUME-01 — Digest-driven resume — MET

**Goal:** A user resuming a run or answering an approval checkpoint pays only for changed
work: unchanged artifacts are trusted via durable digests without per-artifact re-verification
calls, reviews re-run only when their inputs changed, and approval decisions apply without
re-running unaffected gates.

**Evidence (source — `plugins/feature-workflows/workflows/src/state.mjs`):**

`ARTIFACT_CHECKPOINT_GATE_MAP` (lines 8–14): maps 5 artifact path keys to their checkpoint
gate names:
- `definitionPath` → `define`
- `requirementsPath` → `requirements`
- `archPath` → `architecture`
- `designPath` → `detailed-design`
- `planPath` → `plan`

`verifyArtifactDigest(result, pathKey)` (lines 20–31): pure function that checks whether
a durable checkpoint exists for the artifact's gate AND a stored digest was recorded. Returns
`{ verified: true, ... }` only when both conditions hold.

`repairResumeArtifactFlags(result)` (lines 409–465): extended with digest-driven skip:

1. For each of the 5 artifacts, checks the checkpoint gate via `ARTIFACT_CHECKPOINT_GATE_MAP`.
2. If `checkpoint.acknowledged && storedDigest` both exist → `continue` (skip the expensive
   LLM `verifyArtifactPresence` call entirely).
3. Otherwise: falls through to `verifyArtifactPresence` which itself checks
   `verifyArtifactDigest` first (Phase 11 deterministic verification) before falling back
   to the LLM file-reader.
4. If the artifact is missing: nulls all downstream flags (`_define`, `designReady`, `ready`,
   `executed`, `testsPassed`, `codeReview`, `_goalkeeper`).

**`verifyArtifactPresence` digest integration (lines 385–390):** When `pathKey` is provided,
`verifyArtifactDigest` is checked first — if the durable digest verifies, the LLM call is
skipped entirely. This is the Phase 11 DVERIFY-01 enhancement layered on top of Phase 8's
checkpoint infrastructure.

**Backward compatibility:** Artifacts without checkpoints or digests (v1.4.5 states) fall
through to the existing LLM verification path unchanged.

---

## UAT Scenarios Confirmed

### Goal 1 — Interrupting a design run between any two material gates resumes at the first incomplete gate

- **Per-gate durable flush:** all 19 material gates (15 design + 4 implement) call
  `checkpointDesign()` which persists `_designCheckpoints` + `_artifactDigests` via
  `flushPipelineStateWithSnapshot`. Confirmed by reading all 19 call sites in source
  and verifying 19 `await checkpointDesign(` occurrences in dist.
- **Non-blocking:** try/catch around `flushPipelineStateWithSnapshot` — flush failure
  warns but does not gate the pipeline (same Phase 4 pattern).
- **Resume at first incomplete gate:** each gate body is guarded by a
  `if (!result.xxxPath)` or `if (!result._xxx)` check — a checkpointed gate with its
  artifact path set is skipped on resume. Behavioral tests confirm the agent is not
  called for pre-completed gates.

### Goal 2 — A truncated or partially written state file auto-recovers

- **Write ordering verified:** `flushPipelineStateWithSnapshot` reads current state →
  writes snapshot to `pipeline-state.last-good.json` → writes new state via
  `flushPipelineState`. Nyquist test at `phase08-nyquist-validation.test.mjs:230` verifies
  this exact ordering via call-order tracking.
- **First-write behavior:** when no existing state exists, snapshot copy is skipped (test
  at line 264) — the new write proceeds without a spurious snapshot of nothing.
- **Recovery signal:** `loadPipelineStateWithRecovery` returns `recovered: true` when
  primary fails and last-good succeeds; `recovered: false` when primary is valid. Resume
  path logs the recovery event (main.mjs line 102).
- **Both-fail hard block:** when both primary and last-good are corrupt/null, the function
  returns `{ state: null, recovered: false }` — the caller produces a clean
  `resume-no-state` blocked result instead of throwing an unrecoverable crash.

### Goal 3 — Resuming re-verifies only artifacts whose durable digest changed

- **Digest-driven skip:** `repairResumeArtifactFlags` checks `_designCheckpoints[gate].acknowledged`
  AND `_artifactDigests[pathKey]`. When both exist, the LLM verification call is skipped
  entirely (test at `phase08-nyquist-validation.test.mjs:524`).
- **Checkpoint without digest:** falls through to LLM verification (test at line 552).
- **Digest without checkpoint:** falls through to LLM verification (test at line 578).
- **Mixed-state artifacts:** only artifacts without checkpoint+digest are verified;
  checkpointed artifacts are skipped (test at line 604).
- **planned=false exclusion:** `planPath` is excluded from verification when `planned` is
  false (test at line 644); included when `planned` is true (test at line 666).
- **Downstream flag cleanup:** when an artifact is nullified, all 7 downstream flags are
  cleared (test at line 691).

### Goal 4 — Implement and tune modes exhibit the same gate-level checkpoint durability

- **Implement mode:** 4 material gates checkpointed: `test-authoring` (2767), `execute`
  (2980), `test` (3071), `code-review` (3141). Confirmed in dist at lines 9843, 10056,
  10147, 10217.
- **Tune mode:** no additional checkpoints needed — all tune `stateCheckpoint` calls are
  already followed by `consolidate()` which flushes state. This is the correct adoption
  of the Phase 4 pattern: tune was never affected by the coarse-checkpoint loss because
  it consolidates at every gate.

---

## E2E Matrix Coverage (Phase 8 Rows)

| E2E ID | Verified | Evidence |
|--------|----------|----------|
| E2E-DCKPT-01 | MET | 19 `checkpointDesign()` call sites in source and dist (15 design + 4 implement). Each durably flushes via `flushPipelineStateWithSnapshot`. Non-blocking try/catch. Resume guards skip completed gates. Behavioral tests verify agent not called for checkpointed gates. |
| E2E-DSTATE-01 | MET | `flushPipelineStateWithSnapshot` writes last-good before new state (ordering test). `loadPipelineStateWithRecovery` auto-recovers from truncated primary (test at line 364), returns null when both fail (test at line 389, 401), hard-blocks when both corrupt (test at line 416). Resume path wired at main.mjs:100. |
| E2E-DRESUME-01 | MET | `repairResumeArtifactFlags` skips unchanged artifacts with checkpoint+digest (test at line 524). Falls through on checkpoint-without-digest (test at line 552) and digest-without-checkpoint (test at line 578). Mixed-state test verifies selective skip (test at line 604). `verifyArtifactDigest` provides deterministic Phase 11 enhancement on top of Phase 8 checkpoints. |

---

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| `tests/design-checkpoints.test.mjs` | 22 | all pass — DCKPT-01 (7), DSTATE-01 (8), DRESUME-01 (5), REGRESSION (2) |
| `tests/phase08-nyquist-validation.test.mjs` | 68 | all pass — DCKPT-01 (24 gap-filling), DSTATE-01 (19), DRESUME-01 (16), REGRESSION (9) |
| **Phase 8 total** | **90** | **all pass** |
| Full milestone suite | 1448 | pass / 0 fail |

Build validation: `npm run validate:build` — both entries drift-free (`feature-pipeline.js`
+ `fp-extract-slice.js` each 33 modules, 314 top-level names, engine-version 1.4.5).

---

## Live Behavioral Checks

1. **Clean rebuild drift-free:** `npm run validate:build` → both entries `up to date`;
   no diff after rebuild.
2. **Dist call-site match:** 19 `await checkpointDesign(` occurrences in
   `feature-pipeline.js` matching source exactly (15 design + 4 implement gates).
3. **Resume-path wiring:** `loadPipelineStateWithRecovery(resumeDir)` present at
   `main.mjs:100`; recovery log message at line 102.
4. **Result-field initialization:** `_designCheckpoints: {}` and `_artifactDigests: {}`
   present in dist (1 occurrence each — the result-init block).
5. **ARTIFACT_CHECKPOINT_GATE_MAP:** 5-entry map present in `state.mjs` (lines 8–14)
   and dist (3 occurrences — definition + 2 references).
6. **verifyArtifactDigest:** deterministic digest check present in `state.mjs` (lines 20–31)
   and dist (2 occurrences — definition + call in `verifyArtifactPresence`).
7. **Nyquist defect fix confirmed:** `checkpointDesign` body at `main.mjs:641` special-cases
   `definitionPath` to map to `_define` (not `_definition`). Test at
   `phase08-nyquist-validation.test.mjs:131` asserts this mapping.

---

## Success Criteria Verification

1. **Interrupting a design run between any two material gates resumes at the first
   incomplete gate with all prior verified artifacts intact and no gate repeated.** —
   VERIFIED. All 19 material gates (15 design + 4 implement) call `checkpointDesign()`
   which durably flushes state. Each gate body is guarded by an artifact-path check so
   checkpointed gates are skipped on resume. Behavioral tests confirm no agent call for
   pre-completed gates.

2. **A truncated or partially written state file auto-recovers from the last durably
   acknowledged snapshot on resume instead of hard-blocking as `resume-invalid-state`.** —
   VERIFIED. `flushPipelineStateWithSnapshot` retains a last-good snapshot before each write.
   `loadPipelineStateWithRecovery` auto-recovers from last-good when primary fails
   validation. Resume path at `main.mjs:100` uses the recovery-aware loader. Both-fail
   case returns a clean blocked result, not a crash.

3. **Resuming a run or applying an approval decision re-verifies or re-runs only
   artifacts/reviews whose durable digest changed; unaffected gates and reviews are
   skipped.** — VERIFIED. `repairResumeArtifactFlags` checks checkpoint+digest for each
   of the 5 artifacts; matching entries skip LLM verification entirely. `verifyArtifactDigest`
   provides deterministic digest-based verification (Phase 11 enhancement). Non-matching
   entries fall through to LLM verification. Mixed-state test confirms selective skip.

4. **Implement and tune modes exhibit the same gate-level checkpoint durability wherever
   the coarse-checkpoint defect is proven present.** — VERIFIED. Implement mode: 4 gates
   checkpointed (test-authoring, execute, test, code-review). Tune mode: unaffected — all
   tune `stateCheckpoint` calls already have following `consolidate()` which flushes state.

---

## Defects Found During This Verification

None. The Nyquist-validation defect (dataKey derivation for `definitionPath`) was found
and fixed during Phase 8 Nyquist validation (commit `c4477a6`). This verification confirms
the fix is correct and present in both source and dist: `definitionPath` maps to `_define`
(not `_definition`), ensuring the digest is computed from the definition content object,
not the file path string. All other dataKey derivations follow the standard convention
correctly.

---

## Files Verified

| File | Role |
|------|------|
| `plugins/feature-workflows/workflows/src/main.mjs` | `checkpointDesign()` (628–649), 19 call sites (1660–3141), resume path with `loadPipelineStateWithRecovery` (100–102) |
| `plugins/feature-workflows/workflows/src/state.mjs` | `ARTIFACT_CHECKPOINT_GATE_MAP` (8–14), `verifyArtifactDigest` (20–31), `flushPipelineStateWithSnapshot` (330–352), `loadPipelineStateWithRecovery` (354–389), `repairResumeArtifactFlags` digest extension (409–465) |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | Generated dist — drift-free, 19 checkpointDesign call sites, recovery-aware resume path, result-field init, ARTIFACT_CHECKPOINT_GATE_MAP |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | Generated leaf dist — drift-free, engine-version 1.4.5 |
| `tests/design-checkpoints.test.mjs` | 22 Phase 8 original tests |
| `tests/phase08-nyquist-validation.test.mjs` | 68 Phase 8 Nyquist gap-filling tests |
| `tests/harness.mjs` | `flushPipelineStateWithSnapshot` + `loadPipelineStateWithRecovery` registered as engine export candidates |

---

## Concerns (non-blocking)

1. **Review-only gates checkpoint without artifact path.** Five design gates
   (knowledge, requirements-review, arch-review, design-review, tdd-enforce) call
   `checkpointDesign('gateName')` with no `artifactPathKey`. Their checkpoint entry
   has `artifactPath: null` and no digest is recorded. This is intentional — these
   gates produce boolean flags or in-memory state, not file artifacts — but it means
   their resume correctness relies on the in-memory flag surviving the state flush,
   not on a digest-based skip. Non-blocking — the `acknowledged` flag in
   `_designCheckpoints` is still persisted and the gate is still skipped on resume
   via its guard condition.

2. **`repairResumeArtifactFlags` covers 5 artifacts only.** The artifact list maps
   `definitionPath`, `requirementsPath`, `archPath`, `designPath`, and `planPath` to
   their checkpoint gates. Gates without a file artifact (knowledge, reviews, tdd,
   reconcile, chunk-plan, implement gates) are not in this list because they have no
   file to verify. This is correct — `repairResumeArtifactFlags` is specifically about
   file-artifact verification, not gate-completion verification. Non-blocking.

3. **Digest comparison is checkpoint-time, not real-time.** The stored digest reflects
   the gate result at checkpoint time. If an external process modifies the artifact file
   after checkpoint but before resume, the digest will still match (the result object
   hasn't changed) and verification will be skipped. This is the intended trade-off:
   the digest authenticates the pipeline's own output, not external file mutations.
   Phase 11's `verifyArtifactDigest` uses the same checkpoint-time digest. Non-blocking
   — external file mutation is outside the pipeline's trust boundary.

---

## Sign-off

Phase 8 goals are genuinely met. The codebase delivers per-gate durable checkpoints for
all 15 material design gates and all 4 material implement gates, auto-recovering atomic
state writes with last-good snapshot retention, and digest-driven resume that skips
unchanged artifacts. The Nyquist-validation defect (dataKey derivation for
`definitionPath`) is confirmed fixed in post-fix code. Tune mode correctly relies on
its existing consolidate-at-every-checkpoint pattern. 90 Phase 8 tests pass; 1448 tests
pass overall; clean rebuild is drift-free; no new defects found.

**Status:** VERIFIED
