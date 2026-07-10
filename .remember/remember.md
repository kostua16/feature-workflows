# Handoff — 2026-07-10

## What happened this session
Full review of the dynamic workflow engine
(`plugins/feature-workflows/workflows/feature-pipeline.js`, v1.0.0) producing a
prioritized improvement backlog at `docs/TODOs.md`:

- 5 bugfixes (BF-1..5) — headline: BF-1 tune-mode stage invalidation is a no-op for
  non-plan gates (tune functionally broken); BF-2 the promised implement-mode gate guard
  (`gateModeActive`) is defined but never wired.
- 5 enforcements (EN-1..5) — headline: EN-1 zero unit tests for the engine's pure logic.
- 5 improvements (IM-1..5) — headline: IM-1 LLM file-writer used for mechanical I/O
  (token cost + state-corruption risk).
- 5 features (FT-1..5) — headline: FT-1 `/pipeline-status` command.
- 15 robustness items (RB-1..15) for weak-model drivers (qwen3/kimi): single hardened
  call path, JSON repair, verdict contradiction guards, artifact-existence verification,
  circuit breaker, model-escalation ladder, degradation telemetry.
- 5 unresolved questions (Q1..Q5) at the end of the file.

## State
- Branch `claude/dynamic-workflow-improvements-2721ab` (worktree). `docs/TODOs.md`
  committed; PR opened against main.

## Next
- Await review/merge of the TODOs PR, then start fixing in the suggested order:
  BF-1 → BF-2/EN-3 → EN-1 (test harness) → rest.
