---
description: EXTRACT flow — reverse-engineer design docs (code facts -> e2e use cases -> detailed design -> architecture [-> requirements]) from existing code, slice by slice; audit for design debt. Output is a /tune-feature- and /design-feature-compatible baseline.
argument-hint: <scope: free text, paths/globs, or entry points> [--plan=PLAN_PATH] [--profile=full|standard|light] [--no-confirm] [--no-decompose] [--max-slices=N] [--slices=id1,id2] [--no-audit] [--no-requirements] [--no-review] [--no-e2e] [--no-arch] [--no-design] [--no-enhancer] [--no-quick-decider] [--no-translator] [--no-categorizer] [--no-publish] [--no-persist] [--decision-cap=N] [--retries=N] [--timestamp=TS] [--resume <planDir>]
allowed-tools: Workflow, AskUserQuestion, Read, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*)
---

Run the `feature-pipeline` workflow in **extract mode** — the reverse flow that explores EXISTING
code and extracts its design: code facts -> observable e2e use cases -> detailed design (as built)
-> high-level architecture (as built) [-> fidelity review] [-> reverse-derived requirements]
[-> as-is design audit]. A wide scope (large directory / whole repo) is decomposed into
feature/subsystem slices, each extracted in its own `slices/<id>/` docset with a top-level
`system-overview.md`. All artifacts reuse the forward-pipeline names, so the output dir is a
ready baseline for `/tune-feature <dir>` (fix audit findings) and `/design-feature --resume <dir>`
(design on top of the as-is docs).

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
- `task`: everything except the flags (required, UNLESS `--resume` is given). This is the
  extraction scope input — free text ("the authentication flow"), paths/globs (`src/auth/**`),
  entry points (API routes, CLI commands), or any mix. Passed verbatim to the scope resolver.
- `--resume <planDir>`: → `resume: <planDir>` (hydrate persisted state; `task` optional — resolved
  from state). A bare `plan.md` path also accepted (`/plan.md` suffix stripped).
- `--plan=PATH`: → `planPath` (**OPTIONAL — do NOT pass a default**). When absent, pass
  `planPath: ""` so the workflow derives the dynamic planDir `docs/{category}/{sub}/extract/{leaf}/`
  via the feature-categorizer. Ignored on `--resume`.
- `--profile=full|standard|light`: → `profile` (`standard` drops the fidelity review; `light` also
  drops reverse requirements + the audit. Default `full`. The core extraction gates — code facts,
  e2e use cases, detailed design, architecture — are profile-independent in extract mode: the
  engine re-derives them with default ON, so a profile never reduces the run to facts-only; use
  the explicit `--no-e2e`/`--no-arch`/`--no-design` flags to drop them.)
- `--no-confirm`: → `useScopeConfirm: false` (skip the scope-confirmation checkpoint; extraction
  runs fully autonomous after scope resolution. Default **enabled**.)
- `--no-decompose`: → `useDecompose: false` (never slice — extract the whole scope as one docset
  even when the scope resolver flags it wide)
- `--max-slices=N`: → `maxSlices` (cap on slices extracted per run; excess slices are recorded as
  `skipped` in the queue and can be resumed later. Default 8.)
- `--slices=id1,id2`: → `slices: ["id1","id2"]` (extract ONLY these slice ids; the rest are
  recorded as `skipped`)
- `--no-audit`: → `useAudit: false` (skip the as-is design audit + its issues-and-improvements.md
  handoff)
- `--no-requirements`: → `useExtractRequirements: false` (skip reverse-derived requirements)
- `--no-review`: → `useExtractReview: false` (skip the fidelity review loops on the extracted
  detailed design + architecture)
- `--no-e2e`: → `useE2eUsecase: false` (skip observable e2e use-case extraction)
- `--no-arch`: → `useArchDesign: false` (skip architecture abstraction)
- `--no-design`: → `useDetailedDesign: false` (skip detailed-design extraction)
- `--no-enhancer`: → `useEnhancer: false`
- `--no-quick-decider`: → `useQuickDecider: false`
- `--no-translator`: → `useTranslator: false`
- `--no-categorizer`: → `useCategorizer: false` (planDir falls back to `docs/uncategorized/extract/<leaf>/`)
- `--no-publish`: → `usePublish: false`
- `--no-persist`: → `useKnowledgePersist: false`
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20; shared global budget)
- `--timestamp=<TS>`: → `timestamp` (planDir leaf when no JIRA id in task)

