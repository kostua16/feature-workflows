# feature-workflows

A **Claude Code workflow-orchestration framework**. This repo is not an application —
it is a reusable `.claude/` configuration that encodes a gate-enforced feature-development
pipeline as a **dynamic workflow** (a JavaScript script that orchestrates sub-agents).

## What's here

| Path | What it is |
|------|-----------|
| `.claude/workflows/feature-pipeline.js` | The engine — a ~3.9k-line **ES-module** dynamic workflow. ONE engine, THREE modes. |
| `.claude/workflows/feature-pipeline.md` | Full reference for the engine: gates, inputs, outputs, model tiers, validation. |
| `.claude/commands/` | 4 thin slash commands that drive the engine. |
| `.claude/agents/` | 32 sub-agents (task-definition, arch-design, plan-architect, critical-reviewer, executor, …). |
| `.claude/skills/compress-md/` | In-session markdown caveman-compression skill (Node `.mjs` scripts). |
| `docs/dynamic-workflows.md` | Reference guide on Claude Code dynamic workflows (RU). |
| `CLAUDE.md` | Mandatory agent-orchestration rules for this project. |

## The pipeline — ONE engine, THREE modes

The engine is driven by four slash commands (see `.claude/commands/`):

```
/design-feature   <task>      mode:design    THINK — define → requirements → arch → design →
                                             e2e → plan → tdd → reconcile → review → chunk stages.
                                             Stops PRE-EXECUTE at designReady. Nothing runs.
/implement-feature <planDir>  mode:implement DO — execute stages → test → code-review →
                                             goalkeeper → (publish/persist) → commit.
/tune-feature     <planDir>   mode:tune      FIX — consume issues-and-improvements.md → revisit
                                             only the mapped design gates → re-enable designReady.
/feature-pipeline <task>      alias          design (stop); --auto-implement chains into DO.
```

All three modes share `<planDir>/pipeline-state.json` — the resumable contract (`--resume <planDir>`).

## Key invariants

- **No direct FS/shell in the workflow script.** The `.js` engine only coordinates; all reads,
  writes, and commands run inside sub-agents spawned via `agent()`.
- **`feature-pipeline.js` is an ES module.** Validate with the `--input-type=module` recipe in
  `feature-pipeline.md` → *Validation* — plain `node --check` parses as CommonJS and **silently
  passes invalid ESM**.
- **Committing is opt-in** (`autoCommit` defaults to `false`).
- **No build manifest** (no `package.json` / `pyproject.toml`). Node 25 / Python 3.14 are available;
  `pytest-runner` is the test gate for target projects the pipeline operates on.

## Editing the engine

After any edit to `.claude/workflows/feature-pipeline.js`:

```bash
cd .claude/workflows
sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
  | node --input-type=module --check          # ESM syntax check — exit 0 = pass
```

Also run the **phase-label validation** in `feature-pipeline.md` → *Phase-label validation* so
every `phase('X')` maps to a declared `meta.phases` entry.
