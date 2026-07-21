# Research: Design-Mode Flow and Shared Engine Weaknesses

**Researched:** 2026-07-22
**Scope:** `/feature-workflows:design-feature` flow and the shared engine infrastructure it uses.
**Method:** Repository-grounded review of `plugins/feature-workflows/workflows/src/` (engine sources), `plugins/feature-workflows/commands/`, and `tests/`. All findings carry file:line evidence. The prior improvement backlog (`docs/TODOs.md`) is fully implemented; every finding below is new.
**Purpose:** Evidence base for the v1.5.0 milestone extension (design-mode durability, truthfulness, and bounded execution phases appended after Phase 7).

## Design-mode gate sequence (observed)

Command `design-feature.md` invokes the engine with `mode:"design"`. Forward chain in `main.mjs` (design mode iterates the E4 loop exactly once): Translate → Categorize → Define (blocking, main.mjs:1273) → Define-clarification via `user-interviewer` (main.mjs:1330-1368) → Knowledge (1401) → Codebase Facts (1438) → E2E Use Cases (blocking, 1487) → Requirements (blocking, 1545) → Requirements Review (`reviewLoop`, fail-forward, 1587) → Architecture (blocking, 1625) → Arch Review (1651) → Detailed Design (blocking, 1690) → Design Review (1721) → Plan (blocking, 1757) → TDD Enforce (blocking, 1805) → Reconcile (non-blocking + design-fix loop, 1857-1966) → Plan Review/Refine + escalation (can hard-block or force-accept, 1987-2173) → Chunk Plan (degrades silently, 2195) → Publish (2230) → Persist (2236) → design terminal: artifact verification (2250-2291), `designReady=true` (2318), or `awaiting-approval` stop (2297-2316).

User interaction exists at exactly two points: Gate-0 clarification and the `--approval` stop/re-invoke loop (subagents cannot AskUserQuestion; decisions applied via `applyApprovalDecision`, decisions.mjs:254-272).

## Findings

### Durability and state

- **F1. No mid-chain state persistence.** `stateCheckpoint` only advances an in-memory cursor (main.mjs:559-564); `flushPipelineState` runs only inside `consolidate()` (state.mjs:13-29, 252-273), called only at hard-block/terminal exits (~30 return sites). A non-throw interruption mid-design (kill, OOM, watchdog-passed hang) persists nothing; resume restarts from Define even though artifact `.md` files exist. Extract mode already flushes per slice (main.mjs:1163, 1170) — the fix pattern exists in-engine. Exposed modes: design, implement, tune.
- **F2. Non-atomic chunked state writes; unrecoverable truncation.** `writeChunkedFile` stops on first chunk failure leaving a partial file (state.mjs:81-84); resume checksum (djb2, state.mjs:107-114) catches it but the only outcome is a hard `resume-invalid-state` block with manual-inspection advice (main.mjs:113-132). No last-good snapshot, no auto-recovery. All modes.
- **F3. Duplicate work on resume.** Every resume runs `repairResumeArtifactFlags` — one LLM file-reader call per recorded artifact regardless of change (state.mjs:317-362). `_reviewed*Forced` markers force full review-loop re-runs (main.mjs:1586, 1607-1611). Approval round-trips reload/re-validate full state per decision; "edit stages" re-runs the chunker, "reject" re-runs plan + downstream (main.mjs:625-644, 2297-2316). All modes (HITL pattern shared with tune-confirm main.mjs:710-725 and extract scope-confirm 1018-1038).

### Truthfulness

- **F4. `designReady=true` despite fail-forward reviews.** `reviewLoop` returns `{accepted:true, failForward:true}` on null reviewer (review-loop.mjs:98-102), null reviser (140-143), or sub-cap exhaustion (148-150). Engine sets `_reviewed*Forced` flags (main.mjs:1607-1611, 1670-1674, 1741-1745) but the design terminal never checks them (main.mjs:2318-2325).
- **F5. Force-accept hides carried blockers.** Gate 2 force-accepts an unresolved plan (`planAccepted=true`, `carriedBlockers`, main.mjs:2164-2170); handoff message does not mention `forceAccepted`/`carriedBlockers` (2318-2325) — truth depends on the command-layer prose.
- **F6. Reconcile conflicts ride to readiness.** Conflicts only travel as a string into the plan-reviewer prompt (main.mjs:1994, 2003); nothing gates on `result.reconcile.consistent` (1872) before `designReady`.
- **F7. YAGNI BLOCKER dropped under `--no-reconcile`.** Escalated into `reconcile.conflicts` (main.mjs:1828-1837) but `reconcileContext` is built only in the reconcile branch (1873); skip branch (1852-1853) leaves it empty — the blocker reaches no reviewer.
- **F8. Open questions recorded, never enforced.** `writeOpenQuestions` (decisions.mjs:136-167; main.mjs:1526, 1576) writes `open-questions.md`; no downstream gate blocks on unresolved entries; only a Gate-0 critical fork stops the run.
- **F9. Chunker degradation is silent.** Chunker failure degrades to a single implicit `stage01` (stages-issues.mjs:50-58); loses implement-mode parallelism/resumability; only a log line, not a warning or acknowledged outcome.
- **F10. Terminal outcomes overstate success.** Commit failure still returns terminal success (`committed=false`, no `blockedAt`, main.mjs:2891-2915). Publish/persist swallow errors and set self-reported booleans never verified and never affecting readiness (publish-persist.mjs:37-40, 63-68). Status derives done/pending from flags that may be fail-forward-set (state.mjs:151-176). All modes.

