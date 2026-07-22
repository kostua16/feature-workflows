# Research: Phase 11 — Design-Mode Reliability, Verification, and Characterization Proof

**Researched:** 2026-07-22
**Scope:** Transient-error retry in `flexibleAgent`, deterministic artifact verification, and end-to-end behavioral characterization tests for the design flow.

## 1. DTRANS-01: Transient-error classification and bounded backoff retry

### Current defect (F14)

`flexibleAgent` in `agent-core.mjs` (lines 36-93) retries ONLY schema-classified failures (`/StructuredOutput|schema|valid output/i`). Any other throw — network timeout, provider 429/503, connection reset — is caught at line 41-47 and immediately converted to `null`. Every blocking design gate hard-blocks on `null` (main.mjs lines 1313, 1514, 1566, 1637, 1704, 1781, 1814).

### Fix approach

Add a `classifyAgentError(errorMsg)` pure function that returns `'transient' | 'schema' | 'fatal'`:
- **transient**: network/provider errors matching `/network|timeout|connection|ECONNRESET|ENOTFOUND|ETIMEDOUT|429|503|502|rate.?limit|overloaded|service.unavailable|temporarily/i`
- **schema**: existing `/StructuredOutput|schema|valid output/i` pattern
- **fatal**: everything else

Add `retryTransientError(prompt, opts, result, errorMsg)` that applies bounded backoff:
- Max `TRANSIENT_RETRY_MAX = 3` attempts (configurable)
- Backoff: `TRANSIENT_BACKOFF_BASE_MS = 500` with exponential multiplier (500, 1000, 2000)
- Uses `callAgentWithWatchdog` (existing watchdog still applies)
- Records each attempt via `recordDegradationEvent(result, 'retry', ...)`
- On exhaustion, returns `null` (existing gate null-handling takes over)

Wire into `flexibleAgent`: replace the immediate `return null` at line 44 with a transient-classification check. If transient, enter the backoff retry loop before returning null.

### Files to modify

- `plugins/feature-workflows/workflows/src/agent-core.mjs` — add `classifyAgentError`, `retryTransientError`, `TRANSIENT_RETRY_MAX`, `TRANSIENT_BACKOFF_BASE_MS`; modify `flexibleAgent` catch block
- `tests/harness.mjs` — add new exports to CANDIDATES
- `tests/design-reliability.test.mjs` — new test file

### Key invariants

- Schema retry path (existing) is unchanged
- Backoff is bounded (max 3 retries, total ~3.5s max additional latency)
- Each retry is journaled via `recordDegradationEvent` for DHIST-01 compatibility
- All modes benefit (shared agent core)

## 2. DVERIFY-01: Deterministic artifact verification

### Current defect (F15)

`verifyArtifactPresence` (state.mjs lines 298-315) trusts a file-reader agent's self-reported `exists/sizeBytes/hasExpectedHeadings`. A hallucinated existence claim passes a missing artifact; an under-reported size false-blocks a present one.

`verifyAppendGrowth` (decisions.mjs lines 281-296) trusts writer-reported `totalBytes` and is advisory-only.

### Fix approach

Add `computeContentDigest`-based deterministic verification that doesn't rely on LLM self-reports:

1. **`verifyArtifactDigest(result, pathKey, gateName)`** — pure function that checks `_artifactDigests[pathKey]` against the Phase 8 durable checkpoint record. Returns `{ verified, reason, digest }`:
   - If checkpoint acknowledged AND digest exists → `verified: true` (the artifact was durably verified at checkpoint time)
   - If checkpoint not acknowledged → `verified: false, reason: 'no-checkpoint'`
   - If digest missing → `verified: false, reason: 'no-digest'`

2. **Modify `verifyArtifactPresence`** to cross-check the LLM's self-report against the durable digest:
   - First check `_artifactDigests[path]` — if present, that's the authoritative answer
   - Only fall back to the LLM reader if no digest exists (backward compat with pre-Phase 8 state)
   - A hallucinated existence claim (LLM says `exists:true`) is rejected if no digest was recorded
   - A genuine artifact (digest recorded at checkpoint) is accepted regardless of LLM self-report

