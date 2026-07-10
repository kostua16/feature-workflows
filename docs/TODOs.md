# TODOs — dynamic workflow (feature-pipeline engine)

Findings from a full review of `plugins/feature-workflows/workflows/feature-pipeline.js`
(engine v1.0.0, 3953 lines), the mode commands, and CI. Grouped by category, 5 items each.
Line refs point at the engine file unless stated otherwise.

Suggested priority order: BF-1 (tune is functionally broken without it) → BF-2/EN-3 (mode
guard) → EN-1 (test harness, so the rest land safely) → everything else.

## Status (engine v1.1.0)

**Bugfixes (BF-1..5)** and **Robustness (RB-1..15)** are implemented in
`plugins/feature-workflows/workflows/feature-pipeline.js` and covered by
`tests/feature-pipeline-helpers.test.mjs` where the behavior is locally testable.

**Enforcements (EN-1..5)** and **Improvements (IM-1..5)** are implemented too:

| Item | Status | Where |
|------|--------|-------|
| EN-1 unit tests for pure logic | ✅ done | `tests/harness.mjs` + `tests/*.test.mjs`, CI `node --test` step |
| EN-2 schema-validate state on resume | ✅ done | `validatePipelineState()`; blocks `resume-invalid-state` |
| EN-3 CI agent-registry check | ✅ done | `scripts/validate-agent-registry.mjs` + CI step |
| EN-4 verify append-only files grew | ✅ done | `verifyAppendGrowth()` + `FILE_ACK.totalBytes`; wired into review-history/decisions/issues appends |
| EN-5 enforce lane ownership post-execute | ✅ done | `detectOwnershipViolations()` + `normalizePath()`; records `result.ownershipWarnings` |
| IM-1 checksum-verify state (Q1 fallback) | ✅ done | `stateChecksum()` embedded in state, verified on resume |
| IM-2 persist budgets across resume | ✅ done | `hydrateBudget()` + `--fresh-budget`; stamped in `consolidate()` |
| IM-3 prompt-size hygiene | ✅ done | `compactList()` on carried-blocker interpolations |
| IM-4 stack-agnostic test gate | ✅ done | `detectTestCommand()` + `--test-cmd`/`--test-framework`; auto-detect fallback |
| IM-5 consolidate flag zoo into profiles | ✅ done | `PROFILES`/`resolveProfile()` + `--profile=full\|standard\|light` |

Only **Features (FT-*)** remain open.

---

## Bugfixes

### DONE BF-1. Tune-mode stage invalidation is a no-op for non-plan gates — CRITICAL
- Where: tune branch `feature-pipeline.js:2354-2360`; `invalidateStages` `:1262`.
- Problem: touched files collected only when `gate === 'plan'`; all other gates contribute
  `[]`. `invalidateStages` requires `touched.size` non-zero, so tuning
  requirements/architecture/design resets **zero** stages. All stages stay `done`,
  `/implement-feature` re-executes nothing, the upstream fix never reaches code.
- Fix: conservatively invalidate all non-preserved stages when the touched set is unknown
  (or derive touched files from the revised artifact).

### DONE BF-2. Promised implement-mode gate guard doesn't exist
- Where: `gateModeActive()` defined `:891` but never called.
- Problem: design gates are skipped only via completion flags. In implement mode any design
  gate whose flag is unset re-runs — e.g. a fail-forward review sets `_reviewedDesignForced`
  instead of `_reviewedDesign` (`:2960`), so `/implement-feature` silently re-runs opus
  review loops that `commands/implement-feature.md` explicitly promises are skipped.
- Fix: actually wire `gateModeActive()` (or equivalent mode assertions) into the gate bodies.

### DONE BF-3. TypeError risk in tune reconcile
- Where: `:2377-2378` — `result.reconcile = reconcile || result.reconcile` then immediately
  `result.reconcile.consistent`.
- Problem: if the reconciler agent returns null AND hydrated state never had a reconcile
  (e.g. design ran with `--no-reconcile`), this throws. Safety net converts an intentionally
  non-blocking gate into a hard `uncaught-throw` block.
- Fix: null-guard before the plog / default `result.reconcile` to a stub object.

