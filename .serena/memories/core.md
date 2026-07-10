# Core — roadmap & project invariants

**Project:** `feature-workflows`. Serena project name to activate: `feature_workflows` (path `$CWD`).

## Vision vs current state
- **Stated goal (`CLAUDE.md` → "Idea"):** become a **Claude Code plugin / marketplace app that lets
  users run dynamic workflows created in this project.**
- **Current state:** a Claude Code **workflow-orchestration framework** scaffold — the `.claude/`
  config + docs. No application/product code yet; the plugin/marketplace app is not built.

## What the repo is (today)
- `.claude/workflows/feature-pipeline.js` — the engine: a **~3.9k-line ES-module dynamic
  workflow**. ONE engine, THREE modes (`design`=THINK, `implement`=DO, `tune`=FIX).
- `.claude/workflows/feature-pipeline.md` — full engine reference (gates, args, outputs, per-gate
  model tiers, validation recipes). Read before touching the engine.
- `.claude/commands/` — 4 thin slash commands: `design-feature`, `implement-feature`,
  `tune-feature`, `feature-pipeline` (alias).
- `.claude/agents/` — 32 sub-agents wired as pipeline gates.
- `.claude/skills/compress-md/` — in-session md caveman-compression skill (Node `.mjs`).
- `docs/dynamic-workflows.md` — RU reference on Claude Code dynamic workflows.

## Invariants (do not violate)
1. **No direct FS/shell in the workflow script.** The `.js` engine only orchestrates; all I/O runs
   inside sub-agents spawned via `agent()`.
2. **`feature-pipeline.js` is an ES module.** Validate with the `--input-type=module` recipe (see
   `mem:suggested_commands`). Plain `node --check` silently passes invalid ESM.
3. **ONE engine, THREE modes** sharing `<planDir>/pipeline-state.json` — the `--resume` contract.
   Gates are idempotent; a mode runs a subset of the gate sequence.
4. **Committing is opt-in** — `autoCommit` defaults `false`.
5. **No build manifest** (no package.json / pyproject.toml). Node 25, Python 3.14 available.
   `pytest-runner` is the pipeline's test gate for target projects, not for this repo.
6. Every `phase('X')` in the engine must map to a declared `meta.phases` entry (phase-label
   validation).
7. **Docs+memory discipline (CLAUDE.md rule):** read `docs/` + Serena memories before any task;
   capture useful notes/knowledge back into `docs/` + memories.

## Roadmap
- **Done (2026-07-10):** onboarding — README + 7 Serena memories; branch rebased onto main
  (`4fa69d0`), which fixed the Serena project name and added the "Idea" section.
- **Next / open direction:** build toward the stated plugin/marketplace app vision. No detailed
  feature backlog defined yet. Meanwhile, evolve pipeline gates / agents.

Related: `mem:conventions`, `mem:task_completion`, `mem:handoff`.