Then call the Workflow tool:

```
Workflow({
  name: "feature-pipeline",
  args: {
    mode: "extract",
    task: <task>,
    planPath: <PATH or "">,
    profile: <"full"|"standard"|"light">,
    useScopeConfirm: <bool>,
    useDecompose: <bool>,
    useAudit: <bool>,
    useExtractRequirements: <bool>,
    useExtractReview: <bool>,
    useE2eUsecase: <bool>,
    useArchDesign: <bool>,
    useDetailedDesign: <bool>,
    useEnhancer: <bool>,
    useQuickDecider: <bool>,
    useTranslator: <bool>,
    useCategorizer: <bool>,
    usePublish: <bool>,
    useKnowledgePersist: <bool>,
    maxSlices: <int>,
    slices: <["id", ...] or []>,
    decisionCap: <int>,
    retryBudget: <int>,
    timestamp: <TS or "">,
    resume: <planDir or "">
  }
})
```

Do NOT pass `scopeConfirmed` on the first invocation — it is the confirmation payload for the
checkpoint loop below, and passing `scopeConfirmed: false` cancels the run.

## Scope-confirmation loop (IMPORTANT)

Subagents inside the workflow cannot use AskUserQuestion, so scope confirmation is a
pause-and-resume checkpoint driven by YOU (the main session):

1. If the returned result has `handoff.status === "awaiting-scope-confirm"`: the engine paused
   after resolving the scope. Present `handoff.scopeSummary` to the user via **AskUserQuestion**:
   show the file count + key files, entry points, `confidence`, and (when `wide`) the
   `suggestedSlices`. Read `result.scopeManifestPath` for detail if the summary is not enough.
   Offer: **approve as-is** / **adjust** (user supplies a corrected file list and/or slice ids) /
   **cancel**.
2. Re-invoke the Workflow tool with the confirmation payload:
   ```
   Workflow({ name: "feature-pipeline", args: {
     mode: "extract", resume: <result.planDir>,
     scopeConfirmed: <true | false>,        // false = cancel
     scopeFiles: <[adjusted files] or omit>, // only when the user adjusted the file list
     slices: <[selected slice ids] or omit>  // only when the user narrowed the slices
   }})
   ```
3. Continue reporting from whatever that second call returns. The whole loop is ONE user-visible
   command invocation. A run interrupted at the checkpoint resumes through the same leg:
   `/extract-design --resume <planDir>` re-returns `awaiting-scope-confirm`.

When the workflow returns its final result JSON, report it concisely:
- Always print `result.planDir` first. If `result._categorization` is set, show `category/subCategory`.
- If `extractReady === true`: state "Extraction complete — as-is design docs written." List the
  scope manifest (`scopeManifestPath`), the slice table from `handoff.slices` (id / name / status /
  planDir), and per slice (or flat for a single slice): `codebase-facts.md`, `e2e-use-cases.md`,
  `detailed-design.md`, `architecture.md`, `requirements.md`, `design-audit.md`. Show
  `overviewPath` when set. If audits recorded findings, say the counts and that they are in
  `issues-and-improvements.md`. Print `result.handoff.message` verbatim — it names the follow-up
  commands (`/tune-feature`, `/design-feature --resume`).
- If `blockedAt` is set, explain and note resumability (`/extract-design --resume <planDir>`):
  - `extract-scope`: the input could not be resolved into concrete code — re-run with more
    specific paths/entry points.
  - `extract-cancelled`: the user cancelled at scope confirmation.
  - `extract-budget`: retry budget exhausted mid-queue — completed slices preserved.
  - `artifact-missing`: a done slice's mandated artifact failed verification (`result.artifactChecks`).
  - `uncaught-throw`: inspect `<planDir>/pipeline.log`.

Examples:

```
/extract-design the authentication and session-management flow
/extract-design src/parser/** --no-requirements
/extract-design the whole engine at plugins/feature-workflows/workflows/ --max-slices=4
/extract-design api routes in server/routes.js and their handlers --no-confirm
/extract-design --resume docs/parser/extract/auth-flow
```

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically. After editing, validate as **ES module** — see the **Validation** section
in the `feature-pipeline.md` reference next to the engine. Plain `node --check` parses as CommonJS
and silently passes invalid ESM; use the `--input-type=module` recipe there.