### DONE BF-4. Implicit-stage progress never persisted
- Where: Execute gate `:3519-3521`.
- Problem: when `result.stages` is empty, a local fallback `stages` array is built but never
  assigned back to `result.stages`; the `if (result.stages[si])` guards then silently skip
  every sync. Stage status is lost from `pipeline-state.json`, so a mid-run block resumes by
  re-executing the whole plan.
- Fix: `result.stages = stages` when falling back to the implicit stage.

### DONE BF-5. gsd-quick fast-path can dereference null `definition` (+ dead rewind code)
- Where: `:2579` uses `${definition.definitionPath}`; pre-split-state backfill `:2177-2182`
  does not backfill `_define`, and on resume Define is skipped with
  `definition = result._define || null`.
- Fix: use `result.definitionPath` in the prompt.
- Related dead code: the E4 in-memory rewind for design gates (`:3846-3853`) is unreachable
  (design mode returns before Goalkeeper; implement mode routes design loop-backs to
  issues-handoff) — only `targetPhase='tests'` can fire, and the comment claims otherwise.
  Either delete the design-gate entries of `LOOPBACK_FLAG_MAP` usage or fix the comment
  (see also unresolved question Q2).

---

## Enforcements

### EN-1. Unit tests for the engine's pure logic — ✅ DONE (v1.1.0)
- Zero tests exist; CI only checks version lockstep (`.github/workflows/validate-plugin.yml`,
  `scripts/validate-plugin-versions.mjs`).
- `resolveMode`, `invalidateStages`, `clearGateAndDownstream`, `detectNonEnglish`,
  `categorizeSlug`, `extractJson`, `writeChunkedFile` chunking are pure and trivially
  testable in Node with a stubbed `agent()`. BF-1, BF-4, BF-5 would have been caught.

### EN-2. Schema-validate `pipeline-state.json` on resume — ✅ DONE (v1.1.0)
- `PIPELINE_STATE` (`:687`) is documentation-only; `loadPipelineState` hydrates whatever the
  file-reader returns. Corrupt/truncated state (plausible — see IM-1) hydrates garbage into
  25+ result flags. Validate and repair-or-block with a clear message.

### EN-3. CI agent-registry check — ✅ DONE (v1.1.0)
- The engine spawns some agents by `agentType` (`nsAgent('todo-store')`,
  `nsAgent('file-writer')`) but others only by prompt persona with **no agentType**
  (`issue-classifier` `:1131`, `tunePlanner`, `tune-confirm`, `file-reader`). Add a CI script
  that greps engine agent references and validates them against
  `plugins/feature-workflows/agents/*.md` so renames can't silently degrade to generic
  subagents.

### EN-4. Verify append-only files after write — ✅ DONE (v1.1.0)
- `review-history.md`, `decisions.md`, `issues-and-improvements.md`, and stage ticks rely on
  an LLM file-writer obeying "do NOT overwrite". One agent mistake wipes the audit trail
  tune depends on. Enforce with a post-write size/line-count check (file must grow), or move
  appends to a deterministic script.

### EN-5. Enforce lane/stage file ownership post-execute — ✅ DONE (v1.1.0)
- Lane disjointness is checked only on *declared* files (`:3547-3557`);
  `EXECUTE_VERDICT.files` is explicitly "post-run sanity, not a gate". Parallel executors
  can silently clobber each other. After fan-out, diff actually-touched files (git status)
  against lane ownership and block/warn on overlap.

---

## Improvements

### IM-1. Stop using LLM agents for mechanical file I/O — ✅ DONE (v1.1.0)
- `pipeline-state.json`, `pipeline.log`, and every append go through a haiku file-writer
  told to write bodies "verbatim" in 12k-char chunks (`writeChunkedFile` `:988-1020`).
- Biggest token cost + most likely source of state corruption (a failed chunk 3/5 leaves
  truncated JSON that resume then parses). If the Workflow host exposes any deterministic
  write/read primitive or a hook, use it; otherwise at least checksum-verify state after
  write (pairs with EN-2).

