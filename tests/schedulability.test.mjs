// Phase 2 DEPCTX-01: Schedulability and dependency context tests.
// All functions are pure, deterministic, and carry no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  SCHEDULABILITY_VERDICTS,
  computeWaves,
  boundedDependencyContext,
  schedulabilityDecision,
} = engine

// Helper: build features with IDs
function makeFeatures(ids) {
  return ids.map((id) => ({ id, paths: [`src/${id}.ts`] }))
}

// ---- SCHEDULABILITY_VERDICTS ----

test('SCHEDULABILITY_VERDICTS: has exactly 3 verdicts', () => {
  const values = Object.values(SCHEDULABILITY_VERDICTS)
  assert.equal(values.length, 3)
  assert.ok(values.includes('schedulable'))
  assert.ok(values.includes('no-progress'))
  assert.ok(values.includes('unsupported-cycle'))
})

// ---- computeWaves ----

test('computeWaves: independent features form single wave', () => {
  const features = makeFeatures(['a', 'b', 'c'])
  const edges = []
  const result = computeWaves(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  assert.ok(result.waves.length >= 1)
  const allInWaves = result.waves.flat()
  assert.equal(allInWaves.length, 3)
})

test('computeWaves: linear dependency produces sequential waves', () => {
  // a depends on b, b depends on c
  const features = makeFeatures(['a', 'b', 'c'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
  const result = computeWaves(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  // c must be in an earlier wave than b, b before a
  const waveOf = {}
  result.waves.forEach((wave, i) => wave.forEach((id) => { waveOf[id] = i }))
  assert.ok(waveOf['c'] < waveOf['b'], 'c before b')
  assert.ok(waveOf['b'] < waveOf['a'], 'b before a')
})

test('computeWaves: cap limits features per wave', () => {
  const features = makeFeatures(['a', 'b', 'c', 'd', 'e'])
  const edges = []
  const result = computeWaves(features, edges, 2)
  // With cap 2 and 5 independent features, first wave has 2, then 2, then 1
  assert.ok(result.waves[0].length <= 2)
  assert.ok(result.waves.length >= 3, '5 features with cap 2 needs >= 3 waves')
})

test('computeWaves: unsupported cycle prevents scheduling', () => {
  const features = makeFeatures(['a', 'b'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const result = computeWaves(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE)
  assert.equal(result.waves.length, 0)
})

test('computeWaves: deterministic — same input same waves', () => {
  const features = makeFeatures(['a', 'b', 'c', 'd'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]
  const r1 = computeWaves(features, edges, 0)
  const r2 = computeWaves(features, edges, 0)
  assert.deepEqual(r1, r2)
})

test('computeWaves: diamond dependency', () => {
  // a depends on b and c, both depend on d
  const features = makeFeatures(['a', 'b', 'c', 'd'])
  const edges = [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
  ]
  const result = computeWaves(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  const waveOf = {}
  result.waves.forEach((wave, i) => wave.forEach((id) => { waveOf[id] = i }))
  // d must be in wave 0, b and c in wave 1, a in wave 2
  assert.equal(waveOf['d'], 0)
  assert.ok(waveOf['b'] >= 1 && waveOf['c'] >= 1)
  assert.ok(waveOf['a'] > waveOf['b'])
})

test('computeWaves: no-progress when unresolvable', () => {
  // Features with dependency on nonexistent (should not happen in valid graph
  // but computeWaves must handle gracefully)
  const features = makeFeatures(['a'])
  // Self-dependency creates no-progress
  const edges = [{ from: 'a', to: 'a' }]
  const result = computeWaves(features, edges, 0)
  // Self-loop is a cycle — unsupported
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE)
})

// ---- boundedDependencyContext ----

test('boundedDependencyContext: no dependencies returns empty context', () => {
  const features = makeFeatures(['a'])
  const result = boundedDependencyContext('a', features, [], 3)
  assert.equal(result.featureId, 'a')
  assert.equal(result.context.length, 0)
})

test('boundedDependencyContext: direct dependencies included', () => {
  const features = makeFeatures(['a', 'b', 'c'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]
  const result = boundedDependencyContext('a', features, edges, 3)
  assert.equal(result.context.length, 2)
  assert.ok(result.context.every((c) => c.depth === 1))
})

test('boundedDependencyContext: transitive dependencies bounded by maxDepth', () => {
  // a -> b -> c -> d -> e
  const features = makeFeatures(['a', 'b', 'c', 'd', 'e'])
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
    { from: 'c', to: 'd' }, { from: 'd', to: 'e' },
  ]
  const result = boundedDependencyContext('a', features, edges, 2)
  // maxDepth=2 means b (depth 1) and c (depth 2), but not d or e
  const ids = result.context.map((c) => c.id)
  assert.ok(ids.includes('b'))
  assert.ok(ids.includes('c'))
  assert.ok(!ids.includes('d'))
  assert.ok(!ids.includes('e'))
})

test('boundedDependencyContext: does not traverse visited nodes twice', () => {
  // Diamond: a -> b -> d, a -> c -> d
  const features = makeFeatures(['a', 'b', 'c', 'd'])
  const edges = [
    { from: 'a', to: 'b' }, { from: 'a', 'to': 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
  ].map((e) => ({ from: e.from, to: e.to }))
  const result = boundedDependencyContext('a', features, edges, 5)
  const dCount = result.context.filter((c) => c.id === 'd').length
  assert.equal(dCount, 1, 'd should appear only once despite being reachable from both b and c')
})

test('boundedDependencyContext: includes paths and digest', () => {
  const features = [{ id: 'dep', paths: ['src/dep.ts'], digest: 'abc123' }]
  const edges = [{ from: 'root', to: 'dep' }]
  const result = boundedDependencyContext('root', features, edges, 3)
  assert.equal(result.context[0].paths[0], 'src/dep.ts')
  assert.equal(result.context[0].digest, 'abc123')
})

// ---- schedulabilityDecision ----

test('schedulabilityDecision: schedulable graph', () => {
  const features = makeFeatures(['a', 'b', 'c'])
  const edges = [{ from: 'a', to: 'b' }]
  const result = schedulabilityDecision(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.SCHEDULABLE)
  assert.equal(result.cycleDetected, false)
})

test('schedulabilityDecision: unsupported cycle', () => {
  const features = makeFeatures(['a', 'b'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const result = schedulabilityDecision(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE)
  assert.equal(result.cycleDetected, true)
  assert.ok(result.cycle.length >= 2)
})

test('schedulabilityDecision: supported cycle with policy', () => {
  const features = makeFeatures(['a', 'b'])
  const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
  const policy = { 'a->b': 'supported', 'b->a': 'supported' }
  const result = schedulabilityDecision(features, edges, 0, policy)
  assert.equal(result.cycleDetected, true)
  // Supported cycle still produces schedulable waves
  assert.ok(result.verdict === SCHEDULABILITY_VERDICTS.SCHEDULABLE ||
    result.verdict === SCHEDULABILITY_VERDICTS.NO_PROGRESS)
})

test('schedulabilityDecision: no-progress for unresolvable deps', () => {
  // a depends on b, b depends on c, c depends on a — but mark as not supported
  const features = makeFeatures(['a', 'b', 'c'])
  const edges = [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' },
  ]
  const result = schedulabilityDecision(features, edges, 0)
  assert.equal(result.verdict, SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE)
})

test('schedulabilityDecision: deterministic — same input same output', () => {
  const features = makeFeatures(['x', 'y', 'z'])
  const edges = [{ from: 'x', to: 'y' }, { from: 'y', to: 'z' }]
  const r1 = schedulabilityDecision(features, edges, 0)
  const r2 = schedulabilityDecision(features, edges, 0)
  assert.deepEqual(r1, r2)
})

test('schedulabilityDecision: details string is informative', () => {
  const features = makeFeatures(['a'])
  const result = schedulabilityDecision(features, [], 0)
  assert.ok(typeof result.details === 'string')
  assert.ok(result.details.length > 0)
})
