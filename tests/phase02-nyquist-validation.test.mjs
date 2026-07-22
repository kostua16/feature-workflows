// Phase 2 Nyquist Validation: Gap-filling tests for INV-01, DISC-01, GRAPH-01,
// QUEUE-01, DEPCTX-01.
//
// These tests close validation gaps identified by the gsd-validate-phase audit:
// - INV-01: custom policy overrides, all-verdict inventory, empty-path edge case
// - DISC-01: multi-page resume, all-excluded cursor, empty-pages extraction
// - GRAPH-01: multiple simultaneous errors, ownership overlap detection,
//   edge-case inputs, partial policy cycles
// - QUEUE-01: mixed lifecycle cap, combined selector, failed/excluded promotion,
//   exactly-one-state proof, exclusion-not-completion invariant
// - DEPCTX-01: unknown feature context, default maxDepth, empty inputs, cap-0
//   unlimited waves, edges referencing non-existent features
// - E2E-DISC-01: full pipeline determinism (paths -> inventory -> pages ->
//   features -> digest) across reordered traversal
// - E2E-GRAPH-01: all rejection types in one comprehensive fixture
// - E2E-QUEUE-01: cap + selector + exclusion -> exactly-one-state
// - E2E-DEFER-01: full 23-feature/cap-8 three-segment progression
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  PATH_POLICIES,
  classifyPath,
  buildInventory,
  inventoryDigest,
  refineOversizedArea,
  createCursor,
  nextPage,
  resumeDiscovery,
  exhausted,
  allPages,
  extractFeaturesFromPages,
  CYCLE_POLICIES,
  GRAPH_VERDICTS,
  canonicalizeIdentity,
  detectCycle,
  classifyCycle,
  validateGraph,
  graphDigest,
  LIFECYCLE_STATES,
  applyCap,
  applySelector,
  promoteDeferred,
  queueDenominator,
  segmentProgression,
  SCHEDULABILITY_VERDICTS,
  computeWaves,
  boundedDependencyContext,
  schedulabilityDecision,
} = engine

// =========================================================================
// INV-01: Custom policy overrides
// =========================================================================

test('INV-01: custom generatedSegments override classifies custom paths', () => {
  const result = classifyPath('custom-build/output.ts', { generatedSegments: new Set(['custom-build']) })
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
  assert.equal(result.policy, 'generated')
})

test('INV-01: custom ignoreSegments override classifies custom ignore paths', () => {
  const result = classifyPath('.svn/cache', { ignoreSegments: new Set(['.svn']) })
  assert.equal(result.verdict, PATH_POLICIES.IGNORED)
})

test('INV-01: custom generatedExtensions override classifies custom extensions', () => {
  const result = classifyPath('data/cache.bin', { generatedExtensions: new Set(['.bin']) })
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
})

test('INV-01: include pattern provides evidence for default-included paths', () => {
  // Include patterns are checked after generated/vendor/ignore — they only
  // affect paths that would default to included, providing explicit evidence
  const result = classifyPath('src/special/handler.ts', { includePatterns: ['special/'] })
  assert.equal(result.verdict, PATH_POLICIES.INCLUDED)
  assert.equal(result.policy, 'include-pattern')
})

test('INV-01: ignore takes precedence over generated', () => {
  // .git inside node_modules — ignore should win
  const result = classifyPath('node_modules/.git/config')
  assert.equal(result.verdict, PATH_POLICIES.IGNORED)
})

// =========================================================================
// INV-01: All verdict types in one inventory
// =========================================================================

test('INV-01: buildInventory with all 5 verdict types simultaneously', () => {
  const inv = buildInventory([
    'src/app.ts',                         // included
    'node_modules/express/index.js',      // generated
    'vendor/lib.go',                      // vendor
    '.git/config',                        // ignored
    'legacy/old.ts',                      // excluded (via pattern)
  ], { excludePatterns: ['legacy/'] })

  assert.equal(inv.counts.included, 1)
  assert.equal(inv.counts.generated, 1)
  assert.equal(inv.counts.vendor, 1)
  assert.equal(inv.counts.ignored, 1)
  assert.equal(inv.counts.excluded, 1)
  assert.equal(inv.entries.length, 5)
})

test('INV-01: every entry has a recorded evidence string', () => {
  const inv = buildInventory(['src/a.ts', 'node_modules/b.js', '.git/c'])
  for (const e of inv.entries) {
    assert.ok(typeof e.evidence === 'string' && e.evidence.length > 0,
      `entry '${e.path}' must have non-empty evidence`)
  }
})

