// Phase 2 DISC-01: Durable paginated discovery tests.
// All functions are pure, deterministic, and carry no I/O.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  buildInventory,
  createCursor,
  nextPage,
  resumeDiscovery,
  exhausted,
  allPages,
  pageDigest,
  extractFeaturesFromPages,
} = engine

// Helper: build a simple inventory from path list
function makeInventory(paths) {
  return buildInventory(paths)
}

// ---- createCursor ----

test('createCursor: initializes with offset 0', () => {
  const inv = makeInventory(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  const cursor = createCursor(inv, 2)
  assert.equal(cursor.offset, 0)
  assert.equal(cursor.pageSize, 2)
  assert.equal(cursor.totalIncluded, 3)
  assert.equal(cursor.exhausted, false)
})

test('createCursor: only includes included entries', () => {
  const inv = makeInventory(['src/a.ts', 'node_modules/b.js', 'src/c.ts', '.git/config'])
  const cursor = createCursor(inv, 10)
  assert.equal(cursor.totalIncluded, 2) // only src/a.ts and src/c.ts
})

test('createCursor: empty inventory produces exhausted cursor', () => {
  const inv = makeInventory([])
  const cursor = createCursor(inv, 5)
  assert.equal(cursor.exhausted, true)
  assert.equal(cursor.totalIncluded, 0)
})

test('createCursor: throws on invalid pageSize', () => {
  const inv = makeInventory(['src/a.ts'])
  assert.throws(() => createCursor(inv, 0), /positive/)
  assert.throws(() => createCursor(inv, -1), /positive/)
})

// ---- nextPage ----

test('nextPage: returns correct page size', () => {
  const inv = makeInventory(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])
  const cursor = createCursor(inv, 2)
  const { page, cursor: c2 } = nextPage(cursor)
  assert.equal(page.length, 2)
  assert.equal(c2.offset, 2)
  assert.equal(c2.pagesEmitted, 1)
})

test('nextPage: last page may be smaller', () => {
  const inv = makeInventory(['a.ts', 'b.ts', 'c.ts'])
  const cursor = createCursor(inv, 2)
  const r1 = nextPage(cursor)
  const r2 = nextPage(r1.cursor)
  assert.equal(r2.page.length, 1) // only 1 left
  assert.equal(r2.cursor.exhausted, true)
})

test('nextPage: exhausted cursor returns empty page', () => {
  const inv = makeInventory(['a.ts'])
  const cursor = createCursor(inv, 5)
  const r1 = nextPage(cursor)
  assert.equal(r1.cursor.exhausted, true)
  const r2 = nextPage(r1.cursor)
  assert.equal(r2.page.length, 0)
})

test('nextPage: does not duplicate or lose entries', () => {
  const paths = Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
  const inv = makeInventory(paths)
  let cursor = createCursor(inv, 3)
  const seen = new Set()
  while (!exhausted(cursor)) {
    const result = nextPage(cursor)
    if (result.page.length === 0) break
    for (const e of result.page) {
      assert.ok(!seen.has(e.path), `Duplicate entry: ${e.path}`)
      seen.add(e.path)
    }
    cursor = result.cursor
  }
  assert.equal(seen.size, 10, 'All entries must be seen exactly once')
})

// ---- resumeDiscovery ----