### Bounded execution

- **F11. Budgets bound iterations, not calls/tokens; telemetry is observational.** `retryState` global cap 20 (config.mjs:17, 136-169); `gateTelemetry` counts but never enforces (agent-core.mjs:165-183). No per-gate call cap, token accounting, or reserve for state flush/handoff. All modes.
- **F12. Shared retry budget starvation.** Four design review loops spend from the single global budget; early loops can starve Plan review/escalation (main.mjs:171, 1987-2005); `ESCALATION_RETRIES=5` hardcoded (2081). Resume re-grants budget (config.mjs:146-156) enabling re-entry into the same spin.
- **F13. Unbounded prompt inputs.** Design gates interpolate raw `JSON.stringify` — reconcile conflicts (main.mjs:1874, 1994, 2003), review blockers (2030, 2043, 2048, 2093), design fixes (1918, 1927); `compactList` hygiene exists but only for implement/executor prompts (decisions.mjs:342-353). Shared: `consolidate` embeds full result JSON (state.mjs:34); review-mode merge embeds full findings + whole issues file (review-mode.mjs:179-182). Output is capped (200k chars, config.mjs:23) but input never is.

### Reliability and verification

- **F14. No transient-error retry.** `flexibleAgent` retries only schema-classified failures (`/StructuredOutput|schema|valid output/i`, agent-core.mjs:40); any other throw → `null` immediately (41-47); max 2 real calls, no backoff (36-93). Every blocking design gate hard-blocks on `null` (1313, 1514, 1566, 1637, 1704, 1781, 1814). All modes.
- **F15. Verification is LLM-self-reported.** `verifyArtifactPresence` trusts a file-reader agent's `exists/sizeBytes/hasExpectedHeadings` (state.mjs:298-315); design-stop assertion (main.mjs:2250-2291) and resume repair trust it; `verifyAppendGrowth` trusts writer-reported `totalBytes` and is advisory-only (decisions.mjs:281-296). Hallucinated existence passes; under-report false-blocks. All modes.
- **F16. No attempt history.** `agentFailures` keeps count + last reason per key only (agent-core.mjs:135-154); individual retries/escalations/fallbacks are not journaled durable state.

### Test coverage gaps

- **F17.** No design-mode flow test (gate sequence untested end-to-end; `main()` unimportable by design). `reviewLoop`, `flexibleAgent`/`safeAgent` ladder, `callAgentWithWatchdog`, `escalateAgentOpts`, goalkeeper/reconcile/quick-decider loops, `publishDesign`/`persistFindings`, `tuneRevisitGate` — all untested. No crash-resume (state-never-flushed) test; no partial-chunk-write end-to-end test; no prompt-size guard to test.

## Mode-impact matrix

| Finding | design | implement | tune | review | extract | status |
|---------|--------|-----------|------|--------|---------|--------|
| F1 checkpoints | ✗ | ✗ | ✗ | ✗ | partially mitigated | n/a (read-only) |
| F2 atomic writes | ✗ | ✗ | ✗ | ✗ | ✗ | n/a |
| F3 resume cost | ✗ | ✗ | ✗ | ✗ | ✗ | n/a |
| F4-F9 design truth | ✗ | — | F4 via `tuneRevisitGate` | — | F4 via fidelity fail-forward | — |
| F10 terminal truth | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (reports it) |
| F11-F13 bounding | ✗ | ✗ | ✗ | ✗ | ✗ | — |
| F14 transient retry | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| F15 verification | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (trusts state) |
| F16 attempt history | ✗ | ✗ | ✗ | ✗ | ✗ | — |

## Alignment with v1.5.0 phases 1-7

Phases 1-7 build these primitives for extract: versioned pure reducers + root-last acknowledgement (CONTRACT-01), sharded state (STATE-01), revision/digest invalidation (REV-01), gate-level checkpoints (CHECKPOINT-01), enforced budgets with reserve (BUDGET-01), retry policy with attempt history (RETRY-01), attempted-vs-durable persistence (OBSERVE-01), truthful readiness (STATUS-01). The extension phases adopt those primitives where the same defect is proven in design/other modes — satisfying the existing YAGNI guardrail: "Share reducers, revision comparison, persistence acknowledgements, and status projections only where an existing non-extract regression proves the same contract." F1-F17 are those proven non-extract regressions.

Design-specific fixes with no extract precursor (F5-F9 handoff truth, open-questions policy, chunker surfacing, YAGNI routing) remain design-scoped and must not leak extract graph semantics into design mode.
