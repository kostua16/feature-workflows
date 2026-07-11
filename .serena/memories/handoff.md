# Handoff — current state & next actions

_Last updated: 2026-07-11 (review mode — standalone design-docset audit, engine v1.4.0)._

## Current state
- Implemented **review mode** (`mode: 'review'`, engine/plugin v1.4.0) — the sixth pipeline
  mode and the INSPECT flow: `/review-design <planDir>` audits an existing design docset
  (forward-designed, extracted, or tuned) and collects ALL design issues without mutating
  anything; `/tune-feature <planDir>` then consumes them.
- Review branch (after tune, before Translate; requires `--resume` with pipeline-state.json):
  artifact inventory → per-lens parallel reviewers (consistency/completeness/feasibility/
  testability/scope) → merge/dedup (across lenses AND against already-recorded issues) →
  adversarial verification (refuted findings dropped; unavailable verdicts keep the finding)
  → `design-review.md` (deterministic report) → gate-mapped findings ≥ `minSeverity` appended
  to `issues-and-improvements.md` in the exact tune-consumable section format.
- New engine surface: REVIEW_FINDINGS/MERGE/VERIFY_VERDICT schemas; `REVIEW_LENSES`,
  `SEVERITY_RANK`, `meetsMinSeverity`, `resolveMinSeverity`, `resolveReviewLenses`,
  `collectReviewDocs`, `reviewIssueSection`, `buildReviewReport`, `runReviewLenses`,
  `mergeReviewFindings`, `verifyReviewFindings`, `recordReviewIssues`; config
  `useReviewVerify`/`minSeverity`/`reviewLenses`; result `reviewPath`/`designReview`;
  model tiers `reviewLens`/`reviewVerify`=opus, `reviewMerge`=sonnet; phase `Design Review`;
  blocked values `review-requires-plandir` / `review-no-artifacts` / `design-review`.
- Invariants kept: review never sets `designReady` or resets stages (structural tests);
  the `review-requires-plandir` block returns BEFORE planDir derivation (a fresh review run
  would otherwise throw on undefined planPath pre-safety-net).
- New command `commands/review-design.md`; docs updated (engine reference, READMEs,
  QUICKSTART, marketplace.json, cross-refs in tune/setup/pipeline-status/feature-pipeline).

## Validation
- `npm test`: 180 tests pass (24 new in `tests/review-mode.test.mjs`; harness CANDIDATES extended).
- `npm run validate:agents`: 31 agents, refs resolve. `npm run validate:versions`: lockstep 1.4.0.
- ESM syntax check and phase-label validation (`undeclared_count=0`) pass.

## Next recommended actions
- Dogfood `/review-design` on an extract-produced docset, then `/tune-feature` to verify the
  tunePlanner consumes review-written sections end-to-end.
- Consider a `--max-findings` cap to bound R3 verification cost on huge docsets.
- Pre-existing residue: Gate 0.2 facts prompt hardcodes Serena project "log_analysis";
  `workflows/docs/feature-pipeline-documentation.md` still describes the 3-mode engine.

Related: `mem:core`, `mem:session_start`, `mem:task_completion`, `mem:conventions`.
