# feature-pipeline

**Description:** Gate-enforcing pipeline for new features / bug-fixes. ONE engine, THREE
modes (`args.mode`): `design` (THINK), `implement` (DO), `tune` (FIX). Encodes the CLAUDE.md
agent rules as a deterministic sequence of gates. Three thin slash commands drive it:

```
/design-feature  <task>     ... mode:design   -> THINK docs + plan + stageNN.md, stop pre-execute
/implement-feature <planDir>           mode:implement -> DO: execute stages -> test -> review -> commit
/tune-feature    <planDir>             mode:tune     -> FIX: consume issues -> refine gates -> re-enable designReady
/feature-pipeline <task>               convenience alias -> design (stop); --auto-implement chains
```

The full gate sequence (modes select a subset via `mode`):

```
[design gates — skipped in implement/tune]
feature-categorizer(fresh, no --plan) -> prompt-translator(non-English only)
  -> task-definition-architect [+user-interviewer] -> project-knowledge-consultant
  -> code-explorer(codebase-facts) -> e2e-usecase-extractor -> requirements-collector
  -> arch-design-orchestrator [+review-loop] -> detailed-design-architect [+review-loop]
  -> [requirements review-loop] -> plan-architect -> tdd-plan-enforcer
  -> design-plan-reconciler (+design-fix loop) -> [plan review-loop, prompt-enhancer at retries]
  -> plan-chunker(stageNN.md)                     *** sets designReady=true, STOPS in design ***
[implement gates — skipped in design/tune]
  -> plan-executor(per stage) -> pytest-runner -> critical-reviewer(code)
  -> complex-decision-analyst(goalkeeper: commit | issues-handoff) -> docs-architecture-publisher
  -> knowledge-persist -> [git-ops]
[tune gates — own branch, runs first in tune mode]
  -> read issues-and-improvements.md -> tunePlanner(minimal gate-revisit plan, AskUserQuestion confirm)
  -> revisit ONLY mapped gates in refine mode -> re-reconcile -> invalidate file-intersecting stages
  -> set designReady=true, STOP
```


> Phase C reordering: e2e-usecase-extractor now runs BEFORE architecture (scenarios inform the
> design), and a requirements-collector gate feeds both architecture + detailed-design. Four
> review loops (critical-reviewer + design-reviser) gate Requirements, Architecture, Detailed
> Design, and Plan. Each verdict is appended to `<planDir>/review-history.md`.

`feature-categorizer` runs first (Gate -2) ONLY on a fresh run WITHOUT an explicit `--plan`: it
classifies the task into `{category, subCategory}` and derives the dynamic planDir
`docs/{cat}/{sub}/feature/{leaf}/` where `{leaf}` is a JIRA id parsed from the task text, else
`--timestamp`, else the task slug. An explicit `--plan` skips this gate; `--resume` reuses the
persisted planPath verbatim (the categorizer is never re-run — its output is non-deterministic).

`prompt-translator` runs next (Gate -1) ONLY if the task input contains non-English text: it
translates the task to English and writes `<planDir>/translation.md`, so every downstream agent
prompt and the persisted idea doc are English. English input skips this gate.

`task-definition-architect` runs next (Gate 0): it turns the raw task sketch into a rigorous
definition written to `<planDir>/idea.md` (NFRs, objective pass gates, TDD scenarios). If a
critical ambiguity would fork the whole approach, it sets `needsClarification=true`; the pipeline
then invokes `user-interviewer`
to resolve the open questions interactively and continues, stopping only if they can't be resolved.
The definition becomes the input contract for the knowledge, architecture, detailed-design, e2e,
and plan gates.

Each gate returns a structured verdict; verdicts are themselves the gates (a verdict is a pass iff
its required fields are truthily populated). The pipeline hard-fails (returns the blocker) if any
gate cannot pass; it does NOT silently skip steps.

## What's new

- **Decision agents + state machine (Phase E).** Loops stop being blind-cap:
  - **quick-decider** rides every loop boundary (plan-refine, escalation schema-recovery,
    reconcile design-fix, gsd-debug, and all four reviewLoops: Requirements/Arch/Design/Plan).
    Firing only from the 2nd iteration onward (a clean one-shot accept never pays the tax), it
    asks whether another cycle is worth the global retry budget: `retry` continues, `stop` bails
    to the loop's fail-forward/escalate/block path, **null → stop (conservative)**. Existing
    soft sub-caps become advisory; the hard `decisionCap` (default 50) is the runaway floor.
  - **complex-decision-analyst goalkeeper** (Gate 5.1) re-judges the finished work after code
    review: `commit` proceeds; `loop-back` + `targetPhase` (requirements | architecture | design
    | plan | tests) rewinds to that phase and re-runs every downstream gate. The full-path body is
    now a **state machine** (`do/while` driven by `result._loopBack`); gates are idempotent so a
    loop-back only clears that gate's completion marker + downstream markers, then replays.
    Bounded by `maxPasses=3` + the hard `decisionCap`. null → conservative `commit`.
  - Decision verdicts (quick-decider + goalkeeper) are appended to `<planDir>/decisions.md` for
    audit/resume evidence. New fields: `_goalkeeper`, `decisionsPath`, `_loopBack`, `decisionUsed`.
  - New flags: `--no-goalkeeper` (skip Gate 5.1), `--no-quick-decider` (keep blind-cap loops),
    `--decision-cap=N` (runaway floor, default 50).
- **prompt-enhancer at retries + code-explorer facts (Phase D).** Two more agents wired:
  - Gate 0.2 **Codebase Facts** — `code-explorer` gathers structured facts (relevant files, existing
    patterns to mirror, call sites, gotchas) into `<planDir>/codebase-facts.md`, fed (by reference) into
    the Requirements + Architecture prompts so they consume real structure, not inferred guesses.
    Non-blocking. Full path only (skipped on gsd-quick).
  - **prompt-enhancer at retry sites** — the refine retry, escalation retry, debug retry, reconcile
    design-fix retry, and every reviewLoop revision call the `prompt-enhancer` agent to harden the
    retry prompt (tighten-format after JSON malformation, improve-design after repeated review reject).
    Hardened prompts are cached per gateKey in `result._enhancedPrompts` and persisted to
    `<planDir>/enhanced-prompts.md`. Non-blocking: enhancer failure leaves the base prompt unchanged.
  - New flags: `--no-explorer` (skip codebase-facts gate), `--no-enhancer` (skip prompt hardening).
