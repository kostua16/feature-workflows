---
description: Read-only status report for a feature-pipeline run — mode, gates done/blocked, stage table, budgets used, telemetry, open questions, and the exact next command.
argument-hint: <planDir>
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*)
---

Run the `feature-pipeline` workflow in **status mode** — a strictly read-only inspection of a
persisted run. It loads `<planDir>/pipeline-state.json`, validates it, and renders a report:
mode, gate progress, stage table, budgets used, per-gate telemetry, open questions/issues, and
the exact next command (`/implement-feature …` / `/tune-feature …` / `/review-design …` /
`/design-feature --resume …`).
It writes NOTHING — no state flush, no checkpoint — so it is always safe to run, including on a
blocked, mid-run, or corrupt pipeline.

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
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically.
