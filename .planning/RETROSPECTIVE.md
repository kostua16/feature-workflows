# Retrospective: feature-workflows

Living document. A section per milestone, then cross-milestone trends.

---

## Milestone: v1.5.0 — Project-Scale Extract Design

**Shipped:** 2026-07-22 (cleanup + close: 2026-07-23)
**Phases:** 11 (+ tech-debt cleanup) | **Plans:** 11 | **Tests:** 262 → 1470 | **Commits:** ~54

### What Was Built
Trustworthy whole-project extraction from one `/extract-design` command (bounded, durable, resumable
per-feature segments via a top-level orchestrator + `fp-extract-slice` leaf), plus the same
durability / truthfulness / bounded-execution contracts extended to `/design-feature` and the shared
engine. 36 requirements; 35-row E2E matrix; build drift-free.

### What Worked
- **Sequential opus sub-agent per phase** (plan→execute, then validate, then UAT) with the orchestrator
  independently verifying git + `npm test` + drift between each phase. Zero cross-phase conflicts.
- **Defense-in-depth verification:** Nyquist validation found 8 real defects; goal-backward UAT then
  found a 9th (a goal-level wiring gap). Both passes earned their cost.
- **Recovery-aware re-spawn:** Phase 9's API timeout was recovered by re-spawning with instructions to
  assess the uncommitted diff and salvage-or-reset — the work was saved.
- **Explicit "commit your work"** in sub-agent prompts after one validation agent forgot to commit.

### What Was Inefficient
- **Sub-agents ran GSD workflows inline** (Skill/Task spawn isn't callable from inside a sub-agent), so
  they hand-produced artifacts. Mostly fine, but some hygiene slipped: P9/P10 SUMMARYs and the
  `requirements-completed` frontmatter were missing and had to be backfilled at audit/cleanup.
- **gsd-tools state-counting heuristics under-counted** (reported 8/11 and 9/11 at various points),
  forcing manual STATE.md correction.
- **The REQUIREMENTS.md status ledger drifted** during inline execution (checkboxes not flipped per
  phase) and had to be reconciled at audit — a stale-ledger doc-debt.
- **Inconsistent commit discipline** among validation agents (orchestrator committed on their behalf).

### Patterns Established
- Orchestrator → opus sub-agent per phase → independent verification gate → close issue → next phase.
- "Commit explicitly; leave the tree clean" is now a standing sub-agent instruction.
- Post-completion verification passes (validation + UAT + audit) as a standard milestone close routine.

### Key Lessons
- **Goal-backward UAT catches what unit tests can't** — Phase 10's budget enforcement existed as pure
  functions but was never wired into the live flow; only UAT surfaced it.
- **Inline sub-agent execution trades artifact hygiene for speed** — budget a reconciliation/backfill
  pass (audit) before declaring a milestone done.
- **Two verification passes over a "complete" milestone found 9 real defects** — never trust "all tests
  green" alone for a milestone sign-off.

### Cost Observations
- Model mix: predominantly **opus** (phase execution, validation, UAT, cleanup); **sonnet** (integration
  checker); no haiku this milestone.
- Sub-agent invocations: ~11 execute + ~11 validate + ~11 UAT + 1 cleanup + 1 integration ≈ 35.
- Notable: sequential execution kept context lean and avoided conflicts; the cost was wall-clock time,
  not rework.

---

## Cross-Milestone Trends

| Metric | v1.4.5 (baseline) | v1.5.0 |
|--------|-------------------|--------|
| Phases (GSD) | — | 11 |
| Tests | — | 1470 |
| Defects caught pre-close | — | 9 |
| Audit status | — | passed |

_First cross-milestone entry; add rows per future milestone._
