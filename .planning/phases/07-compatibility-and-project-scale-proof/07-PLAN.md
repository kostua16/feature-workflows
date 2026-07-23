# Phase 7: Compatibility and Project-Scale Proof — Plan

**Phase:** 7
**Requirements:** COMPAT-01, QUAL-01, DOGFOOD-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 6 (synthesis, publish/persist, status truth)

## Overview

Prove the one-command whole-project promise by exercising continuous mode
compatibility, the complete E2E matrix against clean build and both install
modes, and whole-repository dogfood characterization with injected faults.

No new source modules — Phase 7 adds test coverage that exercises the Phase
1-6 surface. All 544 existing tests must remain green.

## Task 1: Compatibility Regression Suite (COMPAT-01)

**Files created:**
- `tests/compatibility-regression.test.mjs`

**What will be built:**
- v1.4.5 legacy state hydration through every mode's resume path (design, implement, tune, review, status)
- v1.5 state (extract queue + synthesis + persistence) consumed by non-extract modes
- `repairResumeArtifactFlags` handles both pre-extract and current state shapes
- `resolveMode` precedence unchanged for all 5 modes + extract
- `validatePipelineState` accepts both legacy and current state shapes
- Extract gates remain inactive in non-extract modes (and vice versa via `gateModeActive`)
- Status projection works for both legacy and v1.5 state
- Established gate flags, artifact paths, and handoffs preserved across migration
- Extract-specific behavior does not leak into design/implement/tune/review/status

## Task 2: E2E Matrix Characterization (QUAL-01)

**Files created:**
- `tests/e2e-matrix.test.mjs`

**What will be built:**
- Clean build drift validation (both entries, zero drift)
- Install resolution: copy and symlink modes for both entries
- Version lockstep: manifest ↔ headers ↔ marketplace ↔ installed entries
- Representative assertion from each of the 18 E2E matrix scenarios:
  - E2E-STATE-01: root-last migration boundary
  - E2E-REV-01: selective revision invalidation
  - E2E-DISC-01: deterministic inventory with reordered traversal
  - E2E-GRAPH-01: graph rejection (collision, gap, dangling, cycle)
  - E2E-QUEUE-01: queue semantics (deferred, excluded, completed)
  - E2E-DEFER-01: 23-feature cap-8 segment progression (8/15, 16/7, 23/0)
  - E2E-DIST-01: symlink install resolution
  - E2E-DIST-02: copy install + release validation
  - E2E-LEAF-01: gate interruption/resume at each boundary
  - E2E-LEAF-02: duplicate completion + invalid output + source drift
  - E2E-SKIP-01: three skip classifications and readiness impact
  - E2E-BUDGET-01: budget admission with non-spendable reserve
  - E2E-FAIL-01: retryable error, exhausted retry, timeout, blocked dependent
  - E2E-CONT-01: duplicate/lost/out-of-order continuation convergence
  - E2E-SCALE-01: 100+ features across multiple segments, exact-once coverage
  - E2E-SYNTH-01: idempotent, selective synthesis
  - E2E-PERSIST-01: attempted vs durably verified persistence fault injection
  - E2E-STATUS-01: handoff/status agreement, readiness truth
- Matrix coverage tracker: every E2E-ID has at least one covering assertion

## Task 3: Whole-Repository Dogfood Characterization (DOGFOOD-01)

**Files created:**
- `tests/dogfood-scale.test.mjs`

**What will be built:**
- Simulated 100+ feature whole-repository inventory with dependency graph
- Multi-segment extraction exercising budget admission (calls, tokens, concurrency)
- Coverage denominator: every feature appears exactly once in terminal outcome
- Continuation convergence: monotonic segment IDs + idempotency keys
- Injected interruption mid-gate: resume converges to correct state
- Injected duplicate continuation delivery: idempotent convergence, no double-apply
- Final readiness proof: synthesis current, coverage complete, budgets recorded
- Reserve headroom characterization: run stays below runtime ceiling
- Compatibility evidence: installed version, mode gates, artifact behavior

## Task 4: Full Suite Regression + STATE.md Update

**What will be verified:**
- `npm run build` — clean rebuild, zero drift
- `npm run validate:build` — drift check passes
- `npm test` — all tests pass (544 existing + Phase 7 new, zero regressions)
- ESM syntax validation for both dist entries
- Phase-label validation (undeclared_count=0)
- STATE.md updated to Phase 7 complete
- ROADMAP.md Phase 7 status updated

## Success Criteria

1. Every exact E2E matrix scenario passes against clean generated output plus copy and symlink installed-plugin surfaces.
2. Design, implement, tune, review, and read-only status preserve established gates, artifacts, hydration, and handoffs for v1.4.5 migration and v1.5 shards.
3. One observed whole-repository command processes its full natural inventory across multiple automatically acknowledged segments with no duplicate/missing coverage and measured reserve headroom.
4. The observed run recovers from an injected gate interruption and duplicate continuation delivery without manual state repair and reaches truthful verified readiness.
