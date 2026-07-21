# Architecture Patterns

**Domain:** Project-scale reverse-design extraction in a generated dynamic-workflow plugin
**Project:** feature-workflows v1.5.0 Project-Scale Extract Design
**Researched:** 2026-07-22
**Confidence:** HIGH — repository-grounded against the v1.4.5 source, tests, command controller, build, and runtime documentation

## Recommended Architecture

Keep `feature-pipeline` as the top-level orchestration workflow and existing command target. Add one generated leaf workflow, `fp-extract-slice`, for a single feature. The top-level workflow owns discovery, graph validation, scheduling, segment budgets, project checkpoints, incremental synthesis, and the only authoritative completion decision. The child owns the existing X2-X7 feature gate chain and writes a design-compatible state shard after every material gate.

The user still invokes `/feature-workflows:extract-design` once. The command controller repeatedly invokes the top-level workflow with `resume: <planDir>` while the workflow returns `handoff.status: "segment-continue"`. Each invocation is a new bounded runtime segment, which resets the runtime's shared 1,000-agent-call backstop while preserving durable state. A single parent invocation may call multiple leaf children, but no child may call another workflow because nesting is exactly one level.

```text
/extract-design (one user command)
  |
  +-- command controller
       |  first invocation / automatic resume loop
       v
  feature-pipeline (top-level, one bounded segment)
       |
       +-- load/migrate compact project control state
       +-- inventory/decompose/validate graph in bounded pages
       +-- select one dependency-safe, pre-budgeted wave
       +-- workflow("fp-extract-slice", compact args) x N
       |      +-- load feature scope + feature state shard
       |      +-- X2 facts -> checkpoint
       |      +-- X3 e2e -> checkpoint
       |      +-- X4 detailed design -> checkpoint
       |      +-- X5 architecture -> checkpoint
       |      +-- X5.5 fidelity review -> checkpoint
       |      +-- X6 requirements -> checkpoint
       |      +-- X7 audit -> checkpoint
       |      +-- verify required artifacts + write bounded summary
       |      `-- return compact outcome + usage
       +-- reconcile outcomes into project manifest + coverage counters
       +-- incrementally synthesize from verified feature summaries
       +-- reserve capacity, checkpoint, return segment-continue
       `-- only when exact coverage + project artifacts verify: extractReady=true
```

This preserves the strongest current contracts:

- workflow scripts still perform no direct filesystem or shell I/O;
- generated distribution remains self-contained and import-free;
- `pipeline-state.json` remains the cross-mode resume contract;
- per-feature artifact names and design-shaped state remain consumable by tune, design, and review;
- all runtime nesting is parent -> leaf, never parent -> child -> grandchild.

## Component Boundaries

### New Components

| Component | Location | Responsibility | Communicates With |
|---|---|---|---|
| Project extraction control plane | `workflows/src/extract-project.mjs` | Pure state migration, page/graph bookkeeping, status taxonomy, coverage derivation, dependency-safe wave selection, segment admission, and completion predicate | `main.mjs`, schemas, state helpers |
| Paginated project discovery | `workflows/src/extract-discovery.mjs` | Agent-mediated deterministic inventory pages, hierarchical feature discovery, dependency graph validation, and feature-scope shard creation; prompts contain page paths/summaries, never the whole repository | control plane, file-reader/writer agents |
| Leaf workflow entry | `workflows/src/extract-slice-main.mjs` | Hydrate one feature shard, enforce per-feature/gate budgets, invoke the X2-X7 chain, checkpoint each transition, verify artifacts, return a compact outcome | `extract-slice.mjs`, state helpers |
| Leaf workflow metadata | `workflows/src/meta/fp-extract-slice.meta.mjs` | Literal `meta` and child-local phase declarations | build script |
| Generated leaf distribution | `workflows/fp-extract-slice.js` | Installed self-contained workflow resolved by `workflow("fp-extract-slice", args)` | top-level workflow, setup/preflight |
| Project manifest/index artifacts | `<planDir>/project-extract-manifest.json`, `<planDir>/inventory/`, `<planDir>/feature-graph/` | Compact durable control metadata plus bounded inventory/graph pages | discovery, scheduler, status |
| Per-feature scope/summary shards | `<sliceDir>/feature-scope.json`, `<sliceDir>/feature-summary.json` | Bound child input and incremental synthesis input without embedding whole artifacts in prompts | leaf workflow, synthesis |

