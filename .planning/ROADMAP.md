# Roadmap: feature-workflows

## Roadmap v1.5.0: Project-Scale Extract Design

## Overview

Milestone v1.5.0 turns the shipped v1.4.5 extract flow into trustworthy whole-project extraction. It establishes the state and revision contracts first, discovers a bounded schedulable graph, ships both required workflow entries in lockstep, makes each feature a checkpointed leaf, advances work through transactionally acknowledged bounded segments, derives synthesis and readiness from exact coverage, and proves compatibility and scale through installed-plugin E2Es and an observed whole-repository run.

The user experience remains one `/feature-workflows:extract-design` command. Internal segmentation exists to respect the one-level composition model and shared call, concurrency, abort, and token limits; every segment is durable and manually resumable even when automatic relaunch is unavailable.

## Milestone-Wide TDD Contract

Every implementation plan in this milestone must follow the same evidence order:

1. **RED characterization first:** add or identify a repository-native test that fails for the exact missing contract before production changes. Record the test ID, failure reason, and fixture/revision used. A test that passes before the change is not RED evidence.
2. **Minimum GREEN implementation:** implement only enough behavior to satisfy the owning requirement and its phase success criteria. Do not weaken existing assertions, delete failures, or substitute mocks for the generated/installed surface when that surface is the contract.
3. **Refactor under unchanged evidence:** structural cleanup is allowed only after GREEN and must leave the new characterization plus all continuous regression gates green.
4. **Generated and installed verification:** source-only success is insufficient whenever generated distribution, copy install, symlink install, versioning, command handoff, or workflow composition is affected.
5. **Durable evidence:** each phase records its RED failure, GREEN run, generated-artifact drift result, and exact E2E observations in the phase verification artifact.

### Continuous Regression Gates

These gates run at every phase exit after the relevant fixtures exist; a phase may add coverage but may not defer a newly exposed regression to Phase 7.

| Gate | Required invariant |
|------|--------------------|
| Build and generated drift | The checked-in generated entries equal a clean source build and contain no direct filesystem, shell, unresolved runtime import, or stale header/version drift. |
| Version and release | Plugin manifest, both generated workflow headers/metadata, marketplace/release contents, and installed entries resolve the same version. |
| Design | `/design-feature` and `--resume` preserve established gates, artifacts, and compatible state hydration. |
| Implement | `/implement-feature` consumes compatible approved design/extract artifacts and preserves its test-authoring and implementation gates. |
| Tune | `/tune-feature` consumes completed feature docsets without losing shard or project-manifest evidence. |
| Review | `/review-design` reads the established artifacts and reports findings without mutating extraction readiness. |
| Status | Read-only status performs no writes and reports the same state/revision truth as the extract handoff. |
| Resume and migration | Existing v1.4.5 fixtures hydrate deterministically and repeated resume is idempotent. |

### YAGNI Guardrails

- Build only whole-project extract orchestration; do not create a general arbitrary-DAG platform or scale-loop other modes without a milestone requirement and failing characterization.
- Ship only the top-level workflow entry and the one required `fp-extract-slice` leaf entry; do not introduce arbitrary nested composition or a generic workflow registry solely for possible future children.
- Keep the dependency-free generated Node/ESM and agent-mediated JSON persistence model; no database, daemon, queue service, bundler, runtime package, or direct workflow filesystem/shell access.
- Do not add dynamic mid-leaf repartitioning until a bounded-feature fixture proves fixed pre-admission partitioning cannot meet the budget contract.
- Derive budget, reserve, concurrency, page-size, and retry defaults from RED characterization and dogfood evidence; do not encode speculative constants.
- Share reducers, revision comparison, persistence acknowledgements, and status projections only where an existing non-extract regression proves the same contract; do not impose extract graph semantics on other modes.

## Phases

**Phase Numbering:** This is the first GSD roadmap. Phase numbering starts at 1; shipped v1.4.5 is the brownfield baseline, not part of the phase ledger.