- **Knowledge, e2e, reconcile, publish, interview agents adopted (R6/R7).** Five more mandated
  CLAUDE.md agents are wired as gates (full path; default-ON, gsd-quick-skipped, disable flags):
  - Gate 0 **User-Interviewer** — when Define flags `needsClarification`, `user-interviewer`
    resolves open questions interactively (AskUserQuestion) and folds the answers into the task,
    continuing instead of stopping. Surface-and-stop is now the fallback (`--no-interview`).
  - Gate 0.1 **Knowledge Consult** — `project-knowledge-consultant` surfaces conventions, prior
    decisions, and gotchas as a brief that feeds the architecture prompt. Non-blocking.
  - Gate 0.7 **E2E Use Cases** — `e2e-usecase-extractor` defines end-to-end use cases / test
    scenarios from the design, feeding the plan + TDD gates. Writes `e2e-use-cases.md`.
  - Gate 1.7 **Reconcile + design-fix loop-back** — `design-plan-reconciler` compares the plan
    against the arch/design/e2e artifacts. If it judges the **design** (not the plan) as the source
    of conflict (`designAtFault=true`), the pipeline re-runs `arch-design-orchestrator` to fix the
    architecture in place and re-reconciles, bounded by the shared retry budget. Conflicts always
    flow forward to review + persist; reconcile never hard-blocks.
  - Gate 5.4 **Publish** — `docs-architecture-publisher` publishes the plan + design into project
    docs. Non-blocking.
  - Gate 5.5 **Persist** extended — `knowledge-persist` now also ingests reconcile conflicts and
    published paths.
- **Pipeline run log (`<planDir>/pipeline.log`).** R5 adds an in-memory log of every gate
  event (what's running + the agent verdict results — paths written, blockers, iterations,
  test summaries, commit hash) and flushes it via a file-writer agent to `pipeline.log` next
  to the plan at each durable boundary (success + each hard-block exit). Workflow scripts
  can't touch the filesystem directly, so the flush rides on the same boundaries as the
  consolidated todo-store write. Non-blocking: a flush failure never gates the pipeline.
- **Four mandated design/TDD/persist agents adopted as gates (full path only).** The project
  CLAUDE.md mandates `arch-design-orchestrator`, `detailed-design-architect`, `tdd-plan-enforcer`,
  and `knowledge-persist`; R4 wires them in as explicit gates:
  - Gate 0.5 **Architecture** — `arch-design-orchestrator` consumes the definition + NFRs, writes
    `architecture.md` next to the plan.
  - Gate 0.6 **Detailed Design** — `detailed-design-architect` consumes the arch design, writes
    `detailed-design.md`; both feed the plan-architect prompt.
  - Gate 1.5 **TDD Enforce** — `tdd-plan-enforcer` hardens the plan **in place** (TDD gates, RED
    test list, GREEN exit criteria, YAGNI warnings) before the review loop.
  - Gate 5.5 **Persist** — `knowledge-persist` captures findings (carried blockers, code-review
    findings, debug gotchas, YAGNI warnings) into CLAUDE.md + Serena mem. **Non-blocking**: on
    failure it logs and sets `persist.persisted=false`, never sets `blockedAt`.
  All four are default-ON for the full path, skipped on the gsd-quick fast-path, with disable flags
  (`useArchDesign` / `useDetailedDesign` / `useTddEnforce` / `useKnowledgePersist`). knowledge-persist
  + the consolidated write also run on blocked exits.
- **Plan-driven parallel lanes.** plan-architect now emits `lanes[]` (file-disjoint work groups).
  The pipeline computes the union of per-lane `files`; if every file belongs to exactly one lane
  (disjoint) AND `allowParallelExecute` AND ≥2 lanes, it fans out with `parallel()` — one
  `plan-executor` per lane, each returning its own `EXECUTE_VERDICT`. Disjoint files in a single
  worktree need no git merge. If lanes overlap a file or there is only one lane, it falls back to a
  single executor (logged). Force-accepted blockers are routed to the lane(s) whose files intersect.
- **Verdicts-as-gates + consolidated todo-store memory.** Each gate already enforced a schema via
  `agent(..., {schema})`; R4 formalizes the **truthfulness gate** (pass iff the returned object is
  non-null AND its required fields are truthily populated) and adds self-summarizing `notes` +
  `evidence` fields to the review/execute/debug/escalation verdicts (no separate summarizer call).
  Per-gate `checkpoint()` calls are replaced by **ONE** `consolidate(slug, result)` write that
  persists the full result object (task, paths, every verdict, carried blockers, blockedAt,
  retryUsed) to `.planning/todos/<slug>.md`. It fires once on success and once per hard-block exit;
  prior context is passed in-prompt from the in-memory `result` instead of being re-read.
- **gsd-quick fast-path.** Set `gsdQuick: true` (or let the define gate recommend it for genuinely
  simple tasks). The task is implemented via the `gsd-quick` skill as an alternate executor — our own
  Plan / Review / Execute gates are skipped, but **Test (Gate 4) and Code Review (Gate 5) still run**
  so our flow stays authoritative.
- **gsd-debug recovery.** On Gate 4 (Test) failure the pipeline no longer hard-blocks immediately.
  It invokes the `gsd-debug` skill to diagnose + fix the code (tests are never weakened), then re-runs
  the tests up to `maxDebugRetries`. It blocks only if debug cannot reach green. Disable with
  `useGsdDebug: false`.
- **Per-gate model tiers.** Every gate runs on a configurable model tier (alias). Deep-analysis gates
  default to `opus`; mechanical gates to `sonnet`/`haiku`. Override any gate via `args.models` — see
  the table below.
- **Global retry budget (no premature exit).** Loops draw from a single shared `retryBudget`
  (default **20**). The pipeline only exits on a true hard error (no artifact produced,
  `needsClarification`) or when retries exceed the budget — never because a review loop hit a soft
  cap mid-task. Per-loop soft sub-caps (`maxRefineIterations` default 10, `maxDebugRetries` default
  20) stop one loop monopolizing the budget.
- **Reviewer convergence gate (no terminal review).** Gate 2 can no longer kill the task. When the
  refine loop exhausts its soft sub-cap without acceptance, a final escalation reviewer reclassifies
  remaining blockers (true plan defect vs implementation-detail), the plan is force-accepted, and the
  carried blockers are written to todo-store so the executor + code-reviewer re-check them. Plan
  reviewer scope is tuned: it blocks only on missing scope/spec/ordering/risk, not on un-enumerated
  call-site wiring.

## When to use

