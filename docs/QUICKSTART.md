# Quickstart — feature-workflows plugin

## 1. Install

Inside any Claude Code project:

```
/plugin marketplace add kostua16/feature-workflows
/plugin install feature-workflows@feature-workflows
```

For local development of this repo, add the marketplace from a path instead:

```
/plugin marketplace add /path/to/feature-workflows
```

Restart the session so the plugin's commands and agents load.

## 2. One-time project setup

```
/feature-workflows:setup
```

Why: Claude Code's Workflow tool resolves dynamic workflows **only** from the project's
`.claude/workflows/` directory — plugins cannot ship workflows directly. `setup` copies the
`feature-pipeline.js` engine (plus its reference docs) from the plugin into your project and
validates it as an ES module. Until you run it, the pipeline commands stop at their preflight
with a "run `/feature-workflows:setup` first" message.

Consider adding `.claude/workflows/` to your project's `.gitignore` — the installed copy is
derived from the plugin, not a source of truth.

## 3. The design → implement → tune loop

```
/feature-workflows:design-feature Add SQL-file categorization via @/@@ directive parsing
```

THINK-only: produces definition, requirements, architecture, detailed design, e2e use cases,
plan, and dependency-ordered `stageNN.md` files under a dynamic `docs/.../feature/<leaf>/`
planDir — then **stops before any code executes**. Note the printed `planDir`.
Add `--approval` to insert a human sign-off checkpoint (approve / edit stage boundaries /
reject back to plan) before the design is marked ready.

```
/feature-workflows:implement-feature <planDir>
```

DO: executes the stages, runs tests, code-reviews, and (opt-in via `--auto-commit`) commits.
If it finds an upstream design defect (goalkeeper loop-back or blocker-severity code-review
findings) it writes `issues-and-improvements.md` and stops. After a manual edit you can re-run
just one stage with `--stage=stageNN`, or rewind a gate with `--from-gate=execute|tests`.

```
/feature-workflows:tune-feature <planDir>
```

FIX: consumes the issues file, revisits only the affected design gates, preserves completed
stages, and re-enables `designReady` — then re-run `/feature-workflows:implement-feature`.

All modes are resumable: `--resume <planDir>` (or just re-run implement/tune with `<planDir>`).

At any point, inspect a run without touching it:

```
/feature-workflows:pipeline-status <planDir>
```

Read-only report: mode, gates done/blocked, stage table, budgets used, per-gate telemetry,
open questions, and the exact next command to run.

## 4. Updating

```
/plugin update feature-workflows
/feature-workflows:setup        # re-copy the engine; preflights warn on version drift until you do
```

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Pipeline command stops with "run /feature-workflows:setup first" | Engine not installed in this project — run `/feature-workflows:setup`. |
| Preflight warns "installed engine is outdated" | Plugin updated but project copy stale — re-run `/feature-workflows:setup`. |
| `setup` reports a SyntaxError | The copied engine failed ESM validation — re-install the plugin; if it persists, file an issue. |
| `Workflow` tool not found / workflows disabled | Enable Dynamic workflows in `/config` (requires Claude Code v2.1.154+). |
| Agents like `feature-workflows:plan-architect` missing | Plugin not installed/enabled, or session not restarted after install. |
