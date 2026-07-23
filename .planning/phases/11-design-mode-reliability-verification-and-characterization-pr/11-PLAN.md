---
phase: 11
title: "Design-Mode Reliability, Verification, and Characterization Proof"
wave: 1
depends_on: []
requirements: [DTRANS-01, DVERIFY-01, DTEST-01]
files_modified:
  - plugins/feature-workflows/workflows/src/agent-core.mjs
  - plugins/feature-workflows/workflows/src/state.mjs
  - plugins/feature-workflows/workflows/src/decisions.mjs
  - tests/harness.mjs
  - tests/design-reliability.test.mjs
autonomous: true
---

# Phase 11: Design-Mode Reliability, Verification, and Characterization Proof

## Objective

Add transient-error classification with bounded backoff retry to the shared agent core (DTRANS-01), make artifact-presence and append-growth verification deterministic via the digest/revision contract rather than LLM self-reports (DVERIFY-01), and prove the extended design flow end to end with behavioral characterization tests covering the gate sequence, review loop, agent retry ladder, crash-resume, and partial state writes (DTEST-01).

## must_haves

truths:
  - "A transient provider/network error on a blocking design gate is retried with bounded backoff before hard-blocking"
  - "Artifact-presence verification derives from the durable digest/revision contract, not trusted LLM self-reports"
  - "A hallucinated agent self-report can neither pass a missing artifact nor false-block a present one"
  - "Behavioral characterization tests cover the design gate sequence, review loop, agent retry ladder, crash-resume, and partial state writes"
  - "All 732 prior tests remain green and the build is drift-free"

## RED Gate Evidence

1. Test asserts `classifyAgentError` exists and classifies network errors as transient — fails (function absent).
2. Test asserts `verifyArtifactDigest` exists and returns verified from durable checkpoint — fails (function absent).
3. Test asserts `flexibleAgent` calls `classifyAgentError` in its catch block — fails (no classification call).
4. Test asserts `verifyArtifactPresence` consults `_artifactDigests` before LLM reader — fails (trusts LLM only).
5. No behavioral test currently exercises the design gate sequence, review loop, retry ladder, crash-resume, or partial writes.

## Tasks

### Task 1: Add transient-error classification and backoff retry to agent-core.mjs (DTRANS-01)

<action>
In `plugins/feature-workflows/workflows/src/agent-core.mjs`:

1. Add constants after the imports:
   - `const TRANSIENT_RETRY_MAX = 3` — max backoff retry attempts for transient errors
   - `const TRANSIENT_BACKOFF_BASE_MS = 500` — base delay for exponential backoff (500, 1000, 2000)

2. Add pure function `classifyAgentError(errorMsg)`:
   - Returns `'transient'` if error matches: `/network|timeout|connection|ECONNRESET|ENOTFOUND|ETIMEDOUT|429|503|502|rate.?limit|overloaded|service.unavailable|temporarily/i`
   - Returns `'schema'` if error matches: `/StructuredOutput|schema|valid output/i`
   - Returns `'fatal'` for all other errors

3. Add async function `retryTransientError(prompt, opts, result, errorMsg)`:
   - Loops up to `TRANSIENT_RETRY_MAX` times
   - Each iteration: wait `TRANSIENT_BACKOFF_BASE_MS * 2^(attempt-1)` ms via `setTimeout` wrapped in a Promise
   - Calls `callAgentWithWatchdog(prompt, opts, result)` on each attempt
   - Records each attempt via `recordDegradationEvent(result, 'retry', opts && opts.phase, opts && opts.label, 'transient error retry')`
   - Returns the result if any attempt succeeds, `null` if all fail
   - Catches errors during retry — only the final exhaustion returns null

