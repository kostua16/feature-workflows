# Technology Stack

**Project:** feature-workflows v1.5.0 Project-Scale Extract Design
**Researched:** 2026-07-22
**Research scope:** Repository-grounded additions only; no external ecosystem research
**Overall confidence:** HIGH

## Recommendation

Keep the existing zero-dependency Node/ESM workflow toolchain. Add one generated leaf workflow,
`fp-extract-slice.js`, and make the existing generated `feature-pipeline.js` the top-level project
orchestrator. Additive, agent-written JSON shards should remain the persistence substrate; the
slash-command layer should re-invoke bounded top-level segments until coverage is complete.

This milestone does **not** need a database, message queue, worker framework, bundler, or a general
split of all six workflow modes. Those additions would not remove the hard runtime limits and would
expand the migration surface unnecessarily.

## Recommended Stack

### Core Runtime

| Technology | Version / Contract | Purpose | Why |
|------------|--------------------|---------|-----|
| Claude Code dynamic workflows | Existing plugin runtime contract | Top-level project orchestrator plus one leaf workflow per feature | The repository already depends on `agent()`, `pipeline()`, `parallel()`, `phase()`, and durable JSON handoffs. `workflow()` is the native composition primitive and supports the required top-level -> leaf shape. |
| `feature-pipeline.js` | Generated from v1.5.0 source | Retain scheduling, project manifest, dependency readiness, segment budgets, synthesis, coverage, and terminal readiness authority | Keeping the current engine as the top-level entry preserves all six existing modes and the v1.4.5 `pipeline-state.json` contract. A milestone-wide per-mode split is not required to ship project-scale extraction. |
| `fp-extract-slice.js` | New generated v1.5.0 leaf | Run exactly one feature's bounded extraction gates and checkpoint its shard after every material gate | A leaf workflow provides failure isolation and a visible progress group while respecting the exactly-one-level composition rule. It must never call `workflow()` itself. |
| `extract-design.md` command driver | Existing command, extended | Turn one user command into repeated bounded top-level Workflow invocations | Parent and child share one invocation's 1,000-agent ceiling, concurrency cap, abort signal, and token budget. A fresh capacity envelope therefore requires a new top-level invocation; the command already demonstrates this pattern in its scope-confirmation loop. |

### Build and Distribution

| Technology | Version / Contract | Purpose | Why |
|------------|--------------------|---------|-----|
| Node.js built-ins | Node 22 in CI; current local environment is newer | Build, validation, and tests | The repository already uses `node:fs`, `node:child_process`, and `node:test` without dependencies. Node 22 is the validated CI floor; no new runtime package is needed. |
| `scripts/build-workflows.mjs` | Existing zero-dependency concat builder, extended to multiple entries | Emit self-contained parent and leaf workflow scripts | The sandbox cannot resolve imports. The existing builder already injects version metadata, strips source ESM imports/exports, rejects unsafe tokens and duplicate names, validates phases, checks neutralized ESM syntax, and detects dist drift. |
| Explicit per-entry manifests | New builder configuration | Select ordered source modules, meta file, output name, and tail entry function for each dist script | The current builder is intentionally manifest-ordered for byte stability and top-level initializer safety. Add an entry for `fp-extract-slice.js`; do not introduce an import-graph bundler merely to support two outputs. |
| Separate pure-literal meta | New `src/meta/fp-extract-slice.meta.mjs` | Give the leaf its own workflow name, description, version, and declared phases | Every generated workflow requires its own `meta`, and every `phase('X')` used by that output must be declared in that output's `meta.phases`. Version remains injected from plugin.json. |
| Committed generated dist | Existing distribution contract, expanded to two scripts | Ship runnable workflow artifacts in the plugin | Users install from the repository and the sandbox cannot build or import source modules at runtime. Both outputs must be committed and must pass `validate:build`. |

### Durable State

| Technology | Version / Contract | Purpose | Why |
|------------|--------------------|---------|-----|
| Compact project `pipeline-state.json` | Additive/defaulted v1.5.0 schema | Store inventory/decomposition identity, compact feature graph, queue status, shard references, segment cursor, budgets, coverage totals, synthesis status, and handoff | This preserves v1.4.5 hydration while preventing the parent state and resume prompt from growing with every feature's gate details and artifacts. |
| Per-feature JSON shard | One bounded file under each stable feature directory | Store gate cursor, attempts, failure reason/history, artifact paths, verified summary, and child budget usage | Existing multi-slice extraction already creates slice-local `pipeline-state.json`; v1.5.0 should make that state authoritative and checkpoint it after every material child gate rather than only after the full slice cycle. |
| Agent-mediated JSON file I/O | Existing `file-reader` / `file-writer` pattern | Read/write parent and child state without direct filesystem APIs in workflow scripts | Direct FS/shell remains unavailable in the sandbox. Reuse `writeChunkedFile`, `flushPipelineState`, integrity checks, and reader agents, but keep each shard small enough that normal writes do not become a project-scale prompt. |
| Deterministic sequence numbers and stable IDs | Existing no-clock/no-random convention | Version transitions, attempts, feature identities, and idempotency keys | `Date.now()`, `Math.random()`, and argless `new Date()` are build-forbidden. Stable scope-derived IDs plus monotonic sequence counters make resumes reproducible. |