3. **Modify `verifyAppendGrowth`** to use the digest contract when available:
   - If `_appendDigests[path]` exists, compare current vs previous digest instead of trusting `totalBytes`
   - Fall back to byte-count comparison when no digest is available

### Files to modify

- `plugins/feature-workflows/workflows/src/state.mjs` — add `verifyArtifactDigest`, modify `verifyArtifactPresence`
- `plugins/feature-workflows/workflows/src/decisions.mjs` — modify `verifyAppendGrowth` to use digest when available
- `tests/harness.mjs` — add new exports
- `tests/design-reliability.test.mjs` — tests for deterministic verification

### Key invariants

- Backward compatible: pre-Phase 8 state files (no digests) still use the LLM reader path
- The digest is the source of truth when available — LLM self-reports cannot override it
- `computeContentDigest` from `revision.mjs` is reused (Phase 1 REV-01 primitive)

## 3. DTEST-01: Behavioral characterization tests

### Current defect (F17)

No behavioral test exercises:
- The design gate sequence end to end
- The review loop
- The agent retry ladder (including transient classification)
- Crash-resume without a flushed state
- Partial/truncated state writes

### Test plan

All tests in `tests/design-reliability.test.mjs`:

**DTRANS-01 tests:**
- `classifyAgentError` returns `'transient'` for network/provider error patterns
- `classifyAgentError` returns `'schema'` for schema validation errors
- `classifyAgentError` returns `'fatal'` for unrecognized errors
- `TRANSIENT_RETRY_MAX` and `TRANSIENT_BACKOFF_BASE_MS` are importable constants
- Source assertion: `flexibleAgent` catch block calls `classifyAgentError` before returning null
- Source assertion: transient retry loop exists with bounded backoff

**DVERIFY-01 tests:**
- `verifyArtifactDigest` returns `verified:true` when checkpoint acknowledged and digest present
- `verifyArtifactDigest` returns `verified:false` when no checkpoint
- `verifyArtifactDigest` returns `verified:false` when no digest
- `verifyArtifactPresence` prefers digest over LLM self-report when digest exists
- `verifyArtifactPresence` falls back to LLM reader when no digest (backward compat)
- `verifyAppendGrowth` uses digest comparison when available

**DTEST-01 tests:**
- Source assertion: design gate sequence is testable (checkpointDesign called at all material gates — already proven in Phase 8 tests, extended here)
- Source assertion: review loop structure exists and is testable
- Agent retry ladder: `classifyAgentError` → transient → `retryTransientError` → exhaustion → null
- Crash-resume: `loadPipelineStateWithRecovery` recovers from truncated state (Phase 8, extended here for design mode)
- Partial state writes: `flushPipelineStateWithSnapshot` + `loadPipelineStateWithRecovery` round-trip (Phase 8, characterized here)
- Design-mode transient error handling: mock agent that throws network error → backoff retry → eventual success

## 4. Build and integration

### Build script changes

Add no new modules (all changes are in existing modules: agent-core.mjs, state.mjs, decisions.mjs). Build script unchanged.

### Harness changes

Add to CANDIDATES in `tests/harness.mjs`:
- `classifyAgentError`
- `TRANSIENT_RETRY_MAX`
- `TRANSIENT_BACKOFF_BASE_MS`
- `verifyArtifactDigest`

### Regression gates

All 732 existing tests must remain green. The build must produce drift-free dist. Phase-label validation must pass.

## 5. Dependencies on prior phases

| Primitive | Phase | Usage in Phase 11 |
|-----------|-------|-------------------|
| `computeContentDigest` | 1 (REV-01) | Deterministic artifact verification |
| `recordDegradationEvent` | 9 (DHIST-01) | Journal transient retry attempts |
| `callAgentWithWatchdog` | existing | Watchdog still applies during retries |
| `_artifactDigests` / `_designCheckpoints` | 8 (DCKPT-01) | Source of truth for verification |
| `flushPipelineStateWithSnapshot` | 8 (DSTATE-01) | Crash-resume characterization |
| `loadPipelineStateWithRecovery` | 8 (DSTATE-01) | Auto-recovery characterization |
