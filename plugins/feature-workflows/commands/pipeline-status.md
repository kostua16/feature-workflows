---
description: Read-only status report for a feature-pipeline run — mode, gates done/blocked, stage table, budgets used, telemetry, open questions, and the exact next command.
argument-hint: <planDir>
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*)
---

Run the `feature-pipeline` workflow in **status mode** — a strictly read-only inspection of a
persisted run. It loads `<planDir>/pipeline-state.json`, validates it, and renders a report:
mode, gate progress, stage table, budgets used, per-gate telemetry, open questions/issues, and
the exact next command (`/implement-feature …` / `/tune-feature …` / `/review-design …` /
`/design-feature --resume …`).
It writes NOTHING — no state flush, no checkpoint — so it is always safe to run, including on a
blocked, mid-run, or corrupt pipeline.

## Preflight — engine must be installed

- Engine installed: !`test -f .claude/workflows/feature-pipeline.js && echo INSTALLED || echo MISSING`
- Installed engine version: !`grep -m1 "engine-version:" .claude/workflows/feature-pipeline.js 2>/dev/null || echo none`
- Plugin engine version: !`grep -m1 "engine-version:" "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" 2>/dev/null || echo unknown`

If the engine is MISSING: tell the user to run `/feature-workflows:setup` first and STOP — do not
call the Workflow tool. If the two versions differ: warn the user, but you may proceed — status
mode is read-only, so an outdated engine can at worst render an incomplete report (older engines
without status mode return a design-mode result instead; in that case tell the user to re-run
`/feature-workflows:setup`).

This command REQUIRES a `<planDir>` positional arg.

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token is the planDir,
  exactly the `result.planDir` printed by the pipeline commands (e.g.
  `docs/parser/feature/add-retry-layer`). A bare `plan.md` path is also accepted (`/plan.md`
  suffix stripped).

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "status",
    resume: <planDir>
  }
})
```

When the workflow returns its result JSON:
- Print `result.statusReport` verbatim (it is a preformatted multi-line report).
- If `blockedAt === 'missing-plan-dir'`: the planDir positional was missing — show usage.
- If `blockedAt === 'resume-no-state'`: no `pipeline-state.json` exists at that planDir — there is
  no run to report on; suggest `/design-feature` to start one.
- If the report contains a validation WARNING line, point it out: the state file may be truncated
  or corrupt, and the report is best-effort.
- Finish by repeating the report's `Next:` line as the recommended action.

Examples:

```
/pipeline-status docs/parser/feature/add-retry-layer
/pipeline-status docs/parser/feature/add-retry-layer/plan.md
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`). The project copy at
`.claude/workflows/feature-pipeline.js` is installed by `/feature-workflows:setup` and overwritten on
re-run — edit the plugin source, not the copy.