### Scheduling and Capacity

| Primitive | Purpose | Integration point |
|-----------|---------|-------------------|
| Segment budget policy | Bound feature count, estimated calls/tokens, retries, and synthesis/checkpoint reserve for one top-level invocation | Resolve in `main.mjs` config; persist used/remaining counters in the compact project state and return a continuation handoff before the reserve is consumed. |
| Dependency-ready queue | Select only runnable features whose prerequisites are verified; preserve deferred/excluded/blocked entries | Replace the current first-`pending` scan and `skipped` cap semantics in `extract-scope.mjs` with explicit durable statuses. Use bounded `pipeline()`/`parallel()` only for safe independent features. |
| Command continuation loop | Re-invoke `Workflow({name: 'feature-pipeline', args: {mode: 'extract', resume, ...}})` while the result requests continuation | Extend `commands/extract-design.md`. Stop only on truthful completion, user-required scope confirmation, cancellation, or a concrete non-retriable block. |
| Child invocation wrapper | Call `workflow('fp-extract-slice', childArgs)` and normalize thrown/invalid returns into one feature's state | Parent extract branch in `main.mjs`; catch unknown-child/syntax failures because `workflow()` throws rather than returning `null`. |

### Validation and Test Stack

| Technology | Change | Why |
|------------|--------|-----|
| `node:test` | Extend repository-native unit and characterization coverage | Existing tests validate the shipped dist. Add multi-entry drift checks, graph/queue semantics, shard hydration, gate-level resume, segment continuation, capacity reserve, partial failure, and truthful final coverage. |
| `validate:build` | Require both generated outputs to be byte-identical to a fresh build | Prevent source/dist drift and hand edits for the new child exactly as for the parent. |
| `validate:versions` | Iterate over every generated workflow and compare header/meta versions to plugin.json | A missing or stale child must hard-fail release validation; plugin.json remains the only version bump site. |
| CI ESM/sandbox checks | Run neutralized ESM syntax and forbidden-token/phase checks per output | The current CI explicitly checks only `feature-pipeline.js`; the same guarantees are required for `fp-extract-slice.js`. |
| Setup/preflight checks | Install, repair, version-check, and syntax-check the child alongside the parent | `workflow('fp-extract-slice', ...)` resolves from the workflow registry. A healthy parent with a missing/stale child is not a healthy installation. |
| Workflow E2E characterization | Exercise the installed plugin command, not only pure helpers | The milestone's defining contract is one user command driving several top-level segments and per-feature child runs with durable continuation and truthful coverage. |

## Required Integration Changes

1. **Extend the builder, not the dependency graph.** Add a second `ENTRIES` item with its own
   output, meta, ordered module list, banner, and entry function/tail. Shared source is duplicated
   only in generated output, which is acceptable and already the documented strategy for a
   module-less sandbox.
2. **Keep the top-level engine top-level.** The existing `feature-pipeline` workflow must call the
   leaf. Do not make extraction itself a child of another workflow, or it loses the only nesting
   level needed for per-feature execution.
3. **Move child checkpoint ownership into the child.** The current parent persists a slice-local
   state only after `extractSlice()` returns. The leaf must flush its own bounded shard after facts,
   e2e, detailed design, architecture, reviews, requirements, audit, and terminal verification so a
   killed child resumes at the first incomplete gate.
4. **Keep the parent state compact.** The parent stores feature IDs, dependencies, status,
   attempt/budget summaries, shard paths, artifact references, and verified summaries. Full
   inventories, evidence, logs, and gate verdicts live in paginated artifacts or feature shards.
5. **Segment at the command boundary.** Within one invocation, stop before the shared runtime
   ceiling and return a deterministic `continue-extract` handoff. The command immediately launches
   the next top-level invocation with `resume` during the same user-visible command.
6. **Make completion derived, not assigned optimistically.** `extractReady` is true only when the
   validated in-scope graph has no runnable/pending/deferred work, every completed feature's
   required artifacts are verified, every excluded/blocked/failed feature is explicitly counted,
   and required project-level synthesis/coverage artifacts are verified.
7. **Expand install lockstep.** The command and `/setup` must manage both generated scripts across
   symlink and copy fallback paths. Release checks must reject any version/build drift across them.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Workflow decomposition | Existing parent + one extract leaf | Split all six modes into sibling workflows now | The milestone needs the extract seam only. A broad mode split changes command/install/test surfaces without solving project-scale continuation. |
