# Handoff — 2026-07-11 (branch claude/code-design-extraction-190541)

## What happened this session
Designed and implemented **extract mode** (engine v1.3.0 after rebase on main's v1.2.0) —
the fifth pipeline mode: reverse design extraction from existing code. `/extract-design
<scope>` resolves hybrid input (free text / paths / entry points) into a scope manifest,
pauses for a **command-layer** scope confirmation (KEY CONSTRAINT, user-confirmed:
subagents inside the workflow CANNOT AskUserQuestion — the engine returns
`handoff.status='awaiting-scope-confirm'` and the command re-invokes with transient
`scopeConfirmed`/`scopeFiles`/`slices` args; same stop/re-invoke pattern main's v1.2.0
adopted for tune-confirm + the approval gate), then per slice climbs the ladder in
reverse: deep code facts → observable e2e use cases → detailed design *as built* →
architecture *as built* → optional fidelity reviews / reverse-derived requirements /
as-is design audit (findings append to `issues-and-improvements.md` in the
tune-consumable format). Wide scopes decompose into a resumable slice queue
(`slices/<id>/` docsets + slice-local design-shaped state files); multi-slice runs
synthesize `system-overview.md`. Artifact names reuse the forward pipeline's, so extract
dirs are `/tune-feature` + `/design-feature --resume` baselines.

- Engine: `resolveMode`/`gateModeActive` extended; extract branch after Translate;
  4 new verdict schemas (SCOPE/DECOMPOSE/AUDIT/OVERVIEW); pure helpers
  `seedExtractQueue`/`nextPendingSlice`; planDir segment `extract/`; version 1.3.0 lockstep.
- Fixed en passant: `repairResumeArtifactFlags` now skips the Plan artifact for
  extract-mode state (would null `result.planPath` and kill consolidate flushing), and the
  Plan gate restores `result.planPath` after a resume repair nulled it.
- Rebased on main (v1.2.0: status mode, telemetry, --stage/--from-gate, approval gate,
  tune-confirm→stop/re-invoke, test-writer gate, pytest-runner removed). Merged: 5 modes,
  FT-6 recorded in TODOs status table; dropped my obsolete FT-7 (main already fixed
  tune-confirm).
- Tests green post-rebase; validators green; PR #8 open.

## State
- Worktree branch `claude/code-design-extraction-190541`, rebased on origin/main,
  force-pushed; PR https://github.com/kostua16/feature-workflows/pull/8.

## Next
- Dogfood: `/feature-workflows:setup` then `/extract-design plugins/feature-workflows/workflows/feature-pipeline.js — the pipeline engine`; verify docset + `/design-feature --resume` baseline compat.
- Candidate follow-up (from main's Q3 note): convert the user-interviewer Define-clarification
  gate to the stop/re-invoke pattern too.
- Known residue (pre-existing): Gate 0.2 facts prompt hardcodes Serena project "log_analysis".