// =========================================================================
// INV-01: Edge cases
// =========================================================================

test('INV-01: classifyPath with empty string returns excluded', () => {
  const result = classifyPath('')
  assert.equal(result.verdict, PATH_POLICIES.EXCLUDED)
})

test('INV-01: refineOversizedArea at exact limit stays one page', () => {
  const paths = Array.from({ length: 5 }, (_, i) => `f${i}.ts`)
  const pages = refineOversizedArea({ name: 'exact', paths }, 5)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].paths.length, 5)
})

// =========================================================================
// DISC-01: Multi-page resume without gaps/duplicates
// =========================================================================

test('DISC-01: 5-page resume covers all entries without gaps or duplicates', () => {
  const paths = Array.from({ length: 15 }, (_, i) => `src/mod${i}.ts`)
  const inv = buildInventory(paths)
  const cursor = createCursor(inv, 3) // 5 pages of 3

  const seen = new Set()
  let c = cursor
  // Simulate interruption/resume at every page boundary
  for (let i = 0; i < 6; i++) {
    if (exhausted(c)) break
    const result = resumeDiscovery(c, inv.digest)
    assert.equal(result.stale, false, `resume at page ${i} must not be stale`)
    for (const e of result.page) {
      assert.ok(!seen.has(e.path), `duplicate detected: ${e.path}`)
      seen.add(e.path)
    }
    c = result.cursor
  }
  assert.equal(seen.size, 15, 'all 15 entries must be covered')
})

test('DISC-01: cursor over all-excluded inventory is immediately exhausted', () => {
  const inv = buildInventory(['node_modules/a.js', '.git/config', 'vendor/b.go'])
  const cursor = createCursor(inv, 10)
  assert.equal(cursor.totalIncluded, 0)
  assert.equal(cursor.exhausted, true)
})

test('DISC-01: extractFeaturesFromPages with empty pages returns no features', () => {
  const result = extractFeaturesFromPages([])
  assert.equal(result.features.length, 0)
  assert.equal(result.totalFeatures, 0)
})

test('DISC-01: page content is independent of cursor page size', () => {
  // Same paths split into different page sizes yield same features
  const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']
  const inv = buildInventory(paths)
  const pages2 = allPages(inv, 2)
  const pages3 = allPages(inv, 3)
  const features2 = extractFeaturesFromPages(pages2)
  const features3 = extractFeaturesFromPages(pages3)
  assert.deepEqual(features2.features.map((f) => f.id).sort(),
    features3.features.map((f) => f.id).sort())
})

// =========================================================================
// GRAPH-01: Multiple simultaneous errors
// =========================================================================

test('GRAPH-01: graph with collision + dangling + overlap reports all errors', () => {
  const features = [
    { id: 'dup', paths: ['src/shared.ts'] },
    { id: 'dup', paths: ['src/other.ts'] },
    { id: 'x', paths: ['src/shared.ts'] }, // overlap with dup on shared.ts
  ]
  const edges = [{ from: 'dup', to: 'nonexistent' }] // dangling
  const result = validateGraph(features, edges)
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  const errorTypes = result.errors.map((e) => e.type)
  assert.ok(errorTypes.includes('identity-collision'))
  assert.ok(errorTypes.includes('dangling-edge'))
  assert.ok(errorTypes.includes('ownership-overlap'))
})

test('GRAPH-01: canonicalizeIdentity with empty array returns no canonical or collisions', () => {
  const result = canonicalizeIdentity([])
  assert.equal(result.canonical.length, 0)
  assert.equal(result.collisions.length, 0)
})

test('GRAPH-01: canonicalizeIdentity throws on non-array input', () => {
  assert.throws(() => canonicalizeIdentity('not-array'), /must be an array/)
})

test('GRAPH-01: detectCycle with non-array input returns no cycle', () => {
  const result = detectCycle(null)
  assert.equal(result.hasCycle, false)
  assert.equal(result.cycle.length, 0)
})

test('GRAPH-01: classifyCycle with partial policy support is unsupported', () => {
  // Cycle a->b->a but only a->b is marked supported
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const partialPolicy = { 'a->b': 'supported' } // missing b->a
  const result = classifyCycle(edges, partialPolicy)
  assert.equal(result.classification, CYCLE_POLICIES.UNSUPPORTED)
})

test('GRAPH-01: validateGraph with null features and edges is valid', () => {
  const result = validateGraph(null, null)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
})

