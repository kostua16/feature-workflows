# Project Research Summary

**Project:** feature-workflows v1.5.0 Project-Scale Extract Design  
**Domain:** Project-scale reverse-design extraction in a generated dynamic-workflow Codex plugin  
**Researched:** 2026-07-22  
**Confidence:** HIGH

## Executive Summary

`feature-workflows` must evolve `/feature-workflows:extract-design` from a bounded multi-slice run into trustworthy whole-project extraction without changing the user-facing simplicity: one user command should automatically drive as many bounded, durable top-level Workflow segments as necessary. The correct architecture is a control plane plus sharded feature data: the existing generated `feature-pipeline` remains the top-level authority for inventory, graph validation, scheduling, synthesis, coverage, and completion, while a new generated `fp-extract-slice` leaf executes exactly one feature's existing X2-X7 gate chain and checkpoints after every material transition.

The repository's existing zero-dependency Node/ESM toolchain, generated self-contained workflows, agent-mediated JSON persistence, and `pipeline-state.json` compatibility contract should be extended rather than replaced. A compact project manifest should reference paginated inventory/graph artifacts and independently resumable feature shards. The command controller should re-invoke the top-level workflow whenever it returns `segment-continue`, creating fresh runtime capacity while preserving a single user command and an exact manual `--resume` fallback.

The central risk is false completion under finite runtime capacity. Caps, selectors, blocked work, retries, stale synthesis, or exhausted budgets must never disappear from the denominator. `extractReady=true` must be derived only from exhausted discovery, a validated graph, verified completion of every in-scope feature, zero unresolved runnable/deferred/in-progress/blocked/failed/skipped work, and current verified project artifacts. Prevent no-progress loops, mid-gate loss, prompt/state growth, source-drift reuse, and cross-mode regressions through explicit state semantics, additive migration, admission budgets with checkpoint reserve, digest-bound synthesis, and installed-plugin E2E proof.

## Key Findings

### Recommended Stack

Keep the current dependency-free implementation model. Extend the explicit-order workflow builder to emit two committed, self-contained scripts and validate both in build, version, sandbox, setup, preflight, and release checks. No database, queue, daemon, bundler, runtime package, direct filesystem API, or broad six-mode workflow split is justified.

**Core technologies:**

- **Claude Code dynamic workflows:** `feature-pipeline` remains the top-level orchestrator and uses the native `workflow()` primitive to call one strict `fp-extract-slice` leaf per admitted feature.
- **Generated Node/ESM workflow scripts:** Node 22 is the CI floor; extend `scripts/build-workflows.mjs` with explicit per-entry manifests and separate pure-literal metadata while keeping generated output import-free and byte-reproducible.
- **Agent-mediated additive JSON state:** retain compact root `pipeline-state.json`, paginated project manifest/index artifacts, and design-compatible per-feature shards with deterministic IDs, sequence counters, gate attempts, artifact evidence, budgets, and summaries.
- **Command-owned continuation:** extend `extract-design.md` to automatically resume bounded top-level segments; child calls share the parent's 1,000-agent-call/token envelope and cannot reset capacity.
- **Repository-native verification:** use `node:test`, generated-dist integration tests, build/version drift checks, installed-plugin characterization, and whole-repository dogfooding.

Critical contracts: plugin version remains sourced from `.claude-plugin/plugin.json`; generated distribution files are never edited directly; child workflows cannot compose another workflow; runtime I/O remains agent-mediated; v1.4.5 state and established per-feature artifacts must continue to hydrate and serve tune/design/review.

### Expected Features

All 15 approved themes are milestone table stakes or proof gates; none may be dropped from v1.5.0:

