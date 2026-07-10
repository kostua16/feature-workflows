// Tests for the selective stage-execution helpers: normalizeGateTarget (--from-gate
// canonicalization), resetStageForRerun (--stage re-arm semantics), and the new
// LOOPBACK_FLAG_MAP.execute entry driven through clearGateAndDownstream.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { normalizeGateTarget, resetStageForRerun, clearGateAndDownstream, LOOPBACK_FLAG_MAP } = engine

const threeStageResult = () => ({
  planned: true,
  designReady: true,
  executed: true,
  testsPassed: true,
  ready: true,
  codeReview: { blockers: [] },
  _goalkeeper: { decision: 'commit' },
  _loopBack: null,
  stages: [
    { id: 'stage01', name: 'a', status: 'done', files: ['a.py'] },
    { id: 'stage02', name: 'b', status: 'done', files: ['b.py'] },
    { id: 'stage03', name: 'c', status: 'done', files: ['c.py'] },
  ],
})

// ---- normalizeGateTarget --------------------------------------------------------

test('normalizeGateTarget: canonical names pass through', () => {
  for (const gate of ['requirements', 'architecture', 'design', 'plan', 'tests', 'execute']) {
    assert.equal(normalizeGateTarget(gate), gate)
  }
})

test('normalizeGateTarget: aliases and casing are canonicalized', () => {
  assert.equal(normalizeGateTarget('arch'), 'architecture')
  assert.equal(normalizeGateTarget('test'), 'tests')
  assert.equal(normalizeGateTarget('exec'), 'execute')
  assert.equal(normalizeGateTarget('  Plan '), 'plan')
})

test('normalizeGateTarget: unknown/empty input returns null', () => {
  assert.equal(normalizeGateTarget('deploy'), null)
  assert.equal(normalizeGateTarget(''), null)
  assert.equal(normalizeGateTarget(undefined), null)
})

// ---- resetStageForRerun -----------------------------------------------------------

test('resetStageForRerun: flips only the target stage to pending', () => {
  const result = threeStageResult()
  assert.equal(resetStageForRerun(result, 'stage02'), true)
  assert.equal(result.stages[0].status, 'done')
  assert.equal(result.stages[1].status, 'pending')
  assert.equal(result.stages[2].status, 'done')
})

test('resetStageForRerun: stale post-execute verdicts cannot survive a stage re-run', () => {
  const result = threeStageResult()
  resetStageForRerun(result, 'stage01')
  assert.equal(result.executed, null)
  assert.equal(result.testsPassed, false)
  assert.equal(result.ready, false)
  assert.equal(result.codeReview, null)
  assert.equal(result._goalkeeper, null)
})

test('resetStageForRerun: leaves design progress intact', () => {
  const result = threeStageResult()
  resetStageForRerun(result, 'stage01')
  assert.equal(result.planned, true)
  assert.equal(result.designReady, true)
})

test('resetStageForRerun: unknown stage id returns false and mutates nothing', () => {
  const result = threeStageResult()
  assert.equal(resetStageForRerun(result, 'stage99'), false)
  assert.equal(result.executed, true)
  assert.ok(result.stages.every((st) => st.status === 'done'))
})

test('resetStageForRerun: tolerates missing stages array', () => {
  assert.equal(resetStageForRerun({}, 'stage01'), false)
  assert.equal(resetStageForRerun(null, 'stage01'), false)
})

// ---- LOOPBACK_FLAG_MAP.execute via clearGateAndDownstream ---------------------------

test('clearGateAndDownstream(execute): clears exactly the post-design flags', () => {
  const result = threeStageResult()
  clearGateAndDownstream(result, 'execute')
  assert.equal(result.executed, null)
  assert.equal(result.testsPassed, false)
  assert.equal(result.ready, false)
  assert.equal(result.codeReview, null)
  assert.equal(result._goalkeeper, null)
  // Design progress is NOT execute-downstream — it must survive the rewind.
  assert.equal(result.planned, true)
  assert.equal(result.designReady, true)
})

test('LOOPBACK_FLAG_MAP: execute entry exists and excludes design flags', () => {
  assert.ok(Array.isArray(LOOPBACK_FLAG_MAP.execute))
  assert.ok(LOOPBACK_FLAG_MAP.execute.includes('executed'))
  assert.ok(!LOOPBACK_FLAG_MAP.execute.includes('planned'))
  assert.ok(!LOOPBACK_FLAG_MAP.execute.includes('designPath'))
})
