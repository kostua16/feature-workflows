---
description: DO flow — author tests -> execute stages -> test -> code-review -> decide -> commit. On upstream defect writes issues-and-improvements.md and stops (run /tune-feature). Requires prior /design-feature.
argument-hint: <planDir> [--stage=stageNN] [--from-gate=execute|tests] [--target=TEST_TARGET] [--test-cmd=CMD] [--test-framework=NAME] [--profile=full|standard|light] [--fresh-budget] [--auto-commit] [--no-test-writer] [--no-issues] [--no-gsd-debug] [--no-publish] [--no-persist] [--no-goalkeeper] [--no-quick-decider] [--no-enhancer] [--no-parallel] [--decision-cap=N] [--retries=N] [--debug-retries=N] [--gsd-quick]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*), Bash(mktemp:*), Bash(rm:*)
---

Run the `feature-pipeline` workflow in **implement mode** — the DO flow that writes/validates tests,
executes the design stage files, runs tests, code-reviews, decides commit-vs-issues-handoff, and commits. Requires a
prior `/design-feature` run (it asserts `designReady`).

## Preflight — engine link must be healthy

- Engine link: !`test -e ~/.claude/workflows/feature-pipeline.js && echo PRESENT || echo ABSENT`
- Link target: !`readlink ~/.claude/workflows/feature-pipeline.js 2>/dev/null || echo not-a-symlink`
- Installed engine version: !`grep -m1 "engine-version:" ~/.claude/workflows/feature-pipeline.js 2>/dev/null || echo none`
- Plugin engine version: !`grep -m1 "engine-version:" "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" 2>/dev/null || echo unknown`
- Legacy project copy: !`test -e .claude/workflows/feature-pipeline.js && echo LEGACY-COPY-PRESENT || echo none`
- Legacy copy version: !`grep -m1 "engine-version:" .claude/workflows/feature-pipeline.js 2>/dev/null || echo none`
- OS: !`uname -s 2>/dev/null || echo unknown`
- Symlink capability: !`d=$(mktemp -d); ln -s "$d" "$d/t" 2>/dev/null && echo SYMLINKS-OK || echo SYMLINKS-UNAVAILABLE; rm -rf "$d"`

(`test -e` follows symlinks, so a dangling link reports ABSENT.) Then:

1. **Auto-repair (silent — do not ask):** if the engine link is ABSENT, or the link target differs
   from `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`, or it is `not-a-symlink` (copy
   fallback) and the installed/plugin versions differ, run the cross-platform repair (tries
   symlink, then native Windows symlink, then copy):
   ```
   mkdir -p ~/.claude/workflows/docs \
     && { ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" ~/.claude/workflows/feature-pipeline.js \
          && ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.md" ~/.claude/workflows/feature-pipeline.md \
          && ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/docs/feature-pipeline-documentation.md" ~/.claude/workflows/docs/feature-pipeline-documentation.md ; } \
     || { command -v powershell >/dev/null 2>&1 && powershell -NoProfile -Command "\$ErrorActionPreference='Stop'; New-Item -ItemType SymbolicLink -Path '$USERPROFILE/.claude/workflows/feature-pipeline.js' -Target '$CLAUDE_PLUGIN_ROOT/workflows/feature-pipeline.js' -Force; New-Item -ItemType SymbolicLink -Path '$USERPROFILE/.claude/workflows/feature-pipeline.md' -Target '$CLAUDE_PLUGIN_ROOT/workflows/feature-pipeline.md' -Force; New-Item -ItemType SymbolicLink -Path '$USERPROFILE/.claude/workflows/docs/feature-pipeline-documentation.md' -Target '$CLAUDE_PLUGIN_ROOT/workflows/docs/feature-pipeline-documentation.md' -Force" ; } \
     || { cp "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" ~/.claude/workflows/feature-pipeline.js \
          && cp "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.md" ~/.claude/workflows/feature-pipeline.md \
          && cp "${CLAUDE_PLUGIN_ROOT}/workflows/docs/feature-pipeline-documentation.md" ~/.claude/workflows/docs/feature-pipeline-documentation.md ; }
   ```
   Tier 1 (`ln -sfn`) covers Linux/macOS and Git-Bash-with-Windows-developer-mode; tier 2
   (`powershell New-Item -ItemType SymbolicLink`) is the native Windows attempt, tried only where
   `ln` fails but symlink privilege still exists; tier 3 (`cp`) is the universal fallback used when
   symlinks are unavailable (Windows without developer mode). `$ErrorActionPreference='Stop'` makes
   any tier-2 failure fall through to `cp`. In copy mode this same rule re-copies on version drift.
   Only if ALL THREE tiers fail: STOP and direct the user to `/feature-workflows:setup`.
2. **Legacy shadow:** if LEGACY-COPY-PRESENT, a pre-1.5.0 project-level copy shadows the
   user-level engine. If the legacy copy version matches the plugin engine version, proceed but
   note the leftover copy and recommend `/feature-workflows:setup` to clean it up. If it differs,
   STOP and tell the user to run `/feature-workflows:setup` — the stale project copy would run
   instead of the current engine.

