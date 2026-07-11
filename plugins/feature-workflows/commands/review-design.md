---
description: INSPECT flow — audit an existing planDir design docset through parallel review lenses (consistency/completeness/feasibility/testability/scope) -> adversarially verify -> design-review.md report + tune-consumable issues-and-improvements.md. Then run /tune-feature to fix.
argument-hint: <planDir> [--lenses=key1,key2] [--min-severity=blocker|high|medium|low] [--no-verify] [--no-enhancer] [--no-quick-decider] [--decision-cap=N] [--retries=N]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*)
---

Run the `feature-pipeline` workflow in **review mode** — the INSPECT flow that audits an EXISTING
design docset (produced by `/design-feature`, `/extract-design`, or a prior `/tune-feature`) and
COLLECTS all design issues without changing anything. One reviewer per review lens reads the whole
docset, the findings are deduplicated (across lenses AND against issues already recorded), each
survivor is adversarially verified, and the result lands in two places:

- `<planDir>/design-review.md` — the full report (every confirmed finding, all severities)
- `<planDir>/issues-and-improvements.md` — the actionable, gate-mapped findings appended in the
  exact section format `/tune-feature` consumes

Review never edits design artifacts, never touches `designReady`, and never resets stages — fixing
stays in `/tune-feature <planDir>`. This makes review safe to run at any point: pre-implement as a
design quality gate, post-extract as a deeper second-opinion audit, or after a tune pass to confirm
the revisions did not introduce new inconsistencies.

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

This command REQUIRES a `<planDir>` positional arg pointing at a dir with a `pipeline-state.json`
(in the multi-slice extract layout, pass the slice dir: `<planDir>/slices/<id>`).

Parse `$ARGUMENTS` into:
- `<planDir>` (positional, REQUIRED): → `resume: <planDir>`. The first bare token (not a flag and
  not a flag value) is the planDir. A bare `plan.md` path also accepted (`/plan.md` suffix
  stripped). `task` is optional — resolved from the persisted state.
- `--lenses=key1,key2`: → `reviewLenses: ["key1","key2"]` (run ONLY these review dimensions.
  Valid keys: `consistency`, `completeness`, `feasibility`, `testability`, `scope`. Default: all 5.)
- `--min-severity=<sev>`: → `minSeverity` (`blocker`|`high`|`medium`|`low`; findings BELOW this
  severity appear in design-review.md but are NOT recorded to issues-and-improvements.md. Default
  `low` — record everything gate-mapped.)
- `--no-verify`: → `useReviewVerify: false` (skip the adversarial-verification pass; faster, but
  unrefuted false positives may reach the issues file and send tune revising healthy docs)
- `--no-enhancer`: → `useEnhancer: false`
- `--no-quick-decider`: → `useQuickDecider: false`
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20; shared global budget)

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "review",
    resume: <planDir>,
    reviewLenses: <["key", ...] or []>,
    minSeverity: <"blocker"|"high"|"medium"|"low">,
    useReviewVerify: <bool>,
    useEnhancer: <bool>,
    useQuickDecider: <bool>,
    decisionCap: <int>,
    retryBudget: <int>
  }
})
```

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first.
- If `result.designReview` is set (success path): state "Design review complete." Show the summary
  counts (`result.designReview`: lenses, docsReviewed, raw, confirmed, refuted, droppedDuplicates,
  recorded), the report path (`result.reviewPath`), and — when findings were recorded — the issues
  file (`result.issuesPath`). Print `result.handoff.message` verbatim — it names the next command
  (`/tune-feature <planDir>` when issues were recorded; otherwise the docset stands as-is).
- If `blockedAt === 'review-requires-plandir'`: no planDir/state was given. Print
  `result.handoff.message` and stop.
- If `blockedAt === 'resume-no-state'`: the dir has no `pipeline-state.json` — point the user at
  `/design-feature` or `/extract-design` to produce a reviewable docset first.
- If `blockedAt === 'review-no-artifacts'`: the state records no design artifacts (e.g. a run that
  blocked before any doc was written). Print `result.handoff.message`.
- If `blockedAt === 'design-review'`: every lens reviewer failed. Re-runnable:
  `/review-design <planDir>`.
- If `blockedAt === 'review-record-failed'`: actionable findings were confirmed but the
  `issues-and-improvements.md` append failed — nothing was recorded for tune (the report at
  `result.reviewPath` still carries every confirmed finding). Print `result.handoff.message` and
  re-run `/review-design <planDir>` — re-runs are dedup-safe.
- If `blockedAt === 'uncaught-throw'`: an escaping error tripped the safety net (see
  `result._uncaughtError`); re-runnable with `<planDir>`.

Examples:

```
/review-design docs/parser/feature/add-retry-layer
/review-design docs/parser/extract/auth-flow/slices/session-mgmt
/review-design docs/parser/feature/add-retry-layer --lenses=consistency,feasibility --min-severity=medium
/review-design docs/parser/feature/add-retry-layer --no-verify
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`). The project copy at
`.claude/workflows/feature-pipeline.js` is installed by `/feature-workflows:setup` and overwritten on
re-run — edit the plugin source, not the copy. After editing, validate as **ES module** — see the
**Validation** section in the `feature-pipeline.md` reference next to the engine. Plain `node --check`
parses as CommonJS and silently passes invalid ESM; use the `--input-type=module` recipe there.