Names may be adjusted to repository conventions, but these boundaries should remain. Do not create a child per gate: the one-level nesting limit must be reserved for the feature leaf, and the existing `extractSlice()` is already the cohesive gate unit.

### Modified Components

| Component | Required Change | Compatibility Rule |
|---|---|---|
| `workflows/src/main.mjs` | Replace the monolithic `while (nextPendingSlice(...))` body with project-control hydration, bounded wave scheduling, leaf `workflow()` calls, outcome reconciliation, segment handoff, and coverage-based terminal verification | Keep the other five modes and existing mode dispatch intact |
| `workflows/src/extract-scope.mjs` | Retire whole-repository `files.join()` decomposition; provide bounded inventory/page helpers and legacy queue migration helpers | Existing `seedExtractQueue`/`nextPendingSlice` may remain exported until old tests/states are migrated |
| `workflows/src/extract-slice.mjs` | Refactor X2-X7 to accept a checkpoint callback and compact scope references; emit a verified feature summary | Preserve gate order and output filenames |
| `workflows/src/state.mjs` | Add version/default migration, compact project-manifest/page readers/writers, per-feature gate checkpointing, extract coverage rendering, and extract-aware next-command logic | Existing state envelope validation stays permissive for missing new fields |
| `workflows/src/schemas.mjs` | Add strict schemas for inventory page, discovery page, graph validation, project manifest read, child args/outcome, gate attempt, feature summary, and coverage | Additive only; old `PIPELINE_STATE` remains valid |
| `workflows/src/config.mjs` | Add segment call reserve/soft limit, feature/gate call and token budgets, retry policy, inventory/discovery page size, and wave width | Persist resolved values; old runs receive deterministic defaults |
| `workflows/src/meta/feature-pipeline.meta.mjs` | Add project discovery/graph/scheduling/synthesis phases; keep child-only phases out of the parent where possible | Every emitted script validates its own phase set |
| `scripts/build-workflows.mjs` | Support multiple entries with an entry function/tail per entry, explicit module lists, per-entry meta/version/phase checks, and generation of both dist scripts | `plugin.json` stays the sole version source; never hand-edit dist |
| `commands/extract-design.md` | Add the automatic segment-resume loop and truthful partial/complete reporting; reframe `--max-slices` as selection/segment policy, never completion | Scope confirmation remains command-mediated and user-visible |
| All command preflights + `commands/setup.md` | Install/repair/version-check `fp-extract-slice.js` together with `feature-pipeline.js`; copy fallback must update both atomically enough to detect drift | Preserve existing user-level install and legacy-shadow rules |
| `scripts/validate-plugin-versions.mjs` | Validate header and `meta.version` for every generated workflow entry | All generated entries must match plugin version |
| Status mode | Render project coverage, current segment, budgets, failures, blocked/deferred features, and exact continuation command; preserve ordinary gate/stage output for non-project runs | Status remains strictly read-only |

## Durable State Model

### Root control state

`<planDir>/pipeline-state.json` remains the canonical entry point and keeps its current envelope (`task`, `slug`, `planPath`, `planDir`, `result`, `config`, optional checksum/engineVersion). Add optional `stateVersion` and a compact `result.extractProject` control object:

```javascript
extractProject: {
  schemaVersion: 2,
  manifestPath: '<planDir>/project-extract-manifest.json',
  inventoryIndexPath: '<planDir>/inventory/index.json',
  graphIndexPath: '<planDir>/feature-graph/index.json',
  discovery: { status, pagesDiscovered, pagesValidated, complete },
  coverage: {
    discovered, inScope, completed, runnable, deferred,
    inProgress, blocked, failed, skipped, excluded,
    requiredArtifactsVerified, synthesisVerified, complete
  },
  segment: {
    sequence, status, admittedFeatureIds,
    callSoftLimit, callsUsed, callReserve, tokenBudgetUsed
  },
  synthesis: {
    overviewPath, dependencyMapPath, coverageIndexPath,
    incorporatedRevision, verified
  }
}
```

Do not store repository-wide file lists or full child result objects in the root state. It is a control plane, not a data warehouse. The root `result.extractQueue` may remain as a slim compatibility projection during v1.5 (`id`, `name`, `planDir`, `status`, `dependsOn`, artifact summary), but new scheduling and completion logic must use the versioned project manifest and coverage invariant.

### Project manifest pages

