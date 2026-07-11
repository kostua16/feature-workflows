---
description: Convenience alias — runs /design-feature then instructs /implement-feature (split engine). Design THINK flow only by default; add --auto-implement to chain into the DO flow (implies --auto-commit off unless --auto-commit).
argument-hint: <task description> [--auto-implement] [--yes] [--auto-commit] [--target=TEST_TARGET] [--plan=PLAN_PATH] [--definition=DEF_PATH] [--gsd-quick] [--no-chunker] [--no-gsd-debug] [--no-test-writer] [--no-knowledge] [--no-arch] [--no-design] [--no-e2e] [--no-tdd-enforce] [--no-reconcile] [--no-publish] [--no-persist] [--no-interview] [--no-parallel] [--no-translator] [--no-categorizer] [--no-requirements] [--no-explorer] [--no-enhancer] [--no-goalkeeper] [--no-quick-decider] [--decision-cap=N] [--timestamp=TS] [--retries=N] [--debug-retries=N] [--max-reconcile-iterations=N] [--resume <planDir>]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*)
---

Run the `feature-pipeline` workflow in **design mode** — the THINK-only flow. This is the convenience
alias that chains the 3 split pipelines (`/design-feature` → `/implement-feature` → `/tune-feature`).
By default it runs design mode and STOPS pre-execute (the human checkpoint). Add `--auto-implement` to
chain into implement mode after `designReady`. (Two more modes exist — `/extract-design`, the reverse
flow that extracts design docs from existing code, and `/review-design`, the standalone design-docset
audit — but this alias never chains into them.)

## Preflight — engine must be installed

- Engine installed: !`test -f .claude/workflows/feature-pipeline.js && echo INSTALLED || echo MISSING`
- Installed engine version: !`grep -m1 "engine-version:" .claude/workflows/feature-pipeline.js 2>/dev/null || echo none`
- Plugin engine version: !`grep -m1 "engine-version:" "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" 2>/dev/null || echo unknown`

If the engine is MISSING: tell the user to run `/feature-workflows:setup` first and STOP — do not
call the Workflow tool. If the two versions differ: STOP before calling the Workflow tool — an
outdated installed engine's agent/gate contract may not match the plugin's registered agents and
would fail mid-pipeline instead of at preflight. Ask the user (AskUserQuestion) to either re-run
`/feature-workflows:setup` first (recommended) or explicitly proceed with the outdated engine;
only call the Workflow tool after setup has been re-run or the user explicitly chose to proceed.