- [ ] **Phase 1: State, Coverage, Migration, and Revision Contracts** - Versioned pure reducers, root-last migration, sharded state, and selective invalidation establish truthful foundations.
- [ ] **Phase 2: Bounded Discovery, Validated Graph, and Schedulability** - Deterministic pages become a validated ownership/dependency graph and durable schedulable queue.
- [ ] **Phase 3: Multi-Entry Build, Install, and Version Lockstep** - Source, generated artifacts, copy/symlink installs, version metadata, and release contents expose both workflow entries together.
- [ ] **Phase 4: Checkpointed Feature Leaf** - One feature runs through `fp-extract-slice` with transition-level acknowledgements and resumable gate evidence.
- [ ] **Phase 5: Bounded Scheduler and Transactional Automatic Continuation** - Dependency-safe work advances through budgeted, isolated, monotonically acknowledged segments from one command.
- [ ] **Phase 6: Synthesis, Publish, Persist, and Status Truth** - Bounded verified summaries produce retry-safe project views and one revision-current readiness account.
- [ ] **Phase 7: Compatibility and Project-Scale Proof** - Continuous mode compatibility, complete E2E characterization, and whole-repository dogfooding prove the promise.

## Phase Details

### Phase 1: State, Coverage, Migration, and Revision Contracts
**Goal**: Users have one deterministic contract for lifecycle transitions, readiness, per-feature state, brownfield migration, and source/revision invalidation before scale behavior is added.  
**Depends on**: Nothing (first phase)  
**Requirements**: CONTRACT-01, STATE-01, REV-01  
**RED Gate**:
  1. Pure-reducer table tests fail for illegal lifecycle transitions, incomplete coverage incorrectly becoming ready, nondeterministic replay, mutation of input state, and conflation of feature-level skipped, policy-disabled optional-gate skipped, and required-gate skipped outcomes.
  2. Migration fault injection fails at each child write/validation boundary and proves current behavior can acknowledge root state before every shard is durable.
  3. Revision fixtures fail because a source/dependency change either preserves stale derived evidence or invalidates unrelated completed features.
**GREEN Evidence**:
  1. Reducer table/property tests replay the same ordered events to byte-stable lifecycle and readiness projections without mutating inputs.
  2. v1.4.5 migration writes and validates all child shards before the compact root manifest, and interruption at any boundary resumes idempotently without a mixed-version ready state.
  3. Feature shards remain bounded while root state contains only schema/version, indexes, aggregate evidence, and durable child references.
  4. Revision/digest tests invalidate the exact affected feature gates and derived views while retaining independently valid evidence.
  5. All continuous regression gates are green against both v1.4.5 and v1.5 fixtures.
**Success Criteria** (what must be TRUE):
  1. Replaying an ordered event stream produces a byte-stable lifecycle/readiness projection without mutating reducer inputs.
  2. Interrupted v1.4.5 migration never acknowledges the root manifest before every referenced child shard is durably validated, and resume converges idempotently.
  3. A source, scope, graph, dependency-summary, or artifact revision change invalidates only affected gates and derived views.
  4. Feature-level skipped remains incomplete, a policy-disabled optional-gate skip may complete only with recorded policy evidence, and skipping any required gate blocks completion and readiness.
**Plans**: TBD

### Phase 2: Bounded Discovery, Validated Graph, and Schedulability
**Goal**: Users can establish a complete reproducible scope and transform it into bounded pages, a validated feature graph, and a truthful queue that is safe to schedule.  
**Depends on**: Phase 1  
**Requirements**: INV-01, DISC-01, GRAPH-01, QUEUE-01, DEPCTX-01  
**RED Gate**:
  1. Fixtures with reordered directory traversal, generated/vendor paths, oversized subsystems, identity collisions, ownership gaps/overlap, dangling edges, and cycles fail deterministic inventory/graph assertions.
  2. Cursor interruption and cap/selector tests fail by duplicating or losing pages or by converting undispatched in-scope features into completion/exclusion; the exact 23-feature, cap-8 fixture must expose any deviation from 8 processed/15 deferred, then 16/7, then 23/0.
  3. Dependency/no-progress fixtures fail to produce a deterministic schedulability decision and bounded dependency context.