`project-extract-manifest.json` points to bounded feature-index pages. Each feature record contains stable identity, dependency ids, status, state/scope/summary paths, attempt count, failure reason, and last verified revision. Repository paths live in the per-feature `feature-scope.json`, not in prompts or the root queue. Inventory and graph pages are immutable or revisioned; transitions update only the relevant feature page and root counters.

This layout avoids the current `loadPipelineState()` problem at project scale: it asks an agent to return the full state object. The root state must remain compact, while page readers return only a requested page or a strict scheduler projection.

### Per-feature state

Each `<sliceDir>/pipeline-state.json` remains design-shaped so existing downstream modes work. Add an optional extraction substate:

```javascript
extractFeature: {
  schemaVersion: 2,
  featureId: 'stable-id',
  status: 'in-progress',
  nextGate: 'extract-design',
  gates: {
    facts: { status, attempts, artifactPath, lastFailure },
    e2e: { status, attempts, artifactPath, lastFailure },
    detailedDesign: { status, attempts, artifactPath, lastFailure },
    architecture: { status, attempts, artifactPath, lastFailure },
    fidelityReview: { status, attempts, lastFailure },
    requirements: { status, attempts, artifactPath, lastFailure },
    audit: { status, attempts, artifactPath, lastFailure }
  },
  budgets: { callsUsed, callLimit, tokensUsed, retryUsed, retryLimit },
  dependencySummaryPaths: [],
  verifiedSummaryPath: null
}
```

Checkpoint after every state transition: before a gate (`in-progress`), after success, after retry scheduling, and after terminal blocked/failed/completed. A killed run resumes from the first incomplete gate because existing artifact-path idempotence remains intact.

### Status semantics

Use explicit, non-overlapping meanings:

| Status | Meaning | Counts as complete? |
|---|---|---|
| `runnable` | Dependencies satisfied and admitted by policy, but not started | No |
| `in-progress` | A child owns it or was interrupted mid-gate | No; normalize safely on resume |
| `deferred` | Valid in-scope work postponed by selector, segment capacity, or budget | No |
| `blocked` | Cannot proceed until a dependency, input, or external condition changes | No |
| `failed` | Bounded retries exhausted; attempt history preserved | No |
| `skipped` | Deliberately not executed, with a durable reason; never silently treated as complete | No unless separately reclassified `excluded` by explicit scope policy |
| `excluded` | Outside the approved scope, with rule/evidence | Removed from the in-scope denominator |
| `completed` | All required feature artifacts and summary verified | Yes |

`extractReady` is derived, never assigned because the pending iterator returned `null`:

```text
coverage.complete =
  discovery.complete
  AND graph.validated
  AND completed == inScope
  AND runnable + deferred + inProgress + blocked + failed + skipped == 0
  AND required project synthesis artifacts verified
```

This corrects the current terminal behavior, which can set `extractReady=true` when some queue entries are `blocked` or `skipped` as long as at least one slice completed.

## Data Flow

### 1. Discovery and graph validation

1. Scope resolution writes a bounded root manifest and deterministic exclusion policy.
2. Inventory agents scan one directory/page at a time and write inventory pages. Returned verdicts contain counts, page paths, continuation cursor, and evidence—not all files.
3. Hierarchical feature discovery consumes inventory page paths/summaries. Oversized areas create child discovery pages, not recursive workflow calls.
4. A graph validator checks stable ids, exactly-accounted inventory ownership, dependency targets, cycles, entry points, and exclusions before scheduling.
5. The controller writes feature scope shards and initial statuses. Cycles or dangling dependencies are not silently reordered; they become validation findings or explicitly blocked nodes.

Discovery recursion is data recursion across pages inside the top-level workflow, not workflow nesting. This respects the one-level runtime rule.

### 2. Segment admission and the 1,000-agent ceiling

The runtime exposes a hard 1,000-agent-call backstop shared by parent and children, plus shared concurrency and token budgets. Treat 1,000 as a never-approach ceiling:

1. Resolve a configurable soft call limit below 1,000 and a non-spendable reserve for state flush, outcome reconciliation, synthesis, and handoff.
2. Estimate the worst-case child cost from enabled gates and retry caps.
3. Admit only a dependency-safe wave whose preallocated quotas fit `remainingSoftCalls - reserve` and token budget.
4. Pass each child its own quota; the child refuses to start a gate it cannot finish and checkpoint.
5. Children return actual logical call usage from the existing hardened agent/telemetry path. Sibling quotas are allocated before a concurrent wave, so they cannot overspend a shared remainder.
6. Stop the segment while reserve remains, flush truth, and return `segment-continue`.

