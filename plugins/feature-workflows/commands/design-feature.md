---
description: THINK-only feature pipeline (define -> requirements -> arch -> design -> plan -> tdd -> reconcile -> review/refine -> chunk into stages). Stops pre-execute. Run /implement-feature next.
argument-hint: <task description> [--plan=PLAN_PATH] [--definition=DEF_PATH] [--profile=full|standard|light] [--approval] [--from-gate=requirements|architecture|design|plan] [--no-chunker] [--no-knowledge] [--no-arch] [--no-design] [--no-e2e] [--no-tdd-enforce] [--no-reconcile] [--no-requirements] [--no-explorer] [--no-enhancer] [--no-quick-decider] [--no-interview] [--no-translator] [--no-categorizer] [--no-publish] [--no-persist] [--no-parallel] [--decision-cap=N] [--retries=N] [--max-reconcile-iterations=N] [--timestamp=TS] [--resume <planDir>]
allowed-tools: Workflow, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*)
---

Run the `feature-pipeline` workflow in **design mode** — the THINK-only flow that produces all
pre-execute documents + the plan + plan STAGE files, then stops before any code executes.

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
- `--profile=full|standard|light`: → `profile` (preset defaults for the gate-control flags below; individual `--no-*` flags still override. `light` = small-task preset that drops the opus review/enhancer/quick-decider loops + arch/detailed-design/reconcile/e2e gates. Default `full`.)
- `--no-explorer`: → `useExplorer: false` (skip Gate 0.2 codebase-facts)
- `--no-enhancer`: → `useEnhancer: false` (skip prompt-enhancer at retry sites)
- `--no-quick-decider`: → `useQuickDecider: false` (blind-cap loops at boundaries)
- `--no-interview`: → `useInterview: false` (stop-and-surface on needsClarification)
- `--no-translator`: → `useTranslator: false` (skip Gate -1 non-English translation)
- `--no-categorizer`: → `useCategorizer: false` (planDir falls back to `docs/uncategorized/feature/<leaf>/`)
- `--no-publish`: → `usePublish: false` (skip docs-architecture-publisher — runs at end even though execute stops, since design docs are publishable)
- `--no-persist`: → `useKnowledgePersist: false` (skip knowledge-persist)
- `--no-parallel`: → `allowParallelExecute: false` (affects intra-stage parallelism in implement)
- `--approval`: if present → `useApproval: true` (human design-approval checkpoint at the design-stop; see the **Approval loop** section. Default **off** — the run ends at `designReady` without asking)
- `--from-gate=<gate>`: → `fromGate` (`requirements`|`architecture`|`design`|`plan`; only with `--resume`. Deterministically clears that gate + every downstream completion flag so those gates re-run — a user-driven version of the goalkeeper rewind. One-shot: applies to this invocation only)
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
    profile: <"full"|"standard"|"light">,
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
    resume: <planDir or "">,
    useApproval: <bool>,
    fromGate: <"requirements"|"architecture"|"design"|"plan" or "">
  }
})
```

## Approval loop (`--approval`)

With `--approval`, the engine stops at the design-stop with `blockedAt === 'awaiting-approval'`
instead of finishing (`approvalPending: true`; the artifacts and stages are complete). The engine
CANNOT ask the user itself (workflow subagents have no AskUserQuestion) — YOU must run the loop:

1. Call AskUserQuestion with the stage list from `result.handoff.stages` and exactly these
   options: **Approve stages as-is** / **Edit stage boundaries** (collect the user's edit text) /
   **Reject back to Plan**.
2. Re-invoke the Workflow with `mode: "design"`, `resume: <result.planDir>`, plus ONE of:
   - Approve → `approveDesign: true`
   - Edit → `stageEdits: "<the user's edit text>"` (the plan-chunker re-runs with the edits,
     then the engine stops at `awaiting-approval` again — repeat from step 1)
   - Reject → `rejectToPlan: true` (the plan + downstream gates and the stage split re-run,
     then the engine stops at `awaiting-approval` again — repeat from step 1)
3. Repeat until the result has `designApproved.approved === true` (normal design-stop handoff)
   or the user cancels (just stop; the run stays resumable).

`result.handoff.message` carries these exact re-invoke recipes — follow them verbatim.

When the workflow returns its result JSON, report it concisely:
- Always print `result.planDir` first (the dynamic `docs/.../feature/<leaf>/` dir). If `result._categorization` is set, show `category/subCategory`.
- In design mode the run ENDS after plan acceptance + (optional) chunking + publish/persist — NO code executes. State this plainly: "Design ready — nothing executed yet."
- If `designReady === true`: list the produced artifacts — `definitionPath`, `requirementsPath`, `archPath`, `designPath`, `useCasePath`, `planPath`, `codebase-facts`, and the `stageNN.md` files (`result.stages`: show count + each stage's `id`/`name`/`files`). Show `reconcile` consistency, `yagniWarnings`, the plan-acceptance outcome (`planAccepted && !forceAccepted` = clean accept; `forceAccepted === true` = force-accepted at Gate 2 — list `carriedBlockers`), and `published`/`persist` results.
- Print `result.handoff.message` verbatim — it tells the user the next step: `/implement-feature <planDir>`.
- If `needsClarification === true` (Gate 0): the `user-interviewer` tried to resolve inline; if `interview.resolved === false` (or `--no-interview`), present remaining `openQuestions` numbered and stop. Do NOT proceed until answered; on answer re-run with answers folded into `task`.
- If `blockedAt === 'awaiting-approval'`: run the **Approval loop** above — do not just report and stop.
- If `blockedAt === 'bad-args'`: an invalid `--from-gate` value; print `result.handoff.message` (it lists the valid targets).
- If `blockedAt` is set otherwise: name the blocking gate (`define`/`requirements`/`architecture`/`detailed-design`/`e2e-usecases`/`plan`/`tdd-enforce`/`review`/`uncaught-throw`), show the relevant detail, and note it is `--resume`-able: `/design-feature --resume <planDir>`.

Examples:

```
/design-feature Add SQL-file categorization via @/@@ SQL*Plus directive parsing
/design-feature Refactor report filters into a composable pipeline --no-chunker
/design-feature Big multi-module feature --no-parallel
/design-feature --resume docs/parser/feature/add-retry-layer
```

Note: `--resume` also accepts a dir produced by `/extract-design` (or one of its `slices/<id>/`
sub-dirs) — the extracted as-is docs become the refine baseline for a forward design pass.

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically. After editing, validate as **ES module** — see the **Validation** section
in the `feature-pipeline.md` reference next to the engine. Plain `node --check` parses as CommonJS
and silently passes invalid ESM; use the `--input-type=module` recipe there.
