# Feature Landscape

**Domain:** Project-scale reverse design extraction for a dynamic-workflow Codex plugin  
**Project:** feature-workflows v1.5.0 Project-Scale Extract Design  
**Researched:** 2026-07-22  
**Confidence:** HIGH — repository-grounded in the v1.4.5 contract, tests, workflow reference, and approved milestone requirements; no external research used.

## Recommended Product Behavior

`/feature-workflows:extract-design` should remain one user-visible command, but internally run as many bounded Workflow segments as the project requires. A segment is a capacity-limited scheduling window, not a scope limit. Each segment should:

1. Load the compact project manifest and only the feature shards needed for that segment.
2. Advance bounded discovery, graph validation, runnable feature children, and synthesis work.
3. Reserve enough call/token capacity to checkpoint every changed shard and return a truthful handoff.
4. Return either `complete`, `continue-automatically`, or a specific user-action/failure state.
5. Let the command layer automatically re-invoke with `--resume` while runnable or deferred work remains and no user decision is required.

The existing scope-confirmation pause remains the only expected early interaction. `--no-confirm` stays autonomous. Manual `/extract-design --resume <planDir>` remains a safe fallback after interruption, but routine whole-project extraction should not require the user to calculate slices or repeatedly issue commands.

Completion is strict: `extractReady=true` only when discovery is exhausted, the feature/dependency graph is valid, every in-scope feature has completed all required gates with verified artifacts, and required project-level synthesis artifacts are current and verified. A run may be operationally successful yet still finish `extractReady=false` with exact partial coverage.

## Table Stakes

Missing any of these makes the project-scale promise untrustworthy or unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Deterministic repository inventory | Re-running the same scope must discover the same evidence and explain omissions | High | Record roots, files, entry points, exclusions, generated/vendor policy, pagination cursors, and an inventory digest. Never depend on one unbounded prompt. |
| Hierarchical paginated feature discovery | Large repositories cannot fit in one agent prompt or one Workflow segment | High | Discover bounded pages under stable parent areas; recursively refine only oversized areas; persist every page and cursor. |
| Validated feature/dependency graph | Scheduling and truthful coverage require stable identities and known ownership/dependency boundaries | High | Validate unique IDs, references, entry points, file ownership/coverage, dangling edges, and cycles before child scheduling. |
| Durable queue with non-overlapping meanings | Caps and selectors must not hide unfinished work | Medium | Distinguish runnable, running, deferred, excluded, blocked, failed, skipped, and completed. See queue semantics below. |
| Truthful coverage and readiness | The current capped queue can otherwise imply completion from partial work | High | Report denominator, completed IDs, remaining/deferred IDs, failures, blockers, exclusions, skipped items, artifact state, and next action. |
| Bounded retry with attempt history | One malformed output or transient failure must neither abort the project nor retry forever | Medium | Retry per gate/per feature; classify failure; persist attempts and last error; exhausted retries become failed/blocked, never completed. |
| Gate-level durable checkpoints | Restarting an interrupted feature from its first gate wastes budget and increases failure probability | High | Persist gate transitions and verified artifact evidence after each material gate, not only after the whole slice. |
| Sharded per-feature state | A monolithic project state grows with repository size and couples unrelated failures | High | Keep a compact project manifest plus independently resumable feature shards; preserve additive hydration of v1.4.5 state. |
| `fp-extract-slice` leaf workflow | One feature needs a bounded, observable, isolated execution unit | High | The top-level workflow owns scheduling/completion; each leaf owns only one feature's extraction gates. Nesting must remain exactly one level. |
| Per-feature/gate budgets and segment capacity reserve | Parent and children share the 1,000-call ceiling, concurrency cap, abort signal, and token budget | High | Estimate before launch, stop scheduling before the ceiling, and reserve checkpoint/synthesis/handoff capacity. |
| Isolated feature failure domains | A failed slice must not erase completed work or stop dependency-independent slices | High | Catch child launch/output/artifact failures into that feature shard; continue safe work; retain an exact project-level failure summary. |
| Dependency-aware bounded scheduler | Prerequisites sometimes inform dependents, while independent features should use safe concurrency | High | Schedule ready nodes only; pass compact verified dependency summaries, not upstream docsets or whole-project inventories. |
| Incremental project synthesis | Rebuilding a system overview from all raw artifacts defeats sharding | High | Idempotently upsert verified feature summaries into overview, dependency map, cross-cutting concerns, and coverage index; final reconciliation proves completeness. |
| Extract-aware publish/persist/status | A long run needs bounded durable outputs and a clear continuation contract | High | Publish by feature/project unit; status reads compact indexes and shards on demand; expose budgets, attempts, failures, coverage, and continuation. |
| Large-project characterization and dogfooding | Structural unit tests alone do not prove the one-command contract or ceiling avoidance | High | Cover discovery pages, graph validation, segmentation, interruption/resume, ordering, partial failure, retry exhaustion, synthesis, and an observed plugin-repository run. |

