---
description: DO flow — execute stages -> test -> code-review -> decide -> commit. On upstream defect writes issues-and-improvements.md and stops (run /tune-feature). Requires prior /design-feature.
argument-hint: <planDir> [--target=TEST_TARGET] [--auto-commit] [--no-issues] [--no-gsd-debug] [--no-publish] [--no-persist] [--no-goalkeeper] [--no-quick-decider] [--no-enhancer] [--no-parallel] [--decision-cap=N] [--retries=N] [--debug-retries=N] [--gsd-quick]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*)
---

Run the `feature-pipeline` workflow in **implement mode** — the DO flow that executes the design
stage files, runs tests, code-reviews, decides commit-vs-issues-handoff, and commits. Requires a
prior `/design-feature` run (it asserts `designReady`).

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

This command REQUIRES a `<planDir>` positional arg (the planDir from your `/design-feature` run).

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token (not a flag and
  not a flag value) is the planDir. Hydrate persisted pipeline state at `<planDir>/pipeline-state.json`.
  `<planDir>` = the design run's plan dir (e.g. `docs/parser/feature/add-retry-layer`), exactly the
  `result.planDir` printed by `/design-feature`. A bare `plan.md` path also accepted (`/plan.md`
  suffix stripped). `task` is optional — resolved from the persisted state.
- `--target=PATH`: → `testTarget` (optional pytest target)
- `--auto-commit`: if present → `autoCommit: true` (commit on success; default `false` — leaves changes staged-and-uncommitted)
- `--no-issues`: if present → `useIssues: false` (on an upstream-defect goalkeeper verdict, do NOT write `issues-and-improvements.md`; degrade to a plain block. Default **enabled** — writes the issues file + stops for `/tune-feature`)
- `--no-gsd-debug`: → `useGsdDebug: false` (disable gsd-debug recovery on test failure)
- `--no-publish`: → `usePublish: false` (skip docs-architecture-publisher)
- `--no-persist`: → `useKnowledgePersist: false` (skip knowledge-persist)
- `--no-goalkeeper`: → `useGoalkeeper: false` (skip commit goalkeeper — no commit-vs-issues-handoff decision)
- `--no-quick-decider`: → `useQuickDecider: false`
- `--no-enhancer`: → `useEnhancer: false`
- `--no-parallel`: → `allowParallelExecute: false` (run intra-stage lanes serially)
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20)
- `--debug-retries=N`: → `maxDebugRetries` (default 20)
- `--gsd-quick`: if present → `gsdQuick: true` (force the gsd-quick alternate executor instead of stage execution)

Note: implement mode does NOT re-run design gates (define/requirements/arch/design/plan/review). Those are skipped via the mode guard; only the DO gates (execute stages → test → code-review → goalkeeper → publish → persist → commit) run.

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "implement",
    resume: <planDir>,
    testTarget: <PATH or "">,
    autoCommit: <bool>,
    useIssues: <bool>,
    useGsdDebug: <bool>,
    usePublish: <bool>,
    useKnowledgePersist: <bool>,
    useGoalkeeper: <bool>,
    useQuickDecider: <bool>,
    useEnhancer: <bool>,
    allowParallelExecute: <bool>,
    decisionCap: <int>,
    retryBudget: <int>,
    maxDebugRetries: <int>,
    gsdQuick: <bool>
  }
})
```

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first.
- If `ready === true` (all stages done, tests green, code-review clean): state "Implementation complete." Show `testsPassed`, `testSummary`, code-review issue count, stage progress (`result.stages`: count done/total + each `id`/`status`), and whether committed (`committed` / `commitHash`) or that `autoCommit` was off so changes are staged-and-uncommitted. Note `lanesUsed` and `persist`/`published` results.
- If `blockedAt === 'design-not-ready'`: design was not run. Print `result.handoff.message` and stop — the user must run `/design-feature` first.
- If `blockedAt === 'execute'`: a stage failed. Show `result._execute._failedStage` (which `stageNN`) + the executor summary. Re-run: `/implement-feature <planDir>` (done stages are skipped; the failed stage re-runs).
- If `blockedAt === 'test'`: tests failing after gsd-debug. Show `result.testSummary` + `debugRetries`. The user may fix manually then re-run.
- If `blockedAt === 'code-review'`: blocker-severity findings. Show `result.codeReview.blockers`. Fix + re-run.
- If `blockedAt === 'issues-handoff'` (the Phase I upstream-defect path): print `result.handoff.message` verbatim — it tells the user to run `/tune-feature <planDir>`. Show `result.handoff.upstreamCount` and the `issuesPath`. Do NOT attempt to commit.
- If `blockedAt === 'goalkeeper'`: decision cap exhausted during a loop-back — re-runnable with `<planDir>`.
- If `blockedAt === 'uncaught-throw'`: an escaping error tripped the safety net (see `result._uncaughtError`); `pipeline-state.json` was written, so re-runnable with `<planDir>`.

Examples:

```
/implement-feature docs/parser/feature/add-retry-layer
/implement-feature docs/parser/feature/add-retry-layer --auto-commit
/implement-feature docs/parser/feature/add-retry-layer --no-issues
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`). The project copy at
`.claude/workflows/feature-pipeline.js` is installed by `/feature-workflows:setup` and overwritten on
re-run — edit the plugin source, not the copy. After editing, validate as **ES module** — see the
**Validation** section in the `feature-pipeline.md` reference next to the engine. Plain `node --check`
parses as CommonJS and silently passes invalid ESM; use the `--input-type=module` recipe there.