### IM-2. Persist budget counters across resume — ✅ DONE (v1.1.0)
- `retryState` is explicitly zeroed on resume (`:2171`); `decisionState` starts fresh each
  process. Every `--resume` grants a full new budget, so a pathological loop that
  hard-blocked can be resumed into the same spin indefinitely. Persist `used` counters in
  config; add `--fresh-budget` to opt into resetting.

### IM-3. Prompt-size hygiene — ✅ DONE (v1.1.0)
- Gate prompts interpolate the full (growing) `task` — including folded interview answers —
  plus raw JSON blobs (`carriedBlockers`, blockers, findings) into every downstream prompt.
- Introduce a compact per-gate brief (artifact paths + one-paragraph summaries) as the sole
  cross-gate context; the on-disk artifacts are the real payload.

### IM-4. Make the test gate stack-agnostic — ✅ DONE (v1.1.0)
- `runTests` hardcodes `python -m pytest` (`:1379`) and the pytest-runner agent, but this is
  a general-purpose marketplace plugin. Auto-detect (pytest / npm test / go test /
  cargo test) or accept `--test-cmd`; rename the gate's agent contract accordingly.

### IM-5. Consolidate the flag zoo into profiles — ✅ DONE (v1.1.0)
- Implement mode alone has ~12 `--no-*` flags. Ship presets
  (`--profile=full|standard|light` — light drops the opus review loops, enhancer, and
  quick-decider for small tasks) with individual flags as overrides. Also allows per-profile
  `MODEL_DEFAULTS` tuning.

---

## Features

### FT-1. `/pipeline-status <planDir>` command
- Read `pipeline-state.json` and render: mode, gates done/blocked, stage table, budgets
  used, open questions, and the exact next command (`/implement-feature …` /
  `/tune-feature …`). All data already exists; today users must read raw JSON.

### FT-2. Route code-review blockers through the issues handoff
- Only goalkeeper loop-back defects get classified into `issues-and-improvements.md`; a
  blocker-severity code-review finding just hard-blocks (`:3782-3789`) with no tune path.
- Run `classifyAndRecordIssue` on code-review blockers too, so upstream-rooted review
  findings flow into `/tune-feature` instead of dead-ending.

### FT-3. Selective stage execution
- `--stage=stageNN` (re-run one stage after a manual edit) and `--from-gate=<gate>` (clear a
  gate + downstream flags deterministically — machinery already exists in
  `LOOPBACK_FLAG_MAP`). Today the only rewind is the goalkeeper's, which the user can't
  drive.

### FT-4. Per-gate telemetry in the run report
- Record agent-call count, model, retries, iteration counts per gate into
  `pipeline-state.json`; print a summary table at each terminal gate. Turns "the pipeline is
  slow/expensive" into actionable data for IM-5 profiles.

### FT-5. Optional human design-approval gate
- At the design-stop, offer an AskUserQuestion checkpoint: approve stages as-is, edit stage
  boundaries, or reject back to Plan — mirroring the tune-confirm pattern (`:2306`).
  Records consent in state (useful for `--auto-implement` in `/feature-pipeline`).

---

## Robustness & self-recovery (weak-model guardrails)

Target: the pipeline must survive being driven by less capable models (qwen3, kimi 2.6, …),
not just Claude. Weak-model failure modes to defend against: forced-structured-output
failures, schema-valid-but-semantically-wrong verdicts, hallucinated "file written" claims,
malformed/truncated JSON, enum casing/synonyms, pretend-work executors, non-English output,
and infinite identical-failure retries. Grouped: call hardening → verdict validation →
deterministic guards → recovery policy.

### A. Agent-call hardening

#### DONE RB-1. One hardened call path for ALL agent calls — CRITICAL
- Today three tiers coexist: raw `agent()` (throws escape to the safety net → hard-block),
  `safeAgent` (throw → null, no JSON fallback), `flexibleAgent` (schema fallback +
  plain-text JSON parse). Critical calls still use raw `agent()`: gsd-quick `:2572`,
  gsd-debug `:2718`, tune-confirm `:2306`, git-ops commit `:2912`, `runTests` `:1381`,
  every file-writer/todo-store call. On a weak model, one schema throw in any of these
  kills or blocks the run.
