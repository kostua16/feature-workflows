// Phase 1 REV-01: Selective revision invalidation tests.
// Tests: computeDigest, computeContentDigest, compareRevisions, selectiveInvalidate, retainValidEvidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  REVISION_INPUTS,
  GATE_DEPENDENCY_MAP,
  computeDigest,
  computeContentDigest,
  compareRevisions,
  selectiveInvalidate,
  retainValidEvidence,
} = engine

// ---- computeDigest ----

test('computeDigest: deterministic — same input produces same digest', () => {
  const a = computeDigest('hello world')
  const b = computeDigest('hello world')
  assert.equal(a, b)
  assert.equal(typeof a, 'string')
  assert.ok(a.length > 0)
})

test('computeDigest: content-sensitive — different inputs produce different digests', () => {
  const a = computeDigest('hello world')
  const b = computeDigest('goodbye world')
  assert.notEqual(a, b)
})

test('computeDigest: handles null/undefined without throwing', () => {
  assert.equal(typeof computeDigest(null), 'string')
  assert.equal(typeof computeDigest(undefined), 'string')
  assert.equal(typeof computeDigest(''), 'string')
})

// ---- computeContentDigest ----

test('computeContentDigest: deterministic for objects regardless of key order', () => {
  const a = computeContentDigest({ x: 1, y: 2 })
  const b = computeContentDigest({ y: 2, x: 1 })
  assert.equal(a, b, 'key order must not affect digest')
})

test('computeContentDigest: different content produces different digests', () => {
  const a = computeContentDigest({ x: 1 })
  const b = computeContentDigest({ x: 2 })
  assert.notEqual(a, b)
})

// ---- compareRevisions ----

test('compareRevisions: no changes returns empty affected sets', () => {
  const old = { source: 'abc', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const newR = { source: 'abc', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const delta = compareRevisions(old, newR)
  assert.equal(delta.affectedGates.length, 0)
  assert.equal(delta.changedInputs.length, 0)
})

test('compareRevisions: source change affects codeFacts and arch gates', () => {
  const old = { source: 'abc', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const newR = { source: 'CHANGED', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(delta.changedInputs.includes('source'))
})

test('compareRevisions: scope change affects only codeFacts gate', () => {
  const old = { source: 'abc', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const newR = { source: 'abc', scope: 'CHANGED', graph: 'ghi', deps: 'jkl' }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(!delta.affectedGates.includes('arch'), 'arch should NOT be affected by scope change alone')
})

test('compareRevisions: graph change affects arch gate', () => {
  const old = { source: 'abc', scope: 'def', graph: 'ghi', deps: 'jkl' }
  const newR = { source: 'abc', scope: 'def', graph: 'CHANGED', deps: 'jkl' }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(!delta.affectedGates.includes('codeFacts'), 'codeFacts should NOT be affected by graph change')
})

test('compareRevisions: artifact change affects only the owning gate', () => {
  const old = {
    source: 'abc',
    artifacts: { design: 'd1', plan: 'p1', tests: 't1' },
  }
  const newR = {
    source: 'abc',
    artifacts: { design: 'd1', plan: 'p1-CHANGED', tests: 't1' },
  }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('plan'))
  assert.ok(!delta.affectedGates.includes('design'), 'design should NOT be affected')
  assert.ok(!delta.affectedGates.includes('tests'), 'tests should NOT be affected')
})

test('compareRevisions: null inputs handled gracefully', () => {
  const delta = compareRevisions(null, null)
  assert.ok(delta.affectedGates.length >= 0)
  assert.ok(delta.changedInputs.length >= 0)
})

// ---- selectiveInvalidate ----

test('selectiveInvalidate: invalidates only affected gates', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
      design: { digest: 'd3', valid: true },
      plan: { digest: 'd4', valid: true },
    },
  }
  const delta = { affectedGates: ['codeFacts'], changedInputs: ['source'] }
  const result = selectiveInvalidate(shard, delta)
  assert.equal(result.gates.codeFacts.valid, false)
  assert.equal(result.gates.arch.valid, true, 'arch should remain valid')
  assert.equal(result.gates.design.valid, true)
  assert.equal(result.gates.plan.valid, true)
})

test('selectiveInvalidate: does NOT mutate input shard', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
    },
  }
  const snapshot = JSON.parse(JSON.stringify(shard))
  selectiveInvalidate(shard, { affectedGates: ['codeFacts'], changedInputs: ['source'] })
  assert.deepEqual(shard, snapshot, 'input shard must not be mutated')
})

