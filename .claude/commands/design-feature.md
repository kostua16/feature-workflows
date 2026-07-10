---
description: THINK-only feature pipeline (define -> requirements -> arch -> design -> plan -> tdd -> reconcile -> review/refine -> chunk into stages). Stops pre-execute. Run /implement-feature next.
argument-hint: <task description> [--plan=PLAN_PATH] [--definition=DEF_PATH] [--no-chunker] [--no-knowledge] [--no-arch] [--no-design] [--no-e2e] [--no-tdd-enforce] [--no-reconcile] [--no-requirements] [--no-explorer] [--no-enhancer] [--no-quick-decider] [--no-interview] [--no-translator] [--no-categorizer] [--no-publish] [--no-persist] [--no-parallel] [--decision-cap=N] [--retries=N] [--max-reconcile-iterations=N] [--timestamp=TS] [--resume <planDir>]
allowed-tools: Workflow
---

Run the `feature-pipeline` workflow in **design mode** — the THINK-only flow that produces all
pre-execute documents + the plan + plan STAGE files, then stops before any code executes.

Parse `$ARGUMENTS` into:
- `task`: everything except the flags (required, UNLESS `--resume` is given)
- `--resume <planDir>`: → `resume: <planDir>` (hydrate persisted pipeline state at `<planDir>/pipeline-state.json`; `task` optional here — resolved from state). `<planDir>` = original run's plan dir (e.g. `docs/parser/feature/add-retry-layer`). A bare `plan.md` path also accepted (`/plan.md` suffix stripped). Dynamic planDir is NOT re-derived on resume; persisted `planPath` reused verbatim.
- `--plan=PATH`: → `planPath` (**OPTIONAL — do NOT pass a default**). Only set when user typed `--plan=<PATH>`. When absent, pass `planPath: ""` so the workflow runs the `feature-categorizer` to derive the dynamic planDir `docs/{category}/{sub-category}/feature/{leaf}/`. Ignored on `--resume`.
- `--definition=PATH`: → `definitionPath` (optional; default: plan dir /idea.md)
- `--no-chunker`: if present → `useChunker: false` (skip plan-chunker; plan stays a single implicit `stage01` covering the whole plan; default **enabled** — splits plan into `stageNN.md` dependency-ordered stage files)
- `--no-knowledge`: → `useKnowledgeConsult: false` (skip Gate 0.1)
- `--no-arch`: → `useArchDesign: false` (skip Gate 0.5)
- `--no-design`: → `useDetailedDesign: false` (skip Gate 0.6)
- `--no-e2e`: → `useE2eUsecase: false` (skip Gate 0.7)
- `--no-requirements`: → `useRequirements: false` (skip Gate 0.75 + its review loop)
- `--no-tdd-enforce`: → `useTddEnforce: false` (skip Gate 1.5)
- `--no-reconcile`: → `useReconcile: false` (skip Gate 1.7 + design-fix loop)
- `--no-explorer`: → `useExplorer: false` (skip Gate 0.2 codebase-facts)
- `--no-enhancer`: → `useEnhancer: false` (skip prompt-enhancer at retry sites)
- `--no-quick-decider`: → `useQuickDecider: false` (blind-cap loops at boundaries)
- `--no-interview`: → `useInterview: false` (stop-and-surface on needsClarification)
- `--no-translator`: → `useTranslator: false` (skip Gate -1 non-English translation)
- `--no-categorizer`: → `useCategorizer: false` (planDir falls back to `docs/uncategorized/feature/<leaf>/`)
- `--no-publish`: → `usePublish: false` (skip docs-architecture-publisher — runs at end even though execute stops, since design docs are publishable)
- `--no-persist`: → `useKnowledgePersist: false` (skip knowledge-persist)
- `--no-parallel`: → `allowParallelExecute: false` (affects intra-stage parallelism in implement)
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20; shared global budget)
- `--max-reconcile-iterations=N`: → `maxReconcileIterations` (default 5)
- `--timestamp=<TS>`: → `timestamp` (planDir leaf when no JIRA id in task)

Note: JIRA id auto-detected from task text via `[A-Z][A-Z0-9_]+-\d+` and becomes the planDir leaf.

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "design",
    task: <task>,
    planPath: <PATH or "">,
    definitionPath: <PATH or "">,
    useChunker: <bool>,
    useArchDesign: <bool>,
    useDetailedDesign: <bool>,
    useTddEnforce: <bool>,
    useKnowledgeConsult: <bool>,
    useE2eUsecase: <bool>,
    useRequirements: <bool>,
    useReconcile: <bool>,
    useExplorer: <bool>,
    useEnhancer: <bool>,
    useQuickDecider: <bool>,
    useInterview: <bool>,
    useTranslator: <bool>,
    useCategorizer: <bool>,
    usePublish: <bool>,
    useKnowledgePersist: <bool>,
    allowParallelExecute: <bool>,
    decisionCap: <int>,
    retryBudget: <int>,
    maxReconcileIterations: <int>,
    timestamp: <TS or "">,
    resume: <planDir or "">
  }
})
```

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first (the dynamic `docs/.../feature/<leaf>/` dir). If `result._categorization` is set, show `category/subCategory`.
- In design mode the run ENDS after plan acceptance + (optional) chunking + publish/persist — NO code executes. State this plainly: "Design ready — nothing executed yet."
- If `designReady === true`: list the produced artifacts — `definitionPath`, `requirementsPath`, `archPath`, `designPath`, `useCasePath`, `planPath`, `codebase-facts`, and the `stageNN.md` files (`result.stages`: show count + each stage's `id`/`name`/`files`). Show `reconcile` consistency, `yagniWarnings`, the plan-acceptance outcome (`planAccepted && !forceAccepted` = clean accept; `forceAccepted === true` = force-accepted at Gate 2 — list `carriedBlockers`), and `published`/`persist` results.
- Print `result.handoff.message` verbatim — it tells the user the next step: `/implement-feature <planDir>`.
- If `needsClarification === true` (Gate 0): the `user-interviewer` tried to resolve inline; if `interview.resolved === false` (or `--no-interview`), present remaining `openQuestions` numbered and stop. Do NOT proceed until answered; on answer re-run with answers folded into `task`.
- If `blockedAt` is set: name the blocking gate (`define`/`requirements`/`architecture`/`detailed-design`/`e2e-usecases`/`plan`/`tdd-enforce`/`review`/`uncaught-throw`), show the relevant detail, and note it is `--resume`-able: `/design-feature --resume <planDir>`.

Examples:

```
/design-feature Add SQL-file categorization via @/@@ SQL*Plus directive parsing
/design-feature Refactor report filters into a composable pipeline --no-chunker
/design-feature Big multi-module feature --no-parallel
/design-feature --resume docs/parser/feature/add-retry-layer
```

## Editing the workflow script

After editing `.claude/workflows/feature-pipeline.js`, validate it as **ES module** — see the
**Validation** section in `.claude/workflows/feature-pipeline.md`. Plain `node --check` parses as
CommonJS and silently passes invalid ESM; use the `--input-type=module` recipe there.