- Fix: make `flexibleAgent` (schema → plain-JSON retry → null) the single entry point for
  every schema-gated call; `safeAgent` becomes a thin alias. Per-call opt-out only where a
  throw is genuinely desired (none today).

#### DONE RB-2. JSON repair layer in `extractJson`
- `:1470-1487` handles fences and first-`{}` only. Weak models also emit: trailing commas,
  single quotes, unescaped newlines in strings, `True/False/None`, truncated objects,
  multiple candidate blocks, prose before/after.
- Fix: add a jsonrepair-style pass (trailing-comma strip, quote normalization, Python-literal
  mapping, best-effort brace balancing for truncation) and try ALL fenced/brace candidates,
  not just the first. Pure function — unit-test heavily (ties into EN-1).

#### DONE RB-3. Enum/field normalization before schema validation
- Weak models return `"Retry"`, `"STOP"`, severity `"Critical"`, gate `"Plan"`,
  `"true"`(string) for booleans. Forced schema rejects all of these outright.
- Fix: a `normalizeVerdict(schema, obj)` pre-pass: lowercase enum candidates, map synonyms
  (`critical→blocker`, `warn→low`), coerce `"true"/"false"/0/1` to booleans, coerce numeric
  strings, wrap bare strings into `{text}` where object items are expected (review gaps
  already handle both — generalize the pattern). Only then validate.

#### DONE RB-4. Model-tier-aware prompt hardening
- Prompts are written for Claude-level instruction following. For weaker tiers, append a
  deterministic "output contract" footer automatically when the gate's resolved model is
  not a known-strong tier: 1-shot literal JSON example matching the schema, field-by-field
  type notes, "no markdown fences, no prose", "respond in English only".
- Fix: `hardenForModel(prompt, schema, model)` helper applied inside the single call path
  (RB-1); keep the example generated from the schema so it never drifts. The existing
  prompt-enhancer stays for *retry* hardening; this is *first-attempt* hardening.

#### DONE RB-5. Per-call timeout / output-size watchdog
- Weak models ramble or loop; a hung/limitless agent call stalls the whole pipeline with no
  budget spent. Add per-agent-call timeout (if the Workflow host exposes one; else instruct
  + cap via harness) and treat timeout exactly like a null verdict (retryable, logged).
  Surface `timeouts` count in the final report.

### B. Verdict validation (schema-valid ≠ true)

#### DONE RB-6. Semantic contradiction guards on every verdict
- Weak models produce internally contradictory verdicts that pass schema:
  `accepted=true` with non-empty blockers; `accepted=false` with zero blockers AND zero
  gaps; `completed=true` with `stepsDone=0` and empty files; `fixed=true` with no changes;
  `decision='retry'` with reasoning that says stop. F5/F7 already fix two instances
  (gaps vs accepted `:1588`, reconcile consistent-vs-conflicts `:3084`) — generalize.
- Fix: per-schema invariant table checked after normalization; on contradiction, ONE
  corrective retry ("your verdict contradicts itself: X vs Y — restate consistently"),
  then fall to the gate's documented default (RB-11).

#### DONE RB-7. Artifact existence verification after every doc-writing gate — CRITICAL
- Define/Requirements/Arch/Design/Plan/Chunker mark their flag done purely because the
  verdict contains a path. Weak models hallucinate "written to <path>" without writing.
  I14 (`:3462-3475`) only checks the path *string* is populated, not the file.
- Fix: deterministic post-gate check (cheap `test -f && wc -c` via a haiku file-reader, or
  host FS primitive per IM-1): file exists AND size > threshold AND (for plan/stages)
  contains expected headings. Missing → one retry with "the file was NOT written — actually
  write it", then hard-block that gate (do NOT fail-forward on a phantom artifact).

#### DONE RB-8. Pretend-work detection on Execute
- Executor returns `completed=true` but wrote nothing. Deterministic check after each
  stage: `git status --porcelain` diff non-empty and intersecting the stage's declared
  files. Empty diff + completed=true → corrective retry, then block the stage. (Complements
  EN-5 which checks the *opposite* — touching files outside the lane.)

