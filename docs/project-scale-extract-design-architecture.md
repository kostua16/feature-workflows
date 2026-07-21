# v1.5.0 Project-Scale Extract Design Architecture

> **Milestone architecture, not implemented behavior.** This document defines the approved target
> for milestone `v1.5.0 Project-Scale Extract Design`. The shipped v1.4.5 workflow does not yet
> provide these guarantees. `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` remain the
> authoritative scope and delivery ledger.

## Objective

One `/feature-workflows:extract-design` command must be able to cover an entire large project. The
command may execute many bounded workflow runs and one leaf workflow per feature, but every run must
leave durable, exact continuation state. Completion is a proof over the current project revision,
not an optimistic flag.

The milestone preserves the existing extraction gates and feature docsets while making discovery,
scheduling, persistence, synthesis, and status scale independently of project size.

## Current defects addressed

The v1.4.5 extract flow can decompose a wide scope into feature slices, but its bounded-run behavior
is not yet a whole-project completion contract:

- Run caps can leave undispatched slices without a first-class durable continuation queue.
- Deferred, skipped, excluded, blocked, failed, and completed outcomes are not sufficiently distinct
  to derive readiness safely.
- `extractReady` can be inferred from a partially processed queue rather than verified total scope.
- Checkpoints are coarser than individual extraction gates, so interruption can repeat work.
- Root state and prompts can grow with project-wide inventories, histories, and artifacts.
- A feature failure can consume orchestration capacity or obscure progress elsewhere.
- Parent and child workflows share the 1,000-agent-call ceiling, concurrency, abort signal, and token
  budget; composing more children does not create new capacity.
- Publishing, synthesis, status, and downstream-mode compatibility are not yet proven across
  automatically continued segments.

## Approved improvement themes

| # | Theme | Architectural outcome |
|---|-------|-----------------------|
| 1 | Deterministic repository inventory | Reproducible bounded pages account for every path as included or explicitly excluded with policy evidence. |
| 2 | Hierarchical paginated discovery | Large areas refine recursively through durable cursors without whole-project prompts. |
| 3 | Validated feature/dependency graph | Canonical feature IDs, ownership, dependencies, entry points, coverage, and cycle policy are verified before scheduling. |
| 4 | Correct deferred/excluded semantics | Every feature has exactly one lifecycle state; caps and selectors defer rather than complete work. |
| 5 | Truthful partial/complete status | Readiness is derived only from current-revision coverage and verified required artifacts. |
| 6 | Bounded retry policy | Per-gate and per-feature attempt history persists; exhausted work remains failed or blocked. |
| 7 | Gate-level checkpoints | Every material transition is acknowledged so resume starts at the first incomplete gate. |
| 8 | Sharded per-feature state | A compact project manifest indexes bounded, independently resumable feature shards. |
| 9 | `fp-extract-slice` leaf | One child owns one feature's extraction gates and cannot compose another workflow. |
| 10 | Calls, tokens, retries, and reserve | Admission uses characterized budgets and preserves non-spendable finalization capacity. |
| 11 | Isolated failure domains | Invalid output, timeout, or failure updates one shard while eligible independent work continues. |
| 12 | Dependency-aware scheduling/context | Prerequisites precede dependents; safe waves receive compact verified summaries. |
| 13 | Incremental synthesis | Project views update idempotently from verified revision-bound feature summaries. |
| 14 | Bounded publishing, persistence, and status | Writes are retry-safe and verified; status exposes exact coverage, budgets, failures, and continuation. |
| 15 | Project-scale E2E and dogfooding | Generated and installed surfaces prove scale, recovery, compatibility, and truthful readiness. |

## Three-layer execution model

```text
/feature-workflows:extract-design command
  command continuation controller
    repeatedly invokes feature-pipeline for acknowledged segments
      feature-pipeline parent control plane
        discovers, validates, schedules, reconciles, synthesizes, decides readiness
          fp-extract-slice leaf data plane
            executes and checkpoints one feature's extraction gates
```

### 1. Command continuation controller

The command preserves the one-command user experience. It invokes the top-level workflow, reads a
durably acknowledged handoff, and starts another bounded top-level run while the handoff status is
`segment-continue` and durable progress remains possible. Each top-level invocation receives fresh
runtime capacity. If the host cannot relaunch, the command stops truthfully and returns the exact
idempotent manual resume command.

### 2. `feature-pipeline` parent control plane

The parent alone owns:

- legacy migration and project-manifest validation;
- inventory pages, hierarchical discovery, graph validation, and the coverage denominator;
- lifecycle transitions, dependency-safe wave admission, budget allocation, and retry policy;
- child outcome reconciliation, project synthesis, publication, continuation, and readiness;
- monotonic segment identifiers, idempotency keys, progress fingerprints, and no-progress stops.