Use a small bounded wave (default determined by characterization, never above runtime concurrency). A wave is a barrier because the parent must reconcile all outcomes before selecting dependency successors; `parallel()` is appropriate for the wave, while gate work inside each child remains sequential and idempotent.

Token budget is independently enforced. Prompts receive only feature scope paths, the current feature summary, and bounded dependency summaries. Never interpolate the whole repository inventory, full project state, all upstream docs, or the complete feature queue.

### 3. Leaf extraction

The child preserves the current quality order:

```text
code facts -> observable e2e -> detailed design -> architecture
           -> optional fidelity review -> optional requirements -> optional audit
```

It loads only one feature's scope and selected compact dependency summaries. After each gate it persists artifact path, verdict summary, attempts, usage, and next gate. Required artifacts are verified before the feature becomes `completed`. Optional disabled gates are gate-level `skipped`; they do not make the feature status `skipped`.

The child returns only `{featureId, status, blockedGate, statePath, summaryPath, artifactIndex, usage, attempt}`. The parent does not absorb the child's full state.

### 4. Incremental project synthesis

Every completed child writes a bounded `feature-summary.json` with module boundaries, public entry points, dependencies, cross-cutting concerns, and verified artifact links. The parent updates:

- `system-overview.md`;
- a dependency map/index;
- a coverage index with exact status counts and reasons.

Synthesis consumes only summaries not yet included in `incorporatedRevision`, in bounded batches. A final adversarial verification compares synthesis/index coverage to manifest counters and feature summary paths. Overview failure is no longer non-blocking when claiming whole-project completion.

### 5. Command-controller continuation

`extract-design.md` keeps the existing scope-confirmation loop and adds a non-interactive segment loop:

```text
call feature-pipeline
while handoff.status == "segment-continue":
  call feature-pipeline with { mode: "extract", resume: result.planDir }
stop on awaiting-scope-confirm, user-action-required, blocked, failed, or complete
```

The continuation token is durable state (`segment.sequence` plus manifest revision), not an opaque in-memory object. The command prints the final truthful coverage; intermediate segments may emit concise progress. A tool/runtime interruption still leaves the exact `/extract-design --resume <planDir>` recovery command.

## Migration and Backward Compatibility

1. Treat missing `stateVersion`/`extractProject` as the v1.4.5 shape.
2. On extract resume, validate the old envelope/checksum first; do not mutate corrupt state.
3. Deterministically map `extractScope` and `extractQueue` into the new manifest:
   - `done` -> candidate `completed`, but reverify mandatory artifacts before counting it;
   - `pending`/`in-progress` -> `runnable` or dependency-blocked after graph validation;
   - old cap/selector `skipped` -> `deferred`, not complete;
   - `blocked` -> `blocked` with `blockedGate` and attempt history initialized.
4. Preserve old artifact paths and slice planDirs. Create feature shards lazily before the next gate; do not move docs.
5. Write the new manifest and root projection only after migration validation succeeds. Record the source version and migration result.
6. Continue accepting states with absent checksum, engineVersion, stateVersion, or new config fields; default deterministically.
7. Preserve `extractScope`, `scopeManifestPath`, `overviewPath`, `extractQueue`, and `extractReady` fields for callers, but derive their new values from authoritative coverage.

Downstream mode rules:

- `/tune-feature <sliceDir>`, `/review-design <sliceDir>`, and `/design-feature --resume <sliceDir>` continue to consume the design-shaped slice state and established artifact filenames.
- The project root is an extraction control plane, not a synthetic single design. It must not advertise `designReady` for multi-feature runs.
- Root handoff lists feature planDirs and their truthful statuses. It may recommend tune/review per completed feature, never imply blocked/deferred features are ready.
- Status mode detects `extractProject` and renders project coverage; legacy/non-extract reports retain their current format.
- Design, implement, tune, and review should receive only shared generic improvements (versioned state helpers, bounded writes, telemetry) proven applicable; do not adopt extract-specific queues.

## Build and Packaging Integration

Extend the existing zero-dependency concatenation builder rather than introducing a bundler. Add entry metadata such as:

```javascript
{
  out: 'fp-extract-slice.js',
  meta: 'src/meta/fp-extract-slice.meta.mjs',
  entryFunction: 'mainExtractSlice',
  modules: [/* explicit dependency-safe order */]
}
```

