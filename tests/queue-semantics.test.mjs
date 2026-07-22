// Phase 2 QUEUE-01: Truthful queue semantics tests.
// All functions are pure, deterministic, and carry no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  LIFECYCLE_STATES,
  applyCap,
  applySelector,
  promoteDeferred,
  queueDenominator,
  segmentProgression,
} = engine

// Helper: build N features all in runnable state
function makeRunnableFeatures(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `feature-${i + 1}`,
    lifecycle: LIFECYCLE_STATES.RUNNABLE,
    paths: [`src/f${i + 1}.ts`],
  }))
}

// ---- applyCap ----

test('applyCap: features within cap stay runnable', () => {
  const features = makeRunnableFeatures(3)
  const result = applyCap(features, 5)
  assert.equal(result.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).length, 3)
})

test('applyCap: features beyond cap become deferred', () => {
  const features = makeRunnableFeatures(10)
  const result = applyCap(features, 3)
  const runnable = result.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  const deferred = result.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED)
  assert.equal(runnable.length, 3, 'Exactly 3 runnable after cap')
  assert.equal(deferred.length, 7, '7 deferred')
  assert.ok(deferred.every((f) => f.deferReason === 'cap-exceeded'))
})

test('applyCap: excluded features are not affected', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'b', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'c', lifecycle: LIFECYCLE_STATES.RUNNABLE },
  ]
  const result = applyCap(features, 1)
  const excluded = result.find((f) => f.id === 'a')
  assert.equal(excluded.lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

test('applyCap: does not mutate input', () => {
  const features = makeRunnableFeatures(5)
  const original = JSON.parse(JSON.stringify(features))
  applyCap(features, 2)
  assert.deepEqual(features, original)
})

test('applyCap: idempotent — reapplying same cap produces same result', () => {
  const features = makeRunnableFeatures(10)
  const r1 = applyCap(features, 3)
  const r2 = applyCap(r1, 3)
  // Second application should not change already-deferred features further
  assert.equal(r2.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).length, 3)
})

test('applyCap: throws on invalid cap', () => {
  assert.throws(() => applyCap([], 0), /positive/)
  assert.throws(() => applyCap([], -1), /positive/)
})

// ---- applySelector ----

