// Phase 2 INV-01: Deterministic repository inventory tests.
// All functions are pure, deterministic, and carry no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  PATH_POLICIES,
  classifyPath,
  buildInventory,
  inventoryDigest,
  refineOversizedArea,
} = engine

// ---- PATH_POLICIES ----

test('PATH_POLICIES: has exactly 5 policy values', () => {
  const values = Object.values(PATH_POLICIES)
  assert.equal(values.length, 5)
  assert.ok(values.includes('included'))
  assert.ok(values.includes('excluded'))
  assert.ok(values.includes('generated'))
  assert.ok(values.includes('vendor'))
  assert.ok(values.includes('ignored'))
})

// ---- classifyPath ----

test('classifyPath: source file defaults to included', () => {
  const result = classifyPath('src/index.ts')
  assert.equal(result.verdict, PATH_POLICIES.INCLUDED)
})

test('classifyPath: node_modules classified as generated', () => {
  const result = classifyPath('node_modules/express/index.js')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
  assert.equal(result.policy, 'generated')
})

test('classifyPath: vendor directory classified as vendor', () => {
  const result = classifyPath('vendor/lib/foo.go')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
  assert.equal(result.policy, 'vendor')
})

test('classifyPath: .git directory classified as ignored', () => {
  const result = classifyPath('.git/config')
  assert.equal(result.verdict, PATH_POLICIES.IGNORED)
})

test('classifyPath: dist directory classified as generated', () => {
  const result = classifyPath('dist/bundle.js')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
})

test('classifyPath: minified file classified as generated', () => {
  const result = classifyPath('public/app.min.js')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
})

test('classifyPath: exclude pattern works', () => {
  const result = classifyPath('src/legacy/old.ts', { excludePatterns: ['legacy/'] })
  assert.equal(result.verdict, PATH_POLICIES.EXCLUDED)
})

test('classifyPath: include pattern overrides default', () => {
  const result = classifyPath('special/generated/handler.ts', { includePatterns: ['special/'] })
  assert.equal(result.verdict, PATH_POLICIES.INCLUDED)
})

test('classifyPath: non-string path returns excluded', () => {
  const result = classifyPath(null)
  assert.equal(result.verdict, PATH_POLICIES.EXCLUDED)
})

test('classifyPath: deterministic — same path same verdict', () => {
  const r1 = classifyPath('src/components/Button.tsx')
  const r2 = classifyPath('src/components/Button.tsx')
  assert.deepEqual(r1, r2)
})

// ---- buildInventory ----

test('buildInventory: deterministic — reordered traversal produces identical digest', () => {
  const paths1 = ['src/a.ts', 'src/b.ts', 'node_modules/x.js', '.git/config']
  const paths2 = ['.git/config', 'node_modules/x.js', 'src/b.ts', 'src/a.ts']
  const inv1 = buildInventory(paths1)
  const inv2 = buildInventory(paths2)
  assert.equal(inv1.digest, inv2.digest,
    'Reordered traversal must produce identical digest')
})

test('buildInventory: counts are correct', () => {
  const inv = buildInventory([
    'src/a.ts', 'src/b.ts',
    'node_modules/x.js',
    '.git/config',
    'vendor/lib.go',
  ])
  assert.equal(inv.counts.included, 2)
  assert.equal(inv.counts.generated, 1)
  assert.equal(inv.counts.vendor, 1)
  assert.equal(inv.counts.ignored, 1)
})

test('buildInventory: same paths produce same digest across calls', () => {
  const paths = ['src/a.ts', 'src/b.ts', 'tests/c.ts']
  const inv1 = buildInventory(paths)
  const inv2 = buildInventory(paths)
  assert.equal(inv1.digest, inv2.digest)
})

test('buildInventory: different paths produce different digests', () => {
  const inv1 = buildInventory(['src/a.ts'])
  const inv2 = buildInventory(['src/b.ts'])
  assert.notEqual(inv1.digest, inv2.digest)
})

test('buildInventory: throws on non-array', () => {
  assert.throws(() => buildInventory('not-array'), /must be an array/)
})

test('buildInventory: empty paths produce empty entries', () => {
  const inv = buildInventory([])
  assert.equal(inv.entries.length, 0)
  assert.equal(inv.counts.included, 0)
})

// ---- inventoryDigest ----

test('inventoryDigest: stable for same entries', () => {
  const entries = [
    { path: 'src/a.ts', verdict: 'included' },
    { path: 'src/b.ts', verdict: 'included' },
  ]
  const d1 = inventoryDigest({ entries })
  const d2 = inventoryDigest({ entries })
  assert.equal(d1, d2)
})

test('inventoryDigest: changes when path added', () => {
  const entries1 = [{ path: 'src/a.ts', verdict: 'included' }]
  const entries2 = [{ path: 'src/a.ts', verdict: 'included' }, { path: 'src/b.ts', verdict: 'included' }]
  assert.notEqual(inventoryDigest({ entries: entries1 }), inventoryDigest({ entries: entries2 }))
})

test('inventoryDigest: changes when verdict changes', () => {
  const e1 = [{ path: 'src/a.ts', verdict: 'included' }]
  const e2 = [{ path: 'src/a.ts', verdict: 'excluded' }]
  assert.notEqual(inventoryDigest({ entries: e1 }), inventoryDigest({ entries: e2 }))
})

// ---- refineOversizedArea ----

test('refineOversizedArea: under limit stays as one page', () => {
  const area = { name: 'comp', paths: ['a', 'b', 'c'] }
  const pages = refineOversizedArea(area, 10)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].paths.length, 3)
  assert.equal(pages[0].depth, 0)
})

test('refineOversizedArea: over limit splits recursively', () => {
  const paths = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`)
  const area = { name: 'large', paths }
  const pages = refineOversizedArea(area, 5)
  assert.ok(pages.length > 1, 'Should split into multiple pages')
  // Every page must be within the limit
  for (const p of pages) {
    assert.ok(p.paths.length <= 5, `Page ${p.name} has ${p.paths.length} paths (limit 5)`)
  }
})

test('refineOversizedArea: total paths preserved after split', () => {
  const paths = Array.from({ length: 17 }, (_, i) => `src/mod${i}.ts`)
  const area = { name: 'big', paths }
  const pages = refineOversizedArea(area, 4)
  const totalPaths = pages.reduce((sum, p) => sum + p.paths.length, 0)
  assert.equal(totalPaths, 17, 'All paths must be preserved after refinement')
})

test('refineOversizedArea: no path appears in two pages', () => {
  const paths = Array.from({ length: 15 }, (_, i) => `src/item${i}.ts`)
  const area = { name: 'split', paths }
  const pages = refineOversizedArea(area, 3)
  const allPaths = pages.flatMap((p) => p.paths)
  const uniquePaths = new Set(allPaths)
  assert.equal(allPaths.length, uniquePaths.size, 'No duplicate paths across pages')
})

test('refineOversizedArea: deterministic — same input same output', () => {
  const paths = Array.from({ length: 10 }, (_, i) => `f${i}.ts`)
  const area = { name: 'det', paths }
  const p1 = refineOversizedArea(area, 3)
  const p2 = refineOversizedArea(area, 3)
  assert.deepEqual(p1, p2)
})

test('refineOversizedArea: throws on invalid maxPathsPerPage', () => {
  assert.throws(() => refineOversizedArea({ name: 'x', paths: [] }, 0), /positive number/)
  assert.throws(() => refineOversizedArea({ name: 'x', paths: [] }, -1), /positive number/)
})
