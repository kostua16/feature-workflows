# feature-workflows

## What This Is

`feature-workflows` is a Codex plugin marketplace package that ships a gate-enforced, dynamic-workflow-driven feature pipeline. It guides users through design, implementation, tuning, reverse design extraction, design review, and status reporting with specialized agents and durable cross-run state.

## Core Value

One user command must drive a trustworthy feature workflow from intent to durable, verifiable artifacts without silently losing work or overstating completion.

## Previous Milestone: v1.6.0 Design-Extract Determination (shipped 2026-07-24)

**Goal:** Make `/feature-workflows:extract-design` map each feature to ONE deterministic, stable folder for its lifetime — across fresh runs, resumes, full path/entry-point renames, and the v1.5→v1.6 upgrade — detect source changes (added/removed/moved/renamed) and re-extract only affected slices in place, recomputing all downstream state truthfully. No LLM in the folder path.

**Target features:**
- Deterministic feature→folder identity + a feature-identity registry (rename-resilient, sticky for life).
- Pending-confirmation protocol with crash-idempotent promotion (new vs existing branches).
- Pure deterministic slice ownership reconciliation.
- Fail-closed source-change detection (full SHA-256) + a full invalidation chain (slice, queue, parent aggregates, publish/persist evidence).
- Auto-update upsert entrypoints + v1.5 docset adoption migration.

**Source plan:** [`plans/260723-extract-deterministic-folders-upsert/plan.md`](../plans/260723-extract-deterministic-folders-upsert/plan.md) (hardened across 5 adversarial review rounds; all decisions baked; no open questions).

---

## Previous Milestone: v1.5.0 Project-Scale Extract Design (shipped 2026-07-22)

**Status:** ✅ SHIPPED, Nyquist-validated, UAT-verified (36/36 requirements GOAL MET), audit passed. Tagged `v1.5.0` (local). Full record: `.planning/milestones/v1.5.0-ROADMAP.md`.

**Goal (delivered):** Make `/feature-workflows:extract-design` automatically process an entire large project through bounded, durable per-feature segments from one user command, while reporting coverage and completion truthfully — and extend the same durability, truthfulness, and bounded-execution contracts to `/feature-workflows:design-feature` and the shared engine where the same defects are proven.

**Next:** superseded by v1.6.0 (above).

**Target features:**

- Complete, deterministic whole-project discovery and dependency-aware feature decomposition.
- Bounded, resumable per-feature extraction with durable gate-level state and isolated failure domains.
- Incremental project-level synthesis with truthful partial/complete coverage reporting.
- Shared scalability, publishing, persistence, and observability improvements for other workflow modes where the same limits apply.
- Large-project characterization tests and real plugin dogfooding that prove the end-to-end command contract.
- Compatibility proof that completed feature shards remain usable by design, implement, tune, review, and read-only status modes throughout the milestone.
- Design-mode extension: durable gate-level design checkpoints, truthful `designReady` and terminal outcomes, enforced budgets and bounded prompts, transient-failure retries, deterministic artifact verification, and design-flow characterization tests (phases appended after Phase 7; evidence in `.planning/research/DESIGN-MODE-FINDINGS.md`).

## Requirements

### Validated

<!-- Shipped and relied upon before the GSD planning ledger was introduced. -->

- ✓ A namespaced `feature-workflows` plugin ships commands, specialized agents, the `compress-md` skill, and a dynamic-workflow engine — v1.4.5 baseline.
- ✓ One generated engine supports six modes: design, implement, tune, extract, review, and read-only status — v1.4.5 baseline.
- ✓ Design, implementation, and tuning are separated by durable gates and explicit handoffs — v1.4.5 baseline.
- ✓ Extract mode reverse-engineers code facts, e2e use cases, detailed design, architecture, requirements, and design-debt findings from existing code — v1.4.5 baseline.
- ✓ Wide extraction scopes can be decomposed into per-slice docsets with a top-level system overview — v1.4.5 baseline.
- ✓ `pipeline-state.json`, idempotent gates, and `--resume` provide cross-run recovery and compatibility between extract, design, tune, review, implement, and status — v1.4.5 baseline.
- ✓ Generated workflow distribution, version lockstep, sandbox checks, and repository-native validation protect the installed plugin artifact — v1.4.5 baseline.