The builder emits `const final = await <entryFunction>()` per entry, injects the same engine version, strips source imports/exports, rejects duplicate top-level declarations, checks forbidden sandbox tokens, validates each entry's phase labels, and neutralizes each sandbox tail for ESM syntax checking. The committed generated files remain the tested installation artifacts.

Keep the test harness centered on dist behavior. Add a child harness or make the existing harness entry-aware; do not switch to source-only tests and lose packaging coverage. `validate:build`, version validation, release assets/checksums, setup, and all command preflights must enumerate every generated workflow.

## Patterns to Follow

### Pattern 1: Control plane plus sharded data plane

**What:** Root state contains paths, counters, and scheduling cursor; inventory, graph, and feature state live in bounded shards.
**When:** Any state or prompt can grow with project size.
**Why:** Agent-mediated full-file reads and chunked writes make a monolithic result increasingly expensive and fragile.

### Pattern 2: Parent authority, leaf isolation

**What:** Leaf produces one verified feature outcome; only the parent mutates project coverage and `extractReady`.
**When:** Running feature work through `workflow()` children.
**Why:** Prevents children from independently overstating whole-project completion and isolates failures.

### Pattern 3: Admission before execution

**What:** Allocate call/token/retry quota before starting a child or wave.
**When:** Parent and children share hard runtime capacity.
**Why:** A post-hoc counter cannot reserve enough capacity to checkpoint safely.

### Pattern 4: Artifact-path idempotence plus explicit gate state

**What:** Keep current “artifact path means gate can self-skip” behavior, backed by a gate status/attempt record and artifact verification.
**When:** Resuming after interruption or migration.
**Why:** Paths make old states compatible; explicit gates make retries and failures truthful.

## Anti-Patterns to Avoid

### Child workflow composition

**What:** `fp-extract-slice` calls another workflow for design/review/persistence.
**Why bad:** The runtime allows exactly one composition level; it will throw.
**Instead:** Bundle required helpers/gates into the leaf dist and use `agent()` inside it.

### One invocation for the whole project

**What:** Keep starting children until no feature remains.
**Why bad:** Parent and children share the 1,000-agent ceiling and token budget; checkpoint calls can be starved.
**Instead:** End early with reserve and let the command controller open the next top-level segment.

### Whole-project prompt interpolation

**What:** `${files.join('\n')}`, full queue JSON, or every architecture doc in one prompt.
**Why bad:** Prompt size grows with the repository and defeats bounded orchestration.
**Instead:** Page paths, bounded summaries, cursors, and strict output schemas.

### “No pending item” equals completion

**What:** Declare ready after an iterator ignores blocked/skipped/deferred entries.
**Why bad:** This is the current false-completion path.
**Instead:** Derive readiness from exact coverage and synthesis verification.

### Full child state copied into parent

**What:** Merge feature result/log/telemetry objects into root `result`.
**Why bad:** Recreates the monolithic state and makes every root flush grow with all work.
**Instead:** Store a shard path, compact status, artifact index, usage, and summary path.

## Scalability Considerations

| Concern | Small project | Large project | Very large project |
|---|---|---|---|
| Inventory | One page | Directory/module pages | Hierarchical pages with continuation cursors |
| Feature graph | Single compact file | Paged nodes + compact dependency index | Paged graph and bounded validator passes |
| Scheduling | Sequential features | Small dependency-safe waves | Multiple top-level segments, conservative quotas |
| State | Root plus a few shards | Root control state + per-feature shards | Paged manifest/index; root counters only |
| Synthesis | One final overview | Incremental summary batches | Revisioned aggregation + final coverage audit |
| Recovery | Re-run current gate | Resume one feature | Resume exact manifest page/feature/segment without replay |
| Runtime ceiling | Usually irrelevant | Soft call limit + reserve | Mandatory automatic segment loop |

## Recommended Implementation Phase Order

1. **State contracts and truth predicates**
   - Add pure status taxonomy, coverage derivation, manifest/shard schemas, migration, and scheduler tests.
   - Exit when old v1.4.5 fixtures hydrate and blocked/skipped/deferred states cannot set `extractReady`.
2. **Bounded inventory and graph discovery**
   - Add deterministic paginated inventory, hierarchical feature discovery, graph validation, and scope shards.
   - Exit when every in-scope inventory item is owned or explicitly excluded with evidence.