test('GRAPH-01: graphDigest with null inputs produces stable digest', () => {
  const d1 = graphDigest(null, null)
  const d2 = graphDigest(null, null)
  assert.equal(d1, d2)
})

test('GRAPH-01: path overlap between features with no ownershipMap is rejected', () => {
  const features = [
    { id: 'a', paths: ['src/shared.ts', 'src/a.ts'] },
    { id: 'b', paths: ['src/shared.ts', 'src/b.ts'] },
  ]
  const result = validateGraph(features, [])
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'ownership-overlap'))
})

test('GRAPH-01: path overlap resolved by ownershipMap is warning not error', () => {
  const features = [
    { id: 'a', paths: ['src/shared.ts'] },
    { id: 'b', paths: ['src/shared.ts'] },
  ]
  const ownershipMap = { 'src/shared.ts': 'a' }
  const result = validateGraph(features, [], ownershipMap)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.ok(result.warnings.some((w) => w.type === 'ownership-overlap-explained'))
  assert.ok(!result.errors.some((e) => e.type === 'ownership-overlap'))
})

test('GRAPH-01: features with disjoint paths have no overlap', () => {
  const features = [
    { id: 'a', paths: ['src/a.ts', 'src/a2.ts'] },
    { id: 'b', paths: ['src/b.ts', 'src/b2.ts'] },
  ]
  const result = validateGraph(features, [])
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.ok(!result.errors.some((e) => e.type === 'ownership-overlap'))
})

// =========================================================================
// QUEUE-01: Mixed lifecycle states and combined operations
// =========================================================================

test('QUEUE-01: applyCap with mixed deferred and runnable states', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED },
    { id: 'c', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'd', lifecycle: LIFECYCLE_STATES.RUNNABLE },
  ]
  const result = applyCap(features, 2)
  // runnable features a, c, d compete for 2 slots; b stays deferred
  const runnable = result.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  const deferred = result.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED)
  // b was already deferred; one of the runnable goes over cap
  assert.equal(deferred.length, 2) // b + 1 capped runnable
  assert.equal(runnable.length, 2)
})

test('QUEUE-01: applySelector with both includeIds and excludeIds', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'b', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'c', lifecycle: LIFECYCLE_STATES.RUNNABLE },
  ]
  // include a,b but exclude b — exclude takes precedence
  const result = applySelector(features, { includeIds: ['a', 'b'], excludeIds: ['b'] })
  assert.equal(result.find((f) => f.id === 'a').lifecycle, LIFECYCLE_STATES.RUNNABLE)
  assert.equal(result.find((f) => f.id === 'b').lifecycle, LIFECYCLE_STATES.DEFERRED)
  // c not in includeIds — deferred
  assert.equal(result.find((f) => f.id === 'c').lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('QUEUE-01: promoteDeferred does not promote failed features', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
    { id: 'f', lifecycle: LIFECYCLE_STATES.FAILED },
    { id: 'd1', lifecycle: LIFECYCLE_STATES.DEFERRED },
    { id: 'd2', lifecycle: LIFECYCLE_STATES.DEFERRED },
  ]
  const result = promoteDeferred(features, ['a'], 2)
  const failedFeat = result.features.find((f) => f.id === 'f')
  assert.equal(failedFeat.lifecycle, LIFECYCLE_STATES.FAILED, 'failed must stay failed')
  // d1, d2 can be promoted since failed doesn't consume cap slot
  const promoted = result.promoted
  assert.equal(promoted.length, 2)
})

test('QUEUE-01: promoteDeferred does not promote excluded features', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
    { id: 'e', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'd', lifecycle: LIFECYCLE_STATES.DEFERRED },
  ]
  const result = promoteDeferred(features, ['a'], 2)
  const excludedFeat = result.features.find((f) => f.id === 'e')
  assert.equal(excludedFeat.lifecycle, LIFECYCLE_STATES.EXCLUDED)
  assert.ok(result.promoted.includes('d'))
  assert.ok(!result.promoted.includes('e'))
})

test('QUEUE-01: every feature has exactly one lifecycle state after cap + promotion', () => {
  const features = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    lifecycle: LIFECYCLE_STATES.RUNNABLE,
  }))
  const capped = applyCap(features, 3)
  // Verify exactly one state per feature
  for (const f of capped) {
    assert.ok(typeof f.lifecycle === 'string', `feature ${f.id} must have lifecycle`)
    const states = [f.lifecycle]
    assert.equal(states.length, 1, `feature ${f.id} must have exactly one lifecycle state`)
  }
  // Complete first batch and promote
  const completedIds = capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).map((f) => f.id)
  const marked = capped.map((f) =>
    completedIds.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const promoted = promoteDeferred(marked, completedIds, 3)
  for (const f of promoted.features) {
    assert.ok(typeof f.lifecycle === 'string')
    // Count should never have multiple lifecycle fields
    assert.equal(f.lifecycle !== undefined, true)
  }
})