1. **Deterministic repository inventory** — bounded, reproducible scope evidence with explicit generated/vendor/exclusion policy.
2. **Hierarchical paginated feature discovery** — durable pages and cursors; oversized areas refine without whole-repository prompts.
3. **Validated feature/dependency graph** — stable unique identities, ownership, entry points, coverage links, valid edges, and explicit cycle policy.
4. **Correct deferred/excluded semantics** — caps and selectors defer work; excluded, skipped, blocked, failed, and completed remain distinct.
5. **Truthful partial versus complete status** — readiness is a proof over an exact coverage revision, not an optimistic flag.
6. **Bounded retry policy** — per-gate/per-feature attempt history persists; exhausted retries remain failed or blocked.
7. **Gate-level durable checkpoints** — resume starts at the first incomplete gate after every interruption point.
8. **Sharded per-feature state** — compact root control state references independently validated feature shards.
9. **Dedicated `fp-extract-slice` leaf** — one feature per child; parent retains scheduling and completion authority.
10. **Call, token, and retry budgets** — admission is pre-budgeted and reserves non-spendable checkpoint/synthesis/handoff capacity.
11. **Isolated failure domains** — one child failure changes only its feature outcome while independent work continues.
12. **Dependency-aware scheduling/context** — prerequisites precede dependents; safe independent work uses bounded waves and compact summaries.
13. **Incremental cross-feature synthesis** — digest/revision-based overview, dependency map, cross-cutting concerns, and coverage index updates.
14. **Extract-aware publishing, persistence, and status** — bounded idempotent writes, exact coverage/budget/failure reporting, and correct continuation commands.
15. **Large-project E2E characterization and dogfooding** — prove pagination, segmentation, interruption/resume, ordering, failure isolation, ceiling reserve, synthesis, and final truth in an installed plugin.

**Differentiators:** one-command multi-segment continuation, evidence-backed completion, graceful partial value, deterministic rebuildable project indexes, and immediate forward-flow compatibility for completed feature docsets.

**Explicitly defer beyond v1.5.0:** project-scale orchestration for other modes without reproduced need; a generalized arbitrary-DAG platform; new design artifact formats/language; dynamic repartitioning after a child starts unless characterization proves it necessary; infrastructure or performance shortcuts that weaken gates, evidence, verification, or checkpoints.

### Architecture Approach

Use a **control plane plus sharded data plane**. The command controller owns repeated top-level invocations. `feature-pipeline` owns compact project state, paginated discovery, graph validation, dependency-safe admission, aggregate coverage, synthesis, and the sole readiness decision. `fp-extract-slice` owns one feature's sequential facts → e2e → detailed design → architecture → optional fidelity review → optional requirements → optional audit gates, its checkpoints, artifact verification, and compact summary. The parent stores paths, counters, revisions, and compact outcomes—not full inventories, child histories, or artifact bodies.

**Major components:**

1. **Command continuation controller** — preserves one invocation for the user while looping over durable `segment-continue` handoffs.
2. **Project extraction control plane** — migrates state, manages status taxonomy/coverage, validates progress, admits waves, and derives completion.
3. **Paginated discovery and graph layer** — inventories scope, hierarchically discovers features, reconciles ownership, and validates dependencies before scheduling.
4. **Compact manifest and feature shards** — separate scheduler/index data from bounded feature gate state and artifact evidence.
5. **Generated `fp-extract-slice` leaf** — runs one isolated gate machine within preallocated quotas and returns a compact JSON outcome.
6. **Bounded dependency scheduler** — admits only ready work that fits soft call/token limits plus finalization reserve; detects no-progress loops.
7. **Incremental synthesis/status layer** — updates revision-bound project views from verified summaries and exposes truthful coverage and continuation.
8. **Multi-entry build/install system** — generates, packages, installs, validates, and versions parent and leaf in lockstep.

The readiness invariant is:

```text
extractReady = discovery exhausted
  AND graph validated
  AND completed == all in-scope features
  AND runnable + deferred + in-progress + blocked + failed + skipped == 0
  AND every required feature artifact is verified
  AND required project synthesis is current and verified
```

### Common Cross-Flow Applicability and Boundaries

