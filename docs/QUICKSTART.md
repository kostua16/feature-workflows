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

## 2. No project setup

There is nothing to install into your project. Claude Code's Workflow tool resolves dynamic
workflows from user-level `~/.claude/workflows/` as well as the project's `.claude/workflows/`;
the pipeline commands automatically create (and repair) symlinks in `~/.claude/workflows/`
pointing at the plugin's `feature-pipeline.js` engine and reference docs. Plugin updates
propagate through the symlinks instantly — no re-install step, no files in your repo.

`/feature-workflows:setup` still exists as a **doctor/repair** command: it diagnoses the
user-level links (dangling/stale/copy-fallback), recreates them, validates the plugin engine as
an ES module, and offers to remove legacy per-project copies left by pre-1.5.0 installs.

### Upgrading from ≤1.4.x

Older versions copied the engine into each project's `.claude/workflows/`. A leftover project
copy **shadows** the user-level engine, so the command preflights detect it and point you at
`/feature-workflows:setup`, which removes it (with confirmation). The old advice to gitignore
`.claude/workflows/` is obsolete — that entry can be dropped once the legacy copy is gone.

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

### Optional quality gate: review the design docset before implementing

```
/feature-workflows:review-design <planDir>
```

INSPECT: audits the whole design docset through parallel review lenses (cross-artifact
consistency, completeness, feasibility vs the codebase, testability, scope discipline),
adversarially verifies every finding, and writes `design-review.md` plus tune-consumable
entries in `issues-and-improvements.md` — without changing a single artifact. If issues were
recorded, `/feature-workflows:tune-feature <planDir>` fixes them; if not, proceed to implement.
Also useful after `extract-design` (deeper second opinion on the as-is audit) or after a tune
pass (confirm the revisions didn't introduce new inconsistencies).

At any point, inspect a run without touching it:

```
/feature-workflows:pipeline-status <planDir>
```

Read-only report: mode, gates done/blocked, stage table, budgets used, per-gate telemetry,
open questions, and the exact next command to run.

### Brownfield entry point: extract the design of existing code

```
/feature-workflows:extract-design the authentication flow in src/auth/
```

REVERSE: explores the existing code and extracts as-is design docs (code facts, observable e2e
use cases, detailed design, architecture, reverse-derived requirements) plus a design-debt audit
into `docs/.../extract/<leaf>/`. You confirm the resolved scope once, then it runs autonomously;
wide scopes are split into per-subsystem slices. The output dir is a ready baseline:
`/feature-workflows:tune-feature <dir>` fixes the audit findings, and
`/feature-workflows:design-feature --resume <dir>` designs new work on top of the as-is docs.

## 4. Updating

```
/plugin update feature-workflows
```

Nothing else to do — the user-level symlink tracks the plugin, so the next pipeline command
runs the updated engine (and self-repairs the link if the plugin path changed). Note this also
means a `--resume` after an update runs the newer engine against state written by the older
one; the engine logs a version-skew warning on the resumed run when that happens.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Pipeline command stops directing you to `/feature-workflows:setup` | Auto-repair could not create the user-level link/copy — run `/feature-workflows:setup` for a diagnosis. |
| Preflight reports a legacy project copy | Pre-1.5.0 install left `.claude/workflows/` files that shadow the user-level engine — run `/feature-workflows:setup` to remove them. |
| Symlink creation fails (e.g. Windows without developer mode) | The preflight falls back to a user-level copy automatically and re-copies on version drift — nothing to do; `/feature-workflows:setup` reports which mode is active. |
| `setup` reports a SyntaxError | The plugin engine failed ESM validation — re-install/update the plugin; if it persists, file an issue. |
| `Workflow` tool not found / workflows disabled | Enable Dynamic workflows in `/config` (requires Claude Code v2.1.154+). |
| Agents like `feature-workflows:plan-architect` missing | Plugin not installed/enabled, or session not restarted after install. |