| Capacity reset | Repeated top-level invocations from one command | Loop through unlimited children in one parent run | Child workflows share the parent's 1,000-call counter and token budget; nesting does not create fresh capacity. |
| Build | Extend the hand-written concat builder | esbuild, Rollup, or another bundler | The output has a pure-literal meta header, no imports, and a sandbox-only top-level `return`. A bundler adds the repository's first dependency, creates noisy output, and still needs custom post-processing. |
| Persistence | Compact parent JSON + per-feature JSON shards | SQLite, embedded database, Redis, or a job queue | Workflow scripts have no direct FS/network runtime API, state writes are already agent-mediated, and external infrastructure would not be portable inside the installed plugin. |
| Scheduling | Runtime built-ins plus persisted deterministic queue | Worker threads or an npm concurrency library | `pipeline()`/`parallel()` already respect the runtime concurrency cap. External concurrency cannot bypass shared call/token ceilings. |
| State compatibility | Additive/defaulted v1.5.0 fields | Replace `pipeline-state.json` with a new project database/manifest format | Existing modes and v1.4.5 resumes rely on the current contract; replacement creates unnecessary migration and artifact compatibility risk. |
| Generated artifacts | Commit both dist workflows | Build on plugin installation | The sandbox cannot resolve source imports, and plugin users need runnable self-contained scripts immediately. |
| Project synthesis | Incremental summaries and indices | Feed every feature artifact into one final agent prompt | A whole-project prompt recreates the scale failure this milestone is intended to remove. |

## What Must Not Be Added

- No npm runtime or build dependencies; package.json should remain dependency-free unless a later,
  separately evidenced requirement cannot be met with Node built-ins.
- No database, message broker, daemon, background worker, server, or cloud service.
- No direct `fs`, shell, `node:` imports, or dynamic imports in generated workflow runtime code.
- No nested child workflow below `fp-extract-slice`; nesting is exactly one level.
- No assumption that `workflow()` resets agent-call or token capacity.
- No monolithic project inventory, full feature verdict history, or accumulated artifact bodies in
  parent `result`/`pipeline-state.json`.
- No conversion of capped/deselected work to `skipped` completion. Caps create durable deferred
  queue entries; explicit user exclusions remain separately accounted exclusions.
- No hand edits to `workflows/feature-pipeline.js` or `workflows/fp-extract-slice.js`.
- No broad rewrite of design/implement/tune/review/status modes. Share only proven generic
  primitives such as checkpointing, budgets, compact status, and coverage accounting.
- No weakening of fidelity reviews, artifact verification, tests, or readiness gates to fit a run.
- No timestamps/random IDs in sandbox state; use deterministic feature identity and sequence fields.

## Installation and Build

No packages should be installed.

```bash
# Rebuild all generated workflow outputs from workflows/src/
npm run build

# Prove every committed output is fresh and version-consistent
npm run validate:build
npm run validate:versions

# Run unit and characterization tests against the shipped artifacts
npm test
```

## Source Evidence

| Source | Evidence used | Confidence |
|--------|---------------|------------|
| `.planning/PROJECT.md` | v1.5.0 requirements, brownfield constraints, generated-dist rule, one-level nesting, shared capacity, additive state compatibility | HIGH |
| `plugins/feature-workflows/workflows/src/main.mjs` | Current single generated engine, capped queue loop, coarse slice persistence, optimistic `extractReady`, command-compatible result shape | HIGH |
| `plugins/feature-workflows/workflows/src/extract-scope.mjs` | Current dependency ordering, first-pending selection, and cap/deselection -> `skipped` semantics | HIGH |
| `plugins/feature-workflows/workflows/src/extract-slice.mjs` | Existing bounded per-slice gate seam and project overview synthesis | HIGH |
| `plugins/feature-workflows/workflows/src/state.mjs` | Agent-mediated chunked state writes, checksum/validation, additive resume repair, status rendering | HIGH |
| `plugins/feature-workflows/workflows/src/config.mjs` | Existing retry/decision budgets, model routing, profiles, and six-mode contract | HIGH |
| `scripts/build-workflows.mjs` | Current zero-dependency single-entry manifest builder and post-emit safety checks | HIGH |
| `package.json`, `tests/build-drift.test.mjs`, `.github/workflows/validate-plugin.yml` | Dependency-free Node toolchain, node:test, current single-output validation integration points | HIGH |
| `plugins/feature-workflows/commands/extract-design.md`, `plugins/feature-workflows/commands/setup.md` | Existing command-driven re-invocation and user-level workflow installation/repair pattern | HIGH |
| `docs/dynamic-workflows.md` | Runtime built-ins, one-level composition, null behavior, budget/call/concurrency constraints, no direct FS/shell | HIGH |
| `docs/workflow-decomposition-investigation.md` | Previously validated hybrid recommendation, child workflow seam, no-module build requirement, install/version risks | HIGH |

## Open Validation Questions

- Characterize exactly how the installed runtime resolves `workflow('fp-extract-slice', ...)` under
  both symlink and copy fallback installs; setup/preflight must prove the chosen name works.
- Measure realistic per-gate calls/tokens on a large repository before fixing default segment and
  reserve sizes. The policy shape is clear, but the numeric defaults require dogfooding evidence.
- Verify the command host reliably performs many sequential Workflow invocations in one slash
  command and surfaces a safe stop if session/context capacity, permissions, or user cancellation
  interrupts the continuation loop.