test('selectiveInvalidate: empty delta retains all evidence', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
    },
  }
  const result = selectiveInvalidate(shard, { affectedGates: [], changedInputs: [] })
  assert.equal(result.gates.codeFacts.valid, true)
  assert.equal(result.gates.arch.valid, true)
})

test('selectiveInvalidate: invalidates multiple affected gates', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
      design: { digest: 'd3', valid: true },
    },
  }
  const delta = { affectedGates: ['codeFacts', 'arch'], changedInputs: ['source'] }
  const result = selectiveInvalidate(shard, delta)
  assert.equal(result.gates.codeFacts.valid, false)
  assert.equal(result.gates.arch.valid, false)
  assert.equal(result.gates.design.valid, true, 'design should remain valid')
})

test('selectiveInvalidate: sets invalidReason on invalidated gates', () => {
  const shard = {
    gates: { codeFacts: { digest: 'd1', valid: true } },
  }
  const result = selectiveInvalidate(shard, { affectedGates: ['codeFacts'], changedInputs: ['source'] })
  assert.equal(result.gates.codeFacts.invalidReason, 'revision-changed')
})

// ---- retainValidEvidence ----

test('retainValidEvidence: returns only gates still valid', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: false, invalidReason: 'revision-changed' },
      arch: { digest: 'd2', valid: true },
      design: { digest: 'd3', valid: true },
    },
  }
  const result = retainValidEvidence(shard)
  assert.ok(result.gates.arch, 'valid gate should be retained')
  assert.ok(result.gates.design, 'valid gate should be retained')
  assert.ok(!result.gates.codeFacts, 'invalid gate should be filtered out')
})

test('retainValidEvidence: all gates valid returns all', () => {
  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
    },
  }
  const result = retainValidEvidence(shard)
  assert.equal(Object.keys(result.gates).length, 2)
})

test('retainValidEvidence: empty shard returns empty gates', () => {
  const result = retainValidEvidence({ gates: {} })
  assert.equal(Object.keys(result.gates).length, 0)
})

test('retainValidEvidence: null input returns empty gates', () => {
  const result = retainValidEvidence(null)
  assert.ok(result.gates)
  assert.equal(Object.keys(result.gates).length, 0)
})

// ---- Integration: compareRevisions -> selectiveInvalidate -> retainValidEvidence ----

test('integration: source change flow preserves independent evidence', () => {
  const oldRevisions = {
    source: 'src-v1', scope: 'scope-v1', graph: 'graph-v1', deps: 'deps-v1',
    artifacts: { design: 'd1', plan: 'p1' },
  }
  const newRevisions = {
    source: 'src-v2', scope: 'scope-v1', graph: 'graph-v1', deps: 'deps-v1',
    artifacts: { design: 'd1', plan: 'p1' },
  }

  // Step 1: compare
  const delta = compareRevisions(oldRevisions, newRevisions)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(!delta.affectedGates.includes('design'))
  assert.ok(!delta.affectedGates.includes('plan'))

  // Step 2: selectively invalidate
  const shard = {
    gates: {
      codeFacts: { digest: 'src-v1', valid: true },
      arch: { digest: 'src-v1', valid: true },
      design: { digest: 'd1', valid: true },
      plan: { digest: 'p1', valid: true },
    },
  }
  const invalidated = selectiveInvalidate(shard, delta)
  assert.equal(invalidated.gates.codeFacts.valid, false)
  assert.equal(invalidated.gates.arch.valid, false)
  assert.equal(invalidated.gates.design.valid, true)
  assert.equal(invalidated.gates.plan.valid, true)

  // Step 3: retain valid evidence
  const retained = retainValidEvidence(invalidated)
  assert.ok(retained.gates.design, 'design evidence retained')
  assert.ok(retained.gates.plan, 'plan evidence retained')
  assert.ok(!retained.gates.codeFacts, 'invalidated codeFacts not retained')
  assert.ok(!retained.gates.arch, 'invalidated arch not retained')
})
