# Phase 2 — UAT Verification (Goal-Backward)

**Phase:** 2 — Bounded Discovery, Validated Graph, and Schedulability
**Milestone:** v1.5.0 (gh sub-issue #21)
**Verification date:** 2026-07-22
**Verifier:** autonomous UAT agent (`/gsd-verify-work 2 --auto` equivalent)
**Method:** Goal-backward — examine delivered code against stated requirement goals, not just task/test existence.

---

## Verdict: GOAL MET

All five Phase 2 requirements (INV-01, DISC-01, GRAPH-01, QUEUE-01, DEPCTX-01) are genuinely
delivered by the codebase. 160 Phase 2 tests pass; full suite 1448 pass / 0 fail; build
drift-free. A real overlap-detection defect was found and fixed during Nyquist validation
(commit `cab072c`).

---

## Requirements Verified

### INV-01 — Deterministic bounded repository inventory — MET

**Goal:** A user can extract a requested project scope from a deterministic, bounded
repository inventory that accounts for every discovered path as included or explicitly
excluded and records the applicable generated, vendor, and ignore policy as evidence.

**Evidence (source: `plugins/feature-workflows/workflows/src/inventory.mjs`, 160 LOC):**

- `classifyPath(path, policies)` — classifies each path as included/excluded/generated/
  vendor/ignored. Returns `{path, verdict, policy, evidence}` — every entry carries a
  recorded evidence string explaining why it received its verdict.
- `PATH_POLICIES` — frozen object with exactly 5 verdicts: included, excluded, generated,
  vendor, ignored. Every discovered path is accounted for under one of these.
- `GENERATED_SEGMENTS`, `IGNORE_SEGMENTS`, `GENERATED_EXTENSIONS` — deterministic pattern
  sets. A path matches if any segment equals one of these names — same path always yields
  same verdict regardless of traversal order.
- `buildInventory(paths, policies)` — canonical sort before classification so reordered
  traversals produce identical output. Returns `{entries, digest, counts}` with counts
  broken down by verdict type.
- `inventoryDigest(inventory)` — deterministic fingerprint over path+verdict pairs;
  reclassification of evidence text does not change the digest.
- `refineOversizedArea(area, maxPathsPerPage)` — recursive bisection splits oversized areas
  into bounded pages. Deterministic: sorted before splitting.

**UAT scenarios confirmed:**
1. Paths with mixed types (src, node_modules, vendor, .git, legacy) classified into all 5
   verdict types simultaneously.
2. Reordered traversal produces identical inventory digest — confirmed by E2E-DISC-01 test.
3. Custom policy overrides (generatedSegments, ignoreSegments, generatedExtensions) change
   classification behavior as expected.
4. Ignore takes precedence over generated (.git inside node_modules classified as ignored).
5. Every entry has non-empty evidence string.
6. Oversized area at exact limit stays one page; over-limit refines recursively.

### DISC-01 — Durable paginated discovery — MET

**Goal:** A user can discover all features and subsystems through durable paginated pages
and cursors, with oversized areas recursively refined so no workflow prompt or response
must contain the whole repository inventory.

**Evidence (source: `plugins/feature-workflows/workflows/src/discovery.mjs`, 147 LOC):**

- `createCursor(inventory, pageSize)` — pagination cursor tracking position, offset,
  exhaustion state, and inventory digest for stale detection. Only included entries are
  paged; excluded/generated/ignored are accounted for but not paged.
- `nextPage(cursor)` — deterministic page advancement: entries `[offset, offset+pageSize)`.
  No gaps or duplicates.
- `resumeDiscovery(cursor, expectedDigest)` — stale-aware resume: if inventory digest
  changed, cursor is marked stale and discovery must restart. Otherwise resumes exactly
  where it left off.
- `exhausted(cursor)` — checks if cursor covered all included entries.
- `allPages(inventory, pageSize)` — collect all pages at once (testing/small inventories).
- `extractFeaturesFromPages(pages)` — canonical feature identity extraction using
  directory-prefix grouping. Each unique directory becomes a candidate feature with
  deterministic ID, sorted paths, and digest.

**UAT scenarios confirmed:**
1. 5-page resume (15 entries, page size 3) covers all entries without gaps or duplicates.
2. Cursor over all-excluded inventory is immediately exhausted (0 included entries).
3. Page content is independent of page size — different page sizes yield same features.
4. Resume detects stale inventory via digest mismatch.
5. Empty pages yield zero features.

### GRAPH-01 — Validated feature graph — MET

**Goal:** Before extraction starts, a user receives a validated feature graph whose
canonical identities are collision-free, whose ownership covers the included inventory
without unexplained overlap or gaps, and whose dependency edges, entry points, coverage
links, dangling references, and cycle policy are verified.

**Evidence (source: `plugins/feature-workflows/workflows/src/graph-validation.mjs`, 195 LOC):**

- `canonicalizeIdentity(features)` — collision-free identity disambiguation: if two features
  share an ID, suffixes are appended (`-1`, `-2`). Returns canonical features + collision list.
- `detectCycle(edges)` — DFS-based cycle detection (WHITE/GRAY/BLACK coloring). Returns first
  cycle and all unique cycles with rotation-normalized deduplication.
- `classifyCycle(edges, cyclePolicy)` — classifies as supported (all cycle edges have policy
  override) or unsupported (deadlock). Partial policy support is unsupported.
- `validateGraph(features, edges, ownershipMap, cyclePolicy)` — full validation:
  - Identity collision detection (duplicate IDs)
  - Ownership gap detection (ownershipMap references unknown features)
  - **Ownership overlap detection** (path claimed by multiple features — unexplained = error,
    resolved by ownershipMap = warning) — THIS WAS THE REAL DEFECT FIXED during validation
  - Dangling edge detection (edges to/from non-existent features)
  - Unsupported cycle rejection
- `graphDigest(features, edges)` — deterministic fingerprint over sorted feature IDs+paths
  and sorted edges.

**Defect fixed during validation (commit `cab072c`):**
The original overlap detection iterated `Object.entries(ownershipMap)`, which never produces
duplicate keys for a standard JS object — `pathOwners.has(path)` was unreachable dead code.
The actual overlap scenario (two features both listing the same path in their `paths` arrays)
was never checked. Fix: replaced with a `pathClaims` map built from features' `paths` arrays.
When a path appears in multiple features, overlap is either explained (ownershipMap resolves
to one claimant → warning) or unexplained (no ownershipMap → error).

**UAT scenarios confirmed:**
1. Identity collision → error reported.
2. Dangling edge → error reported.
3. Unsupported cycle → error reported; supported cycle → warning + valid graph.
4. Ownership gap (ownershipMap references unknown feature) → error.
5. Unexplained ownership overlap → error; resolved by ownershipMap → warning + valid graph.
6. Multiple simultaneous errors (collision + dangling + overlap) all reported at once.
7. Null/empty inputs handled gracefully (valid graph, stable digest).
8. Partial cycle policy (some edges supported) treated as unsupported.
9. Disjoint paths → no overlap, valid graph.

### QUEUE-01 — Truthful queue semantics — MET

**Goal:** A user can see each feature in exactly one durable lifecycle state: runnable,
deferred, in progress, blocked, failed, skipped, excluded, or completed; caps and selectors
preserve unprocessed in-scope features as resumable deferred work rather than completion.

**Evidence (source: `plugins/feature-workflows/workflows/src/queue-semantics.mjs`, 176 LOC):**

- `applyCap(features, cap)` — features beyond cap marked deferred (NOT excluded/completed).
  Idempotent. Excluded features stay excluded. Previously runnable within cap stay runnable.
- `applySelector(features, selector)` — non-selected in-scope features deferred (NOT excluded).
  Include+exclude combined: exclude takes precedence within include set.
- `promoteDeferred(features, completedIds, cap)` — cap-aware promotion: completed features
  free slots; failed features do NOT consume cap slots; excluded features never promoted.
  Each feature promoted from deferred exactly once.
- `queueDenominator(features)` — coverage denominator excludes excluded features. Returns
  `{denominator, excluded, total, breakdown}`.
- `segmentProgression(total, cap, segment)` — exact math for 23-feature/cap-8 progression.

**UAT scenarios confirmed:**
1. Cap 8 on 23 features: segment 1 = 8 runnable / 15 deferred.
2. After completing 8, promote next 8: segment 2 = 16 completed / 7 deferred.
3. After completing 16, promote remaining 7: segment 3 = 23 completed / 0 deferred.
4. Every feature promoted from deferred exactly once — no double-processing.
5. Excluded features never counted as completed in denominator.
6. Failed features stay failed, do not consume cap slots.
7. Excluded features stay excluded through promotion.
8. Mixed deferred+runnable cap correctly counts processing slots.
9. Combined include+exclude selector: exclude takes precedence.

### DEPCTX-01 — Schedulability and dependency context — MET

**Goal:** A user gets a validated schedulability plan that identifies prerequisite order,
safe independent waves, cycle/no-progress handling, and the bounded verified dependency
summaries available to each feature before any leaf is admitted.

**Evidence (source: `plugins/feature-workflows/workflows/src/schedulability.mjs`, 169 LOC):**

- `computeWaves(features, edges, cap, cyclePolicy)` — Kahn's algorithm with per-wave cap:
  features with no unmet dependencies form wave 1; subsequent waves formed as dependencies
  resolve. Cap limits features per wave (overflow stays eligible for next wave). Unsupported
  cycles → empty waves + UNSUPPORTED_CYCLE verdict. No ready features → NO_PROGRESS verdict.
- `boundedDependencyContext(featureId, features, edges, maxDepth)` — BFS traversal bounded
  to maxDepth hops (default 3). Each dependency entry carries `{id, depth, paths, digest}`.
  Visited set prevents cycles from causing infinite traversal.
- `schedulabilityDecision(features, edges, cap, cyclePolicy)` — combines cycle classification
  and wave computation into overall verdict: SCHEDULABLE / NO_PROGRESS / UNSUPPORTED_CYCLE.
  Returns waves, unscheduled features, cycle detection status, and human-readable details.

**UAT scenarios confirmed:**
1. Linear dependency chain (a→b→c→d) produces 4 sequential waves in correct order.
2. Independent features (no edges) all in wave 1.
3. Diamond dependency resolved correctly.
4. Cap-limited waves: overflow features deferred to subsequent waves.
5. Unsupported cycle → UNSUPPORTED_CYCLE verdict, empty waves, all features unscheduled.
6. Supported cycle → SCHEDULABLE with cycle warning.
7. Unknown feature context returns empty (no crash).
8. Default maxDepth=3 bounds traversal depth.
9. Edges to non-existent features filtered out (not counted as dependencies).
10. Empty features → SCHEDULABLE with 0 waves.
11. Cap 0 → unlimited per wave.

---

## Test Summary

| Category | Count | Status |
|----------|-------|--------|
| inventory.test.mjs | 26 | all pass |
| discovery.test.mjs | 22 | all pass |
| graph-validation.test.mjs | 25 | all pass |
| queue-semantics.test.mjs | 22 | all pass |
| schedulability.test.mjs | 19 | all pass |
| phase02-nyquist-validation.test.mjs | 46 | all pass |
| **Phase 2 total** | **160** | **all pass** |
| Full milestone suite | 1448 | pass / 0 fail |

Build validation: `npm run validate:build` — drift-free (33 modules, 314 top-level names
per dist file).

---

## E2E Matrix Coverage (Phase 2 Rows)

| E2E ID | Verified | Evidence |
|--------|----------|----------|
| E2E-DISC-01 | MET | Reordered traversal with mixed path types → identical inventory digest, pages, features, coverage digest |
| E2E-GRAPH-01 | MET | All 5 rejection types (collision, dangling, cycle, ownership gap, ownership overlap) produce explicit errors; supported cycle produces warning + valid graph |
| E2E-QUEUE-01 | MET | Cap + selector + exclusion → exactly-one-state; exclusion never masquerades as completion; denominator excludes excluded |
| E2E-DEFER-01 | MET | Full 3-segment flow: 23 features, cap 8, segments report exactly 8/15, 16/7, 23/0, no double-processing |

---

## Success Criteria Verification

1. **Repeated discovery of the same revision produces identical inventory pages, identities,
   denominator, and graph digest.** — VERIFIED. E2E-DISC-01 test proves byte-identical output
   across reordered traversal with mixed path types (included, generated, vendor, ignored).

2. **Graph validation prevents scheduling for identity collisions, unexplained ownership
   gaps/overlap, dangling edges, and unsupported cycles.** — VERIFIED. E2E-GRAPH-01 test
   exercises each rejection type individually and in combination; invalid graph prevents
   scheduling via `schedulabilityDecision`.

3. **With 23 canonical in-scope features and cap 8, successive acknowledged segments report
   exactly 8 completed/15 deferred, 16/7, and 23/0.** — VERIFIED. E2E-DEFER-01 test runs
   the full 3-segment flow with explicit double-processing prevention via `processedEver` set.

4. **Every discovered feature has exactly one durable lifecycle state and every scheduled leaf
   receives only bounded verified dependency context.** — VERIFIED. E2E-QUEUE-01 + DEPCTX-01
   tests confirm exactly-one-state after cap+selector+promotion and bounded context with
   maxDepth=3 default.

---

## Defect Fixed During Phase 2 Validation

**Defect:** Dead ownership-overlap detection in `validateGraph`
**Commit:** `cab072c`
**Root cause:** The overlap detection iterated `Object.entries(ownershipMap)`, which never
produces duplicate keys for a standard JS object. The `pathOwners.has(path)` check was
unreachable dead code. The actual overlap scenario — two features both listing the same
path in their `paths` arrays — was not checked at all.
**Fix:** Replaced dead intra-ownershipMap check with a `pathClaims` map built from features'
`paths` arrays. When a path appears in multiple features, overlap is either explained
(ownershipMap resolves to one claimant → warning) or unexplained (→ error).

This is a genuine defect that was caught by the Nyquist validation gap analysis and fixed
before the phase was marked complete. The fix is covered by dedicated tests for both
unexplained-rejected and explained-allowed behavior.

---

## Concerns (non-blocking)

1. **`boundedDependencyContext` `bounded` heuristic.** The `bounded` flag uses a heuristic
   (`visited.size > depth * 5`) rather than an explicit cap on context entries. This is
   sufficient for current use cases but could be tightened to an explicit max-context-size
   limit if future dogfooding reveals very broad dependency trees. Non-blocking — the
   maxDepth bound already prevents unbounded traversal.

2. **`extractFeaturesFromPages` directory-prefix grouping.** Feature identity extraction uses
   parent-directory grouping, which is a reasonable heuristic but may over-split or under-split
   features in repos with unconventional layouts. This is acceptable for the current milestone
   scope (pure-function discovery layer); the actual feature identification in production
   runs is agent-mediated and can override these candidate identities.

---

## Files Verified

| File | LOC | Role |
|------|-----|------|
| `plugins/feature-workflows/workflows/src/inventory.mjs` | 160 | Deterministic inventory classification |
| `plugins/feature-workflows/workflows/src/discovery.mjs` | 147 | Paginated discovery with cursors |
| `plugins/feature-workflows/workflows/src/graph-validation.mjs` | 195 | Feature graph validation |
| `plugins/feature-workflows/workflows/src/queue-semantics.mjs` | 176 | Truthful queue semantics |
| `plugins/feature-workflows/workflows/src/schedulability.mjs` | 169 | Schedulability plan + dependency context |
| `tests/inventory.test.mjs` | — | 26 tests |
| `tests/discovery.test.mjs` | — | 22 tests |
| `tests/graph-validation.test.mjs` | — | 25 tests |
| `tests/queue-semantics.test.mjs` | — | 22 tests |
| `tests/schedulability.test.mjs` | — | 19 tests |
| `tests/phase02-nyquist-validation.test.mjs` | — | 46 tests |

---

## Sign-off

Phase 2 goals are genuinely met. The codebase delivers deterministic bounded inventory,
paginated discovery with cursor-based resumption, validated feature graphs with all
rejection types (including the fixed overlap detection), truthful queue semantics with the
exact 23-feature/cap-8 progression, and bounded schedulability with prerequisite waves and
dependency context. All tests green, build drift-free. One real defect (dead overlap
detection code) was caught and fixed during validation. Two minor non-blocking concerns
noted.

**Status:** VERIFIED