- Implementing a new feature that warrants a plan first.
- Fixing a non-trivial bug where you want the plan reviewed before code.
- Any change where you want the full plan -> review/refine -> execute -> test -> review -> commit gate sequence enforced automatically.

Do NOT use for: trivial single-line edits, pure exploration, or anything that
does not need a plan (use a direct agent instead).

## Inputs (`args`)

Pass these via the Workflow `args` parameter (as a real JSON object):

```jsonc
{
  "mode": "design",                                                 // optional: design|implement|tune (default design; --resume hydrates persisted mode)
  "task": "Fix the token expiry check in auth middleware (uses < instead of <=)",
  "planPath": ".planning/user-plans/fix-token-expiry/plan.md",   // optional: where plan is written/read
  "definitionPath": ".planning/user-plans/fix-token-expiry/idea.md", // optional: where the idea doc is written (default: plan dir /idea.md)
  "maxRefineIterations": 10,                                       // optional: SOFT per-loop cap on plan refine iterations (default 10; global budget is the real stop)
  "autoCommit": false,                                             // optional: if true, commit via git-ops when green (default false)
  "testTarget": "tests/test_auth.py",                             // optional: pytest target (default: whole suite)
  "gsdQuick": false,                                               // optional: force the gsd-quick fast-path (default false; define gate may also recommend it)
  "useGsdDebug": true,                                             // optional: gsd-debug recovery on test failure (default true)
  "maxDebugRetries": 20,                                           // optional: SOFT per-loop cap on gsd-debug fix+retest attempts (default 20)
  "maxReconcileIterations": 5,                                    // optional: SOFT per-loop cap on the Gate 1.7 design-fix loop (default 5)
  "retryBudget": 20,                                               // optional: SINGLE GLOBAL retry budget across refine+debug loops (default 20). The only loop "stop" condition.
  "useArchDesign": true,                                           // optional: Gate 0.5 arch-design-orchestrator (default true; full path only)
  "useDetailedDesign": true,                                       // optional: Gate 0.6 detailed-design-architect (default true; full path only)
  "useTddEnforce": true,                                           // optional: Gate 1.5 tdd-plan-enforcer (default true; full path only)
  "useKnowledgePersist": true,                                     // optional: Gate 5.5 knowledge-persist (default true; runs on success AND blocked exits)
  "useE2eUsecase": true,                                           // optional: Gate 0.7 e2e-usecase-extractor (default true; full path only)
  "useKnowledgeConsult": true,                                     // optional: Gate 0.1 project-knowledge-consultant (default true; full path only)
  "useReconcile": true,                                            // optional: Gate 1.7 design-plan-reconciler (default true; full path only)
  "usePublish": true,                                              // optional: Gate 5.4 docs-architecture-publisher (default true)
  "useInterview": true,                                            // optional: user-interviewer to resolve Define clarifications inline (default true)
  "allowParallelExecute": true                                     // optional: fan out file-disjoint plan lanes in parallel (default true)
  "useTranslator": true                                          // optional: Gate -1 prompt-translator for non-English task input (default true)
  "useCategorizer": true,                                       // optional: Gate -2 feature-categorizer for dynamic planDir (default true; fresh run, no --plan)
  "useRequirements": true,                                      // optional: Gate 0.75 requirements-collector + requirements review loop (default true; full path only)
  "useExplorer": true,                                          // optional: Gate 0.2 code-explorer codebase-facts (default true; full path only)
  "useEnhancer": true,                                          // optional: prompt-enhancer at retry sites (default true)
  "useGoalkeeper": true,                                        // optional: Gate 5.1 complex-decision-analyst commit goalkeeper (default true; full path only)
  "useQuickDecider": true,                                      // optional: quick-decider at loop boundaries (default true; turns blind-cap loops into judgment-cap loops)
  "decisionCap": 50,                                            // optional: hard runaway floor for decision-agent calls (quick-decider + goalkeeper). Default 50. Hit -> hard-block (resumable via --resume)
  "timestamp": "202606261430",                                  // optional: planDir leaf when no JIRA id in task (default: slug leaf)
  "useChunker": true,                                            // optional: plan-chunker -> stageNN.md after plan-architect (default true, design mode)
  "useIssues": true,                                             // optional: write issues-and-improvements.md on upstream-defect handoff (default true, implement mode)
  "useTuneConfirm": true,                                        // optional: AskUserQuestion confirm of derived gate-revisit plan (default true, tune mode)
  "resume": "",                                                  // optional: <planDir> to hydrate pipeline-state.json and re-run from first incomplete gate
  "models": {                                                      // optional: per-gate model tier overrides (aliases: haiku|sonnet|opus|fable)
    "plan": "sonnet",
    "execute": "opus"
  }
}
```

- `task` (required): the feature/bug-fix description handed to plan-architect.
- `mode` (optional, default `design`): selects the gate range. `design` = THINK gates only, stops
  pre-execute at `designReady`; `implement` = DO gates (asserts `designReady` from a prior design
  run); `tune` = FIX branch (consumes `issues-and-improvements.md`, revisits only mapped gates in
  refine mode, re-sets `designReady`). On `--resume` the persisted `mode` hydrates if `mode` is absent.
- `resume` (optional): a `<planDir>` (or bare `plan.md` path) to hydrate `<planDir>/pipeline-state.json`
  and re-run from the first incomplete gate. Path-only — the categorizer is never re-run on resume; the
  persisted `planPath` is reused verbatim. Works for all three modes.
- `useChunker` (optional, default `true`, **design mode**): after Gate 2 acceptance, call `plan-chunker`
  to split `plan.md` into dependency-ordered `stageNN.md` files under the plan dir. Stages become the
  implement progress unit (each ticked `pending→in-progress→done`). `--no-chunker` collapses to a single
  implicit `stage01` covering the whole plan (preserves the legacy single-executor path). Runs ONCE in
  design; never re-run on resume (stages persisted in state).
- `useIssues` (optional, default `true`, **implement mode**): on an upstream-defect goalkeeper verdict
  (finding points at plan/arch/design/requirements), write `<planDir>/issues-and-improvements.md` and
  stop (`blockedAt='issues-handoff'`) for `/tune-feature`. `--no-issues` degrades to a plain block.
- `useTuneConfirm` (optional, default `true`, **tune mode**): confirm the agent-derived gate-revisit plan
  via AskUserQuestion before running it. `--no-confirm` runs the derived plan directly (CI/batch).
