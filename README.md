# feature-workflows

A **Claude Code plugin marketplace** shipping one plugin: a gate-enforced feature-development
pipeline encoded as a **dynamic workflow** (a JavaScript engine that orchestrates 31 sub-agents),
driven by thin slash commands.

## What's new in v1.5.0

v1.5.0 makes extraction **trustworthy at project scale** and hardens the design flow — without
changing the command surface (still 8 commands, 31 agents):

- **Whole-project extraction from one command.** `/extract-design` processes an entire large project
  through bounded, durable, resumable per-feature segments — a top-level orchestrator spawns one
  `fp-extract-slice` leaf per feature (one-level composition), with budgeted admission, failure
  isolation, and transactional continuation. It never silently loses work or overstates completion.
- **Truthful status.** `extractReady` is set only when discovery is exhausted, the graph is valid,
  every in-scope feature is verified, and synthesis is current; handoff and read-only status share
  one immutable projection.
- **Design-mode hardening.** `/design-feature` gains gate-level durable checkpoints + auto-recovering
  state writes, truthful `designReady`, enforced per-gate/per-loop budgets with bounded prompts,
  transient-error backoff, and deterministic digest-based artifact verification.
- **v1.4.5 compatibility.** Older state hydrates safely; `--resume --migrate` upgrades a legacy
  v1.4.5 extract state file in place.

36 requirements across 11 phases, 1470 tests, build drift-free. Full record:
[`.planning/milestones/v1.5.0-ROADMAP.md`](.planning/milestones/v1.5.0-ROADMAP.md).

## Install

```
/plugin marketplace add kostua16/feature-workflows    # or a local clone path for dev: /plugin marketplace add ./
/plugin install feature-workflows@feature-workflows
/feature-workflows:design-feature <task description>
```

No per-project setup: the pipeline commands auto-create symlinks in user-level
`~/.claude/workflows/` pointing at the plugin engine (plugins cannot ship workflows directly,
but the Workflow tool resolves the user-level directory), so nothing is copied into your repo
and plugin updates propagate instantly. `/feature-workflows:setup` remains as a doctor/repair
command (diagnose links, clean up legacy pre-1.5.0 project copies).
See [docs/QUICKSTART.md](docs/QUICKSTART.md).

## What's here

| Path | What it is |
|------|-----------|
| `.claude-plugin/marketplace.json` | Marketplace manifest (this repo is the marketplace). |
| `plugins/feature-workflows/` | The plugin. See its [README](plugins/feature-workflows/README.md). |
| `plugins/feature-workflows/workflows/src/` | Engine **source** modules — pure reducers, discovery, scheduling, budgets, status-truth (compiled into the dist). |
| `plugins/feature-workflows/workflows/feature-pipeline.js` | The **generated** top-level engine — an ES-module dynamic workflow. ONE engine, SIX modes. |
| `plugins/feature-workflows/workflows/fp-extract-slice.js` | The **generated** leaf entry — one feature per run (v1.5.0 whole-project extraction). |
| `plugins/feature-workflows/workflows/feature-pipeline.md` | Full reference: gates, inputs, outputs, model tiers, validation. |
| `plugins/feature-workflows/commands/` | 8 slash commands: the 6 pipeline drivers + `pipeline-status` + the `setup` doctor. |
| `plugins/feature-workflows/agents/` | 31 sub-agents (task-definition, arch-design, plan-architect, critical-reviewer, executor, …). |
| `plugins/feature-workflows/skills/compress-md/` | In-session markdown caveman-compression skill (Node `.mjs` scripts). |
| `scripts/build-workflows.mjs` | Build — compiles `workflows/src/` → both dist entries. |
| `tests/` | Characterization + per-phase tests (`npm test`, 1470 tests). |
| `package.json` | Repo build/test/validate scripts (`build`, `test`, `validate:build`, `validate:versions`). |
| `docs/QUICKSTART.md` | End-user install & usage guide. |
| `docs/dynamic-workflows.md` | Reference guide on Claude Code dynamic workflows (RU). |
| `docs/claude-marketplace.md` | Marketplace/plugin repo best practices (RU). |
| `.planning/` | GSD planning ledger — ROADMAP, requirements, per-phase artifacts, milestone archives. |
| `CLAUDE.md` | Mandatory agent-orchestration rules for developing this repo. |