Parse `$ARGUMENTS` into:
- `task`: everything except the flags (required, UNLESS `--resume` is given)
- `--resume <planDir>`: → `resume: <planDir>` (hydrate persisted pipeline state at `<planDir>/pipeline-state.json` and re-run from the first incomplete gate; `task` is optional here — it is resolved from the persisted state). `<planDir>` is the ORIGINAL RUN's plan dir (e.g. `docs/parser/feature/add-retry-layer`), exactly what `result.planDir` printed at run end. A bare `plan.md` path is also accepted (the `/plan.md` suffix is stripped). The dynamic planDir is NOT re-derived on resume (the categorizer is non-deterministic); the persisted `planPath` is reused verbatim. Slug-only resume is no longer supported — the path is the sole resume format. Note: if source files changed since the original run, persisted artifact paths may be stale.
- `--auto-implement`: if present → `autoImplement: true` (after design sets `designReady`, CHAIN into implement mode automatically via `Workflow resume`. Default `false` — design stops pre-execute and instructs the user to run `/implement-feature <planDir>`). **Since v1.2.0 `--auto-implement` also passes `useApproval: true` to the design run** — the human approves the stage split before code executes (see the Approval loop in `design-feature.md`). Add `--yes` to skip that checkpoint (pre-v1.2.0 behavior).
- `--yes`: if present → do NOT pass `useApproval: true` with `--auto-implement` (skip the design-approval checkpoint; chain straight from `designReady` into implement).
- `--auto-commit`: if present anywhere → `autoCommit: true` (default `false`; only meaningful when `--auto-implement` chains into implement)
- `--target=PATH`: → `testTarget` (optional test target/path scope)
- `--plan=PATH`: → `planPath` (**OPTIONAL — do NOT pass a default**). Only set when the user typed `--plan=<PATH>`. When ABSENT, pass `planPath: ""` (empty) so the workflow runs the Gate -2 `feature-categorizer` to derive the dynamic planDir `docs/{category}/{sub-category}/feature/{leaf}/`. Passing a hardcoded default defeats the categorizer (it treats any truthy planPath as an explicit override). **Ignored on `--resume`** (the resume path supplies the planDir).
- `--definition=PATH`: → `definitionPath` (optional; default: plan dir /idea.md)
- `--gsd-quick`: if present → `gsdQuick: true` (force gsd-quick fast-path; default false, but define gate may still recommend it)
- `--no-chunker`: if present → `useChunker: false` (skip plan-chunker; plan stays a single implicit `stage01`; default **enabled** — splits plan into `stageNN.md` dependency-ordered stage files)
- `--no-gsd-debug`: if present → `useGsdDebug: false` (disable gsd-debug recovery on test failure; default enabled)
- `--no-test-writer`: if present → `useTestWriter: false` (skip the pre-execute test-authoring gate when `--auto-implement` chains into implement mode; default enabled)
- `--no-knowledge`: if present → `useKnowledgeConsult: false` (skip Gate 0.1 project-knowledge-consultant; default enabled, full path only)
- `--no-arch`: if present → `useArchDesign: false` (skip Gate 0.5 architecture design; default enabled, full path only)
- `--no-design`: if present → `useDetailedDesign: false` (skip Gate 0.6 detailed design; default enabled, full path only)
- `--no-e2e`: if present → `useE2eUsecase: false` (skip Gate 0.7 e2e use-case extraction; default enabled, full path only)
- `--no-tdd-enforce`: if present → `useTddEnforce: false` (skip Gate 1.5 TDD/YAGNI hardening; default enabled, full path only)
- `--no-reconcile`: if present → `useReconcile: false` (skip Gate 1.7 design-plan-reconciler + design-fix loop; default enabled, full path only)
- `--no-publish`: if present → `usePublish: false` (skip Gate 5.4 docs-architecture-publisher; default enabled)
- `--no-persist`: if present → `useKnowledgePersist: false` (skip Gate 5.5 knowledge-persist; default enabled)
- `--no-interview`: if present → `useInterview: false` (always stop-and-surface on needsClarification instead of resolving inline via user-interviewer; default enabled)
- `--no-parallel`: if present → `allowParallelExecute: false` (run plan lanes serially in one executor; default enabled)
- `--no-translator`: if present → `useTranslator: false` (skip Gate -1 prompt-translator for non-English task input; default enabled)
- `--no-categorizer`: if present → `useCategorizer: false` (skip feature-categorizer; planDir falls back to `docs/uncategorized/feature/<leaf>/`; default enabled)
- `--no-requirements`: if present → `useRequirements: false` (skip Gate 0.75 requirements-collector + requirements review loop; default enabled, full path only)
- `--no-explorer`: if present → `useExplorer: false` (skip Gate 0.2 code-explorer codebase-facts; default enabled, full path only)
- `--no-enhancer`: if present → `useEnhancer: false` (skip prompt-enhancer hardening at retry sites; default enabled)
- `--no-goalkeeper`: if present → `useGoalkeeper: false` (skip Gate 5.1 complex-decision-analyst commit goalkeeper; default enabled, full path only)
- `--no-quick-decider`: if present → `useQuickDecider: false` (keep blind-cap loops instead of quick-decider judgment at loop boundaries; default enabled)
- `--decision-cap=N`: → `decisionCap` (optional HARD runaway floor for decision-agent calls [quick-decider + goalkeeper]; default 50; hit → hard-block at `blockedAt='goalkeeper'`, resumable via `--resume`)
- `--timestamp=<TS>`: → `timestamp` (planDir leaf when no JIRA id in task; format `YYYYmmddHH24MI`; else slug leaf used)
- `--jira=<ID>`: not a flag — JIRA id is detected from the task text via `[A-Z][A-Z0-9_]+-\d+` regex and becomes the planDir leaf automatically
- `--retries=N`: → `retryBudget` (optional, default 20; the SINGLE GLOBAL budget shared by refine + debug loops — the only "stop" condition)
- `--debug-retries=N`: → `maxDebugRetries` (optional SOFT per-loop sub-cap, default 20)
- `--max-reconcile-iterations=N`: → `maxReconcileIterations` (optional SOFT per-loop sub-cap on the Gate 1.7 design-fix loop; default 5). Keeps a persistently mis-judging reconciler from monopolizing the shared global retry budget that refine + test/debug recovery need.