Generalize mechanisms only where the same problem exists:

- Reuse versioned gate checkpoints, artifact evidence, budget/retry ledgers, capacity reserve, bounded persistence, telemetry, and derived readiness across long design, implement, tune, and review flows where applicable.
- Reuse sharded work-item state and isolated failure envelopes only for proven multi-item scale, such as independent implementation lanes or large review lens sets; ordinary single-feature design should remain unsharded.
- Reuse dependency-ready scheduling for implement stages/lanes where dependencies already exist; do not impose an extraction feature graph on design, tune, or review.
- Status is a read-only projection that may read shards on demand and must report exact denominators, revisions, limits, failures, and next commands without mutating state.
- Inventory, repository feature discovery, cross-feature synthesis, and `fp-extract-slice` are extract-specific in v1.5.0. Other modes consume compatible feature artifacts but do not inherit extract queue semantics.
- Preserve existing artifact names and design-shaped feature state for `/tune-feature`, `/design-feature --resume`, and `/review-design`; the project root is an extraction control plane and must not advertise multi-feature `designReady`.

### Critical Pitfalls

1. **False completion from ambiguous queue states** — define a validated transition table first; deferred, blocked, failed, skipped, and excluded never count as completed.
2. **Automatic continuation without progress** — persist a progress fingerprint, bounded segment/attempt counters, explicit capacity reserve, and a deterministic stop requiring user action when no durable progress occurs.
3. **Coarse or divergent checkpoints** — make the child acknowledge gate-level state/artifact writes before success and reconcile child outcomes atomically into the parent manifest.
4. **Unsafe v1.4.5 migration** — validate legacy envelopes before mutation, deterministically default/add fields, reverify old `done` artifacts, and convert old cap/selector `skipped` entries to `deferred` where appropriate.
5. **Unvalidated graph or inventory** — require stable collision-free IDs, complete ownership/exclusion accounting, valid references, and an explicit strongly-connected-component/cycle policy before scheduling.
6. **Runtime ceiling starvation** — estimate worst-case child costs before admission, allocate sibling quotas in advance, enforce separate call/token/retry budgets, and stop while checkpoint/handoff reserve remains.
7. **Unbounded prompts or parent state** — pass page paths and compact dependency summaries; enforce bounded root entries and keep logs, file lists, attempts, and full artifacts in shards.
8. **Stale source, synthesis, publishing, or status** — bind feature evidence and project outputs to source/input digests and revisions; separate publish attempted from publish succeeded and verify before readiness.
9. **One-level composition violations** — top-level parent calls leaf only; leaf contains its gates and never invokes `workflow()`.
10. **Cross-mode and packaging regressions hidden by structural tests** — test generated dist, both install paths, migration/handoff matrices, interruption/fault scenarios, and the actual one-command installed-plugin flow.

## Implications for Roadmap

### Phase 1: Coverage and State Contracts

**Rationale:** Every later scheduler, retry, and completion behavior depends on unambiguous states and compatible persistence.  
**Delivers:** status transition table; derived readiness predicate; additive manifest/shard schemas; deterministic v1.4.5 migration; source/input revision fields; truth-table and migration fixtures.  
**Themes:** 4, 5, 7, 8 foundations.  
**Avoids:** false readiness, permissive/lossy migration, parent/child truth divergence, and cross-mode breakage.

### Phase 2: Deterministic Discovery and Validated Graph

**Rationale:** The denominator and dependency order must be known and reconciled before feature execution can be trusted.  
**Delivers:** bounded repository inventory; hierarchical discovery pages/cursors; canonical feature identity; ownership/exclusion evidence; graph validation including dangling edges and an explicit cycle policy.  
**Themes:** 1, 2, 3, and queue seeding for 4.  
**Avoids:** whole-repository prompts, identity collisions, missing/overlapping scope, hidden cycles, and non-deterministic resumes.