test('resumeDiscovery: resumes from interrupted position without gaps', () => {
  const inv = makeInventory(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  const cursor = createCursor(inv, 2)
  const r1 = nextPage(cursor) // page 1: a, b
  // Simulate interruption after page 1
  const resumed = resumeDiscovery(r1.cursor, inv.digest)
  assert.equal(resumed.stale, false)
  assert.equal(resumed.page.length, 2) // page 2: c, d
  assert.ok(resumed.cursor.exhausted)
})

test('resumeDiscovery: detects stale inventory', () => {
  const inv1 = makeInventory(['a.ts', 'b.ts'])
  const cursor = createCursor(inv1, 1)
  // Inventory changes
  const newDigest = 'different-digest'
  const resumed = resumeDiscovery(cursor, newDigest)
  assert.equal(resumed.stale, true)
  assert.equal(resumed.cursor.offset, 0) // restart
})

test('resumeDiscovery: same inventory not stale', () => {
  const inv = makeInventory(['a.ts', 'b.ts', 'c.ts'])
  const cursor = createCursor(inv, 2)
  const r1 = nextPage(cursor)
  const resumed = resumeDiscovery(r1.cursor, inv.digest)
  assert.equal(resumed.stale, false)
})

// ---- exhausted ----

test('exhausted: true when offset reaches total', () => {
  const inv = makeInventory(['a.ts', 'b.ts'])
  const cursor = createCursor(inv, 2)
  const r = nextPage(cursor)
  assert.ok(exhausted(r.cursor))
})

test('exhausted: false when entries remain', () => {
  const inv = makeInventory(['a.ts', 'b.ts', 'c.ts'])
  const cursor = createCursor(inv, 2)
  assert.ok(!exhausted(cursor))
})

test('exhausted: null cursor returns true', () => {
  assert.ok(exhausted(null))
})

// ---- allPages ----

test('allPages: covers all entries', () => {
  const paths = Array.from({ length: 7 }, (_, i) => `f${i}.ts`)
  const inv = makeInventory(paths)
  const pages = allPages(inv, 3)
  assert.equal(pages.length, 3) // 3+3+1
  const total = pages.reduce((s, p) => s + p.length, 0)
  assert.equal(total, 7)
})

test('allPages: deterministic — same inventory same pages', () => {
  const inv1 = makeInventory(['a.ts', 'b.ts', 'c.ts'])
  const inv2 = makeInventory(['c.ts', 'b.ts', 'a.ts'])
  const p1 = allPages(inv1, 2)
  const p2 = allPages(inv2, 2)
  assert.deepEqual(p1, p2)
})

// ---- pageDigest ----

test('pageDigest: deterministic for same entries', () => {
  const page = [{ path: 'a.ts', verdict: 'included' }, { path: 'b.ts', verdict: 'included' }]
  assert.equal(pageDigest(page), pageDigest(page))
})

test('pageDigest: different for different entries', () => {
  const p1 = [{ path: 'a.ts', verdict: 'included' }]
  const p2 = [{ path: 'b.ts', verdict: 'included' }]
  assert.notEqual(pageDigest(p1), pageDigest(p2))
})

// ---- extractFeaturesFromPages ----

test('extractFeaturesFromPages: groups by directory prefix', () => {
  const pages = [
    [{ path: 'src/auth/login.ts', verdict: 'included' }, { path: 'src/auth/logout.ts', verdict: 'included' }],
    [{ path: 'src/api/users.ts', verdict: 'included' }],
  ]
  const result = extractFeaturesFromPages(pages)
  assert.ok(result.features.length >= 2)
  assert.equal(result.totalFeatures, result.features.length)
})

test('extractFeaturesFromPages: deterministic — same pages same features', () => {
  const pages = [
    [{ path: 'src/a.ts', verdict: 'included' }],
  ]
  const r1 = extractFeaturesFromPages(pages)
  const r2 = extractFeaturesFromPages(pages)
  assert.deepEqual(r1, r2)
})

test('extractFeaturesFromPages: coverage digest is stable', () => {
  const pages1 = [[{ path: 'src/a.ts', verdict: 'included' }]]
  const pages2 = [[{ path: 'src/a.ts', verdict: 'included' }]]
  const r1 = extractFeaturesFromPages(pages1)
  const r2 = extractFeaturesFromPages(pages2)
  assert.equal(r1.coverageDigest, r2.coverageDigest)
})

test('extractFeaturesFromPages: feature IDs are collision-free for distinct dirs', () => {
  const pages = [
    [{ path: 'src/auth/x.ts', verdict: 'included' }],
    [{ path: 'src/api/y.ts', verdict: 'included' }],
  ]
  const result = extractFeaturesFromPages(pages)
  const ids = result.features.map((f) => f.id)
  const uniqueIds = new Set(ids)
  assert.equal(ids.length, uniqueIds.size, 'Feature IDs must be collision-free')
})
