# Requirements: feature-workflows v1.5.0

**Defined:** 2026-07-22  
**Milestone:** v1.5.0 Project-Scale Extract Design  
**Status:** Approved scope, ready for phase planning

## Core Value

One user command must drive a trustworthy feature workflow from intent to durable, verifiable artifacts without silently losing work or overstating completion.

## v1 Requirements

The 15 user-approved improvement themes remain the capability backbone. Six atomic enabling contracts were separated so state, revision invalidation, distribution, continuation, compatibility, and dogfood proof each have one owner and one acceptance boundary.

The milestone was extended with 15 additional user-approved design-mode themes (16-30) covering `/design-feature` durability, truthfulness, bounded execution, and reliability. Each traces to a file:line-verified defect in `.planning/research/DESIGN-MODE-FINDINGS.md` (F1-F17) and adopts the primitives phases 1-7 establish wherever the same contract applies.

### State, Coverage, Migration, and Revision Contracts

- [ ] **CONTRACT-01**: The engine uses a versioned state contract with explicit feature lifecycle and readiness invariants, pure deterministic transition/readiness reducers, and a root-last v1.4.5 migration that durably writes and validates child shards before atomically acknowledging their compact project manifest.
- [ ] **STATE-01**: A user can resume any feature independently from a validated feature-state shard referenced by a bounded project manifest; root state contains indexes and aggregate evidence rather than project-wide gate histories or artifacts.
- [ ] **REV-01**: When repository source, scope, graph inputs, dependency summaries, or generated artifacts change, the engine compares durable revisions/digests and selectively invalidates only affected feature gates and derived project views while retaining independently valid evidence.

### Bounded Discovery and Schedulability

- [ ] **INV-01**: A user can extract a requested project scope from a deterministic, bounded repository inventory that accounts for every discovered path as included or explicitly excluded and records the applicable generated, vendor, and ignore policy as evidence.
- [ ] **DISC-01**: A user can discover all features and subsystems through durable paginated pages and cursors, with oversized areas recursively refined so no workflow prompt or response must contain the whole repository inventory.
- [ ] **GRAPH-01**: Before extraction starts, a user receives a validated feature graph whose canonical identities are collision-free, whose ownership covers the included inventory without unexplained overlap or gaps, and whose dependency edges, entry points, coverage links, dangling references, and cycle policy are verified.
- [ ] **QUEUE-01**: A user can see each feature in exactly one durable lifecycle state: runnable, deferred, in progress, blocked, failed, skipped, excluded, or completed; caps and selectors preserve unprocessed in-scope features as resumable deferred work rather than completion.
- [ ] **DEPCTX-01**: A user gets a validated schedulability plan that identifies prerequisite order, safe independent waves, cycle/no-progress handling, and the bounded verified dependency summaries available to each feature before any leaf is admitted.

### Generated Multi-Entry Distribution

- [x] **DIST-01**: The source build produces exactly two supported workflow entries for this flow, the top-level `feature-pipeline` entry and the `fp-extract-slice` leaf; copy and symlink installs expose both, and build drift, engine headers, plugin version, release contents, and installed entry resolution are validated in lockstep.

### Checkpointed Feature Leaf

- [x] **ORCH-01**: A user can extract one admitted feature through `fp-extract-slice`, which owns exactly that feature's extraction gates while the top-level workflow alone owns discovery, scheduling, reconciliation, synthesis, continuation, and readiness and the leaf performs no further workflow composition.
- [x] **CHECKPOINT-01**: A user can resume an interrupted feature at its first incomplete material extraction gate because the leaf durably acknowledges before/after, retry, invalidation, and terminal transitions together with artifact evidence using the shared state reducer.

### Bounded Scheduling and Automatic Continuation