### Phase 3: Multi-Entry Generated Build and Installation

**Rationale:** The leaf must be buildable, installable, versioned, and sandbox-valid before runtime orchestration depends on it.  
**Delivers:** second explicit builder entry and metadata; generated `fp-extract-slice.js`; per-entry phase/syntax/sandbox/drift checks; setup, preflight, release, and version lockstep for both workflows.  
**Themes:** enabling infrastructure for 9 and 15.  
**Avoids:** missing/stale child installs, hand-edited dist, version drift, unresolved imports, and composition surprises.

### Phase 4: Checkpointed Feature Leaf

**Rationale:** Automatic continuation is unsafe until a killed child can resume at its first incomplete gate without losing or duplicating work.  
**Delivers:** versioned child request/response contract; X2-X7 leaf gate machine; before/after/retry/terminal checkpoints; bounded retry history and feature budgets; verified feature summary; design-compatible shard state.  
**Themes:** 6, 7, 8, 9, 10, 11 foundations.  
**Avoids:** mid-gate loss, retry duplication, child completion overreach, invalid return crashes, non-idempotent artifact updates, and downstream incompatibility.

### Phase 5: Bounded Scheduler and Automatic Segmentation

**Rationale:** With validated graph and resumable leaf units, the parent can safely schedule dependency-ready work within finite shared capacity.  
**Delivers:** fair dependency-safe waves; pre-admission call/token/retry quotas; checkpoint reserve; isolated failure reconciliation; deferred queue semantics; progress fingerprints; `segment-continue`; command-level automatic resume loop and exact manual fallback.  
**Themes:** 4, 6, 10, 11, 12 plus the one-command execution contract.  
**Avoids:** ceiling exhaustion, starvation, infinite/no-progress loops, conflated cap/selector semantics, and one-feature failure aborting the project.

### Phase 6: Incremental Synthesis, Publishing, and Truthful Status

**Rationale:** Completion cannot become reachable until project outputs are revision-aware, verified, and consistent with the coverage ledger.  
**Delivers:** idempotent summary upserts; system overview, dependency map, cross-cutting concerns, and coverage index; synthesis freshness tracking; bounded publish/persist with attempted/succeeded distinction; extract-aware read-only status and handoff; final adversarial reconciliation.  
**Themes:** 5, 13, 14.  
**Avoids:** stale/lossy synthesis, unverified publication, wrong continuation commands, misleading counts without denominators, and optimistic readiness.

### Phase 7: Compatibility and Project-Scale Proof

**Rationale:** The milestone promise is behavioral and installed-plugin-level; structural tests cannot prove multi-segment durability or truthful completion.  
**Delivers:** legacy migration matrix; feature-shard tune/design/review handoffs; unchanged forward-mode behavior; generated-dist parent/leaf integration; pagination, interruption-at-every-gate, retry, partial failure, dependency ordering, source drift, ceiling reserve, and continuation E2Es; observed whole-repository dogfood evidence.  
**Themes:** 15 and final verification of 1-14 plus shared cross-flow primitives.  
**Avoids:** source-only confidence, hidden install/runtime faults, cross-mode regression, and completion claims unsupported by real evidence.

### Phase Ordering Rationale

- Truth and migration contracts precede all mutations so later layers cannot encode ambiguous `skipped`/`blocked` behavior.
- Inventory and graph validation precede scheduling because stable order is not a cycle or coverage policy.
- Multi-entry packaging precedes child runtime use, and gate-level child checkpoints precede automatic relaunch.
- Scheduler budgets, progress detection, and reserve ship together; none is optional hardening.
- Synthesis/status verification precedes any reachable `extractReady=true` path.
- Cross-mode fixtures should begin with Phase 1 changes and remain release gates; Phase 7 adds complete installed-plugin and dogfood proof.

### Research Flags

Phases needing focused phase research or spikes:

