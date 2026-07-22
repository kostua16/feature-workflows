// Phase 2 GRAPH-01: Validated feature graph tests.
// All functions are pure, deterministic, and carry no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  CYCLE_POLICIES,
  GRAPH_VERDICTS,
  canonicalizeIdentity,
  detectCycle,
  classifyCycle,
  validateGraph,
  graphDigest,
} = engine

// ---- canonicalizeIdentity ----

test('canonicalizeIdentity: no collisions returns as-is', () => {
  const features = [
    { id: 'auth', paths: ['src/auth'] },
    { id: 'api', paths: ['src/api'] },
  ]
  const result = canonicalizeIdentity(features)
  assert.equal(result.canonical.length, 2)
  assert.equal(result.collisions.length, 0)
})

test('canonicalizeIdentity: collision disambiguated with suffix', () => {
  const features = [
    { id: 'user', paths: ['src/user'] },
    { id: 'user', paths: ['lib/user'] },
  ]
  const result = canonicalizeIdentity(features)
  assert.equal(result.canonical.length, 2)
  assert.equal(result.collisions.length, 1)
  assert.equal(result.collisions[0].id, 'user')
  // Disambiguated IDs must be unique
  const ids = result.canonical.map((f) => f.id)
  assert.equal(new Set(ids).size, 2)
})

test('canonicalizeIdentity: preserves originalId', () => {
  const features = [{ id: 'auth', paths: ['src/auth'] }]
  const result = canonicalizeIdentity(features)
  assert.equal(result.canonical[0].originalId, 'auth')
})

// ---- detectCycle ----

test('detectCycle: no edges returns no cycle', () => {
  const result = detectCycle([])
  assert.equal(result.hasCycle, false)
})

test('detectCycle: simple DAG returns no cycle', () => {
  const edges = [
    { from: 'a', to: 'b' }, // a depends on b
    { from: 'b', to: 'c' }, // b depends on c
  ]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, false)
})

test('detectCycle: simple cycle detected', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, true)
  assert.ok(result.cycle.length >= 2)
})

test('detectCycle: self-loop detected', () => {
  const edges = [{ from: 'a', to: 'a' }]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, true)
})

test('detectCycle: three-node cycle', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, true)
  assert.ok(result.cycle.length >= 3)
})

test('detectCycle: complex graph with cycle', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'd' },
    { from: 'd', to: 'b' }, // cycle b->c->d->b
    { from: 'e', to: 'f' },
  ]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, true)
})

// ---- classifyCycle ----

test('classifyCycle: no cycle returns none', () => {
  const result = classifyCycle([], {})
  assert.equal(result.classification, CYCLE_POLICIES.NONE)
})

test('classifyCycle: unsupported cycle without policy', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const result = classifyCycle(edges, {})
  assert.equal(result.classification, CYCLE_POLICIES.UNSUPPORTED)
})

test('classifyCycle: supported cycle with policy', () => {
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const policy = { 'a->b': 'supported', 'b->a': 'supported' }
  const result = classifyCycle(edges, policy)
  assert.equal(result.classification, CYCLE_POLICIES.SUPPORTED)
})

// ---- validateGraph ----

test('validateGraph: valid graph passes', () => {
  const features = [{ id: 'a', paths: ['src/a'] }, { id: 'b', paths: ['src/b'] }]
  const edges = [{ from: 'a', to: 'b' }]
  const result = validateGraph(features, edges)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.equal(result.errors.length, 0)
})

test('validateGraph: identity collision rejected', () => {
  const features = [{ id: 'a', paths: ['x'] }, { id: 'a', paths: ['y'] }]
  const result = validateGraph(features, [])
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'identity-collision'))
})

test('validateGraph: dangling edge rejected', () => {
  const features = [{ id: 'a', paths: ['x'] }]
  const edges = [{ from: 'a', to: 'nonexistent' }]
  const result = validateGraph(features, edges)
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'dangling-edge'))
})

test('validateGraph: unsupported cycle rejected', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const result = validateGraph(features, edges)
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'unsupported-cycle'))
})

test('validateGraph: supported cycle allowed with warning', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const policy = { 'a->b': 'supported', 'b->a': 'supported' }
  const result = validateGraph(features, edges, null, policy)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.ok(result.warnings.some((w) => w.type === 'supported-cycle'))
})

test('validateGraph: ownership gap rejected', () => {
  const features = [{ id: 'a', paths: ['src/a.ts'] }]
  const ownershipMap = { 'src/a.ts': 'unknown-feature' }
  const result = validateGraph(features, [], ownershipMap)
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'ownership-gap'))
})

test('validateGraph: unexplained ownership overlap rejected', () => {
  // Two features claim the same path with no ownership resolution
  const features = [{ id: 'a', paths: ['src/shared.ts'] }, { id: 'b', paths: ['src/shared.ts'] }]
  const result = validateGraph(features, [])
  assert.equal(result.verdict, GRAPH_VERDICTS.INVALID)
  assert.ok(result.errors.some((e) => e.type === 'ownership-overlap'))
})

test('validateGraph: explained ownership overlap allowed with warning', () => {
  // Two features claim the same path, but ownershipMap resolves it to one
  const features = [{ id: 'a', paths: ['src/shared.ts'] }, { id: 'b', paths: ['src/shared.ts'] }]
  const ownershipMap = { 'src/shared.ts': 'a' }
  const result = validateGraph(features, [], ownershipMap)
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
  assert.ok(result.warnings.some((w) => w.type === 'ownership-overlap-explained'))
})

test('validateGraph: empty features and edges is valid', () => {
  const result = validateGraph([], [])
  assert.equal(result.verdict, GRAPH_VERDICTS.VALID)
})

// ---- graphDigest ----

test('graphDigest: deterministic — same graph same digest', () => {
  const features = [{ id: 'a', paths: ['x'] }, { id: 'b', paths: ['y'] }]
  const edges = [{ from: 'a', to: 'b' }]
  const d1 = graphDigest(features, edges)
  const d2 = graphDigest(features, edges)
  assert.equal(d1, d2)
})

test('graphDigest: reordered features produce same digest', () => {
  const f1 = [{ id: 'a', paths: ['x'] }, { id: 'b', paths: ['y'] }]
  const f2 = [{ id: 'b', paths: ['y'] }, { id: 'a', paths: ['x'] }]
  const edges = []
  assert.equal(graphDigest(f1, edges), graphDigest(f2, edges))
})

test('graphDigest: different graph produces different digest', () => {
  const features1 = [{ id: 'a', paths: ['x'] }]
  const features2 = [{ id: 'b', paths: ['x'] }]
  assert.notEqual(graphDigest(features1, []), graphDigest(features2, []))
})

test('graphDigest: edge change detected', () => {
  const features = [{ id: 'a', paths: [] }, { id: 'b', paths: [] }]
  const d1 = graphDigest(features, [{ from: 'a', to: 'b' }])
  const d2 = graphDigest(features, [{ from: 'b', to: 'a' }])
  assert.notEqual(d1, d2)
})
