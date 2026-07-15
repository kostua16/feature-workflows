---
description: FIX flow — read issues-and-improvements.md -> derive minimal gate-revisit plan -> refine those design gates in place -> preserve done stages -> re-enable designReady. Then re-run /implement-feature.
argument-hint: <planDir> [--no-confirm] [--no-reconcile] [--no-enhancer] [--no-quick-decider] [--decision-cap=N] [--retries=N] [--max-reconcile-iterations=N]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*), Bash(mktemp:*), Bash(rm:*)
---

Run the `feature-pipeline` workflow in **tune mode** — the FIX flow that consumes
`issues-and-improvements.md` (written by a prior `/implement-feature` upstream-defect handoff —
from a goalkeeper loop-back or from blocker-severity code-review findings classified as upstream —
by an `/extract-design` as-is design audit, or by a `/review-design` design-docset review), derives
a minimal design-gate revisit plan, refines
only those gates in place, preserves completed plan stages, then re-enables `designReady` so you
can re-run `/implement-feature`.

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

This command REQUIRES a `<planDir>` positional arg and an `issues-and-improvements.md` at that dir.
The issues file comes from a prior `/implement-feature` run that hit
`blockedAt === 'issues-handoff'`, an `/extract-design` run whose design audit recorded findings
(in the multi-slice layout, pass the slice dir: `<planDir>/slices/<id>`), or a `/review-design`
run that recorded confirmed design-review findings.

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token (not a flag and
  not a flag value) is the planDir. Hydrate persisted pipeline state at `<planDir>/pipeline-state.json`.
  `<planDir>` = the plan dir shared across design/implement/tune. A bare `plan.md` path also accepted
  (`/plan.md` suffix stripped). `task` is optional — resolved from the persisted state.
- `--no-confirm`: if present → `useTuneConfirm: false` (skip the confirmation stop; run the derived gate-revisit plan directly — for CI/batch. Default **enabled** — the engine stops at `tune-awaiting-confirm` and YOU confirm with the user; see the **Confirmation loop** section)
- `--no-reconcile`: → `useReconcile: false` (skip the post-tune plan↔design re-reconcile)
- `--no-enhancer`: → `useEnhancer: false`
- `--no-quick-decider`: → `useQuickDecider: false`
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20; shared global budget)
- `--max-reconcile-iterations=N`: → `maxReconcileIterations` (default 5)

Note: tune mode does NOT re-run the full design chain or the DO chain. It runs a TARGETED subset: read
issues → derive gates → (confirm) → revisit only those gates in refine mode (critical-reviewer +
design-reviser revise the EXISTING artifact in place, not rewrite) → re-reconcile → invalidate only
affected stages → set `designReady=true` → stop.

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "tune",
    resume: <planDir>,
    useTuneConfirm: <bool>,
    useReconcile: <bool>,
    useEnhancer: <bool>,
    useQuickDecider: <bool>,
    decisionCap: <int>,
    retryBudget: <int>,
    maxReconcileIterations: <int>
  }
})
```

## Confirmation loop

Unless `--no-confirm` was given, the engine derives the gate-revisit plan and then STOPS with
`blockedAt === 'tune-awaiting-confirm'` — it cannot ask the user itself (workflow subagents have
no AskUserQuestion). YOU must run the loop:

1. Call AskUserQuestion presenting `result.handoff.planGates` (gates to revisit) and
   `result.handoff.preserveStages` (stages kept), with options: **Run as-is** / **Edit the gate
   set** (collect a subset/reorder of `requirements|architecture|design|plan`) / **Cancel**.
2. Re-invoke the Workflow with `mode: "tune"`, `resume: <planDir>`, plus ONE of:
   - Run as-is → `confirmTune: true`
   - Edited → `confirmTune: true, finalGates: [<the user's gate list>]`
   - Cancel → `cancelTune: true`
3. On confirm the tune run proceeds to completion; on cancel it exits with
   `blockedAt === 'tune-cancelled'`.

`result.handoff.message` carries these exact re-invoke recipes — follow them verbatim.

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first.
- If `result.designReady === true` after tune (success path): state "Tune complete." Show the revisited gates (`result.handoff.revisitedGates`), stages reset count (`result.handoff.stagesReset`), reconcile consistency (`result.reconcile`), and print `result.handoff.message` verbatim — it tells the user to re-run `/implement-feature <planDir>`.
- If `blockedAt === 'tune-no-issues'`: no issues-and-improvements.md (or no gates derived). Print `result.handoff.message` and stop — the user must run `/implement-feature <planDir>` first to surface upstream defects.
- If `blockedAt === 'tune-awaiting-confirm'`: run the **Confirmation loop** above — do not just report and stop.
- If `blockedAt === 'tune-cancelled'`: the user cancelled the confirmation. Re-runnable with `<planDir>`.
- If `blockedAt === 'uncaught-throw'`: an escaping error tripped the safety net (see `result._uncaughtError`); `pipeline-state.json` was written, so re-runnable with `<planDir>`.

Examples:

```
/tune-feature docs/parser/feature/add-retry-layer
/tune-feature docs/parser/feature/add-retry-layer --no-confirm
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically. After editing, validate as **ES module** — see the **Validation** section
in the `feature-pipeline.md` reference next to the engine. Plain `node --check` parses as CommonJS
and silently passes invalid ESM; use the `--input-type=module` recipe there.
