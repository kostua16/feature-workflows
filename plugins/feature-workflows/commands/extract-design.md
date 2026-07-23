---
description: EXTRACT flow — reverse-engineer design docs (code facts -> e2e use cases -> detailed design -> architecture [-> requirements]) from existing code, slice by slice; audit for design debt. Output is a /tune-feature- and /design-feature-compatible baseline.
argument-hint: <scope: free text, paths/globs, or entry points> [--plan=PLAN_PATH] [--profile=full|standard|light] [--no-confirm] [--no-decompose] [--max-slices=N] [--slices=id1,id2] [--no-audit] [--no-requirements] [--no-review] [--no-e2e] [--no-arch] [--no-design] [--no-enhancer] [--no-quick-decider] [--no-translator] [--no-categorizer] [--no-publish] [--no-persist] [--decision-cap=N] [--retries=N] [--timestamp=TS] [--resume <planDir>] [--confirm <pendingId>] [--update] [--no-update] [--force] [--feature=<featureId>] [--new] [--adopt <planDir>]
allowed-tools: Workflow, AskUserQuestion, Read, Bash(test:*), Bash(grep:*), Bash(echo:*), Bash(ln:*), Bash(mkdir:*), Bash(cp:*), Bash(readlink:*), Bash(uname:*), Bash(powershell:*), Bash(mktemp:*), Bash(rm:*)
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
- `--plan=PATH`: → `planPath` (**OPTIONAL — do NOT pass a default**). When absent, the workflow
  derives a **deterministic** planDir `docs/extract/<area>/<featureId>/` from file hashes (Phase 13).
  The feature-categorizer is NOT invoked for extract mode. Ignored on `--resume`.
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
- `--no-categorizer`: → `useCategorizer: false` (no effect in extract mode — categorizer is always bypassed; folder is deterministic from hashes)
- `--no-publish`: → `usePublish: false`
- `--no-persist`: → `useKnowledgePersist: false`
- `--decision-cap=N`: → `decisionCap` (default 50)
- `--retries=N`: → `retryBudget` (default 20; shared global budget)
- `--timestamp=<TS>`: → `timestamp` (planDir leaf when no JIRA id in task)
- `--confirm <pendingId>`: → `confirm: <pendingId>` (promote a pending scope checkpoint from a prior
  fresh run. Resolves the pending record, creates the feature folder + identity + pipeline-state,
  and continues extraction. Works even after the 30-day bulky-payload TTL via the permanent locator.)
- `--update`: → `update: true` (explicit update trigger — matches the default behavior for existing
  features. Useful in scripts and combined with `--force`.)
- `--no-update`: → `noUpdate: true` (opt OUT of auto-update. An existing feature continues from where
  it left off without re-detecting changes — the legacy `--resume` behavior for finishing interrupted runs.)
- `--force`: → `force: true` (re-extract all slices regardless of digest changes. Combine with
  `--update` or use on an existing feature to force full re-extraction.)
- `--feature=<featureId>`: → `feature: <featureId>` (select a specific existing feature when the
  registry lookup is ambiguous or to disambiguate a weak match.)
- `--new`: → `newFolder: true` (force a distinct forked folder for the same scope — appends a stable
  disambiguator `<featureId>-<n>` and registers a separate feature. Mutually exclusive with `--feature`.)
- `--adopt <planDir>`: → `adoptPlanDir: <planDir>` (import an existing v1.5 extract folder into the
  registry. Derives the feature identity from the folder's persisted scope, writes `.identity.json` +
  registry entry. Useful after upgrading from v1.5 to v1.6.)

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
    resume: <planDir or "">,
    confirm: <pendingId or "">,
    update: <bool>,
    noUpdate: <bool>,
    force: <bool>,
    feature: <featureId or "">,
    newFolder: <bool>,
    adoptPlanDir: <planDir or "">
  }
})
```

Do NOT pass `scopeConfirmed` on the first invocation — it is the confirmation payload for the
checkpoint loop below, and passing `scopeConfirmed: false` cancels the run.

## Scope-confirmation loop (IMPORTANT)

Subagents inside the workflow cannot use AskUserQuestion, so scope confirmation is a
pause-and-resume checkpoint driven by YOU (the main session):

### Primary path: `--confirm <pendingId>` (D0 protocol)

1. A fresh `/extract-design <scope>` run resolves the scope WITHOUT writing files and returns a
   `pendingId` in `result.handoff.pendingId`. The scope verdict is stored in a pending record at
   `docs/extract/.pending/<pendingId>.json`.
2. Present `handoff.scopeSummary` to the user via **AskUserQuestion**: show the file count + key
   files, entry points, `confidence`, and (when `wide`) the `suggestedSlices`. Offer: **approve** /
   **cancel**.
3. To confirm: `/extract-design --confirm <pendingId>`. This promotes the pending record (creates
   the feature folder, writes scope-manifest.md + .identity.json + pipeline-state.json), and
   continues extraction in one invocation.
4. To cancel: simply don't confirm. The pending record expires after 30 days (bulky payload only;
   the permanent locator entry is retained).

### Fallback: `--resume <planDir>` (post-promotion only)

After promotion, `--resume <planDir>` resumes the extraction flow. Before promotion, `--resume`
fails (no pipeline-state.json exists — use `--confirm` instead).

**Concurrent same-feature invocations are unsupported.**

## Deterministic folder derivation (Phase 13)

Extract folders are **deterministic** — derived from file content hashes, not an LLM categorizer:

- `docs/extract/<area>/<featureId>/` where:
  - `<area>` = first 2 path segments of the lex-smallest non-entry-point file (e.g. `src/auth`)
  - `<featureId>` = `<primarySlug>-<scopeId16>` (slug of anchor filename + first 16 hex of scope digest)
  - Fallback: fewer than 2 segments → `uncategorized`
- The same resolved scope always produces the same folder (across runs, worktrees, clones).
- Per-file `contentSha256` (64-hex) and combined `scopeDigest` (64-hex) are computed by the
  hash-sources agent (the engine sandbox cannot import crypto). Hashes are validated before
  identity selection — missing/malformed hashes **block** folder creation (fail-closed).
- `.identity.json` stores the real `ownershipScopeDigest` (full 64-hex, immutable at creation).
- Use `--feature=<featureId>` to override identity selection when hash validation blocks.

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
  - `confirm-not-found`: the `--confirm <pendingId>` was not found or never existed.
  - `confirm-expired`: the `--confirm <pendingId>` payload expired (30-day TTL) with no locator.
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
/extract-design --confirm a1b2c3d4e5f60718
```