- `planPath` (optional): an explicit plan path. If set it is used verbatim and the
  dynamic planDir (Gate -2) is skipped — if a plan already exists there it is refined instead of
  written from scratch. Absent on a fresh run → `feature-categorizer` derives
  `docs/{cat}/{sub}/feature/{leaf}/plan.md`. **Ignored on `--resume`** (the resume path supplies the
  planDir; the persisted `planPath` is reused verbatim).
  `docs/{cat}/{sub}/feature/{leaf}/plan.md`.
- `autoCommit` (optional, default `false`): committing is irreversible/outward,
  so the workflow defaults to returning a "ready" state and lets the user
  commit. Set `true` to have git-ops commit when all gates pass.
- `gsdQuick` (optional, default `false`): force the fast-path. The define gate's
  `recommendedPath` may also select it automatically for simple tasks.
- `useGsdDebug` (optional, default `true`): enable/disable gsd-debug recovery.
- `retryBudget` (optional, default `20`): the SINGLE GLOBAL retry budget shared
  across the refine loop and the debug loop. This is the only "stop" condition
  for loops — the pipeline will not exit because a loop exhausted its own
  sub-cap; it only exits when this budget is exceeded or on a true hard error.
- `maxRefineIterations` / `maxDebugRetries` / `maxReconcileIterations` (optional, default `10` / `20` / `5`):
  SOFT per-loop sub-caps so one loop can't monopolize the whole global budget.
  When a loop hits its sub-cap without succeeding it escalates/force-accepts
  (refine) or blocks (debug) instead of killing the task, and other loops can
  still draw on remaining budget.
- `useArchDesign` (optional, default `true`): enable Gate 0.5 (architecture design). Full path only.
- `useDetailedDesign` (optional, default `true`): enable Gate 0.6 (detailed design). Full path only.
- `useTddEnforce` (optional, default `true`): enable Gate 1.5 (TDD/YAGNI hardening of the plan). Full path only.
- `useKnowledgePersist` (optional, default `true`): enable Gate 5.5 (knowledge-persist). Runs on
  success AND on blocked exits; never blocks itself.
- `useKnowledgeConsult` (optional, default `true`): enable Gate 0.1 (project knowledge brief that
  feeds the architecture). Non-blocking. Full path only.
- `useE2eUsecase` (optional, default `true`): enable Gate 0.7 (e2e use-case extraction). Full path only.
- `useReconcile` (optional, default `true`): enable Gate 1.7 (design-vs-plan reconciliation + the
  design-fix loop-back when the design is at fault). Non-blocking. Full path only.
- `usePublish` (optional, default `true`): enable Gate 5.4 (publish plan + design to project docs).
  Non-blocking.
- `useInterview` (optional, default `true`): when Define flags `needsClarification`, run
  `user-interviewer` to resolve open questions inline and continue. Disable to always stop and surface.
- `allowParallelExecute` (optional, default `true`): allow plan-driven lanes to execute in parallel
  when file-disjoint. Falls back to a single executor on overlap or single-lane plans.
- `useTranslator` (optional, default `true`): enable Gate -1 (prompt-translator). Detects non-English
  task input via non-ASCII letter ratio (>0.15), translates to English, and writes
  `<planDir>/translation.md`. English input skips the gate. Disable with `--no-translator`.
- `useCategorizer` (optional, default `true`): enable Gate -2 (feature-categorizer → dynamic planDir).
  Fresh runs without an explicit `--plan` are classified into `docs/{cat}/{sub}/feature/{leaf}/`.
  Disable with `--no-categorizer` (falls back to `docs/uncategorized/feature/<leaf>/`). Never runs on
  resume.
- `useRequirements` (optional, default `true`): enable Gate 0.75 (requirements-collector + requirements
  review loop). Writes `<planDir>/requirements.md` consumed by the arch/design prompts. Full path only.
- `useExplorer` (optional, default `true`): enable Gate 0.2 (code-explorer codebase-facts). Writes
  `<planDir>/codebase-facts.md`, fed by reference into the Requirements + Architecture prompts.
  Non-blocking. Full path only. Disable with `--no-explorer`.
- `useEnhancer` (optional, default `true`): enable prompt-enhancer at retry sites (refine, escalation,
  reconcile design-fix, debug, and every reviewLoop revision). Hardened prompts cache in
  `result._enhancedPrompts` and persist to `<planDir>/enhanced-prompts.md`. Non-blocking. Disable with
  `--no-enhancer`.
- `useGoalkeeper` (optional, default `true`): enable Gate 5.1 (complex-decision-analyst commit
  goalkeeper), **redefined for the split engine**. `commit` proceeds to publish/persist/git-commit. A
  `loop-back` verdict is NO LONGER a rewind (the Phase-E loop-back state machine was removed): each
  `trueDefect` is classified via `issueClassifier`; if it points at a design gate
  (`requirements`/`architecture`/`design`/`plan`) → append to `<planDir>/issues-and-improvements.md` and
  stop at `blockedAt='issues-handoff'` (run `/tune-feature`). A `tests`-target defect stays on the code
  path (debug loop / hard-block). Bounded by `decisionCap`. null → conservative `commit`. Disable with
  `--no-goalkeeper`.
- `useQuickDecider` (optional, default `true`): enable quick-decider at loop boundaries (plan-refine,
  escalation, reconcile design-fix, gsd-debug, all four reviewLoops). Firing only from the 2nd
  iteration onward, `retry`/`stop` drives continue/break; null → `stop` (conservative). Turns
  blind-cap loops into judgment-cap loops without dropping the hard `decisionCap` floor. Disable with
  `--no-quick-decider`.
- `decisionCap` (optional, default `50`): the HARD runaway floor for decision-agent calls
  (quick-decider + goalkeeper). Unlike `retryBudget` (the loop "stop"), `decisionCap` is pure runaway
  protection: hitting it hard-blocks at `blockedAt='goalkeeper'` (resumable via `--resume`) rather
  than spinning. Per-loop soft sub-caps stay advisory.
- `timestamp` (optional): the planDir leaf when the task names no JIRA id. Format `YYYYmmddHH24MI`
  (e.g. `202606261430`). Absent → the task slug leaf. Sandbox-safe (no `Date.now()`).
- `jira` (implicit): a JIRA id matching `[A-Z][A-Z0-9_]+-\d+` anywhere in the task text is used as
  the planDir leaf automatically; no flag needed.
- `definitionPath` (optional): the idea doc (Gate 0). Default is `<planDir>/idea.md`. The filename
  was renamed from `task-definition.md`; the `definitionPath` *field name* is unchanged (resume
  contract stability).
