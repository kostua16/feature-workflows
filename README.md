# feature-workflows

A **Claude Code plugin marketplace** shipping one plugin: a gate-enforced feature-development
pipeline encoded as a **dynamic workflow** (a JavaScript engine that orchestrates 31 sub-agents),
driven by thin slash commands.

## Install

```
/plugin marketplace add kostua16/feature-workflows    # or a local clone path for dev: /plugin marketplace add ./
/plugin install feature-workflows@feature-workflows
/feature-workflows:setup                              # copies the engine into your project's .claude/workflows/
/feature-workflows:design-feature <task description>
```

`setup` is required once per project: Claude Code resolves dynamic workflows only from the
project's `.claude/workflows/` directory (plugins cannot ship workflows directly), so the plugin
installs the engine there. Re-run it after plugin updates. See [docs/QUICKSTART.md](docs/QUICKSTART.md).

## What's here

| Path | What it is |
|------|-----------|
| `.claude-plugin/marketplace.json` | Marketplace manifest (this repo is the marketplace). |
| `plugins/feature-workflows/` | The plugin. See its [README](plugins/feature-workflows/README.md). |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | The engine — a ~5k-line **ES-module** dynamic workflow. ONE engine, FOUR modes. |
| `plugins/feature-workflows/workflows/feature-pipeline.md` | Full reference: gates, inputs, outputs, model tiers, validation. |
| `plugins/feature-workflows/commands/` | 6 slash commands: `setup` + the 4 pipeline drivers + `pipeline-status`. |
| `plugins/feature-workflows/agents/` | 31 sub-agents (task-definition, arch-design, plan-architect, critical-reviewer, executor, …). |
| `plugins/feature-workflows/skills/compress-md/` | In-session markdown caveman-compression skill (Node `.mjs` scripts). |
| `docs/QUICKSTART.md` | End-user install & usage guide. |
| `docs/dynamic-workflows.md` | Reference guide on Claude Code dynamic workflows (RU). |
| `docs/claude-marketplace.md` | Marketplace/plugin repo best practices (RU). |
| `CLAUDE.md` | Mandatory agent-orchestration rules for developing this repo. |

## The pipeline — ONE engine, FOUR modes

Installed commands are namespaced under the plugin (`/feature-workflows:<command>`):

```
/feature-workflows:design-feature   <task>      mode:design    THINK — define → requirements → arch → design →
                                                               e2e → plan → tdd → reconcile → review → chunk stages.
                                                               Stops PRE-EXECUTE at designReady. Nothing runs.
                                                               --approval adds a human sign-off checkpoint.
/feature-workflows:implement-feature <planDir>  mode:implement DO — execute stages → test → code-review →
                                                               goalkeeper → (publish/persist) → commit.
                                                               --stage / --from-gate re-run parts selectively.
/feature-workflows:tune-feature     <planDir>   mode:tune      FIX — consume issues-and-improvements.md → revisit
                                                               only the mapped design gates → re-enable designReady.
/feature-workflows:pipeline-status  <planDir>   mode:status    READ-ONLY — gates/stages/budgets/telemetry report
                                                               + the exact next command. Writes nothing.
/feature-workflows:feature-pipeline <task>      alias          design (stop); --auto-implement chains into DO
                                                               (with a design-approval pause; --yes skips it).
```

All modes share `<planDir>/pipeline-state.json` — the resumable contract (`--resume <planDir>`).

## Key invariants

- **No direct FS/shell in the workflow script.** The `.js` engine only coordinates; all reads,
  writes, and commands run inside sub-agents spawned via `agent()`.
- **`feature-pipeline.js` is an ES module.** Validate with the `--input-type=module` recipe in
  `feature-pipeline.md` → *Validation* — plain `node --check` parses as CommonJS and **silently
  passes invalid ESM**.
- **Committing is opt-in** (`autoCommit` defaults to `false`).
- **The plugin copy is the source of truth.** The project copy at `.claude/workflows/` is derived
  (installed by `/feature-workflows:setup`, version-checked by every pipeline command's preflight).
- **No build manifest** (no `package.json` / `pyproject.toml`). Node 25 / Python 3.14 are available;
  `test-runner` is the stack-agnostic test gate for target projects the pipeline operates on.

## Editing the engine

Edit the plugin source, not an installed copy. After any edit to
`plugins/feature-workflows/workflows/feature-pipeline.js`:

```bash
cd plugins/feature-workflows/workflows
sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
  | node --input-type=module --check          # ESM syntax check — exit 0 = pass
```

Also run the **phase-label validation** in `feature-pipeline.md` → *Phase-label validation* so
every `phase('X')` maps to a declared `meta.phases` entry. Bump the version in lockstep
(`plugin.json`, the `// engine-version:` header, `meta.version`), then re-run
`/feature-workflows:setup` in consuming projects.