3. **Multi-entry generated build and installation**
   - Add child meta/entry generation, per-entry validation, setup/preflight/version/release enumeration.
   - Exit when both committed dist files rebuild byte-identically and install/version checks cover both.
4. **Checkpointed leaf extraction**
   - Move X2-X7 behind `fp-extract-slice`, add gate budgets/attempt history, feature summaries, and artifact verification.
   - Exit when interruption at every gate resumes without repeating completed gates and slice state remains tune/design/review-compatible.
5. **Bounded parent scheduler and command segment loop**
   - Add dependency-safe waves, quota admission, failure isolation, `segment-continue`, and automatic command re-invocation.
   - Exit when characterized runs stay below the ceiling with checkpoint reserve and continue from one user command.
6. **Incremental synthesis and extract-aware status**
   - Add revisioned overview/dependency/coverage indexes, final adversarial verification, and truthful reporting.
   - Exit when complete is impossible with any unaccounted in-scope feature or missing required project artifact.
7. **Cross-mode compatibility and large-project proof**
   - Exercise migrated old state, tune/design/review on feature shards, root status, partial failures, selectors, retries, ceiling avoidance, and real plugin dogfooding.

This order puts pure state invariants first, because every later orchestration behavior depends on them. Build/install support precedes runtime child use. Completion/status comes after real child outcomes exist, and cross-mode proof closes the milestone rather than being inferred from unit tests.

## Test and Verification Boundaries

- Extend `tests/extract-mode.test.mjs` with pure manifest migration, status transitions, coverage truth table, dependency scheduling, retry/defer behavior, and structural parent/child assertions.
- Add build tests for two entries, per-entry phase validation, duplicate symbols, version lockstep, and drift.
- Add command-preflight tests for installing both scripts and a controller characterization test for repeated `segment-continue` invocations.
- Add interruption fixtures after every X2-X7 gate and assert only the first incomplete gate reruns.
- Add large synthetic inventories for pagination, stable identities, ownership coverage, cycles, dangling dependencies, selectors, and exclusions.
- Add failure isolation scenarios where one feature blocks/fails while independent features complete, yet root readiness remains false.
- Add runtime-capacity characterization using logical agent-call telemetry and reserved checkpoint calls; do not rely only on token budget.
- Dogfood against this repository and retain observed segment/feature coverage artifacts as evidence.

## Sources

- `.planning/PROJECT.md` — milestone requirements, one-command contract, compatibility, one-level nesting, 1,000-agent ceiling, and truthful coverage constraints.
- `plugins/feature-workflows/workflows/src/main.mjs` — current extract control flow, config/default migration, queue loop, slice-local state, terminal artifact checks, and current readiness semantics.
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — current whole-scope resolver, dependency ordering, capped/skipped queue, and pending selector.
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — existing X2-X7 leaf-shaped gate chain and unbounded final overview prompt.
- `plugins/feature-workflows/workflows/src/state.mjs` and `schemas.mjs` — agent-mediated state I/O, 12k-character chunking, permissive backward-compatible envelope, checksum, status rendering, and state schemas.
- `scripts/build-workflows.mjs` — current one-entry explicit-order self-contained dist builder and validation invariants.
- `plugins/feature-workflows/commands/extract-design.md`, `pipeline-status.md`, and `setup.md` — command-owned scope loop, user-level engine installation, reporting, and read-only status contract.
- `tests/extract-mode.test.mjs`, `config-and-state.test.mjs`, `command-preflight.test.mjs`, `status-mode.test.mjs`, and `build-drift.test.mjs` — current executable compatibility and packaging expectations.
- `docs/dynamic-workflows.md` — runtime built-ins, no direct I/O, concurrency, shared budget/call ceiling, and one-level composition.
- `docs/workflow-decomposition-investigation.md` — previously validated hybrid recommendation and extract-slice composition seam.

## Open Questions for Phase-Specific Research

- Characterize the safe default soft call limit, checkpoint reserve, per-gate call quota, and concurrent wave width against the actual workflow runtime; the architecture requires the mechanism, not guessed constants.
- Verify `parallel()`/`pipeline()` behavior when thunks/stages invoke `workflow()` children and confirm progress-tree usability before enabling concurrent child waves by default.
- Determine the smallest feature-summary schema that supports faithful incremental synthesis without rereading full design documents.
- Decide whether very large feature indexes require paged status reads immediately or only after a measured threshold; keep the root control state compact either way.