## Queue and Coverage Semantics

The v1.4.5 `pending/done/skipped/blocked` vocabulary is insufficient for automatic whole-project continuation. Use explicit, durable states with one meaning each.

| State | Meaning | Counts as complete? | Automatic action |
|-------|---------|---------------------|------------------|
| `runnable` | In scope, dependencies satisfied, budget not yet assigned | No | Eligible for the next bounded segment |
| `running` | A child owns the feature and has a durable current gate | No | Resume from the first incomplete gate after interruption |
| `deferred` | In scope but postponed by segment cap, budget reserve, selector, or unmet scheduling window | No | Reconsider automatically; never disappear from coverage |
| `excluded` | Explicitly outside the confirmed scope, with reason and discovery evidence | Outside denominator | Report, but do not schedule |
| `blocked` | Cannot currently advance because of a dependency, missing prerequisite, invalid graph, or external/user action | No | Retry only when the blocking condition changes |
| `failed` | Attempted and exhausted its bounded retry policy, or produced irrecoverably invalid output | No | Preserve failure/attempt evidence; independent work continues |
| `skipped` | User explicitly declined an otherwise in-scope feature or required work item | No | Never silently reinterpret as excluded; prevents readiness until scope is revised |
| `completed` | Every configured required gate and artifact is verified, and the shard checkpoint is durable | Yes | Feed its compact verified summary into synthesis |

Important compatibility behavior:

- `--max-slices=N` becomes a per-segment scheduling bound. Excess in-scope features become `deferred`, not terminal `skipped`.
- `--slices=id1,id2` selects scheduling priority/work for the current segment; unselected in-scope features remain visible and incomplete unless scope confirmation explicitly excludes them.
- `--no-decompose` remains accepted for compatibility, but a scope estimated above one segment must block truthfully rather than attempt an unsafe unbounded slice.
- Disabled optional gates change the configured required-artifact set. They must be shown as intentionally disabled, not missing and not falsely executed.
- An interrupted `running` feature resumes its shard at the first incomplete gate. It is not reset to a fresh feature and not promoted to completed.

Recommended coverage measures:

- **Feature coverage:** verified completed in-scope features / all in-scope features.
- **Discovery coverage:** completed inventory/discovery pages plus unresolved cursors/areas.
- **Artifact coverage:** verified required artifacts by feature and required project-level artifact.
- **Accounting:** separate counts and IDs for runnable, running, deferred, blocked, failed, skipped, and excluded.
- **Synthesis freshness:** last incorporated feature digest/version versus each completed shard's current digest.

Do not collapse these into a single percentage. The terminal handoff should show the feature fraction first, then exact exceptions and synthesis freshness.

## Differentiators

These features make the implementation notably better than a generic batch documentation job.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| One-command, multi-segment continuation | Users request a project once while the system handles finite runtime windows | High | The command layer loops over durable parent resumptions; every internal segment remains bounded and independently recoverable. |
| Evidence-backed completion proof | “Complete” is derived from inventory, graph, shard artifacts, and synthesis evidence rather than a happy-path return | High | Makes partial success useful without overstating readiness. |
| Feature-local forward-flow compatibility | Every extracted feature remains immediately usable by tune, design resume, and review | Medium | Preserve established artifact names and slice-local design-shaped state. |
| Deterministic, rebuildable project index | A lost/stale overview can be regenerated from verified shards without rerunning extraction | High | Stable feature IDs and content digests make synthesis idempotent. |
| Graceful partial value | Independent completed docsets remain valid even when other features fail | Medium | The final report points directly to usable feature artifacts and unresolved coverage. |
| Shared scale primitives without shared domain semantics | Other modes gain checkpoint, budget, telemetry, and truthful-status capabilities without becoming “extract queues” | High | Generalize state-machine primitives; keep repository discovery and project synthesis extract-specific. |

