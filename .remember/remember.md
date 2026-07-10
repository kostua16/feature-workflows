# Handoff — 2026-07-11 (branch claude/ft-todos-implementation-plan-a6603a)

## What happened this session
Implemented ALL remaining `docs/TODOs.md` items — features FT-1..FT-5 — as engine **v1.2.0**
(plan approved by user at `~/.claude/plans/check-all-ft-from-fuzzy-goose.md`):

- **FT-4 per-gate telemetry**: `bumpGateTelemetry` hooked into `flexibleAgent`/`recordAgentFailure`;
  `renderTelemetrySummary` printed via `logTelemetrySummary()` at every terminal exit;
  `result.gateTelemetry` persisted.
- **FT-1 `/pipeline-status`**: new engine `status` mode (read-only early exit in `main()`, never
  consolidates) + pure `summarizeGates`/`deriveNextCommand`/`renderStatusReport` + new command
  `plugins/feature-workflows/commands/pipeline-status.md` (6th command).
- **FT-2**: blocker-severity code-review findings now run through `classifyAndRecordIssue`;
  upstream ones exit at `issues-handoff` → `/tune-feature` (shared `buildIssuesHandoff`,
  also used by the goalkeeper path). Legacy hard-block preserved for non-upstream/`--no-issues`.
- **FT-3**: `--stage=stageNN` (`resetStageForRerun`) + `--from-gate=<gate>`
  (`normalizeGateTarget`, new `LOOPBACK_FLAG_MAP.execute`); one-shot args, invalid →
  `blockedAt='bad-args'` with no persistence.
- **FT-5**: user confirmed **subagents CANNOT use AskUserQuestion** (Q3 resolved) → command-level
  two-phase approval: design-stop exits `awaiting-approval` (`--approval` / `useApproval`),
  `/design-feature` asks + re-invokes with `approveDesign`/`stageEdits`/`rejectToPlan`
  (`applyApprovalDecision`); implement blocks `design-not-approved`. tune-confirm converted to the
  same pattern (`tune-awaiting-confirm` + `confirmTune`/`finalGates`/`cancelTune`).
  `/feature-pipeline --auto-implement` now approval-gated by default; `--yes` skips.

Docs/version sweep: lockstep 1.2.0 (plugin.json, engine header, meta.version), marketplace.json
"6 commands", both READMEs, QUICKSTART, engine reference (What's new, Inputs, Outputs/blockedAt,
Modes incl. `status`), TODOs.md all marked done + Q3 resolved (note: user-interviewer gate still
carries the subagent-AskUserQuestion assumption — future conversion candidate).

## Verification (all green)
- `node --test "tests/**/*.test.mjs"` — 132 pass (5 new test files: telemetry, status-mode,
  issues-handoff, selective-execution, approval; harness CANDIDATES extended; loadFunction dep
  list in feature-pipeline-helpers.test.mjs gained bumpGateTelemetry).
- `validate-plugin-versions.mjs` OK 1.2.0; `validate-agent-registry.mjs` OK; ESM check OK;
  phase-label validation 0 undeclared.

## State
All changes UNCOMMITTED on worktree branch `claude/ft-todos-implementation-plan-a6603a`
(15 modified + 6 new files, +707/−134). Not committed — awaiting user go-ahead.

## Next
- Commit + open PR against main when user asks.
- Manual smoke (needs live run in a scratch project): design --approval loop, /pipeline-status
  against a v1.1.0 state file, --stage re-run, code-review→issues handoff.