4. Modify `flexibleAgent` catch block (currently lines 41-47):
   - Replace the immediate `return null` for non-schema errors with:
     ```
     const errorClass = classifyAgentError(originalError)
     if (errorClass === 'transient') {
       const retried = await retryTransientError(prompt, callOpts, result, originalError)
       if (retried) return retried  // normalizeAgentOutput already applied inside
       // fall through to recordAgentFailure + return fallback
     }
     ```
   - Keep the existing schema-failure path (plain-text JSON fallback) unchanged
   - After transient retry exhaustion, continue to the existing `recordAgentFailure` + `fallbackForAgent` path

5. Add `classifyAgentError`, `retryTransientError`, `TRANSIENT_RETRY_MAX`, `TRANSIENT_BACKOFF_BASE_MS` to the export statement.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/agent-core.mjs (full file — understand flexibleAgent, callAgentWithWatchdog, recordDegradationEvent)
- plugins/feature-workflows/workflows/src/config.mjs (AGENT_TIMEOUT_MS_DEFAULT pattern)
</read_first>

<acceptance_criteria>
- `classifyAgentError('network timeout')` returns `'transient'`
- `classifyAgentError('ECONNRESET connection reset')` returns `'transient'`
- `classifyAgentError('StructuredOutput schema validation failed')` returns `'schema'`
- `classifyAgentError('something unexpected')` returns `'fatal'`
- `TRANSIENT_RETRY_MAX === 3`
- `TRANSIENT_BACKOFF_BASE_MS === 500`
- Source assertion: `flexibleAgent` body contains `classifyAgentError` call
- Source assertion: `retryTransientError` function is defined
- All existing agent-core tests still pass
</acceptance_criteria>

### Task 2: Add deterministic artifact verification via digest contract (DVERIFY-01)

<action>
In `plugins/feature-workflows/workflows/src/state.mjs`:

1. Add import of `computeContentDigest` from `./revision.mjs` (add to existing import or create new import line).

2. Add pure function `verifyArtifactDigest(result, pathKey)`:
   - Checks `result._artifactDigests[pathKey]` and `result._designCheckpoints` for a durable verification record
   - Returns `{ verified: boolean, reason: string, digest: string|null }`
   - Map pathKey to checkpoint gate name using the existing `checkpointGateMap` pattern from `repairResumeArtifactFlags`
   - If checkpoint acknowledged AND digest exists → `{ verified: true, reason: 'checkpoint-verified', digest }`
   - If checkpoint not acknowledged → `{ verified: false, reason: 'no-checkpoint' }`
   - If no digest → `{ verified: false, reason: 'no-digest' }`
   - Pure — no I/O, no side effects

3. Modify `verifyArtifactPresence({ path, gate, expectedHeadings, result })`:
   - BEFORE calling the LLM file-reader agent, check `verifyArtifactDigest(result, path)`
   - If `verified === true`: return `{ exists: true, sizeBytes: 1, hasExpectedHeadings: true, summary: 'verified via durable digest' }` — skip the LLM call entirely
   - If no digest exists (backward compat): proceed with the existing LLM file-reader call
   - This ensures a hallucinated LLM self-report cannot override the durable digest

4. Export `verifyArtifactDigest` from state.mjs.
</action>

<read_first>
- plugins/feature-workflows/workflows/src/state.mjs (full file — understand verifyArtifactPresence, repairResumeArtifactFlags, checkpointGateMap)
- plugins/feature-workflows/workflows/src/revision.mjs (computeContentDigest, computeDigest)
</read_first>

<acceptance_criteria>
- `verifyArtifactDigest` is a pure function (no I/O)
- `verifyArtifactDigest` with acknowledged checkpoint + digest returns `{ verified: true }`
- `verifyArtifactDigest` with no checkpoint returns `{ verified: false, reason: 'no-checkpoint' }`
- `verifyArtifactDigest` with no digest returns `{ verified: false, reason: 'no-digest' }`
- Source assertion: `verifyArtifactPresence` body contains `verifyArtifactDigest` call before the safeAgent call
- Source assertion: when digest-verified, verifyArtifactPresence returns early without calling safeAgent
</acceptance_criteria>

