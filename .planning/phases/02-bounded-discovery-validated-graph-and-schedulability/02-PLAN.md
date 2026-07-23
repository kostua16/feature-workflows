# Phase 2: Bounded Discovery, Validated Graph, and Schedulability — Plan

**Phase:** 2
**Requirements:** INV-01, DISC-01, GRAPH-01, QUEUE-01, DEPCTX-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 1 (lifecycle.mjs, migration.mjs, revision.mjs)

## Overview

Build on Phase 1's pure lifecycle/migration/revision primitives to construct the
discovery-to-schedulability pipeline: deterministic inventory, paginated discovery,
validated feature graph, truthful queue semantics, and bounded schedulability with
dependency context. All modules are pure, deterministic, no I/O.

## Canonical References

- `plugins/feature-workflows/workflows/src/lifecycle.mjs` — Phase 1 lifecycle states
- `plugins/feature-workflows/workflows/src/revision.mjs` — Phase 1 digest/revision
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — current seedExtractQueue
- `tests/harness.mjs` — CANDIDATES array for export injection

---

## Task 1: GREEN — Deterministic inventory module (INV-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/inventory.mjs`
- `tests/inventory.test.mjs`

Implement deterministic repository inventory classification. All pure, no I/O.

Functions:
1. `classifyPath(path, policies)` — classify a path as included/excluded/generated/vendor/ignored
2. `buildInventory(paths, policies)` — build a deterministic inventory from path list
3. `inventoryDigest(inventory)` — deterministic digest of an inventory
4. `refineOversizedArea(area, maxPathsPerPage)` — recursively split oversized areas into pages

---

## Task 2: GREEN — Paginated discovery module (DISC-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/discovery.mjs`
- `tests/discovery.test.mjs`

Implement durable paginated discovery with cursors. All pure, no I/O.

Functions:
1. `createCursor(inventory, pageSize)` — create a pagination cursor over an inventory
2. `nextPage(cursor)` — advance cursor, return page + updated cursor
3. `resumeDiscovery(cursor)` — resume from interrupted cursor without gaps/duplicates
4. `exhausted(cursor)` — check if cursor has covered all inventory

---

## Task 3: GREEN — Feature graph validation module (GRAPH-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/graph-validation.mjs`
- `tests/graph-validation.test.mjs`

Implement validated feature graph with canonical identities. All pure, no I/O.

Functions:
1. `validateGraph(features, edges)` — check collisions, ownership gaps/overlap, dangling edges, cycles
2. `detectCycle(edges)` — detect dependency cycles and classify as supported/unsupported
3. `canonicalizeIdentity(features)` — produce collision-free canonical identities
4. `graphDigest(features, edges)` — deterministic graph fingerprint

---

## Task 4: GREEN — Queue semantics module (QUEUE-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/queue-semantics.mjs`
- `tests/queue-semantics.test.mjs`

Implement truthful queue with exactly-one-state guarantee. All pure, no I/O.

Functions:
1. `applyCap(features, cap)` — apply segment cap, preserving deferred state
2. `applySelector(features, selector)` — apply selector, preserving unprocessed as deferred
3. `promoteDeferred(features, completedIds)` — promote deferred features up to cap
4. `queueDenominator(features)` — compute coverage denominator excluding excluded

---

## Task 5: GREEN — Schedulability and dependency context module (DEPCTX-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/schedulability.mjs`
- `tests/schedulability.test.mjs`

Implement schedulability plan with prerequisite waves and bounded dependency context. All pure.

Functions:
1. `computeWaves(features, edges, cap)` — produce deterministic prerequisite waves
2. `classifyCycle(edges)` — classify cycle as supported-priority or unsupported-deadlock
3. `boundedDependencyContext(featureId, features, edges, maxDepth)` — bounded verified deps
4. `schedulabilityDecision(features, edges)` — overall schedulable/no-progress/explicit-cycle verdict

---

## Task 6: Wire into harness and verify full suite

**Files to modify:**
- `tests/harness.mjs` — add all new function names to CANDIDATES

Verify: `npm run build` clean, `npm run validate:build` no drift, `npm test` all pass.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Harness CANDIDATES misses new declarations | Add all names before running tests |
| Build concatenation breaks on new imports | Source modules use same pattern as Phase 1 |
| 23-feature cap-8 fixture complex | Test with exact fixture from RED Gate criteria |

## Success Criteria

1. Same revision → identical inventory pages, identities, denominator, graph digest
2. Graph validation rejects collisions, ownership gaps/overlap, dangling edges, unsupported cycles
3. 23 features / cap 8 → exactly 8/15, 16/7, 23/0 progression
4. Every feature has exactly one lifecycle state; scheduled leaves receive bounded dependency context
