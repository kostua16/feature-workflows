# Handoff — current state & next actions

_Last updated: 2026-07-11 (workflow-decomposition investigation; engine still v1.4.0, unchanged)._

## Current state
- Investigated splitting the monolithic engine into smaller composed workflows —
  see `docs/workflow-decomposition-investigation.md`. Verdict: feasible; hard constraints are
  ONE-level `workflow()` nesting and no code sharing between scripts (needs a src→dist build
  step to avoid duplicating the ~2.8k-line helper stack). Staging: (1) modularize
  source + build to the same single dist engine, (2) split per MODE (six sibling workflows,
  `pipeline-state.json` contract unchanged), (3) selective `workflow()` children —
  extract-slice first, then a shared design-docs child for design/tune/extract reuse.
- **STAGE 1 IMPLEMENTED (engine v1.4.1, PR #10):** `workflows/src/` = 16 contiguous-range ESM
  modules + `meta/feature-pipeline.meta.mjs`; `scripts/build-workflows.mjs` (zero-dep concat
  builder, manifest order, self-checks: dup names, unstripped import/export, forbidden tokens,
  phase-labels ⊆ meta.phases, neutralized ESM check); `npm run build` / `validate:build`;
  `tests/build-drift.test.mjs`; CI adds dist-freshness + src smoke-import steps. Versioning is
  single-site (plugin.json → build injects header + meta.version). Verified pure refactor: the
  v1.4.1 dist body is byte-identical to v1.4.0 (banner only differs); 183 tests pass; harness
  deliberately still reads the DIST (tests the shipped artifact). `main()` stays whole in
  `main.mjs` — carving mode branches is stage 2.
- **RELEASE CHANNEL (option 2+4, second PR stacked on #10):** end users install PINNED
  releases, not main. `npm run release -- X.Y.Z` (scripts/release.mjs): bump plugin.json →
  build → full validation → commit + annotated tag vX.Y.Z → pin marketplace.json to the tag
  (scripts/pin-marketplace.mjs, `git-subdir` source {url, path, ref, sha} — NOT `github`,
  the plugin lives in a subdir; sha is the effective pin). Push with --follow-tags; the tag
  triggers .github/workflows/release.yml (re-validates the tagged tree, publishes GitHub
  Release + dist/doc/checksums assets; never writes to branches). Rollback = `npm run
  marketplace:pin -- --release <prev-tag>` + commit. Dogfooding after first release:
  `marketplace:pin -- --dev` locally, don't commit. Catalog stays relative-path until the
  FIRST release flips it. See docs/release-process.md.
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
  blocked values `review-requires-plandir` / `review-no-artifacts` / `design-review` /
  `review-record-failed`.
- PR #9 review fix: `recordReviewIssues` returns the PERSISTED count (0 on failed/absent
  ack; `issuesPath` set only on success), recording runs before the report so the report's
  recorded count is truth, and actionable-but-unpersisted findings block at
  `review-record-failed` (re-run review, dedup-safe) instead of routing tune to a
  `tune-no-issues` dead end.
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