## Anti-Features

Features to explicitly not build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Literally unbounded single Workflow invocation | Parent and children share hard runtime capacity; late failure can prevent checkpointing | Use automatic bounded segments with reserved finalization capacity |
| Whole repository inventory in one prompt | Token growth is unbounded and makes omissions/non-determinism hard to detect | Persist paginated inventory evidence and give agents bounded page/feature references |
| Treating caps/selectors as scope completion | Hides unfinished work and permits false readiness | Mark unscheduled work deferred and preserve it in coverage |
| Treating `skipped`, `excluded`, `blocked`, and `failed` as synonyms | Destroys retry, coverage, and user-intent semantics | Use explicit states and reasons with a validated transition table |
| One monolithic project `pipeline-state.json` | Grows with every feature, couples writes, and expands every resume prompt | Compact manifest plus per-feature shards and bounded summary indexes |
| Child workflow deciding project completion | A leaf cannot know undiscovered/deferred project work and must not mutate global authority | Parent alone schedules, synthesizes, and sets `extractReady` |
| Child-to-grandchild composition | Runtime nesting is exactly one level and throws below it | Top-level extract orchestrator calls leaf `fp-extract-slice` children only |
| Unlimited retries or concurrency | Consumes shared ceilings and creates nondeterministic starvation | Per-gate/per-feature budgets, safe scheduler concurrency, and capacity reserve |
| Passing full upstream artifacts to dependents | Recreates project-scale prompt growth through dependency context | Pass compact verified dependency summaries with artifact paths/digests |
| Rewriting established design artifacts | Breaks tune/design/review compatibility and broadens the milestone | Keep current names and semantics; add bounded indexes/metadata only where needed |
| Breaking v1.4.5 state hydration | Existing user runs would become unrecoverable | Add versioned/defaulted fields and deterministic migration/validation |
| Weakening reviews, artifact verification, or tests for speed | Produces faster but untrustworthy extraction | Segment the same quality gates and prove them under scale |
| Broad rewrite of all six modes | Expands risk without evidence that every extract concern applies elsewhere | Share only proven checkpoint, budget, persistence, telemetry, and status primitives |
| Random/time-derived feature identity | Makes resume, deduplication, and synthesis unstable; sandbox also forbids common time/random APIs | Derive stable IDs from confirmed ownership/entry-point boundaries and validate collisions |

## Feature Dependencies

```text
Deterministic inventory
  -> paginated hierarchical discovery
  -> validated feature/dependency graph
  -> truthful queue seeding and scope denominator

Additive state schema + gate checkpoints
  -> per-feature shards
  -> fp-extract-slice leaf workflow
  -> isolated retries/failures + per-slice budgets

Validated graph + queue + shards + budgets
  -> dependency-aware bounded scheduler
  -> automatic multi-segment continuation

Verified completed shards
  -> incremental project synthesis
  -> bounded publish/persist/status

Inventory exhaustion + graph validity + completed in-scope shards + fresh verified synthesis
  -> extractReady=true

All layers
  -> large-project characterization + real plugin dogfooding
```

## Confirmed Improvement Theme Coverage

All 15 approved themes are required for the v1.5.0 milestone. “Depends on” lists the minimum theme prerequisites, not merely related work.

