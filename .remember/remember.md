# Handoff — 2026-07-11 (branch claude/design-review-workflow-hmilx2)

## What happened this session
Designed and implemented **review mode** (engine v1.4.0) — the sixth pipeline mode: a
standalone INSPECT flow that audits an EXISTING planDir design docset and COLLECTS all
design issues without mutating anything. `/review-design <planDir>` complements `/tune-feature`
(the FIX flow): review finds and records, tune consumes and fixes.

Flow (own branch right after tune, before Translate; requires a hydrated `--resume`):
artifact inventory from state (idea/requirements/arch/design/e2e/facts + plan only when
`planned||planAccepted` — extract baselines have no plan — + stageNN files)
→ **R1** one `critical-reviewer` per lens in parallel (`consistency`, `completeness`,
`feasibility`, `testability`, `scope`; barrier deliberate — R2 dedups across lenses)
→ **R2** merge/dedup, also against the existing `issues-and-improvements.md` (re-runs stay
additive; merge failure falls back to the raw union — over-report, never drop)
→ **R3** adversarial verify per finding (refuted → dropped; null verdict → kept unverified)
→ `design-review.md` composed deterministically (`buildReviewReport`) via `writeChunkedFile`
→ gate-mapped findings ≥ `minSeverity` appended to `issues-and-improvements.md` in the EXACT
tune-consumable section format (`reviewIssueSection` mirrors classifier/audit byte-for-byte;
a source test asserts exactly 3 writers of that header)
→ `designReview` summary + handoff (`nextMode:'tune'` only when findings actually persisted,
else implement/design; a failed append with actionable findings blocks at
`review-record-failed` — PR #9 review fix: recordReviewIssues returns the persisted count,
sets issuesPath only on success, and runs before the report).

- Engine: `resolveMode`/`gateModeActive` gained `review`; schemas REVIEW_FINDINGS/MERGE/
  VERIFY_VERDICT; model tiers reviewLens=opus, reviewMerge=sonnet, reviewVerify=opus; config
  `useReviewVerify`/`minSeverity`/`reviewLenses`; result `reviewPath`/`designReview`; new
  blocked values `review-requires-plandir` (returned BEFORE planDir derivation — review has
  no fresh-run planPath, reaching it unresumed would throw), `review-no-artifacts`,
  `design-review`. Review NEVER touches designReady/stages (tests assert this structurally).
- Command: `commands/review-design.md` (`--lenses=`, `--min-severity=`, `--no-verify`).
- Docs: engine reference (what's-new v1.4.0, args, tiers, outputs, modes section, issues
  lifecycle), READMEs, QUICKSTART, marketplace.json, plugin.json (1.4.0 lockstep),
  tune-feature/setup/pipeline-status/feature-pipeline command cross-refs.
- Tests: `tests/review-mode.test.mjs` (24 tests) + harness CANDIDATES extended. 180 tests
  green; validate:agents (31 agents), validate:versions (1.4.0), ESM check, phase-label
  validation (`Design Review` declared) all pass.

## State
- Branch `claude/design-review-workflow-hmilx2`; committed + pushed; PR opened.

## Next
- Dogfood: `/review-design` against an extract-produced docset; then `/tune-feature` on the
  recorded findings to verify the tunePlanner parses review-written sections end-to-end.
- Consider a `--max-findings` cap for R3 verification cost on huge docsets.
- Known residue (pre-existing): Gate 0.2 facts prompt hardcodes Serena project "log_analysis";
  `workflows/docs/feature-pipeline-documentation.md` still describes the 3-mode engine
  (lagged since extract too — needs a refresh pass of its own).