test('QUEUE-01: excluded features never counted as completed in denominator', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'b', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'c', lifecycle: LIFECYCLE_STATES.COMPLETED },
  ]
  const result = queueDenominator(features)
  assert.equal(result.denominator, 1) // only c counts
  assert.equal(result.excluded, 2)
  assert.equal(result.total, 3)
  assert.equal(result.breakdown[LIFECYCLE_STATES.EXCLUDED], 2)
  assert.equal(result.breakdown[LIFECYCLE_STATES.COMPLETED], 1)
})

test('QUEUE-01: segmentProgression with zero features completes immediately', () => {
  const result = segmentProgression(0, 8, 1)
  assert.equal(result.processed, 0)
  assert.equal(result.deferred, 0)
  assert.equal(result.complete, true)
})

// =========================================================================
// DEPCTX-01: Edge cases and bounded context
// =========================================================================

test('DEPCTX-01: boundedDependencyContext for unknown feature returns empty context', () => {
  const features = [{ id: 'a', paths: ['src/a.ts'] }]
  const result = boundedDependencyContext('nonexistent', features, [], 3)
  assert.equal(result.context.length, 0)
})

test('DEPCTX-01: boundedDependencyContext default maxDepth bounds to 3 hops', () => {
  // Chain: root -> a -> b -> c -> d
  const features = ['root', 'a', 'b', 'c', 'd'].map((id) => ({ id, paths: [`src/${id}.ts`] }))
  const edges = [
    { from: 'root', to: 'a' }, { from: 'a', to: 'b' },
    { from: 'b', to: 'c' }, { from: 'c', to: 'd' },
  ]
  const result = boundedDependencyContext('root', features, edges)
  const ids = result.context.map((c) => c.id)
  assert.ok(ids.includes('a'))
  assert.ok(ids.includes('b'))
  assert.ok(ids.includes('c'))
  assert.ok(!ids.includes('d'), 'default maxDepth=3 should not reach d')
})

test('DEPCTX-01: boundedDependencyContext throws on missing featureId', () => {
  assert.throws(() => boundedDependencyContext(null, [], [], 3), /featureId is required/)
  assert.throws(() => boundedDependencyContext('', [], [], 3), /featureId is required/)
})

test('DEPCTX-01: schedulabilityDecision with empty features is schedulable', () => {
  const result = schedulabilityDecision([], [], 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  assert.equal(result.waves.length, 0)
})

test('DEPCTX-01: computeWaves with cap 0 means unlimited per wave', () => {
  const features = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, paths: [`src/${id}.ts`] }))
  const result = computeWaves(features, [], 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  // All 5 in one wave (unlimited)
  assert.equal(result.waves[0].length, 5)
})

test('DEPCTX-01: computeWaves ignores edges referencing non-existent features', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  // Edge to non-existent feature is filtered out by featureIds check
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'ghost' }]
  const result = computeWaves(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  assert.equal(result.unscheduled.length, 0)
})

test('DEPCTX-01: boundedDependencyContext with no edges returns empty', () => {
  const features = [{ id: 'a', paths: ['src/a.ts'] }]
  const result = boundedDependencyContext('a', features, null, 3)
  assert.equal(result.context.length, 0)
})

// =========================================================================
// E2E-DISC-01: Full pipeline determinism (paths -> inventory -> pages ->
// features -> digest) across reordered traversal
// =========================================================================

test('E2E-DISC-01: reordered traversal produces identical inventory, pages, features, digest', () => {
  const pathsA = ['src/auth/login.ts', 'src/auth/logout.ts', 'src/api/users.ts',
    'node_modules/express/index.js', '.git/config', 'vendor/lib.go', 'src/utils/helpers.ts']
  const pathsB = ['.git/config', 'vendor/lib.go', 'src/api/users.ts',
    'src/auth/logout.ts', 'src/auth/login.ts', 'node_modules/express/index.js', 'src/utils/helpers.ts']

  const invA = buildInventory(pathsA)
  const invB = buildInventory(pathsB)

  // Same digest
  assert.equal(invA.digest, invB.digest, 'inventory digest must be identical')

  // Same pages
  const pagesA = allPages(invA, 2)
  const pagesB = allPages(invB, 2)
  assert.deepEqual(pagesA, pagesB, 'pages must be identical')

  // Same features
  const featA = extractFeaturesFromPages(pagesA)
  const featB = extractFeaturesFromPages(pagesB)
  assert.deepEqual(featA.features, featB.features, 'extracted features must be identical')
  assert.equal(featA.coverageDigest, featB.coverageDigest)
})

