# Workflows overview — ONE generated engine, SIX modes

This repo ships a **dynamic-workflow engine** (a generated, self-contained ESM `.js` file the Claude Code
`Workflow` tool runs in a sandbox) that orchestrates 31 sub-agents through gate-enforced feature work.
ONE engine, SIX modes. Driven by thin slash commands namespaced under the plugin.

## The 8 commands (`/feature-workflows:<cmd>`)
- `design-feature <task>` — THINK: define→requirements→arch→design→e2e→plan→tdd→reconcile→review→chunk. Stops PRE-EXECUTE at `designReady`. `--approval` adds sign-off.
- `implement-feature <planDir>` — DO: execute stages→test→code-review→goalkeeper→publish/persist→commit. `--stage`/`--from-gate` re-run parts.
- `tune-feature <planDir>` — FIX: consume issues-and-improvements.md → revisit only mapped design gates → re-enable `designReady`.
- `extract-design <scope>` — REVERSE: whole-project bounded/durable/resumable per-feature extraction → as-is design docs + design-debt audit + truthful coverage. `--resume <planDir>` continues.
- `review-design <planDir>` — INSPECT: parallel review lenses → verify → design-review.md + tune-consumable issues. Changes nothing.
- `pipeline-status <planDir>` — READ-ONLY: gates/stages/budgets/telemetry + exact next command. Writes nothing.
- `feature-pipeline <task>` — alias: design (stop); `--auto-implement` chains into DO.
- `setup` — doctor/repair: diagnose the user-level symlink, clean up legacy pre-1.5.0 project copies.

## Two workflow entries (one-level composition)
- **Top-level** `feature-pipeline.js` — the orchestrator: owns discovery, scheduling, reconciliation,
  synthesis, continuation, readiness. Entry point `main()`.
- **Leaf** `fp-extract-slice.js` — processes exactly ONE feature; composes no child workflow. Entry point
  `extractSliceMain()`. Spawned by the top-level via `Workflow({name:'fp-extract-slice', args:{...}})`.
- Both generated from `workflows/src/` — see `mem:src-to-dist-mapping`.

## Shared contract
- All modes share `<planDir>/pipeline-state.json` — the resumable, idempotent state contract (`--resume <planDir>`).
- Extract output lands under `docs/{cat}/{sub}/extract/{leaf}/` reusing forward-pipeline artifact names → ready baseline for `/tune-feature` and `/design-feature --resume`.
- No direct FS/shell in the engine — all I/O is agent-mediated. `autoCommit` defaults to false.

## Install model
Pipeline commands auto-create a user-level symlink `~/.claude/workflows/<entry>.js` → the plugin engine
(plugins can't ship workflows directly; the Workflow tool resolves the user-level dir). Nothing copied into
consuming repos; updates propagate instantly. `setup` diagnoses/repairs links.

Ref: `plugins/feature-workflows/workflows/feature-pipeline.md` (full gate/input/output reference), `docs/QUICKSTART.md`.