### Task 3: Strengthen verifyAppendGrowth with digest comparison (DVERIFY-01)

<action>
In `plugins/feature-workflows/workflows/src/decisions.mjs`:

1. Import `computeContentDigest` from `./revision.mjs` (add to existing import or new import).

2. Modify `verifyAppendGrowth(result, path, ack)`:
   - After the existing byte-count check, add a digest-based comparison when the ack contains content:
     - If `ack.content` exists, compute `computeContentDigest(ack.content)` and store in `result._appendDigests[path]`
     - Compare against `result._appendDigests[path]` from the previous write
     - If digests match (content unchanged), report `{ ok: false, reason: 'digest-unchanged' }` (no growth)
     - If digests differ, report `{ ok: true, reason: 'digest-grew' }`
   - When no content is available in ack, fall back to the existing `totalBytes` comparison
   - Initialize `result._appendDigests = {}` if not present
   - Keep the function pure (mutates result for state tracking, same as existing pattern)
</action>

<read_first>
- plugins/feature-workflows/workflows/src/decisions.mjs (verifyAppendGrowth, lines 281-296)
- plugins/feature-workflows/workflows/src/revision.mjs (computeContentDigest)
</read_first>

<acceptance_criteria>
- `verifyAppendGrowth` uses digest comparison when content is available
- `verifyAppendGrowth` falls back to byte-count comparison when no content
- Source assertion: `decisions.mjs` imports `computeContentDigest`
- Source assertion: `verifyAppendGrowth` body references `_appendDigests`
</acceptance_criteria>

### Task 4: Update test harness (DTRANS-01, DVERIFY-01)

<action>
In `tests/harness.mjs`, add to the CANDIDATES array (before the closing `]`):
- `'classifyAgentError'`
- `'TRANSIENT_RETRY_MAX'`
- `'TRANSIENT_BACKOFF_BASE_MS'`
- `'verifyArtifactDigest'`

These names will be auto-filtered by the existing `CANDIDATES.filter(...)` check — only names actually declared in the engine source will be exported.
</action>

<read_first>
- tests/harness.mjs (CANDIDATES array, lines 28-208)
</read_first>

<acceptance_criteria>
- harness CANDIDATES includes the 4 new names
- `npm run build` succeeds
- `npm run validate:build` succeeds (no drift)
</acceptance_criteria>

### Task 5: Write behavioral characterization tests (DTEST-01)

<action>
Create `tests/design-reliability.test.mjs` with comprehensive tests:

**DTRANS-01 — Transient error classification and retry:**
- `classifyAgentError('network timeout')` → `'transient'`
- `classifyAgentError('ECONNRESET')` → `'transient'`
- `classifyAgentError('503 Service Unavailable')` → `'transient'`
- `classifyAgentError('429 Too Many Requests')` → `'transient'`
- `classifyAgentError('rate limit exceeded')` → `'transient'`
- `classifyAgentError('StructuredOutput schema validation failed')` → `'schema'`
- `classifyAgentError('unexpected fatal error')` → `'fatal'`
- `TRANSIENT_RETRY_MAX` is 3
- `TRANSIENT_BACKOFF_BASE_MS` is 500
- Source assertion: `flexibleAgent` body contains `classifyAgentError(` call
- Source assertion: `retryTransientError` function is defined with bounded loop
- Mock agent test: agent throws network error on first call, succeeds on second → `flexibleAgent` retries and returns result
- Mock agent test: agent always throws network error → `flexibleAgent` retries TRANSIENT_RETRY_MAX times then returns null/fallback

