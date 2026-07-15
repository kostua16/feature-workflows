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
| Engine asset | `workflows/` | `feature-pipeline.js` + reference docs — **not** auto-loaded; auto-symlinked user-level (`~/.claude/workflows/`) by the command preflights |

## Why a doctor command

Dynamic workflows are not a plugin component, but the Workflow tool resolves user-level
`~/.claude/workflows/` — so the pipeline commands auto-create symlinks there pointing at
`${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js` (+ docs) and self-repair them when they
go missing, dangle after a plugin move, or (in the copy-fallback mode used where symlinks are
unavailable, e.g. Windows) drift in `engine-version:`. Nothing is installed into projects.
`/feature-workflows:setup` is the explicit doctor: it diagnoses the links, recreates them,
ESM-validates the plugin engine, and removes legacy pre-1.5.0 per-project copies (which shadow
the user-level engine) after confirmation. Uninstalling the plugin can leave dangling user-level
symlinks behind — harmless; a reinstall's first preflight (or `setup`) repairs them.

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
- `setup` reports the engine version and sanity-checks it against the plugin manifest.
- Pipeline-command preflights compare the user-level install to the plugin engine and
  **auto-repair** on mismatch (re-link, or re-copy in copy-fallback mode); with symlinks the
  versions agree by construction. Only a legacy per-project copy with a differing version
  stops the command (it would shadow the current engine).