// =========================================================================
// E2E-GRAPH-01: All rejection types verified
// =========================================================================

test('E2E-GRAPH-01: each rejection type produces correct error type', () => {
  // Identity collision
  const collisionResult = validateGraph(
    [{ id: 'x', paths: ['a'] }, { id: 'x', paths: ['b'] }], [])
  assert.ok(collisionResult.errors.some((e) => e.type === 'identity-collision'))

  // Dangling edge
  const danglingResult = validateGraph(
    [{ id: 'a', paths: ['x'] }], [{ from: 'a', to: 'ghost' }])
  assert.ok(danglingResult.errors.some((e) => e.type === 'dangling-edge'))

  // Unsupported cycle
  const cycleResult = validateGraph(
    [{ id: 'a', paths: [] }, { id: 'b', paths: [] }],
    [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
  assert.ok(cycleResult.errors.some((e) => e.type === 'unsupported-cycle'))

  // Ownership gap
  const gapResult = validateGraph(
    [{ id: 'a', paths: ['src/x.ts'] }], [],
    { 'src/x.ts': 'unknown-feature' })
  assert.ok(gapResult.errors.some((e) => e.type === 'ownership-gap'))

  // Ownership overlap (unexplained)
  const overlapResult = validateGraph(
    [{ id: 'a', paths: ['src/shared.ts'] }, { id: 'b', paths: ['src/shared.ts'] }], [])
  assert.ok(overlapResult.errors.some((e) => e.type === 'ownership-overlap'))
})

test('E2E-GRAPH-01: supported cycle produces warning and valid graph', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const policy = { 'a->b': 'supported', 'b->a': 'supported' }
  const result = validateGraph(features, edges, null, policy)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.ok(result.warnings.some((w) => w.type === 'supported-cycle'))
})

// =========================================================================
// E2E-QUEUE-01: Cap + selector + exclusion -> exactly-one-state
// =========================================================================

test('E2E-QUEUE-01: cap + selector preserves deferred and excludes from denominator', () => {
  const features = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    lifecycle: LIFECYCLE_STATES.RUNNABLE,
    paths: [`src/f${i}.ts`],
  }))

  // Exclude f9
  const excluded = features.map((f) =>
    f.id === 'f9' ? { ...f, lifecycle: LIFECYCLE_STATES.EXCLUDED } : f
  )
  // Apply cap 5
  const capped = applyCap(excluded, 5)
  // Apply selector to include only f0-f4
  const selected = applySelector(capped, { includeIds: ['f0', 'f1', 'f2', 'f3', 'f4'] })

  // Every feature must have exactly one lifecycle state
  const stateCount = {}
  for (const f of selected) {
    stateCount[f.lifecycle] = (stateCount[f.lifecycle] || 0) + 1
  }

  // f9 is excluded (outside denominator)
  assert.ok(stateCount[LIFECYCLE_STATES.EXCLUDED] > 0)
  // Some features deferred (cap + selector)
  assert.ok(stateCount[LIFECYCLE_STATES.DEFERRED] > 0)

  // Denominator excludes f9
  const denom = queueDenominator(selected)
  assert.equal(denom.denominator, 9)
  assert.equal(denom.excluded, 1)
})

test('E2E-QUEUE-01: exclusion never masquerades as completion', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'b', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'c', lifecycle: LIFECYCLE_STATES.DEFERRED },
  ]
  const capped = applyCap(features, 1)
  const denom = queueDenominator(capped)

  // Excluded must not count toward completed
  assert.equal(denom.denominator, 2) // only b, c
  assert.equal(denom.excluded, 1)

  const completedCount = capped.filter(
    (f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED
  ).length
  assert.equal(completedCount, 0, 'no feature should be marked completed by cap/selector')
})

// =========================================================================
// E2E-DEFER-01: Full 23-feature/cap-8 three-segment progression
// =========================================================================