**GREEN Evidence**:
  1. Repeated discovery of the same confirmed revision yields identical inventory evidence, page cursors, canonical identities, coverage denominator, and graph digest without whole-repository prompts.
  2. Oversized areas refine recursively into bounded durable pages; interrupted discovery resumes without gaps or duplicates.
  3. Graph validation rejects unexplained ownership gaps/overlap, collisions, dangling edges, and unsupported cycles before extraction.
  4. Every feature occupies exactly one lifecycle state; caps/selectors retain unprocessed work as deferred and excluded paths remain outside the denominator with recorded rationale.
  5. The schedulability plan produces deterministic prerequisite waves, explicit cycle/no-progress outcomes, and bounded verified dependency summaries.
  6. Phase 1 evidence and all continuous regression gates remain green.
**Success Criteria** (what must be TRUE):
  1. Repeated discovery of the same revision produces identical bounded inventory pages, canonical feature identities, coverage denominator, and graph digest.
  2. Graph validation prevents scheduling for identity collisions, unexplained ownership gaps/overlap, dangling edges, and unsupported cycles.
  3. With 23 canonical in-scope features and cap 8, successive acknowledged segments report exactly 8 completed/15 deferred, 16/7, and 23/0, with every feature promoted from deferred exactly once.
  4. Every discovered feature has exactly one durable lifecycle state and every scheduled leaf receives only bounded verified dependency context.
**Plans**: TBD

### Phase 3: Multi-Entry Build, Install, and Version Lockstep
**Goal**: Users who install or release the plugin receive the top-level pipeline and its leaf workflow as one validated, version-consistent unit.  
**Depends on**: Phase 2  
**Requirements**: DIST-01  
**RED Gate**:
  1. Generated-drift tests fail when either source entry changes without rebuilding both checked-in artifacts or when an orphan/stale generated entry remains.
  2. Copy-install and symlink-install E2Es fail to resolve `fp-extract-slice` through the same production lookup used by the top-level workflow.
  3. Version/release tests fail when manifest, generated headers/metadata, marketplace package, installed entries, or release contents disagree or omit either entry.
**GREEN Evidence**:
  1. A clean build deterministically emits exactly the supported top-level and `fp-extract-slice` workflow entries with fresh self-contained sandbox-safe output.
  2. Both copy and symlink dogfood installs resolve and invoke each generated entry through the real installed-plugin surface.
  3. Plugin version, both generated headers/metadata, marketplace/release manifest, and packaged contents pass one lockstep validator.
  4. No direct edits to generated output are needed; clean rebuild drift is empty.
  5. Phases 1-2 evidence and all continuous regression gates remain green.
**Success Criteria** (what must be TRUE):
  1. A clean build deterministically emits the top-level and `fp-extract-slice` entries with no generated drift or sandbox violation.
  2. Both copy and symlink installs resolve and invoke both entries through the production installed-plugin lookup.
  3. Plugin manifest, generated headers/metadata, marketplace and release contents, and installed entries report one version and include both entries.
**Plans**: TBD

### Phase 4: Checkpointed Feature Leaf
**Goal**: Users can extract and resume one feature independently through the installed leaf without losing verified gate work.  
**Depends on**: Phase 3  
**Requirements**: ORCH-01, CHECKPOINT-01  
**RED Gate**:
  1. Installed-plugin fault injection interrupts before and after each material gate: code facts, e2e use cases, detailed design, architecture, requirements, design-debt review, fidelity review, and feature completion.
  2. Each interruption initially fails because resume repeats verified work, skips an incomplete gate, loses artifact evidence, or performs child composition.
  3. Invalid output and revision-change fixtures fail to route through the shared transition/invalidation reducer.
**GREEN Evidence**:
  1. `fp-extract-slice` processes exactly one admitted feature and composes no workflow; the top-level entry retains discovery, scheduling, reconciliation, synthesis, continuation, and readiness authority.
  2. Every before/after gate boundary is durably acknowledged with artifact revision/evidence, and resume starts at the first incomplete or selectively invalidated gate.
  3. Replaying the same gate completion or resume event is idempotent and does not duplicate writes, attempts, or completion counts.
  4. The completed docset remains compatible with the established per-feature artifact contract.
  5. Phases 1-3 evidence and all continuous regression gates remain green.
