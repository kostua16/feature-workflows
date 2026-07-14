# feature-workflows plugin

Gate-enforced feature-development pipeline for Claude Code: **THINK** (`design`) → **DO**
(`implement`) → **FIX** (`tune`), plus **EXTRACT** (`extract` — reverse-engineer as-is design
docs from existing code) and **INSPECT** (`review` — audit an existing design docset and collect
issues for tune), driven by one dynamic-workflow engine.

## Components

| Component | Count | Notes |
|---|---|---|
| Commands | 8 | `/feature-workflows:setup`, `:design-feature`, `:implement-feature`, `:tune-feature`, `:extract-design`, `:review-design`, `:feature-pipeline`, `:pipeline-status` |
| Agents | 31 | Spawned as `feature-workflows:<agent>` (e.g. `feature-workflows:plan-architect`) |
| Skills | 1 | `compress-md` — in-session markdown caveman compression |
| Engine asset | `workflows/` | `feature-pipeline.js` + reference docs — **not** auto-loaded; installed per-project by `setup` |

## Why a setup command

Dynamic workflows are not a plugin component: the Workflow tool resolves only from a project's
`.claude/workflows/`. `/feature-workflows:setup` copies
`${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js` (+ docs) into the current project and
ESM-validates it. Every pipeline command preflights that the engine exists and that its
`engine-version:` matches the plugin's bundled copy, warning on drift.

## Namespacing

Commands and agents are namespaced by the plugin name. The engine spawns its named agents
through the `nsAgent()` helper (single `AGENT_NS` constant in `workflows/feature-pipeline.js`);
if you fork/rename the plugin, change that one constant.

## Engine source layout & build

`workflows/feature-pipeline.js` is a **GENERATED** file — do not edit it directly. The source
lives in `workflows/src/` as real ESM modules (`schemas.mjs`, `config.mjs`, `agent-core.mjs`,
`state.mjs`, the mode-support modules, `main.mjs`, and the `meta/` literal); the Workflow sandbox
cannot resolve imports, so `scripts/build-workflows.mjs` (repo root, zero-dep) concatenates them
into the flat dist script: banner + `export const meta` (version injected from `plugin.json`) +
module bodies + the sandbox tail. Edit src, then:

```
npm run build            # regenerate workflows/feature-pipeline.js
npm run validate:build   # fail if the committed dist is stale (also a test + CI step)
```

The builder self-checks every output: duplicate top-level names, unstripped import/export,
sandbox-forbidden tokens (`require`, `Date.now`, `Math.random`, argless `new Date`), phase-label
↔ `meta.phases` agreement, and the neutralized ESM syntax check.

## Versioning rule

`.claude-plugin/plugin.json` → `version` is the **single bump site**. The build injects it into
the dist's `// engine-version:` header and `meta.version`, so all three markers agree by
construction. Version bumps happen through the release flow — `npm run release -- X.Y.Z` bumps,
builds, validates, commits, tags, and pins the marketplace catalog to the tag (end users
install pinned releases, not `main`). See `docs/release-process.md`.

Enforcement:

- CI runs `scripts/build-workflows.mjs --check` (dist freshness) and
  `scripts/validate-plugin-versions.mjs` (repo root), which fails the build unless all
  three markers agree, plus the ESM syntax check on the engine.
- `setup` reports the installed version and sanity-checks it against the plugin manifest.
- Pipeline-command preflights compare installed vs bundled engine versions and **stop** on
  mismatch (the user must re-run setup or explicitly confirm running the outdated engine).