- `models` (optional): per-gate model-tier overrides. Keys map to gates; values are tier aliases
  (`haiku` / `sonnet` / `opus` / `fable`). Unspecified gates fall back to defaults below.

### Per-gate model tiers

| Key         | Gate / agent                          | Default |
|-------------|---------------------------------------|---------|
| `define`    | task-definition-architect             | opus    |
| `categorizer`| feature-categorizer (Gate -2)        | haiku   |
| `explorer`| code-explorer (Gate 0.2)                | sonnet  |
| `enhancer`| prompt-enhancer (retry sites)           | sonnet  |
| `requirements`| requirements-collector (Gate 0.75) | opus    |
| `reviewDesign`| critical-reviewer (req/arch/design)| opus   |
| `revise`    | design-reviser (review loops)        | opus    |
| `translator`| prompt-translator (Gate -1)           | sonnet  |
| `interview` | user-interviewer (Define clarify)     | sonnet  |
| `knowledgeConsult`| project-knowledge-consultant (Gate 0.1)| sonnet|
| `archDesign`| arch-design-orchestrator (Gate 0.5)   | opus    |
| `detailedDesign`| detailed-design-architect (Gate 0.6)| opus  |
| `e2eUsecase`| e2e-usecase-extractor (Gate 0.7)      | opus    |
| `plan`      | plan-architect                        | opus    |
| `tddEnforce`| tdd-plan-enforcer (Gate 1.5)          | opus    |
| `reconcile` | design-plan-reconciler (Gate 1.7)     | opus    |
| `review`    | critical-reviewer (plan)              | opus    |
| `refine`    | plan-refiner                          | opus    |
| `execute`   | plan-executor (per lane)              | sonnet  |
| `gsdQuick`  | gsd-quick skill                       | sonnet  |
| `gsdDebug`  | gsd-debug root-cause                  | opus    |
| `test`      | pytest-runner                         | sonnet  |
| `codeReview`| critical-reviewer (code)              | opus    |
| `quickDecider`| quick-decider (Phase E2 loop boundaries)| opus |
| `decisionAnalyst`| complex-decision-analyst (Gate 5.1 goalkeeper)| opus |
| `publish`   | docs-architecture-publisher (Gate 5.4)| sonnet  |
| `persist`   | knowledge-persist (Gate 5.5)          | sonnet  |
| `commit`    | git-ops                               | sonnet  |
| `todo`      | todo-store write (consolidate)        | haiku   |

Override example: `models: { plan: 'sonnet', review: 'sonnet' }` downgrades the planning gates.

## Outputs

The workflow returns a JSON summary object:

```jsonc
{
  "task": "...",
  "mode": "design",              // design|implement|tune — the gate range that ran
  "planPath": "...",
  "planDir": "...",              // dynamic docs/{cat}/{sub}/feature/{leaf}/ dir (Phase B1); print for --resume
  "_categorization": null,       // Gate -2 feature-categorizer result; null if --plan/uncategorized
  "definitionPath": "...",       // idea doc (Gate 0) — <planDir>/idea.md
  "_translator": null,           // Gate -1 prompt-translator result; {translated:false,...} if English
  "translatePath": null,         // <planDir>/translation.md path; null unless translation applied
  "factsPath": "...",            // codebase-facts doc (Gate 0.2), null if skipped
  "_facts": null,                // code-explorer verdict (Gate 0.2)
  "_enhancedPrompts": null,      // lazy map gateKey -> hardened prompt (Phase D1); null unless a retry fired
  "enhancedPromptsPath": null,   // <planDir>/enhanced-prompts.md path; null unless a retry hardened a prompt
  "requirementsPath": "...",     // requirements doc (Gate 0.75), null if skipped
  "_requirements": null,         // requirements-collector verdict
  "_reviewedRequirements": false,// true if Requirements review loop ran
  "_reviewedArch": false,        // true if Architecture review loop ran
  "_reviewedDesign": false,      // true if Detailed-Design review loop ran
  "archPath": "...",             // architecture doc (Gate 0.5), null if skipped
  "designPath": "...",           // detailed design doc (Gate 0.6), null if skipped
  "useCasePath": "...",          // e2e use cases doc (Gate 0.7), null if skipped
  "needsClarification": false,   // true => pipeline stopped to ask the user
  "interview": {...},            // user-interviewer result (Gate 0 clarify); null if not run
  "planAccepted": true,
  "tddEnforced": true,           // true if Gate 1.5 hardened the plan (full path)
  "yagniWarnings": [],           // YAGNI warnings surfaced by tdd-plan-enforcer
  "reconcile": { "consistent": true, "conflicts": [...], "designAtFault": false }, // Gate 1.7
  "lanes": [...],               // plan-emitted file-disjoint work groups
  "lanesUsed": 0,               // 0 = single executor (overlap/single-lane); >1 = parallel lanes
  "forceAccepted": false,        // true if Gate 2 exhausted its soft sub-cap and was escalated/force-accepted
  "carriedBlockers": [],         // blockers carried forward from a force-accept, re-checked at Gate 5 (code review)
  "refineIterations": 2,
  "retryUsed": 2,                // total spent from the shared global retry budget (refine + debug)
  "executed": true,
  "gsdQuick": false,             // true if the gsd-quick fast-path was taken
  "debugRetries": 0,             // number of gsd-debug fix+retest attempts
  "testsPassed": true,
  "testSummary": "12 passed",
  "codeReview": { "blockers": [], "issues": 1, "summary": "..." },
  "_goalkeeper": { "decision": "commit", "targetPhase": "none", "reasoning": "...", "trueDefects": [] }, // Gate 5.1; null if skipped/conservative. loop-back now -> classify + issues-handoff (no rewind)
  "issuesPath": null,            // <planDir>/issues-and-improvements.md; set on implement upstream-defect handoff, consumed by tune
  "designReady": false,          // design mode sets true on exit; implement asserts true; tune re-sets true after refine
  "stages": [],                  // plan-chunker output: [{id,file,name,status,files}]; progress unit in implement. [] if --no-chunker/not run
  "tunePlan": null,              // tune mode: derived gate-revisit plan ({planGates, issueRefs, preserveStages}); persisted so resume reuses it
  "tuneConfirmed": false,        // tune mode: true after AskUserQuestion confirm (or --no-confirm); persisted so resume won't re-prompt
  "handoff": null,               // {from, nextMode, message, ...}; cross-mode pointer (design->implement, implement->tune, tune->implement)
  "decisionsPath": "...",        // <planDir>/decisions.md — audit log of quick-decider + goalkeeper verdicts; null if no decision fired
  "decisionUsed": 0,             // spent from the hard decisionCap (quick-decider + goalkeeper)
  "published": { "published": true, "paths": [...], "summary": "..." }, // Gate 5.4; null if skipped, {published:false} on failure
  "persist": { "persisted": true, "paths": [...], "summary": "..." }, // Gate 5.5; {persisted:false} on failure (non-blocking)
  "logLines": [...],            // R5: in-memory pipeline log, flushed to <planDir>/pipeline.log at each consolidate point
  "ready": true,                 // true iff planAccepted && testsPassed && no blockers
  "committed": false,
  "commitHash": null,
  "blockedAt": null              // name of the gate that failed, or null
}
```