| # | Confirmed Theme | Category | Complexity | Depends On | Acceptance Focus |
|---|-----------------|----------|------------|------------|------------------|
| 1 | Deterministic repository inventory | Table stake | High | Existing scope resolver and artifact persistence | Same confirmed scope yields stable inventory/evidence; exclusions and generated/vendor decisions are explicit and bounded |
| 2 | Hierarchical paginated feature discovery | Table stake | High | 1 | No prompt requires the full inventory; all pages/cursors are durable; oversized areas refine recursively |
| 3 | Validated feature and dependency graph | Table stake | High | 1, 2 | Stable unique IDs, valid edges/ownership/entry points, cycle policy, and file/feature coverage links are verified before scheduling |
| 4 | Correct deferred and excluded queue semantics | Table stake | Medium | 3 | Caps/selectors create visible deferred work; excluded/skipped/blocked/failed/completed are never conflated |
| 5 | Truthful partial versus complete status | Table stake / differentiator | High | 1, 3, 4, 13, 14 | Readiness requires exhausted discovery, complete verified denominator, and fresh project artifacts; partial reports exact exceptions |
| 6 | Retry policy for blocked slices | Table stake | Medium | 4, 7, 8, 10 | Bounded attempts resume at a gate, history survives segments, exhausted work remains failed/blocked while independent work continues |
| 7 | Gate-level durable checkpoints | Table stake | High | Existing idempotent gate/artifact markers; additive state schema | Interruption after each material gate resumes from the first incomplete gate with verified prior work preserved |
| 8 | Sharded per-feature state | Table stake | High | 3, 7 | Compact manifest never embeds growing feature histories; every shard independently validates/hydrates; old state still loads |
| 9 | Dedicated `fp-extract-slice` child workflow | Table stake / differentiator | High | 7, 8 | One-level parent→leaf composition; child result is serializable; parent catches launch/output failure and retains completion authority |
| 10 | Per-slice call, token, and retry budgets | Table stake | High | 7, 8, 9 | Scheduler estimates before launch, enforces gate/feature limits, records use, and reserves checkpoint/handoff capacity |
| 11 | Isolated failure domains | Table stake / differentiator | High | 4, 6, 7, 8, 9, 10 | One feature's throw/timeout/invalid artifact changes only its shard and project summary; completed/independent work continues |
| 12 | Dependency-aware scheduling and context | Table stake | High | 3, 4, 8, 9, 10, 11 | Ready prerequisites precede dependents; safe independent work is bounded-concurrent; dependency context stays compact |
| 13 | Incremental cross-feature synthesis | Table stake / differentiator | High | 3, 8; consumes verified completions from 12 | Upserts are idempotent by stable ID/digest; partial overview is labeled partial; final reconciliation detects missing/stale entries |
| 14 | Extract-aware publishing, persistence, and status | Table stake | High | 4, 5, 7, 8, 10, 13 | Bounded feature/project writes; exact continuation and coverage in command/status; state and artifacts remain cross-flow compatible |
| 15 | Large-project E2E characterization and dogfooding | Proof gate | High | 1–14 | Fixtures and an observed whole-repo run prove pagination, segmentation, resume, ordering, failure isolation, ceiling reserve, and final truth |

## Common Cross-Flow Applicability

Generalize mechanisms, not extract-specific concepts. The following is the recommended boundary for reuse across the six existing modes.

| Primitive / Theme | Extract | Design | Implement | Tune | Review | Status |
|-------------------|---------|--------|-----------|------|--------|--------|
| Gate checkpoint schema and artifact evidence (7) | Required per feature gate | Reuse for long design/review loops | Reuse per test/execute/review gate and stage | Reuse per revisited gate | Reuse per lens/merge/verify/record gate where durable resume is useful | Read-only display |
| Sharded work-item state/index pattern (8) | Required per feature | Do not shard ordinary single-feature design; usable for future project-scale design only | Applicable to many stages/lanes when state growth is proven | Usually consume existing feature/stage shards | Applicable to very large artifact/lens sets only | Read shards on demand; never mutate |
| Budget ledger, retry policy, capacity reserve, telemetry (6, 10) | Required per gate/feature/segment | Reuse across refinement/reconciliation | Reuse across execute/test/debug/review | Reuse across revisions | Reuse across lenses and verification | Report exact use/limits |
| Isolated work-item failure envelope (11) | Required per feature | Limited value for sequential dependent gates | Reuse for independent lanes/stages where safe | Preserve unrelated stages | Reuse for independent lenses; keep merge truth | Report without normalizing away failures |
| Dependency-ready scheduler and compact context (12) | Required for features | Reuse only if project-scale design is later added | Natural reuse for dependency-ordered stages/lanes | Reuse existing stage dependencies | Not needed for independent review lenses | Visualize dependencies/readiness |
| Truthful readiness/coverage derivation (5) | `extractReady` from full scope proof | Derive `designReady` only from required verified gates | Derive ready/commit eligibility from stages/tests/review | Derive readiness from revisited gate completion | Distinguish findings produced, verified, and durably recorded | Central read-only projection |
| Bounded publish/persist and continuation envelope (14) | Feature shards + incremental project docs | Reuse chunked publishing/checkpoint handoff | Reuse stage/result persistence | Reuse touched-doc publishing | Reuse chunked report/issue recording | Render exact next command; no writes |
| Inventory/discovery/feature graph and project synthesis (1–3, 13) | Extract-specific for v1.5.0 | Do not impose | Do not impose | Consume feature artifacts only | Consume feature artifacts only | Display when present |
| `fp-extract-slice` leaf (9) | Extract-specific | A shared design-doc leaf is a later separately-proven opportunity | No | No | No | No |
| Scale characterization harness (15) | Primary milestone scenarios | Add regression assertions for shared primitives | Add stage/checkpoint regressions | Add resume/readiness regressions | Add partial-recording regressions | Add truthful projection regressions |