**DVERIFY-01 — Deterministic artifact verification:**
- `verifyArtifactDigest` with `{ _designCheckpoints: { define: { acknowledged: true } }, _artifactDigests: { definitionPath: 'abc123' } }, 'definitionPath'` → `{ verified: true }`
- `verifyArtifactDigest` with no checkpoint → `{ verified: false, reason: 'no-checkpoint' }`
- `verifyArtifactDigest` with checkpoint but no digest → `{ verified: false, reason: 'no-digest' }`
- `verifyArtifactDigest` is pure (no mutation of input)
- Source assertion: `verifyArtifactPresence` calls `verifyArtifactDigest` before LLM reader
- Source assertion: `verifyArtifactPresence` returns early when digest-verified
- `verifyAppendGrowth` with digest available uses digest comparison
- `verifyAppendGrowth` without digest falls back to byte count
- Source assertion: `decisions.mjs` imports `computeContentDigest`

**DTEST-01 — Behavioral characterization:**
- Source assertion: design gate sequence has checkpointDesign at all material gates (extends Phase 8 proof)
- Source assertion: review loop (reviewLoop) is defined and testable
- Agent retry ladder: classifyAgentError → transient → bounded retries → exhaustion
- Crash-resume characterization: `loadPipelineStateWithRecovery` with truncated state returns `{ state: lastGoodState, recovered: true }` (extends Phase 8)
- Partial state writes characterization: `flushPipelineStateWithSnapshot` writes state then snapshot is loadable (extends Phase 8)
- Design-mode transient error: mock agent that throws `'network timeout'` → `flexibleAgent` classifies as transient, enters retry loop, eventually succeeds or hard-blocks after exhaustion
- Source assertion: no raw `JSON.stringify` of reconcile/blockers at prompt sites (Phase 10 regression)
- Source assertion: `designReady` checks `_reviewed*Forced` flags (Phase 9 regression)
</action>

<read_first>
- tests/design-checkpoints.test.mjs (Phase 8 test pattern for source assertions and mock agents)
- tests/design-truth.test.mjs (Phase 9 test pattern for truthful readiness)
- tests/design-budget.test.mjs (Phase 10 test pattern for budget/loop assertions)
- tests/telemetry.test.mjs (agent-core test patterns)
- tests/harness.mjs (engine import and mock agent patterns)
</read_first>

<acceptance_criteria>
- `npm test` passes with 0 failures
- New test file covers all 3 requirements (DTRANS-01, DVERIFY-01, DTEST-01)
- Total test count increases from 732 baseline
- All 732 prior tests remain green
- Build drift is empty (`npm run validate:build` exit 0)
</acceptance_criteria>

## GREEN Evidence

1. Transient errors classified and retried with bounded backoff across all modes
2. Artifact verification deterministic via digest contract — LLM self-reports cannot override
3. Behavioral characterization tests prove design gate sequence, review loop, retry ladder, crash-resume, partial writes
4. All 732 prior tests remain green; build drift is empty

## Success Criteria

1. A transient provider/network error on a blocking design gate is retried with bounded backoff and only hard-blocks after those retries are exhausted, not on the first non-schema failure.
2. Artifact-presence and append-growth checks pass or fail based on the shared digest/revision contract; a hallucinated agent self-report can neither pass a missing artifact nor false-block a present one.
3. The design gate sequence, review loop, agent retry ladder, crash-resume without a flushed state, and partial state writes each have passing behavioral characterization tests with recorded RED-then-GREEN evidence.

## Artifacts this phase produces

- `classifyAgentError(errorMsg)` — pure error classification function in agent-core.mjs
- `retryTransientError(prompt, opts, result, errorMsg)` — bounded backoff retry function in agent-core.mjs
- `TRANSIENT_RETRY_MAX` — configurable max retry constant (3)
- `TRANSIENT_BACKOFF_BASE_MS` — backoff base delay constant (500ms)
- `verifyArtifactDigest(result, pathKey)` — pure deterministic verification function in state.mjs
- Modified `verifyArtifactPresence` — digest-first verification path in state.mjs
- Modified `verifyAppendGrowth` — digest-comparison path in decisions.mjs
- `tests/design-reliability.test.mjs` — behavioral characterization test suite
