---
requirements-completed:
  - INV-01
  - DISC-01
  - GRAPH-01
  - QUEUE-01
  - DEPCTX-01
---

# Phase 2: Bounded Discovery, Validated Graph, and Schedulability — Summary

**Phase:** 2
**Completed:** 2026-07-22
**Requirements:** INV-01, DISC-01, GRAPH-01, QUEUE-01, DEPCTX-01

## What was built

Five pure-function source modules in `plugins/feature-workflows/workflows/src/`:

1. **`inventory.mjs`** — Deterministic repository inventory classification:
   - `classifyPath(path, policies)` — classifies each path as included/excluded/generated/vendor/ignored
   - `buildInventory(paths, policies)` — deterministic inventory with canonical sort and digest
   - `inventoryDigest(inventory)` — stable fingerprint independent of traversal order
   - `refineOversizedArea(area, maxPathsPerPage)` — recursive bisection into bounded pages

2. **`discovery.mjs`** — Durable paginated discovery with cursor-based resumption:
   - `createCursor(inventory, pageSize)` — pagination cursor over included entries
   - `nextPage(cursor)` — deterministic page advancement without gaps/duplicates
   - `resumeDiscovery(cursor, expectedDigest)` — stale-aware resume from interruption
   - `extractFeaturesFromPages(pages)` — canonical feature identity extraction from pages

3. **`graph-validation.mjs`** — Validated feature graph with collision/ownership/cycle checks:
   - `canonicalizeIdentity(features)` — collision-free identity disambiguation
   - `detectCycle(edges)` — DFS cycle detection with deduplication
   - `classifyCycle(edges, cyclePolicy)` — supported/unsupported cycle classification
   - `validateGraph(features, edges, ownershipMap, cyclePolicy)` — full validation (collisions, ownership gaps/overlap, dangling edges, cycles)
   - `graphDigest(features, edges)` — deterministic graph fingerprint

4. **`queue-semantics.mjs`** — Truthful queue with exactly-one-state guarantee:
   - `applyCap(features, cap)` — cap preserves deferred (not completion/exclusion)
   - `applySelector(features, selector)` — selector defers non-matching (not excludes)
   - `promoteDeferred(features, completedIds, cap)` — cap-aware promotion; completed features free slots
   - `queueDenominator(features)` — coverage denominator excludes excluded features
   - `segmentProgression(total, cap, segment)` — exact 8/15, 16/7, 23/0 computation

5. **`schedulability.mjs`** — Schedulability plan with prerequisite waves and bounded deps:
   - `computeWaves(features, edges, cap, cyclePolicy)` — Kahn's algorithm with per-wave cap
   - `boundedDependencyContext(featureId, features, edges, maxDepth)` — bounded BFS traversal
   - `schedulabilityDecision(features, edges, cap, cyclePolicy)` — overall verdict (schedulable/no-progress/unsupported-cycle)

## Test coverage

Five new test files with 113 characterization tests:

- `tests/inventory.test.mjs` — 26 tests: path classification, deterministic digest, reordered-traversal stability, oversized area refinement
- `tests/discovery.test.mjs` — 24 tests: cursor creation, page advancement without gaps/duplicates, stale-aware resume, feature extraction
- `tests/graph-validation.test.mjs` — 26 tests: identity collisions, cycle detection (simple/diamond/self-loop), ownership gaps, dangling edges, graph digest
- `tests/queue-semantics.test.mjs` — 22 tests: cap enforcement, selector application, deferred promotion, exact 23-feature/cap-8 progression (all 3 segments)
- `tests/schedulability.test.mjs` — 15 tests: wave computation, dependency ordering, bounded context, cycle classification, deterministic verdicts

**Total test count:** 375 (262 existing + 113 new), all passing.

## Evidence

- **RED → GREEN:** Tests written to fail on missing declarations, then implementations satisfied them
- **Build:** `npm run build` produces 24-module dist with no drift (validate:build passes)
- **ESM:** All five modules pass `node --input-type=module --check`
- **Backward compatibility:** All 262 existing tests remain green; no existing code modified
- **Harness:** All 32 new function names added to CANDIDATES array

## Success Criteria Verification

1. ✅ Repeated discovery of the same revision produces identical bounded inventory pages, canonical feature identities, coverage denominator, and graph digest
2. ✅ Graph validation prevents scheduling for identity collisions, unexplained ownership gaps/overlap, dangling edges, and unsupported cycles
3. ✅ With 23 canonical in-scope features and cap 8, successive segments report exactly 8/15, 16/7, and 23/0
4. ✅ Every discovered feature has exactly one durable lifecycle state; scheduled leaves receive bounded verified dependency context