- [x] **BUDGET-01**: A user can run large-project extraction without hitting the shared runtime ceiling because each gate, feature, and segment is admitted against bounded call, token, concurrency, and retry budgets with non-spendable capacity reserved for checkpointing, reconciliation, synthesis, and truthful handoff.
- [x] **RETRY-01**: A user can resume a failed or blocked feature under bounded per-gate and per-feature retry rules that persist attempt history and terminal reasons, continue eligible independent work, and never reclassify exhausted retries as completed.
- [x] **ISOLATE-01**: A user retains all verified work when one feature times out, fails, or returns invalid output because the failure updates only that feature's durable outcome and dependency-independent features continue within the current segment.
- [x] **CONT-01**: One `/feature-workflows:extract-design` command automatically launches durably acknowledged bounded segments while progress is possible; segment intents and completions use monotonic identifiers and idempotency keys so duplicate, lost, or interrupted launches cannot skip or double-apply work, and every stop preserves an exact manual resume command.

### Synthesis, Publishing, Persistence, and Status Truth

- [ ] **SYNTH-01**: A user receives incrementally updated, idempotent project views, including the system overview, dependency map, cross-cutting concerns, and coverage index, derived only from verified bounded feature summaries through the shared revision contract.
- [ ] **OBSERVE-01**: A user can publish and persist feature shards, project indexes, synthesis artifacts, and continuation acknowledgements in bounded retry-safe units that distinguish attempted writes from durably verified success and expose budgets, failures, and continuation evidence.
- [ ] **STATUS-01**: The command handoff and read-only status surface report the same revision-current coverage denominator and lifecycle outcomes, and set `extractReady=true` only when discovery is exhausted, the graph is valid, every in-scope feature and required artifact is verified, required synthesis is current, and no incomplete lifecycle state remains.

### Compatibility and Scale Proof

- [x] **COMPAT-01**: Existing design, implement, tune, review, and read-only status workflows continue to hydrate v1.4.5 and v1.5 state safely, consume completed feature docsets/shards, and preserve their established gates, artifacts, handoffs, and command behavior under continuous regression tests.
- [x] **QUAL-01**: Generated-source and installed-plugin E2E characterization covers inventory determinism, pagination, graph rejection, queue semantics, root-last migration, selective revision invalidation, both install modes, gate interruption/resume, dependency ordering, budgeting, retries, isolated failure, duplicate continuation delivery, synthesis, publishing failure, truthful readiness, and every non-extract regression gate named by the milestone matrix.
- [x] **DOGFOOD-01**: An observed whole-repository `/feature-workflows:extract-design` run started by one user command processes multiple features across as many automatically continued bounded segments as required and records durable segment, budget, coverage, failure, synthesis, compatibility, and final readiness evidence without reaching the shared runtime ceiling.

### Design-Mode Durability and State (Extension)

- [ ] **DCKPT-01**: A user whose design run is interrupted at any point resumes from the last completed material design gate because pipeline state is durably persisted after every gate transition, not only at hard-block and terminal exits; the same gate-level persistence applies to implement and tune where the identical coarse-checkpoint loss is proven. (F1)
- [ ] **DSTATE-01**: A user never loses a resumable run to a truncated state file because state writes follow a write-verify-acknowledge pattern with a retained last-good snapshot, and resume auto-recovers from a failed or partial write instead of hard-blocking as `resume-invalid-state`. (F2)
- [ ] **DRESUME-01**: A user resuming a run or answering an approval checkpoint pays only for changed work: unchanged artifacts are trusted via durable digests without per-artifact re-verification calls, reviews re-run only when their inputs changed, and approval decisions apply without re-running unaffected gates. (F3)

### Design-Mode Truthfulness (Extension)

- [ ] **DREADY-01**: A user sees `designReady=true` only when every design review genuinely passed, no plan was force-accepted with carried blockers, reconcile conflicts are resolved, and all required artifacts are verified; any degraded outcome is reported with its exact cause instead of silent readiness. (F4, F5, F6)
- [ ] **DHIST-01**: A user can inspect a durable record of every fail-forward, retry, model escalation, and fallback with reasons and attempt counts through the handoff and read-only status surfaces. (F16)
- [ ] **DTERM-01**: A user is never told a run finished successfully when its commit failed, and publish/persist results distinguish attempted from durably verified outcomes across all modes. (F10)
- [ ] **DQUEST-01**: A user's unresolved open questions must be resolved, explicitly deferred with recorded evidence, or block design completion; they can no longer ride silently into architecture, design, and planning. (F8)
- [ ] **DCHUNK-01**: A user is explicitly told, and must acknowledge, when plan chunking degrades to a single stage and implement-mode parallelism and stage-level resumability are lost. (F9)
- [ ] **DYAGNI-01**: A user running with reconcile disabled still has BLOCKER-severity YAGNI findings delivered to the plan reviewer instead of silently dropped. (F7)