**Success Criteria** (what must be TRUE):
  1. The installed `fp-extract-slice` processes exactly one admitted feature, composes no child workflow, and leaves project scheduling/readiness authority at the top level.
  2. Interrupting before or after code facts, e2e, detailed design, architecture, requirements, design-debt review, fidelity review, or completion resumes at the first incomplete gate without repeating verified work.
  3. Duplicate completion, invalid output, and source drift converge through the shared reducer without duplicating evidence or advancing stale state.
  4. A feature-level skipped outcome remains incomplete; only a policy-disabled optional gate with recorded evidence may be skipped while completing; a skipped required gate blocks feature completion.
**Plans**: TBD

### Phase 5: Bounded Scheduler and Transactional Automatic Continuation
**Goal**: Users start extraction once and dependency-safe work continues across bounded segments without ceiling crashes, duplicate application, or cross-feature failure loss.  
**Depends on**: Phase 4  
**Requirements**: BUDGET-01, RETRY-01, ISOLATE-01, CONT-01  
**RED Gate**:
  1. Capacity fixtures fail when admission spends checkpoint/handoff reserve, crosses characterized call/token/concurrency limits, or accepts a feature that cannot finish its next atomic gate.
  2. Retry, timeout, invalid-child, and dependency-block fixtures fail by losing verified work, poisoning independent work, or relabeling exhausted attempts complete.
  3. Continuation transport fixtures inject duplicate launch, lost acknowledgement, crash before/after intent, out-of-order delivery, host relaunch refusal, and no-progress waves; current behavior must fail monotonic/idempotent segment assertions.
**GREEN Evidence**:
  1. Deterministic fair waves admit only dependency-ready work that fits characterized per-gate, per-feature, and per-segment budgets while retaining non-spendable reconciliation/checkpoint/synthesis/handoff reserve.
  2. Feature failures update only their shard, preserve verified artifacts and attempts, and allow eligible independent features to continue; exhausted retries remain failed/blocked.
  3. Segment intent and completion acknowledgements use monotonic IDs plus idempotency keys; duplicate, lost, resumed, or out-of-order launches converge to one durable outcome without skipped work.
  4. One command automatically launches the next acknowledged segment while progress is possible; every stop, including host relaunch refusal and no-progress, emits an exact idempotent manual resume command.
  5. Stress characterization completes below the shared runtime ceiling with measured reserve and no speculative default.
  6. Phases 1-4 evidence and all continuous regression gates remain green.
**Success Criteria** (what must be TRUE):
  1. A 100-plus canonical-feature fixture completes across multiple automatically acknowledged segments below characterized limits with measured checkpoint/reconciliation/synthesis/handoff reserve.
  2. Segment intents and completions use monotonic identifiers and idempotency keys so duplicate, lost, resumed, and out-of-order delivery cannot skip or double-apply work.
  3. Retry exhaustion or one feature failure preserves verified work, remains failed/blocked, and does not prevent eligible independent features from continuing.
  4. Every segment stop reports exact completed/deferred/blocked/failed counts and an idempotent manual resume command.
**Plans**: TBD

### Phase 6: Synthesis, Publish, Persist, and Status Truth
**Goal**: Users receive bounded revision-current project artifacts and one consistent, verifiable account of progress, continuation, and completion.  
**Depends on**: Phase 5  
**Requirements**: SYNTH-01, OBSERVE-01, STATUS-01  
**RED Gate**:
  1. Synthesis fixtures fail when repeated verified summaries duplicate content, when changed inputs leave stale project views, or when unrelated changes rebuild unaffected views.
  2. Persistence fault injection fails at attempted write, durable verification, index update, and continuation acknowledgement boundaries.
  3. Partial/deferred/blocked/failed/skipped, stale-revision, incomplete-discovery, invalid-graph, and missing-synthesis fixtures fail if handoff/status denominators differ or readiness becomes true.