### Active

> ✅ **All 30 v1.5.0 themes below shipped in v1.5.0** — validated, Nyquist-validated, and UAT-verified GOAL MET. Archived in `milestones/v1.5.0-REQUIREMENTS.md`. Retained here for reference until the next milestone's requirements are defined.

<!-- The 15 user-approved improvement themes for v1.5.0. Atomic enabling
contracts for state, revision invalidation, distribution, continuation,
compatibility, and dogfooding are specified separately in REQUIREMENTS.md. -->

#### Project discovery and decomposition

- [ ] **1. Deterministic repository inventory:** Build a reproducible, bounded inventory that covers the requested project scope and records exclusions, generated/vendor handling, and discovery evidence.
- [ ] **2. Hierarchical paginated feature discovery:** Discover features/subsystems in bounded pages, recursively refining large areas without placing the whole repository inventory into a single agent prompt.
- [ ] **3. Validated feature and dependency graph:** Produce stable feature identities, ownership boundaries, dependencies, entry points, and coverage links; validate the graph before scheduling extraction.
- [ ] **4. Correct deferred and excluded queue semantics:** Distinguish runnable, deferred, excluded, blocked, skipped, and completed features so caps or selectors never make unprocessed work disappear.

#### Truthful progress and recovery

- [ ] **5. Truthful partial versus complete status:** Set readiness only when all in-scope features and required project-level artifacts are verified; otherwise report exact processed, remaining, blocked, excluded, and failed coverage.
- [ ] **6. Retry policy for blocked slices:** Apply bounded per-feature retry rules, persist failure reasons and attempt history, and continue independent work without converting exhausted retries into completion.
- [ ] **7. Gate-level durable checkpoints:** Persist after every material extraction gate and transition, not only after an entire feature slice, so interruption resumes from the first incomplete gate.
- [ ] **8. Sharded per-feature state:** Store independently resumable feature state plus a compact project manifest, avoiding a monolithic state or prompt that grows with the whole repository.

#### Bounded orchestration

- [ ] **9. Dedicated `fp-extract-slice` child workflow:** Execute each feature through a leaf child workflow while the top-level extract orchestrator retains scheduling, checkpoint, synthesis, and completion authority.
- [ ] **10. Per-slice call, token, and retry budgets:** Estimate and enforce bounded budgets per feature and per gate, reserve orchestration capacity, and segment before the shared runtime ceiling is reached.
- [ ] **11. Isolated failure domains:** Contain feature failures, invalid outputs, and timeouts to their feature state while preserving completed work and continuing dependency-independent features.
- [ ] **12. Dependency-aware scheduling and context:** Process prerequisites before dependents where needed, run safe independent features concurrently, and pass compact dependency summaries rather than unbounded upstream artifacts.

#### Project synthesis and proof

- [ ] **13. Incremental cross-feature synthesis:** Build and update the system overview, cross-cutting concerns, dependency map, and coverage index incrementally from verified feature summaries.
- [ ] **14. Extract-aware publishing, persistence, and status:** Publish and persist project and feature artifacts in bounded units; expose continuation, coverage, budgets, failures, and readiness through the command handoff and status mode, reusing the same primitives in other modes where applicable.
- [ ] **15. Large-project E2E characterization and dogfooding:** Add fixtures and end-to-end scenarios for pagination, segmentation, interruption, resume, dependency ordering, partial failure, ceiling avoidance, final synthesis, and an observed whole-repository plugin run.

#### Design-mode durability and state (extension)

- [ ] **16. Gate-level durable design checkpoints:** Persist pipeline state after every material design gate (and in implement/tune where the same coarse-checkpoint loss is proven) instead of only at hard-block and terminal exits.
- [ ] **17. Atomic, recoverable state persistence:** Replace truncation-prone chunked state writes with a write-verify-acknowledge pattern and a last-good snapshot so resume auto-recovers instead of hard-blocking on `resume-invalid-state`.
- [ ] **18. Revision-aware resume and approval round-trips:** Skip re-verification and review re-runs for unchanged artifacts via durable digests, and make approval decisions apply without re-running unaffected gates.

