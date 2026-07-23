# Phase 7: Compatibility and Project-Scale Proof — Research

**Researched:** 2026-07-22
**Phase:** 7 (Compatibility and Project-Scale Proof)
**Requirements:** COMPAT-01, QUAL-01, DOGFOOD-01

## Current State (Post Phase 6)

### Test Suite: 544 tests across 28 test files

Phases 1-6 delivered unit/integration coverage for every primitive:
- `lifecycle-reducers.test.mjs` (79 tests) — Phase 1 lifecycle/migration/revision
- `discovery.test.mjs`, `inventory.test.mjs`, `graph-validation.test.mjs`, `queue-semantics.test.mjs`, `schedulability.test.mjs` (113 tests) — Phase 2
- `multi-entry-build.test.mjs` (22 tests) — Phase 3 build/install/version lockstep
- `checkpointed-leaf.test.mjs` (24 tests) — Phase 4 leaf lifecycle + Workflow spawn
- `bounded-scheduler.test.mjs` (68 tests) — Phase 5 budget/retry/isolation/continuation
- `synthesis-status.test.mjs` (55 tests) — Phase 6 synthesis/persist/status truth
- Plus: `extract-mode.test.mjs`, `review-mode.test.mjs`, `status-mode.test.mjs`,
  `config-and-state.test.mjs`, `approval.test.mjs`, `telemetry.test.mjs`, etc.

### Build Infrastructure

- Source modules: `plugins/feature-workflows/workflows/src/*.mjs` (40 modules)
- Generated dist: `feature-pipeline.js` + `fp-extract-slice.js` (290 top-level names each)
- Build: `npm run build` regenerates both entries; `npm run validate:build` checks drift
- Install modes: copy install and symlink install both tested in `multi-entry-build.test.mjs`
- Version: plugin.json → both generated headers → marketplace (lockstep validated)

### Mode Compatibility Surface

Five non-extract modes must coexist with extract:
- **design** (`/design-feature`): full gate chain Define → ... → Plan → Review/Refine
- **implement** (`/implement-feature`): consumes design artifacts, executes plan stages
- **tune** (`/tune-feature`): reads issues-and-improvements.md, revisits gates
- **review** (`/review-design`): standalone audit of existing docsets (non-mutating)
- **status** (read-only): renders persisted state + readiness projection

All modes share `pipeline-state.json` via `loadPipelineState`/`validatePipelineState`/
`flushPipelineState`. The `--resume` contract and `repairResumeArtifactFlags` must
hydrate v1.4.5 state (pre-extract fields absent) and v1.5 state (extract fields present)
without loss.

### Extract Integration in main.mjs (lines 985+)

The extract branch runs after scope resolution: seeds queue → loops slices →
`extractSlice` per feature → synthesis → persist → readiness. Phase 6 added:
- Truthful `deriveExtractReadiness` replacing simple `extractReady` flag
- `projectStatusProjection` (frozen immutable) shared by handoff and status
- `createPersistenceTracker` wrapping durable write boundaries
- Incremental `synthesizeProjectViews` after slice loop

## Gaps Phase 7 Must Close

### COMPAT-01: Continuous Mode Compatibility Regression

**Missing:** No single test suite exercises the cross-mode compatibility contract:
- v1.4.5 state hydration under all modes (design/implement/tune/review/status)
- v1.5 extract-integrated state consumed by non-extract modes
- Established gates, artifacts, handoffs preserved across migration boundaries
- Extract-specific behavior not leaking into design/implement/tune/review/status

**Required:** A `compatibility-regression.test.mjs` suite that:
1. Hydrates v1.4.5 legacy state (no extract fields) through every mode's resume path
2. Hydrates v1.5 state (with extract queue, synthesis, persistence) through non-extract modes
3. Verifies `repairResumeArtifactFlags` handles both state shapes
4. Confirms `resolveMode` precedence is unchanged for all 5 modes
5. Validates `validatePipelineState` accepts both legacy and current shapes
6. Asserts extract gates stay inactive in non-extract modes (and vice versa)
7. Confirms status projection works for both legacy and v1.5 state

### QUAL-01: Complete E2E Matrix Characterization

**Missing:** No unified E2E matrix runner validates ALL 18 Phase 1-6 E2E scenarios
from the milestone matrix against:
- Clean generated source (no stale dist)
- Copy-installed plugin surface
- Symlink-installed plugin surface

**Existing coverage is scattered** — each phase tested its own primitives but no test
proves the COMPLETE matrix passes as a regression gate.

**Required:** An `e2e-matrix.test.mjs` suite that:
1. Validates clean build drift = 0 for both entries
2. Exercises install resolution (copy + symlink) for both entries
3. Verifies version lockstep (manifest ↔ headers ↔ marketplace ↔ installed)
4. Runs representative assertions from each E2E matrix scenario:
   - E2E-STATE-01, E2E-REV-01 (Phase 1)
   - E2E-DISC-01, E2E-GRAPH-01, E2E-QUEUE-01, E2E-DEFER-01 (Phase 2)
   - E2E-DIST-01, E2E-DIST-02 (Phase 3)
   - E2E-LEAF-01, E2E-LEAF-02, E2E-SKIP-01 (Phase 4)
   - E2E-BUDGET-01, E2E-FAIL-01, E2E-CONT-01, E2E-SCALE-01 (Phase 5)
   - E2E-SYNTH-01, E2E-PERSIST-01, E2E-STATUS-01 (Phase 6)
5. Confirms every matrix ID has at least one covering assertion

### DOGFOOD-01: Whole-Repository Scale Characterization

**Missing:** No test exercises the full pipeline end-to-end at project scale:
- Multiple features across multiple automatically acknowledged segments
- Budget admission preserving reserve below runtime ceiling
- Continuation convergence with monotonic segment IDs
- Recovery from injected interruption mid-gate
- Recovery from duplicate continuation delivery
- Final truthful readiness proof with synthesis + coverage

**Required:** A `dogfood-scale.test.mjs` suite that:
1. Simulates 100+ feature whole-repository inventory
2. Runs multi-segment extraction with budget admission
3. Verifies all features appear exactly once in coverage denominator and terminal outcome
4. Injects interruption mid-gate and proves resume converges
5. Injects duplicate continuation delivery and proves idempotent convergence
6. Validates final readiness projection with synthesis, budgets, and coverage
7. Records reserve headroom and confirms characterization below runtime limits

## Implementation Approach

### New Test Files (in `tests/`)

1. **`tests/compatibility-regression.test.mjs`** — COMPAT-01
2. **`tests/e2e-matrix.test.mjs`** — QUAL-01
3. **`tests/dogfood-scale.test.mjs`** — DOGFOOD-01

### No New Source Modules

Phase 7 is a proof phase — all primitives ship from Phases 1-6. Phase 7 adds only
test coverage that exercises the existing surface. If a characterization exposes a
bug, the fix goes to the owning source module (not a new compatibility module).

### Harness Updates

`tests/harness.mjs` CANDIDATES list may need additions only if the compatibility
tests need to call functions not yet exported. The existing 290 top-level names
should cover all needs.

## Key Constraints

- **No new source modules** — Phase 7 proves existing contracts, doesn't add new ones
- **All 544 existing tests must stay green** — no Phase 1-6 regressions
- **TDD evidence model** — RED characterization before any fix, GREEN proof after
- **No direct FS/shell in workflow scripts** — all I/O through sub-agents
- **Both install modes** — copy and symlink must pass identically

## RESEARCH COMPLETE
