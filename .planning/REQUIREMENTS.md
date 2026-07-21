# Requirements: feature-workflows v1.5.0

**Defined:** 2026-07-22  
**Milestone:** v1.5.0 Project-Scale Extract Design  
**Status:** Drafted for roadmap mapping

## Core Value

One user command must drive a trustworthy feature workflow from intent to durable, verifiable artifacts without silently losing work or overstating completion.

## v1 Requirements

### Project Discovery and Decomposition

- [ ] **INV-01**: A user can extract a requested project scope from a deterministic, bounded repository inventory that accounts for every discovered path as included or explicitly excluded and records the applicable generated, vendor, and ignore policy as evidence.
- [ ] **DISC-01**: A user can discover all features and subsystems through durable paginated pages and cursors, with oversized areas recursively refined so no workflow prompt or response must contain the whole repository inventory.
- [ ] **GRAPH-01**: Before extraction starts, a user receives a validated feature graph whose canonical identities are collision-free, whose ownership covers the included inventory without unexplained overlap or gaps, and whose dependency edges, entry points, coverage links, dangling references, and cycle policy are verified.
- [ ] **QUEUE-01**: A user can see each feature in exactly one durable lifecycle state—runnable, deferred, in progress, blocked, failed, skipped, excluded, or completed—and caps or selectors preserve unprocessed in-scope features as resumable deferred work rather than completion.

### Truthful Progress and Durable Recovery

- [ ] **STATUS-01**: A user sees `extractReady=true` only when discovery is exhausted, the graph is valid, every in-scope feature and required artifact is verified for the current revision, required project synthesis is current, and no runnable, deferred, in-progress, blocked, failed, or skipped work remains; otherwise status reports exact denominators and outcomes.
- [ ] **RETRY-01**: A user can resume a failed or blocked feature under bounded per-gate and per-feature retry rules that persist attempt history and terminal reasons, continue independent work, and never reclassify exhausted retries as completed.
- [ ] **CHECKPOINT-01**: A user can resume an interrupted feature at its first incomplete material extraction gate because the workflow durably acknowledges before/after, retry, and terminal transitions together with artifact evidence.
- [ ] **STATE-01**: A user can resume any feature independently from a validated, versioned feature-state shard referenced by a compact project manifest, while existing v1.4.5 state migrates deterministically and completed artifacts are revalidated without loading project-wide histories into root state.

### Bounded Feature Orchestration

- [ ] **ORCH-01**: A user can extract each admitted feature through a generated and installed `fp-extract-slice` leaf workflow that owns exactly one feature's extraction gates and checkpoints, while the top-level workflow alone owns discovery, scheduling, reconciliation, synthesis, and readiness.
- [ ] **BUDGET-01**: A user can run large-project extraction without hitting the shared runtime ceiling because each feature and gate is admitted against separate bounded call, token, and retry budgets with non-spendable capacity reserved for checkpointing, synthesis, and a truthful continuation handoff.
- [ ] **ISOLATE-01**: A user retains all verified work when one feature times out, fails, or returns invalid output because the failure updates only that feature's durable outcome and dependency-independent features continue within the segment.
- [ ] **DEPCTX-01**: A user gets dependency-correct extraction in deterministic, fair waves that process prerequisites before dependents, run safe independent features concurrently, detect no-progress conditions, and pass only bounded verified dependency summaries to each feature.

### Project Synthesis, Observability, and Proof

- [ ] **SYNTH-01**: A user receives incrementally updated, idempotent project views—including the system overview, dependency map, cross-cutting concerns, and coverage index—derived from verified bounded feature summaries and invalidated or rebuilt when their source or input revision changes.
- [ ] **OBSERVE-01**: A user can publish, persist, inspect, and continue extraction in bounded units through handoff and read-only status surfaces that distinguish attempted from successful writes and report the current coverage denominator, outcomes, revisions, budgets, failures, readiness proof, and exact continuation command; proven common primitives are reusable by other modes without imposing extract-only semantics.
- [ ] **QUAL-01**: A user can trust the whole-project promise because generated-distribution and installed-plugin tests demonstrate pagination, automatic multi-segment continuation from one command, interruption at every gate, resume, dependency ordering, bounded retries, isolated partial failure, source drift, ceiling reserve, final synthesis, truthful readiness, v1.4.5 migration, downstream tune/design/review compatibility, and an observed whole-repository dogfood run.

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
| Broad rewrites of all non-extract modes | Only proven common checkpoint, budget, state, persistence, and observability primitives belong in this milestone. |
| Direct filesystem or shell access from workflow scripts | Runtime I/O remains agent-mediated and generated workflow output remains self-contained. |
| More than one level of workflow composition | The runtime permits a top-level workflow to invoke a leaf; the leaf cannot invoke another workflow. |
| External services, databases, queues, daemons, bundlers, or runtime packages | Repository research found the dependency-free generated Node/ESM and JSON-state model sufficient for this milestone. |
| Speculative runtime constants | Segment limits, reserves, quotas, and concurrency must be established by characterization and dogfooding evidence. |

## Traceability

Roadmap phases are intentionally pending until the roadmapper assigns each v1 requirement to exactly one owning phase.

| Requirement | Roadmap Phase | Status |
|-------------|---------------|--------|
| INV-01 | Pending | Pending |
| DISC-01 | Pending | Pending |
| GRAPH-01 | Pending | Pending |
| QUEUE-01 | Pending | Pending |
| STATUS-01 | Pending | Pending |
| RETRY-01 | Pending | Pending |
| CHECKPOINT-01 | Pending | Pending |
| STATE-01 | Pending | Pending |
| ORCH-01 | Pending | Pending |
| BUDGET-01 | Pending | Pending |
| ISOLATE-01 | Pending | Pending |
| DEPCTX-01 | Pending | Pending |
| SYNTH-01 | Pending | Pending |
| OBSERVE-01 | Pending | Pending |
| QUAL-01 | Pending | Pending |

**Coverage:** 15 v1 requirements; 0 mapped; 15 pending roadmap assignment.

---
*Requirements defined: 2026-07-22*  
*Last updated: 2026-07-22 after repository-grounded milestone research*
