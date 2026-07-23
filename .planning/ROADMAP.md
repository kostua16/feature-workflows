# Roadmap: feature-workflows

## Milestones

- ✅ **v1.5.0 Project-Scale Extract Design** — Phases 1-11 (shipped 2026-07-22). Full details: [`milestones/v1.5.0-ROADMAP.md`](milestones/v1.5.0-ROADMAP.md)
- ✅ **v1.4.5 Pre-GSD Baseline** — shipped before the GSD planning ledger.

## Phases

<details>
<summary>✅ v1.5.0 Project-Scale Extract Design (Phases 1-11) — SHIPPED 2026-07-22</summary>

- [x] Phase 1: State, Coverage, Migration, and Revision Contracts (1/1 plans)
- [x] Phase 2: Bounded Discovery, Validated Graph, and Schedulability (1/1 plans)
- [x] Phase 3: Multi-Entry Build, Install, and Version Lockstep (1/1 plans)
- [x] Phase 4: Checkpointed Feature Leaf (1/1 plans)
- [x] Phase 5: Bounded Scheduler and Transactional Automatic Continuation (1/1 plans)
- [x] Phase 6: Synthesis, Publish, Persist, and Status Truth (1/1 plans)
- [x] Phase 7: Compatibility and Project-Scale Proof (1/1 plans)
- [x] Phase 8: Design-Mode Durable Checkpoints and Revision-Aware Resume (1/1 plans)
- [x] Phase 9: Design-Mode Truthful Readiness and Outcome Reporting (1/1 plans)
- [x] Phase 10: Design-Mode Bounded Budgets and Prompt Context (1/1 plans)
- [x] Phase 11: Design-Mode Reliability, Verification, and Characterization Proof (1/1 plans)
- [x] Tech-debt cleanup (post-audit): migration resume path, budget trade-off docs, token-plumbing, doc hygiene

</details>

### 📋 Next Milestone — not yet planned

Run `/gsd-new-milestone` to define questioning → research → requirements → roadmap.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. State, Coverage, Migration, Revision | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 2. Bounded Discovery, Graph, Schedulability | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 3. Multi-Entry Build, Install, Version Lockstep | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 4. Checkpointed Feature Leaf | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 5. Bounded Scheduler, Transactional Continuation | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 6. Synthesis, Publish, Persist, Status Truth | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 7. Compatibility, Project-Scale Proof | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 8. Design-Mode Durable Checkpoints, Resume | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 9. Design-Mode Truthful Readiness, Outcomes | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 10. Design-Mode Bounded Budgets, Prompts | v1.5.0 | 1/1 | Complete | 2026-07-22 |
| 11. Design-Mode Reliability, Characterization | v1.5.0 | 1/1 | Complete | 2026-07-22 |

## Deferred to Future Milestones

Carried forward from v1.5.0 (see `milestones/v1.5.0-REQUIREMENTS.md` Future section):

- Project-scale sharding & automatic continuation for non-extract modes (design/implement/tune/review) where a measured multi-item scaling need appears.
- A generalized arbitrary-DAG orchestration platform beyond whole-project extraction.
- Dynamic mid-leaf repartitioning, unless characterization proves fixed pre-admission slices insufficient.
- Real per-gate **token-budget characterization** (plumbing added in v1.5.0 cleanup; needs a dogfood run to measure).
- Runtime adoption of the Phase-2 **deterministic** discovery/scheduling primitives (currently contract-characterization libraries; the live extract path is LLM-driven by design).