Note: the full result object is persisted **once** to the `todo-store` agent
(`.planning/todos/<task-slug>.md`) on success and once per hard-block exit; prior context is
carried in-prompt between gates. The same boundaries also write a resumable
`<plan dir>/pipeline-state.json` (the `--resume` substrate) plus `<plan dir>/pipeline.log`.

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "design",
    task: <task>,
    autoCommit: <bool>,
    testTarget: <PATH or "">,
    planPath: <PATH or "">,          // "" unless --plan typed — empty triggers Gate -2 dynamic planDir
    definitionPath: <PATH or "">,
    gsdQuick: <bool>,
    useChunker: <bool>,
    useGsdDebug: <bool>,
    useTestWriter: <bool>,
    useArchDesign: <bool>,
    useDetailedDesign: <bool>,
    useTddEnforce: <bool>,
    useKnowledgePersist: <bool>,
    useKnowledgeConsult: <bool>,
    useE2eUsecase: <bool>,
    useReconcile: <bool>,
    usePublish: <bool>,
    useInterview: <bool>,
    allowParallelExecute: <bool>,
    useTranslator: <bool>,
    useCategorizer: <bool>,
    useRequirements: <bool>,
    useExplorer: <bool>,
    useEnhancer: <bool>,
    useGoalkeeper: <bool>,
    useQuickDecider: <bool>,
    decisionCap: <int>,
    timestamp: <TS or "">,
    retryBudget: <int>,
    maxDebugRetries: <int>,
    maxReconcileIterations: <int>,
    resume: <planDir or "">,
    useApproval: <bool>                // true when --auto-implement without --yes
  }
})
```

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` (the dynamic docs/.../feature/<leaf>/ dir) first so the user can pass it to `--resume`. If `result._categorization` is set, show `category/subCategory`.
- In design mode the run ENDS after plan acceptance + (optional) chunking + publish/persist — NO code executes. State this plainly: "Design ready — nothing executed yet."
- If `result.designReady === true`: list the produced artifacts (`definitionPath`, `requirementsPath`, `archPath`, `designPath`, `useCasePath`, `planPath`, `codebase-facts`) and the `stageNN.md` files (`result.stages`: count + each stage `id`/`name`/`files`). Show `reconcile` consistency, `yagniWarnings`, and the plan-acceptance outcome (`planAccepted && !forceAccepted` = clean accept; `forceAccepted === true` = force-accepted — list `carriedBlockers`). Note `persist`/`published` results.
- Print `result.handoff.message` verbatim — it tells the user the next step: `/implement-feature <planDir>`.
- If `blockedAt === 'awaiting-approval'` (the `--auto-implement` design run stopped at the approval checkpoint): run the **Approval loop** from `design-feature.md` — AskUserQuestion (approve / edit stage boundaries / reject to plan), re-invoke with `approveDesign`/`stageEdits`/`rejectToPlan`, repeat until `designApproved.approved === true` — and only then chain into implement.
- If `--auto-implement` was passed AND `designReady === true` AND (approval is complete — `designApproved.approved === true` — or `--yes` was given): chain automatically by invoking the workflow again in implement mode (`Workflow({name:"feature-pipeline", args:{mode:"implement", resume:<planDir>, autoCommit, ...}})`). On `ready === true`, report implementation complete (stages done/total, `testsPassed`, `testSummary`, code-review count, `committed`/`commitHash` or autoCommit-off). On `blockedAt === 'issues-handoff'`, print the handoff and stop — instruct `/tune-feature <planDir>`.
- If `needsClarification === true` (Gate 0 stopped): the `user-interviewer` already tried to resolve the open questions inline; if `interview.resolved === false` (or `--no-interview`), present the remaining `openQuestions` to the user as a numbered list and stop. Do NOT proceed until the user answers; on answer, re-run with those answers folded into `task`.
- If `blockedAt` is set (design gates): name the blocking gate (`define`/`requirements`/`architecture`/`detailed-design`/`e2e-usecases`/`plan`/`tdd-enforce`/`review`/`uncaught-throw`), show the relevant detail, and note it is `--resume`-able: `/feature-pipeline --resume <planDir>`. If `blockedAt === 'uncaught-throw'`, an escaping error tripped the safety net (see `result._uncaughtError`); `pipeline-state.json` was still written, so `--resume`-able.

Examples:

```
/feature-pipeline Fix the token expiry check — it uses < instead of <= in auth middleware
/feature-pipeline Add cache invalidation on config reload --target=tests/test_cache.py
/feature-pipeline Refactor report filters --plan=.planning/user-plans/report-filters/plan.md --auto-commit
/feature-pipeline Fix typo in error message label --gsd-quick
/feature-pipeline Add retry layer --no-arch --no-design
/feature-pipeline Big refactor across modules --no-parallel
/feature-pipeline --resume docs/parser/feature/add-retry-layer
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`). The project copy at
`.claude/workflows/feature-pipeline.js` is installed by `/feature-workflows:setup` and overwritten on
re-run — edit the plugin source, not the copy. After editing, validate as **ES module** — see the
**Validation** section in the `feature-pipeline.md` reference next to the engine. Plain `node --check`
parses as CommonJS and silently passes invalid ESM; use the `--input-type=module` recipe there.