**GREEN Evidence**:
  1. System overview, dependency map, cross-cutting concerns, and coverage index update idempotently from bounded verified summaries and obey selective revision invalidation.
  2. Feature shards, project indexes, synthesis views, and continuation acknowledgements persist/publish in bounded retry-safe units that distinguish attempted from durably verified success.
  3. Command handoff and read-only status return the same immutable projection for denominator, lifecycle outcomes, revisions, budgets, failures, readiness proof, and continuation command.
  4. `extractReady=true` occurs only when discovery is exhausted, graph and current-revision artifacts are valid, synthesis is current, and every in-scope feature is verified complete.
  5. Status remains read-only under success, failure, stale-state, and migration fixtures.
  6. Phases 1-5 evidence and all continuous regression gates remain green.
**Success Criteria** (what must be TRUE):
  1. Repeated or selectively changed verified summaries produce idempotent, revision-current project views without rebuilding unaffected outputs.
  2. Persistence fault injection distinguishes attempted from durably verified writes and retry never produces duplicate index, synthesis, or continuation state.
  3. Command handoff and read-only status report identical denominators, lifecycle outcomes, revisions, budgets, failures, and continuation evidence.
  4. Readiness is true only for exhausted discovery, a valid graph, current verified required artifacts, current synthesis, and no incomplete feature-level outcome.
**Plans**: TBD

### Phase 7: Compatibility and Project-Scale Proof
**Goal**: Users can rely on the one-command whole-project promise because the generated installed plugin demonstrates every contract and preserves all established workflow modes.  
**Depends on**: Phase 6  
**Requirements**: COMPAT-01, QUAL-01, DOGFOOD-01  
**RED Gate**:
  1. Run the complete milestone E2E matrix below against both generated source and copy/symlink installed-plugin surfaces; every scenario must have recorded pre-fix RED evidence from its owning phase or a newly exposed failing characterization before correction.
  2. Run design, implement, tune, review, status, v1.4.5 migration, and resume fixtures continuously; any state/artifact/handoff regression blocks dogfooding.
  3. Start a whole-repository dogfood run over its full natural inventory with characterized settings that require multiple segments, and capture the first unmet scale, continuation, compatibility, or truthfulness assertion as RED evidence.
**GREEN Evidence**:
  1. The exact E2E matrix passes on clean generated output and both installed-plugin modes with no stale distribution or version drift.
  2. Design, implement, tune, review, and status workflows consume compatible migrated/completed shards while preserving their established gates and artifact behavior.
  3. One observed `/feature-workflows:extract-design` command completes the repository's full natural inventory across multiple automatically acknowledged segments, recording revision, budgets, attempts, coverage, failures, synthesis, installed version, compatibility checks, and final readiness proof.
  4. The dogfood run stays below characterized runtime limits and demonstrates recovery from at least one injected interruption and one duplicate continuation delivery without manual state repair.
  5. All continuous regression gates and every prior phase evidence suite are green.
**Success Criteria** (what must be TRUE):
  1. Every exact E2E matrix scenario passes against clean generated output plus copy and symlink installed-plugin surfaces.
  2. Design, implement, tune, review, and read-only status preserve established gates, artifacts, hydration, and handoffs for v1.4.5 migration and v1.5 shards.
  3. One observed whole-repository command processes its full natural inventory across multiple automatically acknowledged segments with no duplicate/missing coverage and measured reserve headroom.
  4. The observed run recovers from an injected gate interruption and duplicate continuation delivery without manual state repair and reaches truthful verified readiness.
**Plans**: TBD

## Exact E2E Matrix