## MVP Recommendation

For this milestone, “MVP” still includes all 15 confirmed themes because each closes a correctness or runtime-safety gap in the one-command whole-project claim. Deliver them in dependency order:

1. **Scope and truth foundation:** deterministic inventory, paginated discovery, validated graph, explicit queue states, and the coverage/readiness model (themes 1–5).
2. **Durability foundation:** additive state versioning, gate checkpoints, compact manifest, per-feature shards, and v1.4.5 hydration tests (themes 7–8).
3. **Bounded execution:** `fp-extract-slice`, per-gate/feature/segment budgets, retry history, isolated failure handling, and dependency-ready scheduling (themes 6, 9–12).
4. **Project outputs and command loop:** incremental synthesis, bounded publishing/persistence, status projection, and automatic command-level continuation (themes 13–14).
5. **Proof:** synthetic large-project fixtures, interruption/failure/ceiling scenarios, and a recorded full-repository dogfood run (theme 15).

Prioritize preserving the existing artifact contract and manual `--resume` escape hatch throughout. A phase is not complete merely because its code exists; its state transitions and truth claims need characterization before the next layer depends on them.

Defer beyond v1.5.0:

- Project-scale design/tune/review orchestration unless a concrete repository-scale limit is reproduced there.
- A generalized arbitrary DAG workflow platform; implement only the scheduling primitives needed by feature extraction and proven implement-stage reuse.
- New artifact formats or design language.
- Fine-grained dynamic repartitioning after a feature child starts; start with deterministic preflight estimation and hierarchical discovery, then add split-on-budget only if characterization proves it necessary.
- Performance optimizations that weaken evidence, artifact verification, or checkpoint durability.

## Sources

- `.planning/PROJECT.md` — milestone goal, all 15 approved themes, constraints, scope, and key decisions.
- `plugins/feature-workflows/commands/extract-design.md` — current one-command surface, scope-confirmation loop, flags, terminal reporting, and resume behavior.
- `plugins/feature-workflows/workflows/feature-pipeline.md` — v1.4.5 extract flow, state/output contract, modes, gate semantics, resilience, budgets, artifact compatibility, and status behavior.
- `tests/extract-mode.test.mjs` — current queue meanings, dependency ordering fallback, scope checkpoint, per-slice flush, readiness, profile, and resume-repair assertions.
- `docs/workflow-decomposition-investigation.md` — one-level composition limit, shared parent/child runtime ceilings, no workflow imports, `fp-extract-slice` seam, build constraints, and migration risks.

## Unresolved Questions for Phase Research

- What exact runtime telemetry is available early enough to estimate remaining call/token capacity versus using conservative configured estimates?
- Should dependency cycles be rejected, represented as a validated strongly connected feature group, or extracted with explicit degraded ordering? The current queue silently falls back to source order; project-scale truth needs an explicit policy.
- What is the maximum compact project-manifest size that status and resume can safely load before the index itself needs pagination?
- Which artifact digest/evidence fields can be added while preserving hydration of every observed v1.4.5 state shape?
- How should the command layer communicate an automatic continuation that cannot proceed because the host session itself is ending, while still honoring the one-command goal and exact manual resume fallback?
