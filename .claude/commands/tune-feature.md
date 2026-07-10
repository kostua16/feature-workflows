---
description: FIX flow — read issues-and-improvements.md -> derive minimal gate-revisit plan -> refine those design gates in place -> preserve done stages -> re-enable designReady. Then re-run /implement-feature.
argument-hint: <planDir> [--no-confirm] [--no-reconcile] [--no-enhancer] [--no-quick-decider] [--decision-cap=N] [--retries=N] [--max-reconcile-iterations=N]
allowed-tools: Workflow
---

Run the `feature-pipeline` workflow in **tune mode** — the FIX flow that consumes
`issues-and-improvements.md` (written by a prior `/implement-feature` upstream-defect handoff),
derives a minimal design-gate revisit plan, refines only those gates in place, preserves completed
plan stages, then re-enables `designReady` so you can re-run `/implement-feature`.

This command REQUIRES a `<planDir>` positional arg (the planDir from your `/implement-feature` handoff)
and a prior `/implement-feature` run that hit `blockedAt === 'issues-handoff'` (so
`issues-and-improvements.md` exists at `<planDir>`).

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token (not a flag and
  not a flag value) is the planDir. Hydrate persisted pipeline state at `<planDir>/pipeline-state.json`.
  `<planDir>` = the plan dir shared across design/implement/tune. A bare `plan.md` path also accepted
  (`/plan.md` suffix stripped). `task` is optional — resolved from the persisted state.
- `--no-confirm`: if present → `useTuneConfirm: false` (skip the AskUserQuestion confirmation; run the derived gate-revisit plan directly — for CI/batch. Default **enabled** — confirms the derived plan with the user)
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

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first.
- If `result.designReady === true` after tune (success path): state "Tune complete." Show the revisited gates (`result.handoff.revisitedGates`), stages reset count (`result.handoff.stagesReset`), reconcile consistency (`result.reconcile`), and print `result.handoff.message` verbatim — it tells the user to re-run `/implement-feature <planDir>`.
- If `blockedAt === 'tune-no-issues'`: no issues-and-improvements.md (or no gates derived). Print `result.handoff.message` and stop — the user must run `/implement-feature <planDir>` first to surface upstream defects.
- If `blockedAt === 'tune-cancelled'`: the user cancelled the confirmation. Re-runnable with `<planDir>`.
- If `blockedAt === 'uncaught-throw'`: an escaping error tripped the safety net (see `result._uncaughtError`); `pipeline-state.json` was written, so re-runnable with `<planDir>`.

Examples:

```
/tune-feature docs/parser/feature/add-retry-layer
/tune-feature docs/parser/feature/add-retry-layer --no-confirm
```

## Editing the workflow script

After editing `.claude/workflows/feature-pipeline.js`, validate it as **ES module** — see the
**Validation** section in `.claude/workflows/feature-pipeline.md`. Plain `node --check` parses as
CommonJS and silently passes invalid ESM; use the `--input-type=module` recipe there.