#### Design-mode truthfulness (extension)

- [ ] **19. Truthful design readiness:** Set `designReady=true` only when no review was fail-forwarded, no plan was force-accepted with carried blockers, reconcile conflicts are resolved, and required artifacts are verified; otherwise report the exact degraded state.
- [ ] **20. Durable fail-forward and attempt history:** Record every fail-forward, retry, escalation, and fallback with reasons as durable state surfaced through handoff and status.
- [ ] **21. Truthful commit, publish, and persist outcomes:** Distinguish attempted from durably verified commit/publish/persist results and never report terminal success over a failed commit.
- [ ] **22. Open-questions resolution policy:** Require unresolved open questions to be resolved, explicitly deferred with recorded evidence, or to block design completion.
- [ ] **23. Surfaced plan-chunker degradation:** Make single-stage chunker fallback an explicit acknowledged degraded outcome instead of a silent log line.
- [ ] **24. YAGNI blocker routing independent of reconcile:** Deliver BLOCKER-severity YAGNI findings to the plan reviewer even when reconcile is disabled.

#### Design-mode bounded execution (extension)

- [ ] **25. Enforced per-gate call and token budgets:** Convert observational gate telemetry into enforced per-gate/per-run budgets with non-spendable reserve for state flush and handoff.
- [ ] **26. Per-loop retry sub-budgets:** Give each design review/refine loop its own bounded budget so early loops cannot starve later gates, and make escalation retries configurable.
- [ ] **27. Bounded prompt context in design loops:** Cap and compact conflict, blocker, and fix payloads interpolated into design-gate prompts, reusing the existing compaction hygiene.

#### Design-mode reliability and proof (extension)

- [ ] **28. Transient-error retry with backoff:** Classify agent-call failures (transient, schema, fatal) and apply bounded backoff retries to transient errors in the shared agent core.
- [ ] **29. Deterministic artifact verification:** Verify artifact presence and append growth through the shared digest/revision contract rather than trusting agent self-reports.
- [ ] **30. Design-flow and shared-infra characterization tests:** Add behavioral tests for the design gate sequence, review loop, agent retry ladder, crash-resume, and partial state writes per the milestone evidence model.

### Out of Scope

- A literally unbounded single Workflow invocation — runtime limits make this unsafe; the user-visible contract is one command backed by automatic durable segments and continuation loops.
- Removing or weakening existing gates, artifact verification, reviews, or tests to reduce runtime — scale must preserve workflow quality.
- Breaking or replacing the existing `pipeline-state.json` contract — older v1.4.5 state must continue to hydrate safely through additive/defaulted schema evolution.
- Redesigning the meaning or format of established design artifacts unless required for bounded indexing or compatibility — this milestone changes orchestration and scale behavior, not the product's design language.
- Broad rewrites of non-extract modes — shared improvements and the approved design-mode extension themes (16-30) are adopted only where a defect is proven with evidence; unproven speculative changes to other modes stay excluded.
- External ecosystem research — milestone research is repository-grounded and should validate decisions against current source, tests, docs, and runtime constraints.

## Context

The shipped v1.4.5 extract flow already resolves a hybrid code scope, asks for scope confirmation, decomposes wide scopes into feature/subsystem slices, writes slice-local compatible docsets, synthesizes `system-overview.md`, and persists resumable state. Its current defaults and queue behavior are optimized for bounded runs, not guaranteed whole-project completion: extraction is capped per run, deferred work is not a first-class durable continuation queue, readiness can be inferred from a partially processed queue, checkpoints are coarser than individual feature gates, and prompts can carry project-wide inventories.

The milestone must preserve the simple user experience: invoke `/feature-workflows:extract-design` once for a project, then let the command automatically schedule as many bounded workflow segments as required. Multiple internal loops and one leaf run per feature are acceptable. Every segment must leave a valid continuation point, and the final report must prove that all in-scope features were processed or explicitly account for why they were not.