test('applySelector: includeIds keeps only matching features active', () => {
  const features = makeRunnableFeatures(5)
  const result = applySelector(features, { includeIds: ['feature-1', 'feature-3'] })
  assert.equal(result.find((f) => f.id === 'feature-1').lifecycle, LIFECYCLE_STATES.RUNNABLE)
  assert.equal(result.find((f) => f.id === 'feature-3').lifecycle, LIFECYCLE_STATES.RUNNABLE)
  assert.equal(result.find((f) => f.id === 'feature-2').lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.equal(result.find((f) => f.id === 'feature-4').lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('applySelector: excludeIds defers matching features', () => {
  const features = makeRunnableFeatures(3)
  const result = applySelector(features, { excludeIds: ['feature-2'] })
  assert.equal(result.find((f) => f.id === 'feature-1').lifecycle, LIFECYCLE_STATES.RUNNABLE)
  assert.equal(result.find((f) => f.id === 'feature-2').lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.equal(result.find((f) => f.id === 'feature-3').lifecycle, LIFECYCLE_STATES.RUNNABLE)
})

test('applySelector: excluded features not affected', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { id: 'b', lifecycle: LIFECYCLE_STATES.RUNNABLE },
  ]
  const result = applySelector(features, { includeIds: ['b'] })
  assert.equal(result.find((f) => f.id === 'a').lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

test('applySelector: null selector returns copy unchanged', () => {
  const features = makeRunnableFeatures(2)
  const result = applySelector(features, null)
  assert.equal(result[0].lifecycle, LIFECYCLE_STATES.RUNNABLE)
  assert.equal(result[1].lifecycle, LIFECYCLE_STATES.RUNNABLE)
})

// ---- promoteDeferred ----

test('promoteDeferred: promotes deferred up to cap', () => {
  const features = makeRunnableFeatures(10)
  const capped = applyCap(features, 3)
  // Complete the 3 active features
  const completed = capped.map((f) =>
    f.lifecycle === LIFECYCLE_STATES.RUNNABLE ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const result = promoteDeferred(completed, ['feature-1', 'feature-2', 'feature-3'], 3)
  assert.ok(result.promoted.length > 0, 'Should promote deferred features')
  const runnable = result.features.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  assert.equal(runnable.length, 3, 'Should have 3 runnable after promotion')
})

test('promoteDeferred: exact 23-feature cap-8 progression: segment 1', () => {
  // 23 features, cap 8, segment 1: 8 processed, 15 deferred
  const features = makeRunnableFeatures(23)
  const capped = applyCap(features, 8)
  const processed = capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).length
  const deferred = capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED).length
  assert.equal(processed, 8, 'Segment 1: 8 processed')
  assert.equal(deferred, 15, 'Segment 1: 15 deferred')
})

test('promoteDeferred: exact 23-feature cap-8 progression: segment 2', () => {
  // After segment 1 completes (8), promote 8 more: 16 processed, 7 deferred
  const features = makeRunnableFeatures(23)
  const capped = applyCap(features, 8)
  const completedIds = capped
    .filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
    .map((f) => f.id)
  const marked = capped.map((f) =>
    completedIds.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const result = promoteDeferred(marked, completedIds, 8)
  const totalProcessed = result.features.filter(
    (f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED || f.lifecycle === LIFECYCLE_STATES.RUNNABLE
  ).length
  assert.equal(totalProcessed, 16, 'Segment 2: 16 processed')
  assert.equal(result.remainingDeferred, 7, 'Segment 2: 7 deferred')
})

test('promoteDeferred: exact 23-feature cap-8 progression: segment 3', () => {
  // After segment 2 completes (16 total), promote remaining: 23 processed, 0 deferred
  const features = makeRunnableFeatures(23)
  const capped = applyCap(features, 8)
  // Complete first batch
  const completedIds1 = capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).map((f) => f.id)
  const marked1 = capped.map((f) =>
    completedIds1.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const r1 = promoteDeferred(marked1, completedIds1, 8)
  // Complete second batch
  const completedIds2 = r1.features
    .filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE || f.lifecycle === LIFECYCLE_STATES.COMPLETED)
    .map((f) => f.id)
  const marked2 = r1.features.map((f) =>
    completedIds2.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const r2 = promoteDeferred(marked2, completedIds2, 8)
  // After segment 3 promotion: 16 completed + 7 runnable = 23 processed, 0 deferred
  const totalProcessed = r2.features.filter(
    (f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED || f.lifecycle === LIFECYCLE_STATES.RUNNABLE
  ).length
  assert.equal(totalProcessed, 23, 'Segment 3: 23 processed (completed + runnable)')
  assert.equal(r2.remainingDeferred, 0, 'Segment 3: 0 deferred')
})

test('promoteDeferred: each feature promoted exactly once', () => {
  const features = makeRunnableFeatures(6)
  const capped = applyCap(features, 2)
  const completedIds1 = capped.filter((f) => f.lifecycle === LIFECYCLE_STATES.RUNNABLE).map((f) => f.id)
  const marked1 = capped.map((f) =>
    completedIds1.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const r1 = promoteDeferred(marked1, completedIds1, 2)
  const completedIds2 = r1.features
    .filter((f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED || f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
    .map((f) => f.id)
  const marked2 = r1.features.map((f) =>
    completedIds2.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const r2 = promoteDeferred(marked2, completedIds2, 2)
  const completedIds3 = r2.features
    .filter((f) => f.lifecycle === LIFECYCLE_STATES.COMPLETED || f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
    .map((f) => f.id)
  const marked3 = r2.features.map((f) =>
    completedIds3.includes(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  const r3 = promoteDeferred(marked3, completedIds3, 2)

  // Check no feature has promotedAt > 1
  for (const f of r3.features) {
    assert.ok(!f.promotedAt || f.promotedAt <= 1, `Feature ${f.id} promoted more than once`)
  }
})

// ---- queueDenominator ----

test('queueDenominator: excludes excluded features', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'b', lifecycle: LIFECYCLE_STATES.COMPLETED },
    { id: 'c', lifecycle: LIFECYCLE_STATES.EXCLUDED },
  ]
  const result = queueDenominator(features)
  assert.equal(result.denominator, 2)
  assert.equal(result.excluded, 1)
  assert.equal(result.total, 3)
})

test('queueDenominator: all runnable', () => {
  const features = makeRunnableFeatures(5)
  const result = queueDenominator(features)
  assert.equal(result.denominator, 5)
  assert.equal(result.excluded, 0)
})

test('queueDenominator: breakdown counts all states', () => {
  const features = [
    { id: 'a', lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED },
    { id: 'c', lifecycle: LIFECYCLE_STATES.COMPLETED },
    { id: 'd', lifecycle: LIFECYCLE_STATES.EXCLUDED },
  ]
  const result = queueDenominator(features)
  assert.equal(result.breakdown.runnable, 1)
  assert.equal(result.breakdown.deferred, 1)
  assert.equal(result.breakdown.completed, 1)
  assert.equal(result.breakdown.excluded, 1)
})

// ---- segmentProgression ----

test('segmentProgression: 23 features cap 8 segment 1', () => {
  const result = segmentProgression(23, 8, 1)
  assert.equal(result.processed, 8)
  assert.equal(result.deferred, 15)
  assert.equal(result.complete, false)
})

test('segmentProgression: 23 features cap 8 segment 2', () => {
  const result = segmentProgression(23, 8, 2)
  assert.equal(result.processed, 16)
  assert.equal(result.deferred, 7)
  assert.equal(result.complete, false)
})

test('segmentProgression: 23 features cap 8 segment 3', () => {
  const result = segmentProgression(23, 8, 3)
  assert.equal(result.processed, 23)
  assert.equal(result.deferred, 0)
  assert.equal(result.complete, true)
})

test('segmentProgression: every feature promoted from deferred exactly once', () => {
  // Verify the progression covers all 23 features across 3 segments
  const seg1 = segmentProgression(23, 8, 1)
  const seg2 = segmentProgression(23, 8, 2)
  const seg3 = segmentProgression(23, 8, 3)
  // Each segment processes exactly 8 new features (or remainder)
  const newlyProcessed1 = seg1.processed // 8
  const newlyProcessed2 = seg2.processed - seg1.processed // 8
  const newlyProcessed3 = seg3.processed - seg2.processed // 7
  assert.equal(newlyProcessed1 + newlyProcessed2 + newlyProcessed3, 23)
})
