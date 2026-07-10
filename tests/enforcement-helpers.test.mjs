// Tests for the enforcement/improvement helpers:
//   EN-4 verifyAppendGrowth, EN-5 detectOwnershipViolations, IM-3 compactList.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { verifyAppendGrowth, detectOwnershipViolations, normalizePath, compactList } = engine

// ---- EN-4: verifyAppendGrowth ----------------------------------------------

test('verifyAppendGrowth: first write records size, no warning', () => {
  const result = {}
  const g = verifyAppendGrowth(result, 'a.md', { ok: true, totalBytes: 100 })
  assert.equal(g.ok, true)
  assert.equal(g.prev, null)
  assert.equal(result._appendSizes['a.md'], 100)
  assert.equal(result.appendWarnings, undefined)
})

test('verifyAppendGrowth: a grown file passes', () => {
  const result = { _appendSizes: { 'a.md': 100 } }
  const g = verifyAppendGrowth(result, 'a.md', { ok: true, totalBytes: 180 })
  assert.equal(g.ok, true)
  assert.equal(result._appendSizes['a.md'], 180)
  assert.equal(result.appendWarnings, undefined)
})

test('verifyAppendGrowth: a shrunk/equal file is flagged as a possible overwrite', () => {
  const result = { _appendSizes: { 'a.md': 200 } }
  const g = verifyAppendGrowth(result, 'a.md', { ok: true, totalBytes: 50 })
  assert.equal(g.ok, false)
  assert.equal(g.shrank, true)
  assert.ok(result.appendWarnings.some((w) => w.includes('a.md')))
})

test('verifyAppendGrowth: equal size (no-op append) is also flagged', () => {
  const result = { _appendSizes: { 'a.md': 200 } }
  const g = verifyAppendGrowth(result, 'a.md', { ok: true, totalBytes: 200 })
  assert.equal(g.ok, false)
})

test('verifyAppendGrowth: missing totalBytes cannot be checked (unknown, no warning)', () => {
  const result = { _appendSizes: { 'a.md': 200 } }
  const g = verifyAppendGrowth(result, 'a.md', { ok: true })
  assert.equal(g.unknown, true)
  assert.equal(result._appendSizes['a.md'], 200) // unchanged
  assert.equal(result.appendWarnings, undefined)
})

test('verifyAppendGrowth: null result is a safe no-op', () => {
  assert.deepEqual(verifyAppendGrowth(null, 'a.md', { totalBytes: 1 }), { ok: true, unknown: true })
})

// ---- EN-5: detectOwnershipViolations ---------------------------------------

test('detectOwnershipViolations: clean disjoint lanes report nothing', () => {
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['a.js'], touched: ['a.js'] },
    { name: 'l2', owned: ['b.js'], touched: ['b.js'] },
  ])
  assert.deepEqual(v.outOfLane, [])
  assert.deepEqual(v.crossOverlap, [])
})

test('detectOwnershipViolations: out-of-lane touch is flagged', () => {
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['a.js'], touched: ['a.js', 'c.js'] },
  ])
  assert.equal(v.outOfLane.length, 1)
  assert.deepEqual(v.outOfLane[0], { unit: 'l1', file: 'c.js' })
})

test('detectOwnershipViolations: cross-lane clobber is flagged', () => {
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['shared.js'], touched: ['shared.js'] },
    { name: 'l2', owned: ['shared.js'], touched: ['shared.js'] },
  ])
  assert.equal(v.crossOverlap.length, 1)
  assert.equal(v.crossOverlap[0].file, 'shared.js')
  assert.deepEqual(v.crossOverlap[0].units, ['l1', 'l2'])
})

test('detectOwnershipViolations: empty ownership skips out-of-lane but still detects overlap', () => {
  const v = detectOwnershipViolations([
    { name: 'l1', owned: [], touched: ['x.js'] },
    { name: 'l2', owned: [], touched: ['x.js'] },
  ])
  assert.deepEqual(v.outOfLane, []) // no declared ownership to enforce
  assert.equal(v.crossOverlap.length, 1)
})

test('detectOwnershipViolations: handles empty/undefined input', () => {
  assert.deepEqual(detectOwnershipViolations([]), { outOfLane: [], crossOverlap: [] })
  assert.deepEqual(detectOwnershipViolations(undefined), { outOfLane: [], crossOverlap: [] })
})

test('detectOwnershipViolations: path surface-form differences do NOT fabricate violations', () => {
  // declared "src/a.js" vs executor-reported "./src/a.js" / "src//a.js" must match.
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['src/a.js'], touched: ['./src/a.js'] },
    { name: 'l2', owned: ['src/b.js'], touched: ['src//b.js'] },
  ])
  assert.deepEqual(v.outOfLane, [])
  assert.deepEqual(v.crossOverlap, [])
})

test('detectOwnershipViolations: normalized cross-overlap is still detected', () => {
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['src/shared.js'], touched: ['src/shared.js'] },
    { name: 'l2', owned: ['src/shared.js'], touched: ['./src/shared.js/'] },
  ])
  assert.equal(v.crossOverlap.length, 1)
  assert.equal(v.crossOverlap[0].file, 'src/shared.js')
})

// ---- EN-5: normalizePath (review feedback) ---------------------------------

test('normalizePath: strips ./, collapses //, drops trailing /, normalizes backslashes', () => {
  assert.equal(normalizePath('./src/a.js'), 'src/a.js')
  assert.equal(normalizePath('src//a.js'), 'src/a.js')
  assert.equal(normalizePath('src/a.js/'), 'src/a.js')
  assert.equal(normalizePath('src\\a.js'), 'src/a.js')
})

test('normalizePath: preserves ../ (a parent-dir file is a DISTINCT file, not a variant)', () => {
  assert.equal(normalizePath('../src/a.js'), '../src/a.js')
  assert.notEqual(normalizePath('../a.js'), normalizePath('a.js'))
})

test('detectOwnershipViolations: ../ file is NOT collapsed into a same-name in-lane file', () => {
  // unit owns a.js and touches the genuinely out-of-lane ../a.js — must be flagged, not merged.
  const v = detectOwnershipViolations([
    { name: 'l1', owned: ['a.js'], touched: ['a.js', '../a.js'] },
  ])
  assert.deepEqual(v.outOfLane, [{ unit: 'l1', file: '../a.js' }])
})

test('normalizePath: preserves case (case-sensitive FS safety)', () => {
  assert.equal(normalizePath('src/Foo.js'), 'src/Foo.js')
  assert.notEqual(normalizePath('src/Foo.js'), normalizePath('src/foo.js'))
})

test('normalizePath: null/empty are safe', () => {
  assert.equal(normalizePath(null), '')
  assert.equal(normalizePath('  x.js  '), 'x.js')
})

// ---- IM-3: compactList ------------------------------------------------------

test('compactList: renders all items under the cap', () => {
  assert.equal(compactList(['a', 'b'], 5), '- a\n- b')
})

test('compactList: truncates with a "+K more" tail over the cap', () => {
  const out = compactList(['a', 'b', 'c', 'd'], 2)
  assert.ok(out.includes('- a'))
  assert.ok(out.includes('- b'))
  assert.ok(out.includes('+2 more'))
  assert.ok(!out.includes('- c'))
})

test('compactList: stringifies object items', () => {
  assert.equal(compactList([{ x: 1 }], 5), '- {"x":1}')
})

test('compactList: empty/non-array inputs are safe', () => {
  assert.equal(compactList([], 5), '- (none)')
  assert.equal(compactList(null, 5), '- (none)')
  assert.equal(compactList('solo', 5), '- solo')
})