### Design-Mode Bounded Execution (Extension)

- [ ] **DBUDGET-01**: A user's design run enforces per-gate and per-run call/token budgets derived from existing gate telemetry, with non-spendable reserve for state persistence and handoff, instead of purely observational counters. (F11)
- [ ] **DLOOP-01**: A user's later design gates cannot be starved by earlier ones because each review/refine loop draws from its own bounded sub-budget, and escalation retry limits are configurable rather than hardcoded. (F12)
- [ ] **DPROMPT-01**: A user's design-gate prompts stay bounded because conflict, blocker, and fix payloads are capped and compacted with the existing prompt-hygiene helpers before interpolation. (F13)

### Design-Mode Reliability and Proof (Extension)

- [ ] **DTRANS-01**: A user's blocking design gate survives a transient provider or network error because the shared agent core classifies failures (transient, schema, fatal) and applies bounded backoff retries to transient errors before converting them to a hard block. (F14)
- [ ] **DVERIFY-01**: A user's artifact-presence and append-growth checks are deterministic through the shared digest/revision contract, so a hallucinated agent self-report can neither pass a missing artifact nor false-block a present one. (F15)
- [ ] **DTEST-01**: The design gate sequence, review loop, agent retry ladder, crash-resume without a flushed state, and partial state writes are covered by behavioral characterization tests under the milestone's RED/GREEN evidence model. (F17)

## Approved Improvement Theme Traceability

| Approved theme | Owning requirement(s) |
|----------------|-----------------------|
| 1. Deterministic repository inventory | INV-01 |
| 2. Hierarchical paginated feature discovery | DISC-01 |
| 3. Validated feature and dependency graph | GRAPH-01 |
| 4. Correct deferred and excluded queue semantics | QUEUE-01 |
| 5. Truthful partial versus complete status | STATUS-01 |
| 6. Retry policy for blocked slices | RETRY-01 |
| 7. Gate-level durable checkpoints | CHECKPOINT-01 |
| 8. Sharded per-feature state | STATE-01 |
| 9. Dedicated `fp-extract-slice` child workflow | ORCH-01, DIST-01 |
| 10. Per-slice call, token, and retry budgets | BUDGET-01 |
| 11. Isolated failure domains | ISOLATE-01 |
| 12. Dependency-aware scheduling and context | DEPCTX-01 |
| 13. Incremental cross-feature synthesis | SYNTH-01, REV-01 |
| 14. Extract-aware publishing, persistence, and status | OBSERVE-01, STATUS-01 |
| 15. Large-project E2E characterization and dogfooding | QUAL-01, DOGFOOD-01 |
| Cross-cutting state and migration enabler | CONTRACT-01 |
| One-command continuation enabler | CONT-01 |
| Other-mode compatibility enabler | COMPAT-01 |
| 16. Gate-level durable design checkpoints | DCKPT-01 |
| 17. Atomic, recoverable state persistence | DSTATE-01 |
| 18. Revision-aware resume and approval round-trips | DRESUME-01 |
| 19. Truthful design readiness | DREADY-01 |
| 20. Durable fail-forward and attempt history | DHIST-01 |
| 21. Truthful commit, publish, and persist outcomes | DTERM-01 |
| 22. Open-questions resolution policy | DQUEST-01 |
| 23. Surfaced plan-chunker degradation | DCHUNK-01 |
| 24. YAGNI blocker routing independent of reconcile | DYAGNI-01 |
| 25. Enforced per-gate call and token budgets | DBUDGET-01 |
| 26. Per-loop retry sub-budgets | DLOOP-01 |
| 27. Bounded prompt context in design loops | DPROMPT-01 |
| 28. Transient-error retry with backoff | DTRANS-01 |
| 29. Deterministic artifact verification | DVERIFY-01 |
| 30. Design-flow and shared-infra characterization tests | DTEST-01 |

## Future Requirements