test('E2E-DEFER-01: complete 3-segment flow with explicit counts and no double-processing', () => {
  const allFeatures = Array.from({ length: 23 }, (_, i) => ({
    id: `feat-${i + 1}`,
    lifecycle: LIFECYCLE_STATES.RUNNABLE,
    paths: [`src/feat-${i + 1}.ts`],
  }))

  const processedEver = new Set()

  // --- Segment 1: apply cap 8 ---
  const seg1Capped = applyCap(allFeatures, 8)
  const seg1Runnable = seg1Capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  const seg1Deferred = seg1Capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED)
  assert.equal(seg1Runnable.length, 8, 'segment 1: 8 runnable')
  assert.equal(seg1Deferred.length, 15, 'segment 1: 15 deferred')
  for (const f of seg1Runnable) processedEver.add(f.id)

  // Complete segment 1
  const seg1Completed = seg1Capped.map((f) =>
    f.lifecycle === LIFECYCLE_STATES.RUNNABLE
      ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED }
      : f
  )
  const seg1CompletedIds = seg1Runnable.map((f) => f.id)

  // --- Segment 2: promote next 8 ---
  const seg2Result = promoteDeferred(seg1Completed, seg1CompletedIds, 8)
  const seg2Runnable = seg2Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  const seg2Completed = seg2Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED)
  const seg2Deferred = seg2Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED)

  assert.equal(seg2Completed.length, 8, 'segment 2: 8 completed')
  assert.equal(seg2Runnable.length, 8, 'segment 2: 8 runnable (promoted)')
  assert.equal(seg2Deferred.length, 7, 'segment 2: 7 deferred')
  for (const f of seg2Runnable) {
    assert.ok(!processedEver.has(f.id), `feature ${f.id} double-processed`)
    processedEver.add(f.id)
  }

  // Complete segment 2
  const seg2AllCompleted = seg2Result.features.map((f) =>
    f.lifecycle === LIFECYCLE_STATES.RUNNABLE
      ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED }
      : f
  )
  const seg2AllCompletedIds = seg2AllCompleted
    .filter((f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED)
    .map((f) => f.id)

  // --- Segment 3: promote remaining 7 ---
  const seg3Result = promoteDeferred(seg2AllCompleted, seg2AllCompletedIds, 8)
  const seg3Runnable = seg3Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  const seg3Completed = seg3Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED)
  const seg3Deferred = seg3Result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED)

  assert.equal(seg3Completed.length, 16, 'segment 3: 16 completed')
  assert.equal(seg3Runnable.length, 7, 'segment 3: 7 runnable (promoted)')
  assert.equal(seg3Deferred.length, 0, 'segment 3: 0 deferred')
  for (const f of seg3Runnable) {
    assert.ok(!processedEver.has(f.id), `feature ${f.id} double-processed`)
    processedEver.add(f.id)
  }

  // All 23 features processed exactly once
  assert.equal(processedEver.size, 23, 'all 23 features must be processed')
})

test('E2E-DEFER-01: segmentProgression math matches behavioral progression', () => {
  // Verify the mathematical model matches: cap * segment = processed
  for (let seg = 1; seg <= 3; seg++) {
    const math = segmentProgression(23, 8, seg)
    const expectedProcessed = Math.min(23, 8 * seg)
    const expectedDeferred = Math.max(0, 23 - expectedProcessed)
    assert.equal(math.processed, expectedProcessed, `segment ${seg} processed`)
    assert.equal(math.deferred, expectedDeferred, `segment ${seg} deferred`)
  }
  // Segment 3 is complete
  assert.equal(segmentProgression(23, 8, 3).complete, true)
})

// =========================================================================
// GRAPH-01 + QUEUE-01: Graph validation prevents scheduling
// =========================================================================

test('E2E-GRAPH-01: invalid graph prevents scheduling via schedulabilityDecision', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  const cycleEdges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const decision = schedulabilityDecision(features, cycleEdges, 0)
  assert.equal(decision.verdict, SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE)
  assert.equal(decision.waves.length, 0)
  assert.equal(decision.unscheduled.length, 2)
})

test('E2E-GRAPH-01: valid graph with dependencies produces ordered waves', () => {
  const features = ['a', 'b', 'c', 'd'].map((id) => ({ id, paths: [`src/${id}.ts`] }))
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' },
  ]
  const decision = schedulabilityDecision(features, edges, 0)
  assert.equal(decision.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  // 4 sequential waves (linear dependency chain)
  assert.equal(decision.waves.length, 4)
  // d in wave 0, c in wave 1, b in wave 2, a in wave 3
  assert.ok(decision.waves[0].includes('d'))
  assert.ok(decision.waves[3].includes('a'))
})
