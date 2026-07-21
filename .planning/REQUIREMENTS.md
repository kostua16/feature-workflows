# Requirements: feature-workflows v1.5.0

**Defined:** 2026-07-22  
**Milestone:** v1.5.0 Project-Scale Extract Design  
**Status:** Approved scope, ready for phase planning

## Core Value

One user command must drive a trustworthy feature workflow from intent to durable, verifiable artifacts without silently losing work or overstating completion.

## v1 Requirements

The 15 user-approved improvement themes remain the capability backbone. Six atomic enabling contracts were separated so state, revision invalidation, distribution, continuation, compatibility, and dogfood proof each have one owner and one acceptance boundary.

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

- [ ] **DIST-01**: The source build produces exactly two supported workflow entries for this flow, the top-level `feature-pipeline` entry and the `fp-extract-slice` leaf; copy and symlink installs expose both, and build drift, engine headers, plugin version, release contents, and installed entry resolution are validated in lockstep.

### Checkpointed Feature Leaf

- [ ] **ORCH-01**: A user can extract one admitted feature through `fp-extract-slice`, which owns exactly that feature's extraction gates while the top-level workflow alone owns discovery, scheduling, reconciliation, synthesis, continuation, and readiness and the leaf performs no further workflow composition.
- [ ] **CHECKPOINT-01**: A user can resume an interrupted feature at its first incomplete material extraction gate because the leaf durably acknowledges before/after, retry, invalidation, and terminal transitions together with artifact evidence using the shared state reducer.

### Bounded Scheduling and Automatic Continuation

- [ ] **BUDGET-01**: A user can run large-project extraction without hitting the shared runtime ceiling because each gate, feature, and segment is admitted against bounded call, token, concurrency, and retry budgets with non-spendable capacity reserved for checkpointing, reconciliation, synthesis, and truthful handoff.
- [ ] **RETRY-01**: A user can resume a failed or blocked feature under bounded per-gate and per-feature retry rules that persist attempt history and terminal reasons, continue eligible independent work, and never reclassify exhausted retries as completed.
- [ ] **ISOLATE-01**: A user retains all verified work when one feature times out, fails, or returns invalid output because the failure updates only that feature's durable outcome and dependency-independent features continue within the current segment.
- [ ] **CONT-01**: One `/feature-workflows:extract-design` command automatically launches durably acknowledged bounded segments while progress is possible; segment intents and completions use monotonic identifiers and idempotency keys so duplicate, lost, or interrupted launches cannot skip or double-apply work, and every stop preserves an exact manual resume command.

### Synthesis, Publishing, Persistence, and Status Truth

- [ ] **SYNTH-01**: A user receives incrementally updated, idempotent project views, including the system overview, dependency map, cross-cutting concerns, and coverage index, derived only from verified bounded feature summaries through the shared revision contract.
- [ ] **OBSERVE-01**: A user can publish and persist feature shards, project indexes, synthesis artifacts, and continuation acknowledgements in bounded retry-safe units that distinguish attempted writes from durably verified success and expose budgets, failures, and continuation evidence.
- [ ] **STATUS-01**: The command handoff and read-only status surface report the same revision-current coverage denominator and lifecycle outcomes, and set `extractReady=true` only when discovery is exhausted, the graph is valid, every in-scope feature and required artifact is verified, required synthesis is current, and no incomplete lifecycle state remains.

### Compatibility and Scale Proof

- [ ] **COMPAT-01**: Existing design, implement, tune, review, and read-only status workflows continue to hydrate v1.4.5 and v1.5 state safely, consume completed feature docsets/shards, and preserve their established gates, artifacts, handoffs, and command behavior under continuous regression tests.
- [ ] **QUAL-01**: Generated-source and installed-plugin E2E characterization covers inventory determinism, pagination, graph rejection, queue semantics, root-last migration, selective revision invalidation, both install modes, gate interruption/resume, dependency ordering, budgeting, retries, isolated failure, duplicate continuation delivery, synthesis, publishing failure, truthful readiness, and every non-extract regression gate named by the milestone matrix.
- [ ] **DOGFOOD-01**: An observed whole-repository `/feature-workflows:extract-design` run started by one user command processes multiple features across as many automatically continued bounded segments as required and records durable segment, budget, coverage, failure, synthesis, compatibility, and final readiness evidence without reaching the shared runtime ceiling.

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
| DIST-01 | Phase 3 | Pending |
| ORCH-01 | Phase 4 | Pending |
| CHECKPOINT-01 | Phase 4 | Pending |
| BUDGET-01 | Phase 5 | Pending |
| RETRY-01 | Phase 5 | Pending |
| ISOLATE-01 | Phase 5 | Pending |
| CONT-01 | Phase 5 | Pending |
| SYNTH-01 | Phase 6 | Pending |
| OBSERVE-01 | Phase 6 | Pending |
| STATUS-01 | Phase 6 | Pending |
| COMPAT-01 | Phase 7 | Pending |
| QUAL-01 | Phase 7 | Pending |
| DOGFOOD-01 | Phase 7 | Pending |

**Coverage:** 21/21 v1 requirements mapped; 0 orphaned; 0 duplicated. All 15 approved improvement themes are represented.

---
*Requirements defined: 2026-07-22*  
*Last updated: 2026-07-22 after review convergence and seven-phase remapping*
