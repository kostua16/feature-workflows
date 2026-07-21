# Handoff — current state & next actions

_Last updated: 2026-07-22 (v1.5.0 milestone initialized and roadmap approved)._

## Current state
- Milestone **v1.5.0 Project-Scale Extract Design** is initialized and approved. Planning status is
  **ready to plan** at Phase 1; implementation has not started.
- The 15 approved improvement themes are expressed as **21 atomic requirements**, mapped exactly
  once across **7 phases** (21/21 coverage; no orphaned or duplicated requirements):
  1. State, Coverage, Migration, and Revision Contracts
  2. Bounded Discovery, Validated Graph, and Schedulability
  3. Multi-Entry Build, Install, and Version Lockstep
  4. Checkpointed Feature Leaf
  5. Bounded Scheduler and Transactional Automatic Continuation
  6. Synthesis, Publish, Persist, and Status Truth
  7. Compatibility and Project-Scale Proof
- Planning artifacts are `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`,
  `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/MILESTONES.md`, and
  `.planning/research/`; the published architecture is
  `docs/project-scale-extract-design-architecture.md`.
- Milestone commits:
  - `5682a1d` — `docs: start milestone v1.5.0 Project-Scale Extract Design`
  - `e4d4d05` — `docs: research project-scale extract design`
  - `0155b30` — `docs: define milestone v1.5.0 requirements`
  - `bc3fcea` — `docs: create milestone v1.5.0 roadmap (7 phases)`

## Durable architecture decisions
- The user-facing contract is **one `/feature-workflows:extract-design` command**. Internally, the
  command automatically drives as many bounded, durably acknowledged top-level segments as needed;
  every stop retains an exact idempotent manual resume command.
- A top-level `feature-pipeline` control plane owns discovery, scheduling, reconciliation,
  synthesis, continuation, and the sole readiness decision. One generated `fp-extract-slice`
  leaf owns the checkpointed extraction gates for exactly one feature and performs no further
  workflow composition.
- Parent and leaf share the runtime's **1,000-agent-call ceiling**, token budget, concurrency cap,
  and abort signal. Segment admission must preserve non-spendable capacity for checkpointing,
  reconciliation, synthesis, persistence, and truthful handoff; runtime constants must come from
  characterization rather than guesses.
- State evolves additively from v1.4.5 into a compact project manifest plus independently resumable
  feature shards. `extractReady=true` is derived only from exhausted discovery, a valid graph,
  complete current-revision feature/artifact coverage, current verified synthesis, and no incomplete
  lifecycle state.
- Design, implement, tune, review, and read-only status compatibility is a continuous milestone
  gate; extract-specific graph and queue semantics must not leak into unrelated modes.

## Next recommended action
Run `$gsd-plan-phase 1` for **State, Coverage, Migration, and Revision Contracts**. Phase 1 must
characterize the v1.4.5 migration boundary and revision/digest inputs before schema implementation,
then establish pure deterministic lifecycle/readiness reducers, root-last migration, sharded state,
selective invalidation, and RED-first fixtures.

Related: `mem:core`, `mem:session_start`, `mem:task_completion`, `mem:conventions`,
`mem:memory_maintenance`.