The parent stores indexes, digests, counters, paths, and compact outcomes. It does not carry the
whole inventory, child histories, or artifact bodies through one state object or prompt.

### 3. `fp-extract-slice` leaf data plane

The generated leaf accepts one admitted feature, its quota, current shard revision, and bounded
dependency summaries. It executes that feature's existing extraction sequence: code facts, e2e use
cases, detailed design, architecture, optional requirements and reviews, artifact verification, and
feature completion. It acknowledges before/after, retry, invalidation, and terminal transitions.

The leaf does not discover project scope, schedule siblings, synthesize project views, decide
project readiness, or invoke `workflow()`. This preserves the runtime's exactly-one-level nesting
contract.

## Sharded state, inventory, and graph

The target state is a control plane plus sharded data plane:

```text
pipeline-state.json                 compact, versioned project control state
project-manifest pages              feature index, lifecycle, revisions, shard references
inventory pages                     bounded path records and include/exclude evidence
feature graph pages/index           canonical nodes, ownership, edges, validation evidence
feature-state/<feature-id>.json     gate state, attempts, budgets, artifacts, revisions
feature summaries                   bounded verified inputs for project synthesis
project views                       overview, dependency map, concerns, coverage index
```

Stable canonical feature identities and deterministic ordering make pages, digests, and replays
byte-stable for the same repository revision. The validated graph must account for all included
inventory ownership, reject unexplained gaps or overlaps, validate edge targets, and apply an
explicit cycle policy before any feature is admitted.

Each feature occupies exactly one durable lifecycle state:

```text
runnable | deferred | in-progress | blocked | failed | skipped | excluded | completed
```

`excluded` is outside the denominator and requires rationale. `deferred`, `blocked`, `failed`, and
feature-level `skipped` remain incomplete. Only a policy-disabled optional gate may be skipped while
allowing feature completion, and only with recorded policy evidence.

Source, scope, graph, dependency-summary, and artifact digests drive selective invalidation. A
revision change invalidates affected feature gates and derived project views while retaining
independently valid evidence.

## Budgeted scheduling and transactional continuation

The scheduler admits only dependency-ready work whose next atomic gate fits characterized call,
token, concurrency, and retry budgets. A non-spendable reserve is retained for checkpointing,
reconciliation, synthesis, persistence, and handoff. The hard 1,000-agent-call limit is treated as a
ceiling never to approach, not an admission target.

Every segment follows a transactional protocol:

1. Persist a monotonic segment intent and idempotency key.
2. Admit a bounded dependency-safe wave against the remaining spendable budget.
3. Run one isolated leaf per admitted feature and durably checkpoint each gate.
4. Reconcile child outcomes idempotently into validated feature shards and manifest pages.
5. Update revision-current synthesis from verified summaries only.
6. Persist and verify the segment completion acknowledgement.
7. Return `segment-continue`, a truthful terminal/blocking outcome, and an exact resume command.

Duplicate, lost, resumed, or out-of-order launches must converge to one durable outcome. A progress
fingerprint and bounded segment/attempt counters stop automatic relaunch when no durable progress is
possible. Failures remain local to their feature; dependency-independent features can continue.

## Synthesis and truthful readiness

The system overview, dependency map, cross-cutting concerns, and coverage index are idempotent
projections of verified bounded feature summaries. Attempted publication is distinct from durably
verified publication, and stale project views cannot satisfy readiness.

The command handoff and read-only status must use the same immutable, revision-current projection.
The target readiness invariant is:

```text
extractReady = discovery exhausted
  AND graph validated
  AND completed == all in-scope features
  AND runnable + deferred + in-progress + blocked + failed + skipped == 0
  AND every required feature artifact is current and verified
  AND required project synthesis is current and verified
```

Any partial state reports the exact denominator and completed, remaining, blocked, failed, skipped,
and excluded counts together with budget and continuation evidence. Read-only status performs no
writes.

## Brownfield migration and compatibility

v1.4.5 `pipeline-state.json` remains a supported input. Migration is additive, deterministic, and
root-last:

1. Validate the legacy envelope before mutation.
2. Derive deterministic feature identities and default new version/revision fields.
3. Write and validate every referenced child shard.
4. Reclassify legacy cap/selector outcomes as `deferred` where evidence shows undispatched scope.
5. Reverify legacy completed artifacts against the revision contract.
6. Atomically acknowledge the compact project manifest only after all child references are durable.

Interruption at any migration boundary must resume idempotently without exposing a mixed-version
ready state. Completed feature docsets and shards remain consumable by design resume, implement,
tune, review, and status without extract-specific queue behavior leaking into those modes.