This command REQUIRES a `<planDir>` positional arg (the planDir from your `/design-feature` run).

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token (not a flag and
  not a flag value) is the planDir. Hydrate persisted pipeline state at `<planDir>/pipeline-state.json`.
  `<planDir>` = the design run's plan dir (e.g. `docs/parser/feature/add-retry-layer`), exactly the
  `result.planDir` printed by `/design-feature`. A bare `plan.md` path also accepted (`/plan.md`
  suffix stripped). `task` is optional — resolved from the persisted state.
- `--stage=stageNN`: → `stage` (re-run exactly ONE stage after a manual edit: that stage flips
  back to pending and the stale test/review/goalkeeper verdicts are cleared so they re-earn over
  the fresh diff; other done stages stay skipped. One-shot: applies to this invocation only)
- `--from-gate=execute|tests`: → `fromGate` (deterministically clear that gate + downstream
  completion flags so they re-run — a user-driven rewind. Design-gate targets belong to
  `/design-feature --from-gate` / `/tune-feature`; implement mode rejects them. One-shot)
- `--target=PATH`: → `testTarget` (optional test target/path scope)
- `--test-cmd="<cmd>"`: → `testCmd` (run this EXACT test command, stack-agnostic; overrides auto-detect)
- `--test-framework=<name>`: → `testFramework` (mapped template: `pytest`|`npm`|`jest`|`vitest`|`node`|`go`|`cargo`|`make`; used when `--test-cmd` is absent). With neither set, the runner auto-detects the project's test command.
- `--profile=full|standard|light`: → `profile` (preset defaults for the gate-control flags; individual `--no-*` flags still override. `light` drops the opus review/enhancer/quick-decider loops + extra design gates for small tasks. Default `full`.)
- `--fresh-budget`: if present → `freshBudget: true` (reset the retry + decision budgets on resume; default carries the used counters across `--resume` so a spinning loop can't be resumed into a full fresh budget)
- `--auto-commit`: if present → `autoCommit: true` (commit on success; default `false` — leaves changes staged-and-uncommitted)
- `--no-test-writer`: if present → `useTestWriter: false` (skip the pre-execute test-authoring gate; default enabled)
- `--no-issues`: if present → `useIssues: false` (on upstream-flagged findings — a goalkeeper loop-back OR blocker-severity code-review findings — do NOT classify or write `issues-and-improvements.md`; degrade to a plain block. Default **enabled** — upstream-rooted findings are written to the issues file and the run stops for `/tune-feature`)
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

Note: implement mode does NOT re-run design gates (define/requirements/arch/design/plan/review). Those are skipped via the mode guard; only the DO gates (test-authoring → execute stages → test → code-review → goalkeeper → publish → persist → commit) run.

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "implement",
    resume: <planDir>,
    stage: <"stageNN" or "">,
    fromGate: <"execute"|"tests" or "">,
    testTarget: <PATH or "">,
    testCmd: <"exact test command" or "">,
    testFramework: <"pytest|npm|go|cargo|…" or "">,
    profile: <"full"|"standard"|"light">,
    freshBudget: <bool>,
    autoCommit: <bool>,
    useTestWriter: <bool>,
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
- If `blockedAt === 'test-authoring'`: the test-writer gate could not write or confirm the required tests. Show `result.testWriterSummary` and re-run after fixing the blocker.
- If `blockedAt === 'design-not-approved'`: the design run used `--approval` and the sign-off is still pending. Print `result.handoff.message` — the user must finish the approval via `/design-feature --resume <planDir>` first.
- If `blockedAt === 'bad-args'`: an invalid `--stage`/`--from-gate` value; print `result.handoff.message` (it lists the valid stage ids / gate targets). Nothing ran.
- If `blockedAt === 'execute'`: a stage failed. Show `result._execute._failedStage` (which `stageNN`) + the executor summary. Re-run: `/implement-feature <planDir>` (done stages are skipped; the failed stage re-runs).
- If `blockedAt === 'test'`: tests failing after gsd-debug. Show `result.testSummary` + `debugRetries`. The user may fix manually then re-run.
- If `blockedAt === 'code-review'`: blocker-severity findings with no upstream root (or classification unavailable). Show `result.codeReview.blockers`. Fix + re-run.
- If `blockedAt === 'issues-handoff'` (upstream-defect path — from the goalkeeper loop-back OR from blocker-severity code-review findings classified as upstream): print `result.handoff.message` verbatim — it tells the user to run `/tune-feature <planDir>`. Show `result.handoff.upstreamCount` and the `issuesPath`. Do NOT attempt to commit.
- If `blockedAt === 'goalkeeper'`: decision cap exhausted during a loop-back — re-runnable with `<planDir>`.
- If `blockedAt === 'uncaught-throw'`: an escaping error tripped the safety net (see `result._uncaughtError`); `pipeline-state.json` was written, so re-runnable with `<planDir>`.

Examples:

```
/implement-feature docs/parser/feature/add-retry-layer
/implement-feature docs/parser/feature/add-retry-layer --auto-commit
/implement-feature docs/parser/feature/add-retry-layer --no-issues
/implement-feature docs/parser/feature/add-retry-layer --stage=stage02
/implement-feature docs/parser/feature/add-retry-layer --from-gate=tests
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically. After editing, validate as **ES module** — see the **Validation** section
in the `feature-pipeline.md` reference next to the engine. Plain `node --check` parses as CommonJS
and silently passes invalid ESM; use the `--input-type=module` recipe there.