## The pipeline — ONE engine, SIX modes

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
/feature-workflows:extract-design   <scope>     mode:extract   REVERSE — whole-project extraction: bounded, durable,
                                                               resumable per-feature segments (one leaf per feature)
                                                               → as-is design docs (facts → e2e → detailed design →
                                                               arch → requirements) + design-debt audit + truthful
                                                               coverage/readiness. `--resume <planDir>` continues.
/feature-workflows:review-design    <planDir>   mode:review    INSPECT — audit the existing design docset through
                                                               parallel review lenses → verify → design-review.md +
                                                               tune-consumable issues. Changes nothing.
/feature-workflows:pipeline-status  <planDir>   mode:status    READ-ONLY — gates/stages/budgets/telemetry report
                                                               + the exact next command. Writes nothing.
/feature-workflows:feature-pipeline <task>      alias          design (stop); --auto-implement chains into DO
                                                               (with a design-approval pause; --yes skips it).
```

All modes share `<planDir>/pipeline-state.json` — the resumable contract (`--resume <planDir>`).
Extract runs land under `docs/{cat}/{sub}/extract/{leaf}/` and reuse the forward pipeline's artifact
names, so an extracted docset is a ready baseline for `/tune-feature` (fix audit findings) and
`/design-feature --resume` (design on top of the as-is docs).

## Key invariants

- **No direct FS/shell in the workflow script.** The `.js` engine only coordinates; all reads,
  writes, and commands run inside sub-agents spawned via `agent()`.
- **`feature-pipeline.js` is an ES module.** Validate with the `--input-type=module` recipe in
  `feature-pipeline.md` → *Validation* — plain `node --check` parses as CommonJS and **silently
  passes invalid ESM**.
- **Committing is opt-in** (`autoCommit` defaults to `false`).
- **The plugin engine is the source of truth.** The user-level install at `~/.claude/workflows/`
  is a symlink to it (auto-created and health-checked by every pipeline command's preflight;
  falls back to an auto-synced copy where symlinks are unavailable). Nothing is installed into
  consuming projects — a leftover pre-1.5.0 project copy is flagged as a legacy shadow.
- **Generated engine + build manifest.** The dist (`feature-pipeline.js`, `fp-extract-slice.js`) is
  compiled from `workflows/src/` by `scripts/build-workflows.mjs`. The repo `package.json` provides
  `npm run build`, `npm test` (1470-test characterization suite), `npm run validate:build` (drift),
  and `npm run validate:versions` (N-surface version lockstep). `test-runner` remains the
  stack-agnostic test gate for *target* projects the pipeline operates on.

## Editing the engine

Edit the **source**, not the generated dist or an installed copy. The dist files
(`feature-pipeline.js`, `fp-extract-slice.js`) are compiled from `workflows/src/*.mjs` by
`scripts/build-workflows.mjs` — never hand-edit them.

```bash
npm run build            # compile src/ → both dist entries
npm run validate:build   # drift check: checked-in dist must equal a clean build (exit 0 = pass)
npm test                 # full characterization suite (1470 tests)
```

Also run the **phase-label validation** (`feature-pipeline.md` → *Phase-label validation*) so every
`phase('X')` maps to a declared `meta.phases` entry. Bump the version in lockstep across `plugin.json`,
the `// engine-version:` header, and `meta.version` (verified by `npm run validate:versions`).
Consuming setups need no re-install — the user-level symlink tracks the plugin (copy-fallback
installs re-sync at the next command preflight).
