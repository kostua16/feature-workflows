# Phase 1: State, Coverage, Migration, and Revision Contracts — Research

**Researched:** 2026-07-22
**Phase:** 1 (State, Coverage, Migration, and Revision Contracts)
**Requirements:** CONTRACT-01, STATE-01, REV-01

## Current State Architecture (v1.4.5 Baseline)

### Monolithic pipeline-state.json

The engine persists one `pipeline-state.json` per plan directory via `flushPipelineState()` in
`src/state.mjs`. The payload contains:

- `task`, `slug`, `planPath`, `planDir` — identity
- `lastGate` — coarse checkpoint cursor (last gate name)
- `engineVersion` — version skew detection on resume
- `checksum` — djb2 hash over serialized result (truncation/corruption signal)
- `result` — the full pipeline result object: 25+ flags covering every gate verdict,
  artifact paths, stage array, telemetry, budget counters, handoff, open questions, etc.
- `config` — resolved run configuration (mode, profile, budgets, etc.)

There is NO feature-level state separation. Extract mode adds a flat `slices` array on the
result object, but every slice's gate state lives inline in the same monolithic file.

### Coarse Checkpoint Granularity

`stateCheckpoint()` advances an in-memory cursor; `flushPipelineState()` runs only at
`consolidate()` boundaries (success + hard-block exits). Between those boundaries, an
interruption loses all gate progress since the last flush. The extract slice queue tracks
status as `'pending' | 'skipped'` — no blocked, failed, deferred, excluded, or completed
lifecycle states.

### Integrity and Resume

- `stateChecksum()` (djb2, pure, unsigned 32-bit) — detects truncated chunked writes
- `validatePipelineState()` — structural validation of required fields + checksum verification
- `repairResumeArtifactFlags()` — re-reads artifact files to reset stale gate flags on resume
- `detectResumeEngineSkew()` — warns when saved and running engine versions differ
- `loadPipelineState()` — reads via file-reader agent (no direct FS)

All I/O goes through sub-agents; the workflow script has no direct filesystem access.

### Extract Queue (seedExtractQueue)

`src/extract-scope.mjs` exports:
- `seedExtractQueue(scope, slices, parentPlanDir, maxSlices, selectedSlices)` — PURE.
  Creates queue entries with status `'pending'` or `'skipped'`. Over-cap slices are
  `'skipped'`, conflating "never selected" with "cap-exceeded but still in-scope."
- `nextPendingSlice(queue)` — PURE. Returns first pending entry.

No lifecycle state machine. No dependency-aware scheduling. No revision tracking.
No selective invalidation. No migration from legacy state.

### Test Infrastructure

- `node:test` framework with `node:assert/strict`
- `tests/harness.mjs` — strips `await main()` / `return final` tail, appends
  `export { ... }` for unit-testable functions, dynamic-imports the transformed source
- Tests stub `globalThis.agent` for async operations
- `npm test` runs all `tests/**/*.test.mjs`; harness reads the DIST file
- `npm run build` regenerates dist from `src/*.mjs`
- `npm run validate:build` checks for drift

### Build Pipeline

Source modules live in `plugins/feature-workflows/workflows/src/*.mjs`. The build script
(`scripts/build-workflows.mjs`) concatenates them into the single dist file
`plugins/feature-workflows/workflows/feature-pipeline.js`. New modules are added to
`src/` and the build picks them up via the meta file at `src/meta/feature-pipeline.meta.mjs`.

## Gaps Phase 1 Must Close

### CONTRACT-01: Versioned State Contract with Pure Reducers

**Missing:**
1. No pure lifecycle transition reducer — transitions are implicit in gate flag mutations
   scattered across `main.mjs` (2936 lines). There is no single function that takes
   `(currentState, event)` and returns a new state.
2. No explicit feature lifecycle enumeration. The extract queue has only
   `'pending' | 'skipped'`. The architecture requires:
   `runnable | deferred | in-progress | blocked | failed | skipped | excluded | completed`.
3. No readiness reducer. `extractReady` is inferred from queue inspection in `main.mjs`
   rather than derived by a pure function from canonical state.
4. No root-last migration. v1.4.5 `pipeline-state.json` has no migration path to sharded
   state. The file is loaded as-is on resume.
5. Skipped semantics are conflated: feature-level skipped, policy-disabled optional-gate
   skipped, and required-gate skipped are all the same string `'skipped'`.

**Required deliverables:**
- Pure `applyLifecycleEvent(state, event)` reducer with explicit transition table
- Pure `deriveReadiness(state)` function that returns readiness from canonical state
- Transition table that rejects illegal transitions (e.g., `completed → in-progress`)
- Three distinct skip classifications with different readiness implications

### STATE-01: Sharded Per-Feature State