## Feature-identity registry

Each extracted feature is registered in `docs/extract/.registry.json` — a single JSON index of all
extracted features. Each feature folder also has a `.identity.json` sidecar holding the immutable
ownership identity (`ownershipScopeDigest` — the full 64-hex SHA-256 scope digest, fixed at creation).

**Rename-resilient lookup:** when you re-run `/extract-design` on code that has been renamed or
reorganized, the registry finds the existing feature by content hash matching (not just file paths).
A current file matches a registry feature if its path OR `contentSha256` appears in the feature's
file set. This means a full rename of every file still resolves to the same feature folder.

**Defensible threshold:** ambiguous or weak matches are blocked (not silently mismerged). A match is
"strong" only if the anchor file matches OR a majority of files match. Weak-only matches (e.g. two
features sharing only a `package.json`/`tsconfig.json`) are blocked. Use `--feature=<featureId>` to
select a specific feature or `--new` to create a new folder.

**Collision guard:** on new-feature folder creation, if the derived `planDir` already exists with a
different `ownershipScopeDigest`, the upsert is aborted — it will not overwrite another feature's
folder. Same digest is idempotent (safe re-run).

**Startup recovery:** on each run, any registry entries left in `status: 'extracting'` (from an
interrupted run) are reconciled from current `pipeline-state.json`. Entries with complete extraction
evidence are promoted to `current`; entries with missing or incomplete evidence are marked `stale`
(fail-closed). Immutable ownership fields are always sourced from `.identity.json` sidecars, never
from the potentially-stale registry.

**Atomic writes:** all registry and sidecar writes use temp-then-rename to prevent torn JSON on crash.
The root-last readiness commit sets `status` to `current` only after extraction + publish + persist
are durable.

**Concurrency:** concurrent same-feature invocations are explicitly UNSUPPORTED (may corrupt state).
Run one extract/update at a time per feature.

## Auto-update (v1.6.0)

Re-running `/extract-design` on code that resolves to an **existing** feature now defaults to
**auto-update**: change detection runs automatically, and changed slices are re-extracted in place.
This makes "re-run = refresh" the default behavior.

- **Default (no flags):** if the registry lookup finds an existing feature, auto-update runs —
  slices with changed source files are invalidated and re-extracted; unchanged slices skip via
  checkpoint guards.
- `--update`: explicit trigger (same as default — useful in scripts).
- `--no-update`: opt out — just continue an interrupted run without re-detecting changes.
- `--force`: re-extract ALL slices regardless of digest (combine with an existing feature).
- `--feature=<id>`: select a specific feature when the lookup is ambiguous.
- `--new`: create a distinct forked folder (`<featureId>-<n>`) instead of updating the existing one.

**Mutual exclusion:** `--new` and `--feature` cannot be used together.

## v1.5 migration (v1.6.0)

Existing v1.5 extract folders have no registry entry or `.identity.json`. On the first post-upgrade
run (when the registry is empty and `docs/extract/` exists), the engine auto-scans for legacy roots
and offers them for adoption:

- **Auto-scan:** a folder qualifies as a root if it contains `pipeline-state.json` (or `plan.md`)
  and its path does NOT contain `/slices/`, `/.pending/`, or end with `.registry.json`/`.identity.json`.
  Roots are offered in deterministic sorted order.
- `--adopt <planDir>`: manually adopt a specific folder (bypasses the scan).
- Adoption derives the feature identity from the folder's persisted scope, writes `.identity.json` +
  registry entry (root-last, temp-rename, with rollback on failure).
- After adoption, old `--resume <planDir>` and fresh `/extract-design <scope>` converge on the same
  folder — no duplicates.

## Editing the workflow script

The canonical engine source lives in the plugin at `plugins/feature-workflows/workflows/feature-pipeline.js`
(resolved at runtime as `${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js`).
`~/.claude/workflows/feature-pipeline.js` is a symlink to that plugin engine — auto-created by the
pipeline commands and by `/feature-workflows:setup` — so edit the plugin source; the symlink
follows automatically. After editing, validate as **ES module** — see the **Validation** section
in the `feature-pipeline.md` reference next to the engine. Plain `node --check` parses as CommonJS
and silently passes invalid ESM; use the `--input-type=module` recipe there.