The improvements should become shared orchestration primitives where design, review, tune, implement, or status have the same scaling, checkpointing, budgeting, or truthfulness problem. Extract-specific semantics must not be imposed on modes that do not share the issue.

## Constraints

- **Generated distribution:** `plugins/feature-workflows/workflows/feature-pipeline.js` is generated from `workflows/src/`; source changes must be rebuilt and committed with fresh validation — the distribution file is not edited directly.
- **Workflow sandbox:** Workflow scripts cannot use direct filesystem or shell APIs and cannot resolve runtime module imports; I/O remains agent-mediated and build output remains self-contained.
- **Composition:** Workflow nesting is exactly one level — a top-level orchestrator may call leaf children, but a child workflow cannot compose another workflow.
- **Runtime capacity:** A parent and its child workflows share the same 1,000-agent-call ceiling, concurrency cap, abort signal, and token budget — automatic segmentation must finish a segment with capacity reserved for checkpointing and handoff.
- **State compatibility:** Existing v1.4.5 `pipeline-state.json` files must hydrate safely; new project/feature state is additive, versioned/defaulted, validated, and deterministic.
- **Artifact compatibility:** Per-feature extract output must remain usable by `/tune-feature`, `/design-feature --resume`, `/review-design`, and status reporting.
- **Versioning:** `.claude-plugin/plugin.json` remains the version source of truth; generated engine headers and metadata are injected by the build.
- **Quality:** Repository-native build, version, sandbox, unit, characterization, and workflow E2E checks must remain green; tests may not be weakened to satisfy scale scenarios.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Present whole-project extraction as one user command backed by automatic bounded, resumable segments | Preserves a simple command surface while respecting finite runtime capacity and allowing any number of features to be processed safely | ✓ Accepted by user |
| Use one leaf extraction workflow per feature beneath a top-level orchestrator | Fits the one-level nesting limit, isolates failures, and creates a natural durable progress unit | ✓ Accepted by user |
| Number this first GSD roadmap from Phase 1 | The repository has shipped history but no prior GSD planning ledger or roadmap phase sequence | ✓ Accepted by user |
| Treat v1.4.5 as the pre-GSD brownfield baseline | The plugin manifest and generated engine identify v1.4.5 as the current shipped behavior from which validated requirements are inferred | ✓ Good |
| Name the milestone `v1.5.0 Project-Scale Extract Design` | Whole-project orchestration and completion semantics are a substantial capability increment over the v1.4.5 baseline | ✓ Accepted by user |
| Use repository-grounded research | The main unknowns are current engine contracts, runtime constraints, failure modes, and characterization gaps already evidenced in source and project docs | ✓ Accepted by user |
| Report readiness only from verified scope coverage and required artifacts | Prevents capped, deferred, skipped, or blocked work from being mislabeled complete | ✓ Accepted by user |
| Generalize only proven common scaling primitives to other modes | Gains consistency without broadening the milestone into an unnecessary rewrite | ✓ Accepted by user |
| Preserve implement-mode compatibility alongside design, tune, review, and status | Whole-project extract state is not complete if the established downstream implementation path cannot consume it without regression | ✓ Accepted milestone constraint |
| Extend v1.5.0 with design-mode phases instead of opening a v1.6.0 milestone | GSD tracks one active milestone; the design-mode findings adopt the same primitives phases 1-7 build, so appending phases keeps one ledger and one milestone truth | ✓ Accepted by user |
| Track the extension in GitHub issue #19 with new sub-issues per appended phase | The milestone parent issue must stay the single tracking surface; sub-issues are added once phases are created and committed | ✓ Accepted by user |
| Ground the extension in `.planning/research/DESIGN-MODE-FINDINGS.md` | All 15 extension themes trace to file:line-verified defects (F1-F17); the prior docs/TODOs.md backlog is fully implemented, so no theme duplicates shipped work | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-23 after v1.5.0 milestone shipped (archived to `.planning/milestones/`, tagged `v1.5.0`)*