- Project-scale sharding and automatic continuation for design, implement, tune, or review modes where measurements later demonstrate the same multi-item scaling need.
- A generalized arbitrary-DAG orchestration platform beyond the dependency behavior required for whole-project extraction.
- Dynamic repartitioning of a feature after its leaf workflow starts, unless project-scale characterization proves fixed pre-admission slices insufficient.
- New design artifact formats or a new design language independent of bounded indexing and compatibility needs.

## Out of Scope

| Boundary | Reason |
|----------|--------|
| One literally unbounded Workflow invocation | Parent and child workflows share finite call, token, concurrency, and abort limits; the supported contract is one user command backed by automatic durable top-level segments. |
| Removing or weakening extraction gates, verification, reviews, or tests | Scale must preserve the workflow's existing quality and evidence guarantees. |
| Replacing or incompatibly rewriting `pipeline-state.json` | v1.4.5 state must hydrate through additive, versioned, validated migration. |
| Broad rewrites or scale orchestration of all non-extract modes | This milestone preserves compatibility and shares proven primitives; it does not redesign unrelated mode behavior. |
| Direct filesystem or shell access from workflow scripts | Runtime I/O remains agent-mediated and generated workflow output remains self-contained. |
| More than one level of workflow composition | The runtime permits a top-level workflow to invoke a leaf; the leaf cannot invoke another workflow. |
| External services, databases, queues, daemons, bundlers, or runtime packages | Repository research found the dependency-free generated Node/ESM and JSON-state model sufficient for this milestone. |
| Speculative runtime constants | Segment limits, reserves, quotas, and concurrency must be established by RED characterization and dogfooding evidence. |

## Traceability

Each v1 requirement is assigned to exactly one owning roadmap phase.

| Requirement | Roadmap Phase | Status |
|-------------|---------------|--------|
| CONTRACT-01 | Phase 1 | Pending |
| STATE-01 | Phase 1 | Pending |
| REV-01 | Phase 1 | Pending |
| INV-01 | Phase 2 | Pending |
| DISC-01 | Phase 2 | Pending |
| GRAPH-01 | Phase 2 | Pending |
| QUEUE-01 | Phase 2 | Pending |
| DEPCTX-01 | Phase 2 | Pending |
| DIST-01 | Phase 3 | Complete |
| ORCH-01 | Phase 4 | Complete |
| CHECKPOINT-01 | Phase 4 | Complete |
| BUDGET-01 | Phase 5 | Complete |
| RETRY-01 | Phase 5 | Complete |
| ISOLATE-01 | Phase 5 | Complete |
| CONT-01 | Phase 5 | Complete |
| SYNTH-01 | Phase 6 | Complete |
| OBSERVE-01 | Phase 6 | Complete |
| STATUS-01 | Phase 6 | Complete |
| COMPAT-01 | Phase 7 | Complete |
| QUAL-01 | Phase 7 | Complete |
| DOGFOOD-01 | Phase 7 | Complete |
| DCKPT-01 | Phase 8 | Pending |
| DSTATE-01 | Phase 8 | Pending |
| DRESUME-01 | Phase 8 | Pending |
| DREADY-01 | Phase 9 | Pending |
| DHIST-01 | Phase 9 | Pending |
| DTERM-01 | Phase 9 | Pending |
| DQUEST-01 | Phase 9 | Pending |
| DCHUNK-01 | Phase 9 | Pending |
| DYAGNI-01 | Phase 9 | Pending |
| DBUDGET-01 | Phase 10 | Pending |
| DLOOP-01 | Phase 10 | Pending |
| DPROMPT-01 | Phase 10 | Pending |
| DTRANS-01 | Phase 11 | Pending |
| DVERIFY-01 | Phase 11 | Pending |
| DTEST-01 | Phase 11 | Pending |

**Coverage:** 36/36 v1 requirements mapped; 0 orphaned; 0 duplicated. All 30 approved improvement themes are represented.

---
*Requirements defined: 2026-07-22*  
*Last updated: 2026-07-22 after extending the milestone with design-mode themes 16-30 (DCKPT/DSTATE/DRESUME/DREADY/DHIST/DTERM/DQUEST/DCHUNK/DYAGNI/DBUDGET/DLOOP/DPROMPT/DTRANS/DVERIFY/DTEST)*