If a gate fails, `blockedAt` names it and `ready` is `false`; nothing after the
failing gate runs. `blockedAt` values: design gates (`define`/`requirements`/`architecture`/
`detailed-design`/`e2e-usecases`/`plan`/`tdd-enforce`/`review`), implement gates (`execute`/`test`/
`code-review`/`goalkeeper`), tune-specific (`tune-no-issues`/`tune-cancelled`), or `issues-handoff`
(implement upstream-defect path), or `uncaught-throw` (safety net, `--resume`-able).

## Modes

ONE engine, selected by `args.mode`. Each mode runs a subset of the gate sequence; `<planDir>/
pipeline-state.json` is the shared contract across the three invocations.

| field | design sets | implement reads/sets | tune reads/sets |
|---|---|---|---|
| `mode` | `design` | `implement` | `tune` |
| `designReady` | `true` (exit) | asserts `true` (else block `design-not-ready`) | sets `true` (exit) |
| `stages[]` | populated (chunker) | ticks `status` per stage | resets only file-intersecting stages |
| `planPath`/`planDir` | derived (categorizer) | reused verbatim | reused verbatim |
| `issuesPath` | — | set on handoff | consumed |
| `tunePlan` | — | — | set |
| `handoff` | `{from:'design', nextMode:'implement', message}` | `{from:'implement', nextMode:'tune'}` on handoff | `{from:'tune', nextMode:'implement', revisitedGates, stagesReset}` |

### `design` — `/design-feature` (THINK, stops pre-execute)
Runs Gates -2 → 2 (define → requirements → arch → design → plan → tdd → reconcile → review/refine),
then `plan-chunker` → `stageNN.md`. Sets `designReady=true`, calls `consolidate`, **returns — NO code
executes.** `handoff.message` instructs `/implement-feature <planDir>`. The gsd-quick fast-path
and all implement/tune gates are skipped (gsd-quick belongs to implement).

### `implement` — `/implement-feature <planDir>` (DO; positional planDir required)
Hydrates state, **asserts `designReady`** (else `blockedAt='design-not-ready'`). Runs stages sequentially
(execute per stage, lane-scoped to `stage.files`, tick `pending→in-progress→done`), then Gate 4 (Test/
Debug), Gate 5 (Code Review), Gate 5.1 (Goalkeeper). Goalkeeper `commit` → publish/persist/git-commit
(`--auto-commit`). Upstream-defect `loop-back` → `issueClassifier` → append `<planDir>/issues-and-improvements.md`
→ `blockedAt='issues-handoff'` → stop for `/tune-feature`. Design gates are NOT re-run.

### `tune` — `/tune-feature <planDir>` (FIX; positional planDir required)
Runs its own branch first (before the translator gate). Reads `issues-and-improvements.md` → `tunePlanner`
agent derives `tunePlan` (minimal `planGates` to revisit + `issueRefs` + `preserveStages`). Confirms via
AskUserQuestion (unless `--no-confirm` / already `tuneConfirmed`). Revisits ONLY `planGates` in **refine
mode** (critical-reviewer + design-reviser revise the EXISTING doc in place via `reviewLoop` — not a
rewrite). Re-runs reconcile on touched docs. **Stage preservation:** only stages whose `files` intersect
the revised gate's scope reset to `pending`; `preserveStages` / file-disjoint stages keep `done`. Re-sets
`designReady=true`, consolidate, stop. `handoff.message` instructs re-running `/implement-feature`.

### `issues-and-improvements.md` lifecycle
```
implement: goalkeeper loop-back + upstream defect
  -> issueClassifier (per defect) -> isUpstream? gate ∈ {requirements,architecture,design,plan}
  -> append <planDir>/issues-and-improvements.md  -> blockedAt='issues-handoff' (stop)
tune: read issues-and-improvements.md -> tunePlanner -> planGates -> confirm -> refine those gates
  -> re-reconcile -> invalidate file-intersecting stages -> designReady=true (stop)
implement (<planDir>): re-runs from the first invalidated stage -> green -> commit
```

**Backward-compat:** old `pipeline-state.json` (no `mode`/`stages`/`designReady`) hydrates as a design-mode
linear replay at whatever `lastGate` recorded; idempotent gate markers skip completed work; falls through
to the design stop. **Concurrent-write guard:** pipelines are sequential by design; on resume, state is
re-read fresh rather than trusting in-memory cache across `Workflow` calls.

## Gate rules

-2. **Categorize** (fresh run, `useCategorizer`) — `feature-categorizer` classifies the task into
   `{category, subCategory}` (kebab-case) so the planDir can be derived dynamically. Skipped when an
   explicit `--plan` is given (that path wins) and never run on `--resume` (the persisted planPath
   is reused). Non-blocking (null/failure → `docs/uncategorized/feature/<leaf>/`). `{leaf}` =
   JIRA id from task text (`[A-Z][A-Z0-9_]+-\d+`) else `--timestamp` else slug.
-1. **Translate** (`useTranslator`, Gate -1) — if the task input contains non-English text
   (non-ASCII letter ratio > 0.15), `prompt-translator` converts it to English and writes
   `<planDir>/translation.md`; every downstream agent prompt and the idea doc become English.
   English input skips this gate. Non-blocking (null/agent-failure → proceeds with original text).
0. **Define** — `task-definition-architect` produces the idea doc (`<planDir>/idea.md`) and recommends
   `gsd-quick` or `full` path. If `needsClarification`, the pipeline invokes `user-interviewer`
   (Gate 0 clarify) to resolve the open questions interactively and continues; it stops and surfaces
   them to the user only if they can't be resolved (or `--no-interview`).
0.1. **Knowledge Consult** (full path, `useKnowledgeConsult`) — `project-knowledge-consultant`
   surfaces conventions, prior decisions, and gotchas as a brief that feeds the architecture prompt.
   Non-blocking. Skipped on the fast-path.