- **Phase 2:** choose and characterize the explicit dependency-cycle policy (reject, validated SCC group, or degraded ordering) and determine when manifest/status indexes require pagination.
- **Phase 3:** verify child workflow resolution and progress-tree behavior for symlink and copy-fallback installs; prove `parallel()`/`pipeline()` child invocation behavior before default concurrency.
- **Phase 5:** measure safe soft call limits, finalization reserve, per-gate quotas, token budgets, and wave width; verify the command host can sustain repeated top-level invocations and stop truthfully on host/session interruption.
- **Phase 6:** determine the smallest verified feature-summary schema that supports faithful incremental synthesis and define digest/revision invalidation precisely.
- **Phase 7:** establish observed dogfood thresholds and evidence format; the proof must use actual runtime telemetry rather than guessed constants.

Phases with established repository patterns (targeted validation, no broad external research):

- **Phase 1:** additive JSON state/default migration, artifact-path idempotence, and pure state-machine testing are well evidenced in current source/tests.
- **Phase 4:** the X2-X7 gate order and artifact contract already exist; research should focus only on checkpoint and child protocol edges.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Directly grounded in the current zero-dependency builder, CI Node floor, generated runtime restrictions, setup flow, and documented composition limits |
| Features | HIGH | All 15 themes are approved in PROJECT.md and traced to observable v1.4.5 correctness or scalability gaps |
| Architecture | HIGH | The parent/leaf seam, one-level nesting, shared runtime capacity, current gate chain, and state contracts are directly evidenced in source/docs/tests |
| Pitfalls | HIGH | Queue/readiness, checkpoint, prompt growth, publish/status, migration, and packaging risks map to concrete current control flow and regressions |

**Overall confidence:** HIGH

### Gaps to Address

- **Runtime constants:** derive segment soft limits, reserves, quotas, and concurrency from characterization; do not hard-code speculative defaults.
- **Cycle semantics:** explicitly select and test the policy before graph scheduling ships.
- **Child runtime/install behavior:** verify registry resolution, error normalization, counter propagation, and progress display in both supported install modes.
- **Source drift:** define which inventory, feature-scope, dependency, and artifact digests invalidate which completed gates or synthesis revisions.
- **Compact-summary sufficiency:** prove the summary schema can rebuild faithful project views without rereading full docsets.
- **Host continuation boundary:** define truthful user-facing behavior when the slash-command host cannot begin another automatic segment; always retain the exact manual resume command.
- **Scale thresholds:** determine when manifest and status indexes themselves need paging through measured fixtures and dogfooding.

## Sources

### Primary (HIGH confidence)

- `.planning/PROJECT.md` — v1.5.0 goal, 15 approved themes, single-command contract, constraints, compatibility, and explicit boundaries.
- `.planning/research/STACK.md` — recommended runtime/build/state/test stack, integration changes, rejected infrastructure, and validation questions.
- `.planning/research/FEATURES.md` — table stakes, differentiators, queue/coverage vocabulary, dependencies, cross-flow applicability, and deferrals.
- `.planning/research/ARCHITECTURE.md` — parent/leaf boundaries, durable state, data flow, migration, build integration, phase order, and verification boundaries.
- `.planning/research/PITFALLS.md` — critical failure modes, phase warnings, non-deferrable mitigations, and confidence assessment.
- `plugins/feature-workflows/workflows/src/` — current extract control flow, queue, gates, state, schemas, configuration, and publish/persist behavior cited by the research files.
- `plugins/feature-workflows/commands/` and `scripts/build-workflows.mjs` — command continuation/install contracts and generated distribution pipeline cited by the research files.
- `tests/`, `docs/dynamic-workflows.md`, and `docs/workflow-decomposition-investigation.md` — characterized behavior, runtime constraints, and validated decomposition seam cited by the research files.

No external ecosystem research was used; repository evidence is authoritative for this brownfield milestone.

---
*Research completed: 2026-07-22*  
*Ready for requirements and roadmap: yes*
