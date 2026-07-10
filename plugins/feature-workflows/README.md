# feature-workflows plugin

Gate-enforced feature-development pipeline for Claude Code: **THINK** (`design`) → **DO**
(`implement`) → **FIX** (`tune`), plus **EXTRACT** (`extract` — reverse-engineer as-is design
docs from existing code), driven by one dynamic-workflow engine.

## Components

| Component | Count | Notes |
|---|---|---|
| Commands | 7 | `/feature-workflows:setup`, `:design-feature`, `:implement-feature`, `:tune-feature`, `:extract-design`, `:feature-pipeline`, `:pipeline-status` |
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

## Versioning rule

Keep these three in lockstep when releasing:

1. `.claude-plugin/plugin.json` → `version`
2. `workflows/feature-pipeline.js` → `// engine-version:` header comment
3. `workflows/feature-pipeline.js` → `meta.version`

Enforcement:

- CI runs `scripts/validate-plugin-versions.mjs` (repo root), which fails the build unless all
  three markers agree, plus the ESM syntax check on the engine.
- `setup` reports the installed version and sanity-checks it against the plugin manifest.
- Pipeline-command preflights compare installed vs bundled engine versions and **stop** on
  mismatch (the user must re-run setup or explicitly confirm running the outdated engine).