The build must generate exactly two supported entries, `feature-pipeline` and
`fp-extract-slice`, from `workflows/src/`. Copy and symlink installs, release contents, generated
headers, sandbox validation, and plugin version must remain in lockstep. Generated distribution is
never edited directly.

## Delivery roadmap

1. **State, coverage, migration, and revision contracts** — pure transitions, root-last migration,
   sharded schemas, readiness truth, and selective invalidation.
2. **Bounded discovery, validated graph, and schedulability** — deterministic inventory pages,
   canonical features, complete ownership, dependency validation, and truthful queue seeding.
3. **Multi-entry build, install, and version lockstep** — generate, package, install, and validate
   the parent and leaf together.
4. **Checkpointed feature leaf** — run one feature through gate-level durable transitions while
   preserving existing artifact compatibility.
5. **Bounded scheduler and transactional automatic continuation** — dependency-safe waves,
   characterized quotas/reserve, isolated failures, and command-level multi-segment continuation.
6. **Synthesis, publish, persist, and status truth** — revision-current project views, retry-safe
   bounded writes, identical handoff/status projections, and reachable verified readiness.
7. **Compatibility and project-scale proof** — continuous non-extract regression gates, full E2E
   matrix, both install modes, and an observed whole-repository dogfood run.

Each phase follows RED characterization, minimum GREEN implementation, refactoring under unchanged
evidence, and generated/installed verification. A newly exposed regression blocks that phase; it is
not deferred to Phase 7.

## Exact scale and E2E exit gates

Milestone completion requires all of the following observable evidence:

- A 23-feature, cap-8 fixture reports exactly `8 completed / 15 deferred`, then `16 / 7`, then
  `23 / 0`; every feature is promoted and processed exactly once.
- A fixture with at least 100 canonical in-scope features completes across multiple automatically
  acknowledged segments below characterized call, token, and concurrency limits, with measured
  checkpoint/reconciliation/synthesis/handoff reserve and no missing or duplicate coverage.
- Inventory remains deterministic under reordered traversal; generated, vendor, ignored, oversized,
  ownership-gap/overlap, collision, dangling-edge, and supported/unsupported-cycle fixtures produce
  explicit verified outcomes.
- Root-last legacy migration and selective revision invalidation survive fault injection and replay
  without mixed state or unrelated evidence loss.
- Copy and symlink installed-plugin surfaces resolve both generated entries with clean build drift,
  sandbox checks, release contents, headers, and version metadata in lockstep.
- Interruption before and after every material leaf gate resumes at the first incomplete gate;
  duplicate completions, invalid output, and source drift cannot duplicate or advance stale evidence.
- Near-limit admission preserves non-spendable reserve. Retryable errors, exhausted retries,
  timeouts, invalid child output, and blocked dependents remain truthful while independent work
  continues.
- Duplicate, lost, and out-of-order segment launches plus crashes around intent/completion
  acknowledgement converge without skipped or double-applied work and retain an exact manual resume.
- Repeated, changed, removed, or stale feature summaries produce idempotent, selectively current
  project views; persistence fault injection distinguishes attempted from durable success.
- Partial, deferred, blocked, failed, skipped, stale-revision, invalid-graph, and missing-synthesis
  states never set readiness; command handoff and read-only status agree exactly.
- Design resume, implement, tune, review, status, v1.4.5 migration, and v1.5 completed-shard fixtures
  preserve established gates, artifacts, hydration, and handoffs.
- One observed whole-repository run begins with one user command, processes the repository's full
  natural in-scope feature inventory across multiple segments, recovers from an injected gate
  interruption and a duplicate continuation without manual state repair, stays below runtime limits
  with measured reserve headroom, and reaches verified whole-project readiness. The synthetic scale
  fixture supplies the 100-plus-feature stress threshold; the real-repository dogfood run must not
  manufacture features merely to meet an artificial minimum.

## Reusable contracts and mode boundaries

The milestone may share versioned gate reducers, artifact evidence, revision comparison, bounded
persistence acknowledgements, budget/retry ledgers, capacity reserve, telemetry, and truthful status
projections with design, implement, tune, or review when a failing characterization proves the same
problem.

Sharded work-item state, isolated failure envelopes, and dependency-ready scheduling are reusable
only for modes that demonstrate real multi-item scale. Ordinary single-feature flows remain
unsharded. Status is a read-only consumer and never mutates workflow state.

Repository inventory, feature discovery, the extraction graph, cross-feature reverse-design
synthesis, automatic extract continuation, and `fp-extract-slice` remain extract-specific in
v1.5.0. This milestone does not create a general DAG platform, add direct filesystem access or a
queue service, weaken existing gates, or redesign established artifact formats.

---

*Approved milestone architecture: 2026-07-22. Implementation status: not started.*