| ID | Owning phase | Surface and fixture | Required observable outcome |
|----|--------------|---------------------|-----------------------------|
| E2E-STATE-01 | 1 | v1.4.5 state; interrupt each child migration write/validation and root commit | Children are durable before root acknowledgement; resume converges idempotently; readiness never observes mixed state. |
| E2E-REV-01 | 1 | Change one source file, one dependency summary, scope, and graph input independently | Only affected gates/views invalidate; unrelated verified shards remain usable. |
| E2E-DISC-01 | 2 | Reordered traversal with generated/vendor/ignored paths and an oversized subsystem | Inventory/page/feature/graph digests are deterministic; cursors exhaust scope without whole-project prompts. |
| E2E-GRAPH-01 | 2 | Identity collision, ownership gap/overlap, dangling edge, supported cycle, unsupported cycle | Unsafe graphs are rejected explicitly; supported policy yields deterministic schedulability and denominator. |
| E2E-QUEUE-01 | 2 | Caps, selectors, exclusion, interruption, and no-progress dependency wave | Every feature has one state; undispatched scope remains deferred; exclusion never masquerades as completion. |
| E2E-DEFER-01 | 2 | Exactly 23 canonical in-scope features with a per-segment cap of 8 | Acknowledged segments report exactly 8 completed/15 deferred, then 16/7, then 23/0; each feature is promoted from deferred once and processed once. |
| E2E-DIST-01 | 3 | Clean build followed by symlink install | Both generated entries resolve, share version/header metadata, and run through the installed production lookup. |
| E2E-DIST-02 | 3 | Clean build followed by copy install and release-content validation | Both entries are packaged, version-aligned, sandbox-safe, and drift-free. |
| E2E-LEAF-01 | 4 | Interrupt before/after code facts, e2e, detailed design, architecture, requirements, design-debt review, fidelity review, completion | Resume starts at the first incomplete gate and preserves all prior verified evidence exactly once. |
| E2E-LEAF-02 | 4 | Duplicate gate completion plus invalid output and source drift | Reducer replay is idempotent; invalid/stale evidence cannot advance lifecycle/readiness. |
| E2E-SKIP-01 | 4 | Feature-level skipped, policy-disabled optional gate skipped, and required-gate skipped | Feature-level skipped remains incomplete; an optional gate may be skipped only with policy evidence and may then complete; any skipped required gate blocks completion/readiness. |
| E2E-BUDGET-01 | 5 | Multi-wave project near characterized call/token/concurrency limits | Admission preserves non-spendable reserve and stops with a durable truthful handoff before the ceiling. |
| E2E-FAIL-01 | 5 | Retryable error, exhausted retry, timeout, invalid child output, blocked dependent | Attempts persist; independent work continues; terminal failure is never counted complete. |
| E2E-CONT-01 | 5 | Duplicate/lost/out-of-order launch and crash before/after segment intent/completion acknowledgement | Monotonic idempotency converges to one outcome with no skipped/double-applied work and an exact manual resume fallback. |
| E2E-SCALE-01 | 5 | At least 100 canonical in-scope features requiring multiple automatically acknowledged segments | All features appear exactly once in the coverage denominator and exactly once in a terminal outcome; no feature is duplicated or lost, every segment preserves measured checkpoint/reconciliation/synthesis/handoff reserve, and the run retains characterized headroom below shared limits. |
| E2E-SYNTH-01 | 6 | Repeated, changed, removed, and stale feature summaries | Project views are idempotent, selectively current, and derived only from verified summaries. |
| E2E-PERSIST-01 | 6 | Fail attempted write, durable verification, index update, and continuation acknowledgement | Retry is safe; attempted and durable status differ; root/status never claims unverified persistence. |
| E2E-STATUS-01 | 6 | Partial/deferred/blocked/failed/skipped, stale revision, invalid graph, missing synthesis, and complete project | Handoff and read-only status agree exactly; only the complete current-revision case is ready. |
| E2E-COMPAT-01 | 7 | Design resume, implement, tune, review, and status against v1.4.5 migration and v1.5 completed shards | Established gates/artifacts/handoffs work without state loss or extract-specific behavior leaking into other modes. |
| E2E-DOGFOOD-01 | 7 | Whole repository's full natural inventory, multiple segments, injected interruption and duplicate continuation | One command reaches verified whole-project readiness below runtime limits with complete durable evidence. |

## Progress

**Execution Order:** Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. State, Coverage, Migration, and Revision Contracts | 0/TBD | Not started | - |
| 2. Bounded Discovery, Validated Graph, and Schedulability | 0/TBD | Not started | - |
| 3. Multi-Entry Build, Install, and Version Lockstep | 0/TBD | Not started | - |
| 4. Checkpointed Feature Leaf | 0/TBD | Not started | - |
| 5. Bounded Scheduler and Transactional Automatic Continuation | 0/TBD | Not started | - |
| 6. Synthesis, Publish, Persist, and Status Truth | 0/TBD | Not started | - |
| 7. Compatibility and Project-Scale Proof | 0/TBD | Not started | - |