#### DONE RB-9. Test-verdict cross-check
- pytest-runner asserts `passed` honestly, but a weak model may report passed=true on a
  red run (or invent a summary). Run the test command's exit code through a deterministic
  channel where possible (Bash gate in the runner agent's allowed-tools; require the exact
  command + exit code echoed in `command`), and reject a `passed=true` verdict whose
  summary contains failure markers (`failed`, `error`, `exit 1`) — corrective retry once.

### C. Deterministic guards

#### DONE RB-10. Resume-state vs filesystem cross-validation
- Hydration (`:2157-2183`) trusts every flag in `pipeline-state.json`. A weak-model run can
  persist poisoned state (designReady=true, plan.md never written; stage done, file absent).
- Fix: on resume, verify flag→artifact pairs (designReady→plan.md + stages files exist;
  requirementsPath→file exists; …). Mismatch → clear the flag, log
  `resume-repair: cleared X (artifact missing)`, and let the idempotent gate re-run.
  Extends EN-2 (schema validation) with ground-truth validation.

#### DONE RB-11. Centralized per-gate fallback ladder (GATE_FALLBACKS table)
- Safe defaults exist but are scattered and ad hoc: reviews fail-forward, quick-decider
  null→stop `:1740`, goalkeeper null→commit `:1792`, executors block. Document + encode
  ONE table: for each gate, `schema-fail → plain-JSON → normalized → default verdict` and
  whether the default is fail-forward, conservative-stop, or hard-block. Makes degradation
  auditable and prevents a future gate from silently inventing a dangerous default
  (e.g. force-accept on a null escalation — already guarded `:3359`, keep it that way).

#### DONE RB-12. Identical-failure circuit breaker
- Budgets bound *count*, not *futility*: a deterministic failure (missing dep, syntax error
  in an unowned file) reproduces byte-identical N times while the loop burns budget and
  quick-decider (itself an LLM, itself fallible) keeps saying retry.
- Fix: hash the failure signature (test summary / reviewer blockers / thrown message) per
  loop; identical signature K times in a row (K=2–3) → deterministic stop overriding the
  quick-decider, log `circuit-breaker: identical failure xK`. Cheap, pure, testable.

#### DONE RB-13. Output-language guard
- The translator gate normalizes *input* only. Weak models sometimes emit non-English
  verdict summaries/docs, which then poison downstream prompts and docs.
- Fix: run `detectNonEnglish` on verdict text fields and written-artifact spot-checks;
  non-English → one corrective retry ("respond in English"). Also add "English only" to the
  RB-4 output contract.

### D. Recovery policy

#### DONE RB-14. Model-escalation ladder on repeated gate failure
- Before hard-blocking a gate after schema/verdict retries, retry ONCE with the next model
  tier up (haiku→sonnet→opus) for that single call. A weak default tier (e.g. categorizer
  haiku, executor sonnet) shouldn't doom the run when a stronger tier would pass. Bound by
  a per-run escalation budget; record escalations in the final report.

#### DONE RB-15. Degradation telemetry + honest final report
- Every fallback taken (plain-JSON parse, normalization, corrective retry, fail-forward,
  circuit-break, model escalation, timeout) increments a `result.degradations[]` entry.
  Surface the list at every terminal gate and in `/pipeline-status` (FT-1) so users of weak
  models can SEE how much of the run rode on fallbacks — and judge whether to trust it.
  A run with 0 degradations on qwen3 and one with 14 look identical today.

---

## Unresolved questions

- Q1: Does the Workflow host offer any deterministic FS primitive (IM-1), or are LLM
  file-writers the only option?
- Q2: Is the E4 design-gate rewind (BF-5) intentionally kept for a future single-command
  mode, or safe to delete?
- Q3: Subagent access to AskUserQuestion is assumed by user-interviewer/tune-confirm but
  explicitly denied in the requirements-collector prompt (`:2766`) — which is true in the
  actual harness?
- Q4: Does the target weak-model harness support forced structured output (tool-use JSON) at
  all, or is plain-text JSON the only reliable channel? Decides whether RB-1 keeps the
  schema-first path or inverts (plain-JSON-first for weak tiers).
- Q5: Does the Workflow host expose per-agent-call timeouts (RB-5)? If not, the watchdog has
  to live in the harness/hook layer.
