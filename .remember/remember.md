# Milestone v1.5.0 extended with design-mode phases 8-11

Milestone **v1.5.0 Project-Scale Extract Design** was extended (user decision: extend the current
milestone instead of opening v1.6.0, because GSD tracks one active milestone). It now has **11
phases and 36 requirements**. Phases 1-7 (extract orchestration) are unchanged; new phases 8-11
cover `/design-feature` durability, truthfulness, bounded execution, and reliability.

Evidence base: `.planning/research/DESIGN-MODE-FINDINGS.md` — 17 file:line-verified findings
(F1-F17) from a full review of the design flow and shared engine. The old `docs/TODOs.md` backlog
is fully implemented; all extension themes are new findings.

GitHub hierarchy under parent issue **#19** (body updated with themes 16-30, 36 requirements,
extended exit criteria):

- **#20-#26** — Phases 1-7 (unchanged)
- **#27** — Phase 8: Design-Mode Durable Checkpoints and Revision-Aware Resume (DCKPT/DSTATE/DRESUME)
- **#28** — Phase 9: Design-Mode Truthful Readiness and Outcome Reporting (DREADY/DHIST/DTERM/DQUEST/DCHUNK/DYAGNI)
- **#29** — Phase 10: Design-Mode Bounded Budgets and Prompt Context (DBUDGET/DLOOP/DPROMPT)
- **#30** — Phase 11: Design-Mode Reliability, Verification, and Characterization Proof (DTRANS/DVERIFY/DTEST)

Phases 8-11 depend on primitives from Phases 1, 4, 5, 6, 7 — execution order stays 1 → 11.

Commits (branch claude/feature-workflows-design-review-daaebe, worktree
code-design-extraction-190541): `647bddd` (PROJECT/REQUIREMENTS/findings), `68d26ca`
(ROADMAP phases 8-11, STATE total_phases 11, traceability 36/36). Not yet pushed.

Next action: unchanged — plan and implement **Phase 1** from issue **#20**
(`/gsd-discuss-phase 1` or `/gsd-plan-phase 1`). At Phase 2 (#21), obtain explicit user
confirmation at the cycle-policy HITL checkpoint. Preserve all approved requirements and
architecture decisions; extension themes must adopt Phase 1-7 primitives, not fork parallel
mechanisms.