0.2. **Codebase Facts** (full path, `useExplorer`) — `code-explorer` gathers structured facts (relevant
   files + line refs, existing patterns to mirror, call sites, gotchas) into `codebase-facts.md`, fed
   by reference into the Requirements + Architecture prompts. Non-blocking. Skipped on the fast-path.
   **prompt-enhancer** (`useEnhancer`, default ON) is applied at retry sites throughout the pipeline —
   the refine retry (Gate 2), escalation retry, debug retry (Gate 4), reconcile design-fix retry
   (Gate 1.7), and every reviewLoop revision (Gates 0.5R/0.6R/0.75R) harden their retry prompt via
   prompt-enhancer before re-invoking the agent; hardened prompts persist to `enhanced-prompts.md`.
0.7. **E2E Use Cases** (full path, `useE2eUsecase`) — `e2e-usecase-extractor` defines end-to-end
   use cases / test scenarios from the idea + knowledge and writes `e2e-use-cases.md`. **Moved before
   architecture** (Phase C) so scenarios inform requirements + design. The cases feed the plan + TDD
   gates. Skipped on the fast-path.
0.75. **Requirements** (full path, `useRequirements`) — `requirements-collector` elicits FRs + NFRs
   into `requirements.md`, consumed (by path) by the architecture + detailed-design prompts. Feeds the
   review loops (gaps == unmet requirements). Skipped on the fast-path.
0.5. **Architecture** (full path, `useArchDesign`) — `arch-design-orchestrator` consumes the
   idea doc + knowledge brief + e2e + requirements (NFRs) and writes `architecture.md`. Skipped on the fast-path.
0.5R. **Architecture Review** (full path) — `critical-reviewer` + `design-reviser` loop until the
   architecture closes all gaps/open-questions (unmet requirements, wrong decomposition, unhandled
   risk). Non-terminal (fail-forwards on sub-cap). Verdicts appended to `review-history.md`.
0.6. **Detailed Design** (full path, `useDetailedDesign`) — `detailed-design-architect` consumes
   the arch + idea + requirements and writes `detailed-design.md`; doc paths feed the plan-architect prompt.
   Skipped on the fast-path.
0.6R. **Detailed-Design Review** (full path) — review loop until openGaps closed. Non-terminal.
   Verdicts appended to `review-history.md`.
0.75R. **Requirements Review** (full path, `useRequirements`) — review loop until the requirements
   are clear, complete, and testable. (Runs after design in v1 — closes gaps in the persisted doc for
   audit/resume rather than retroactively re-feeding arch.) Non-terminal. Verdicts appended to `review-history.md`.
1. **Plan** — `plan-architect` produces (or updates) the plan, consuming the idea + arch +
   detailed-design + e2e + requirements docs. It emits file-disjoint `lanes[]` for parallel execution. Skipped on
   the gsd-quick fast-path.
1.5. **TDD Enforce** (full path, `useTddEnforce`) — `tdd-plan-enforcer` hardens the plan **in
   place** (TDD gates, RED tests, GREEN exit criteria, YAGNI warnings) before the review loop.
1.7. **Reconcile** (full path, `useReconcile`) — `design-plan-reconciler` compares the plan against
   the arch/design/e2e artifacts. If it judges the **design** as the conflict source
   (`designAtFault=true`), the pipeline re-runs `arch-design-orchestrator` to fix the architecture
   in place and re-reconciles, bounded by the shared retry budget. Conflicts flow forward to review
   + persist; **non-blocking** (never sets `blockedAt`). Skipped on the fast-path.
2. **Review/Refine loop** — `critical-reviewer` reviews; if not accepted,
   `plan-refiner` applies fixes; loop until accepted or the refine soft sub-cap
   (`maxRefineIterations`, default 10). This is a **convergence gate, not a
   terminal gate**: on sub-cap exhaustion the pipeline escalates to a final
   reviewer pass that reclassifies remaining blockers as true plan defects vs
   implementation-detail notes; if only the latter remain (or even on true
   defects), the plan is **force-accepted** and the carried blockers are written
   to todo-store so the executor + code-reviewer re-check them. It can no longer
   kill the task. Reviewer scope is tuned to block ONLY on missing scope /
   ambiguous spec / wrong ordering / unhandled risk — un-enumerated call-site
   wiring is an implementer note, not a plan blocker. Reconcile conflicts (if any)
   are also reviewed here. Skipped on the fast-path.
2.1. **Chunk Plan into Stages** (design, `useChunker`) — after Gate 2 acceptance, `plan-chunker`
   splits `plan.md` into dependency-ordered `stageNN.md` files under the plan dir. Each stage is
   `{id (stageNN), file, name, status (pending→in-progress→done), files[]}`. Stages are the implement
   progress unit (lanes collapse INTO a stage — file-disjoint `stage.files` fan out in parallel within
   one stage). Runs ONCE in design; never re-run on resume (stages persisted in state). `--no-chunker`
   collapses to a single implicit `stage01` covering the whole plan. **In design mode the pipeline
   sets `designReady=true` here, calls `consolidate`, and returns — nothing executes.**
3. **Execute** — `plan-executor` runs the plan (full path), or `gsd-quick` implements it
   (fast-path). If plan lanes are file-disjoint AND `allowParallelExecute` AND ≥2 lanes, one
   `plan-executor` runs per lane in parallel (`lanesUsed > 1`); otherwise a single executor
   (`lanesUsed = 0`). The plan's Regression-mechanics and Edge-case sections are a
   checklist; any carried blockers from a force-accept are addressed here.
4. **Test** — `pytest-runner` runs the target; gate passes only if tests pass. On failure,
   `gsd-debug` (if enabled) diagnoses + fixes and tests re-run up to the debug
   soft sub-cap (`maxDebugRetries`, default 20). Blocks only if green cannot be
   reached.
5. **Code review** — `critical-reviewer` reviews the diff; gate blocks on any
   `blocker`-severity finding.