**Missing:**
1. No feature-state shard files. All state is in one `pipeline-state.json`.
2. No project manifest. No compact root state with indexes and child references.
3. No bounded feature-state schema. No separation between what belongs in root vs. child.

**Required deliverables:**
- Feature-state shard schema: `{ featureId, lifecycle, gates, attempts, artifacts, revisions }`
- Project manifest schema: `{ schemaVersion, features: [{id, lifecycle, shardRef}], indexes, aggregateEvidence }`
- Root state contains only schema/version, indexes, aggregate evidence, and durable child references
- Feature shards remain independently resumable

### REV-01: Selective Revision Invalidation

**Missing:**
1. No digest/revision computation for source, scope, graph, dependency-summary, or artifacts.
2. No selective invalidation logic. Any change invalidates everything.
3. No retention of independently valid evidence when a revision changes.

**Required deliverables:**
- Digest computation for revision inputs (source files, scope, graph, etc.)
- Selective invalidation: only affected feature gates and derived views are invalidated
- Independently valid evidence is retained across revision changes

## Validation Architecture (Nyquist Dimension 8)

### RED Characterization Tests (must fail before implementation)

1. **Lifecycle reducer table tests:**
   - Illegal transition (e.g., `completed → in-progress`) must throw/reject
   - Replaying ordered events must produce byte-stable projections
   - Reducer must not mutate input state
   - Incomplete coverage must NOT become ready
   - Feature-level skipped must remain incomplete
   - Policy-disabled optional-gate skipped may complete only with policy evidence
   - Required-gate skipped must block completion

2. **Migration fault injection:**
   - Root acknowledged before child shards durable → must fail
   - Interruption at each child write boundary → resume must converge idempotently
   - Mixed-version ready state must never be observable

3. **Revision fixtures:**
   - Source change preserves stale derived evidence → must fail
   - Source change invalidates unrelated completed features → must fail
   - Only affected gates/views should invalidate

### GREEN Evidence Tests (must pass after implementation)

1. Reducer replay produces byte-stable lifecycle/readiness projections
2. Migration writes all child shards before root; interruption resumes idempotently
3. Feature shards bounded; root contains only schema/version/indexes/aggregates/refs
4. Revision tests invalidate exact affected gates; retain independent evidence
5. All existing tests remain green (v1.4.5 compatibility)

## Implementation Approach

### New Modules (in `plugins/feature-workflows/workflows/src/`)

1. **`lifecycle.mjs`** — Pure lifecycle reducers and transition table
   - `LIFECYCLE_STATES` enum: runnable, deferred, in-progress, blocked, failed, skipped, excluded, completed
   - `SKIP_REASONS` enum: feature-level, policy-disabled-optional, required-gate
   - `applyLifecycleEvent(state, event)` — pure transition reducer
   - `deriveReadiness(projectManifest)` — pure readiness derivation
   - `isTerminal(lifecycleState)` — true for completed, failed, excluded
   - `isIncomplete(lifecycleState)` — true for deferred, blocked, in-progress, feature-skipped
   - All functions pure, deterministic, no I/O

2. **`migration.mjs`** — Root-last v1.4.5 → v1.5.0 state migration
   - `migrateLegacyState(legacyState)` — pure transform
   - `deriveFeatureId(legacySlice)` — deterministic canonical identity
   - Migration writes children first, validates, then atomically acknowledges root
   - `validateMigrationBoundary(state, phase)` — fault-injection boundary check

3. **`revision.mjs`** — Digest computation and selective invalidation
   - `computeDigest(input)` — deterministic hash over source/scope/graph/artifact content
   - `compareRevisions(oldRevisions, newRevisions)` — diff revision sets
   - `selectiveInvalidate(featureShard, revisionDelta)` — invalidate only affected gates
   - `retainValidEvidence(featureShard)` — filter to independently valid evidence

### Test Files (in `tests/`)

4. **`tests/lifecycle-reducers.test.mjs`** — RED-then-GREEN lifecycle reducer tests
5. **`tests/migration.test.mjs`** — Root-last migration fault injection tests
6. **`tests/revision-invalidation.test.mjs`** — Selective invalidation tests

### Harness Updates

7. **`tests/harness.mjs`** — Add new function names to CANDIDATES array

## Key Constraints

- **No direct FS/shell in workflow scripts** — all I/O through sub-agents
- **ES module** — all source must be valid ESM
- **Dist is generated** — edit `src/*.mjs`, run `npm run build`
- **Phase-label validation** — every `phase('X')` must map to `meta.phases`
- **Backward compatibility** — v1.4.5 `pipeline-state.json` must hydrate correctly
- **Pure functions tested via harness** — functions must be declarable, not inline
- **Node 25, no build system** — just `node:test` and direct ESM

## RESEARCH COMPLETE