5.1. **Goalkeeper** (implement, `useGoalkeeper`) — `complex-decision-analyst` re-judges the
   finished work as a **commit goalkeeper**. `commit` → proceeds to publish/persist/git-commit. A
   `loop-back` verdict is **no longer a rewind** (the Phase-E loop-back state machine was removed in the
   engine split): each `trueDefect` is classified via `issueClassifier`; a defect pointing at a design
   gate (`requirements`/`architecture`/`design`/`plan`) → `isUpstream` → append to
   `<planDir>/issues-and-improvements.md` and stop at `blockedAt='issues-handoff'` (run `/tune-feature`);
   a `tests`-target defect stays on the code path (debug loop / hard-block). Bounded by the hard
   `decisionCap`. null → conservative `commit`. Decision logged to `<planDir>/decisions.md`.
   Cap-exhaustion hard-blocks at `blockedAt='goalkeeper'` (resumable).
   **quick-decider** (`useQuickDecider`, Phase E2) rides the loops above — refine, escalation,
   reconcile design-fix, debug, and every reviewLoop (Requirements/Arch/Design). Firing only from
   the 2nd iteration onward, it asks whether another cycle is worth the global retry budget:
   `retry` continues, `stop` bails to the loop's fail-forward/escalate/block path, null → stop
   (conservative). Turns blind-cap loops into judgment-cap loops without losing the hard
   `decisionCap` floor.
5.4. **Publish** (`usePublish`) — `docs-architecture-publisher` publishes the plan + architecture
   design into project docs. **Non-blocking** (never sets `blockedAt`).
5.5. **Persist** (`useKnowledgePersist`) — `knowledge-persist` captures findings
   (carried blockers, code-review findings, debug gotchas, YAGNI warnings, reconcile conflicts,
   published paths) into CLAUDE.md + Serena mem. Runs on success AND on blocked exits; **non-blocking**
   (never sets `blockedAt`).
6. **Commit (optional)** — only if `ready` AND `autoCommit`; otherwise stop.

The full result object is persisted **once** via the `todo-store` agent to
`.planning/todos/<task-slug>.md` — on success and once per hard-block exit.

### Resilience (StructuredOutput-cap / throw recovery)

A schema-gated agent that throws (e.g. a `StructuredOutput retry cap exceeded` loop where the model
emits malformed JSON on every retry) no longer crashes the pipeline:

- The critical-path schema-gated calls (review, refine, escalation, single-executor, code-review)
  go through a `safeAgent()` wrapper that converts any throw into a recoverable `null` + a log line.
  The existing null-handling then runs: a null review/refine re-loops; a null escalation is retried up
  to 5 times with a hardened prompt and, if it still fails, hard-blocks (resumable) rather than
  force-accepting; a null execute/code-review hard-blocks. The pipeline completes or blocks cleanly
  instead of the Workflow tool reporting a raw crash.
- A top-level `main()` safety net catches anything `safeAgent` doesn't cover: it sets
  `blockedAt='uncaught-throw'`, records `_uncaughtError`, and calls `consolidate()` so
  `pipeline-state.json` is written even on an escaping throw. The run is then `--resume`-able.

So a cap-exhausted run now either completes (fail-forward) or leaves a resumable state file —
never a hard crash with no state.

## Cost

Medium weight (~14-20 agent calls for a clean full run: define (+interview if needed) + knowledge
+ arch + design + e2e + plan + tdd + reconcile (+design-fix loop if at fault) + review + execute
(×lanes) + test + code-review + publish + persist + commit; plus one consolidated todo-store write).
More if the refine loop spins, the design-fix loop runs, or gsd-debug retries fire. The gsd-quick
fast-path is lighter (skips knowledge/arch/design/e2e/plan/tdd/reconcile/review/publish; still keeps
Test + Code-Review + Persist). Gates 0→1.7 are sequential (each depends on the prior artifact);
lanes within Gate 3 run in parallel.

## Running

```text
Workflow({ name: "feature-pipeline", args: { task: "...", autoCommit: false } })
```

Or via the `/feature-pipeline` slash command.

## Validation

This workflow is an **ES module** (`export const meta`) with no `package.json type:"module"`.
Syntax-checking requires ESM mode — plain `node --check` parses as CommonJS and **silently passes
invalid ESM** (verified: a missing colon returns exit 0).

The canonical source lives in the plugin repo at `plugins/feature-workflows/workflows/`; the
project copy at `.claude/workflows/` is installed by `/feature-workflows:setup`. Edit the plugin
source and re-run setup — the recipes below work from whichever directory holds the copy you edited.

```bash
cd .claude/workflows   # or: cd plugins/feature-workflows/workflows
sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
  | node --input-type=module --check
```

- `--input-type=module` forces ESM parsing so `export` / top-level `await` validate correctly.
- The `sed` neutralizes the **sandbox-only top-level `return final`** at the file's end — legal
  inside the Workflow runtime, illegal in standalone loaded ESM. Commenting it out keeps the check
  faithful without changing line numbers.
- **Pass:** exit 0, no output. **Fail:** non-zero, prints the `SyntaxError` line.
- Plain `node --check feature-pipeline.js` does **not** catch ESM body errors — don't rely on it.

Run this after editing the script (before invoking the Workflow) to confirm it still parses as ESM.

### Phase-label validation (I7)

Every `phase('X')` / `stateCheckpoint('X', …)` title — and every literal
`phase: 'X'` option on an `agent()` call (cross-cutting groups like `Enhance`,
`Checkpoint`, `Decide` are attributed to the progress tree only this way) —
should map to a `meta.phases` entry. A stray label (e.g. two distinct gates both
emitting `'Detailed Design'`, or a chunker re-using a design label) silently
collides the progress-tree grouping and mislabels the pipeline log. Catch this
at CI time:

```bash
cd .claude/workflows   # or: cd plugins/feature-workflows/workflows
# 1. labels actually emitted by the script:
#    phase('...') + stateCheckpoint('...', ...) calls AND literal phase: '...' agent() opts
{ grep -oE "(phase|stateCheckpoint)\('[^']+'" feature-pipeline.js \
    | sed -E "s/.*'([^']+)'/\1/"
  grep -oE "\bphase: *'[^']+'" feature-pipeline.js \
    | sed -E "s/.*'([^']+)'/\1/"; } | sort -u > /tmp/used.txt
# 2. titles declared in meta.phases
sed -n "/^  phases:/,/^  }/p" feature-pipeline.js \
  | grep -oE "title: *'[^']+'" | sed -E "s/.*'([^']+)'/\1/" | sort -u > /tmp/declared.txt
# 3. emitted-but-undeclared labels (should be empty)
comm -23 /tmp/used.txt /tmp/declared.txt
echo "undeclared_count=$(comm -23 /tmp/used.txt /tmp/declared.txt | wc -l)"
```

- `undeclared_count` should be `0`. Any non-empty diff is a phase label not present in
  `meta.phases` — add the entry or fix the label (the F4 chunker bug was exactly this class).
- Add to CI after each edit so a label drift fails the build, not a future pipeline log.
