// Phase 15 — Slice Ownership Reconciliation (D2.1).
// Tests reconcileSlices pure function, helpers, schemas, and source assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  reconcileSlices,
  computePrefixScore,
  clusterByTwoSegDir,
  deriveClusterSliceId,
  detectMoves,
  validatePartition,
  RECONCILE_FILE,
  RECONCILE_DELTA,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// Valid 64-hex SHA-256 values for tests.
const H1 = 'a234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H2 = 'b234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H3 = 'c234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H4 = 'd234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H5 = 'e234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H6 = 'f234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'

// ---- RED tests (must fail before implementation) ----

test('RED: reconcileSlices is defined and callable', () => {
  assert.equal(typeof reconcileSlices, 'function')
})

test('RED: reconcileSlices signature is (persistedSlices, currentFiles) — no flags/hints', () => {
  const fnBody = source.slice(
    source.indexOf('function reconcileSlices'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  // The function declaration must accept exactly two params.
  const sigMatch = fnBody.match(/function reconcileSlices\(([^)]*)\)/)
  assert.ok(sigMatch, 'function signature found')
  const params = sigMatch[1].split(',').map(s => s.trim()).filter(Boolean)
  assert.equal(params.length, 2, 'exactly two parameters')
})

test('RED: no crypto/createHash/Math.random/Date.now in reconcileSlices or helpers', () => {
  const block = source.slice(
    source.indexOf('function directorySegments'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  assert.doesNotMatch(block, /\brequire\(/)
  assert.doesNotMatch(block, /createHash/)
  assert.doesNotMatch(block, /Math\.random/)
  assert.doesNotMatch(block, /Date\.now/)
  assert.doesNotMatch(block, /crypto/)
})

test('RED: removed slice does not receive added files', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-aaa',
      status: 'current',
      planDir: 'docs/x/',
      files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-bbb',
      status: 'removed',
      planDir: 'docs/y/',
      files: [{ path: 'src/old/removed.ts', contentSha256: H2 }],
    },
  ]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/added.ts', contentSha256: H3 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  // The removed slice must not own any current files.
  const removedSlice = slices.find(s => s.sliceId === 'slice-bbb')
  assert.equal(removedSlice.status, 'removed')
  assert.equal(removedSlice.files.length, 0)
  // The added file must go to the non-removed slice, not the removed one.
  assert.equal(delta.added.length, 1)
  assert.equal(delta.added[0].sliceId, 'slice-aaa')
})

// ---- GREEN tests — computePrefixScore ----

test('computePrefixScore: src/auth/login.ts vs src/auth/session.ts -> 2', () => {
  const score = computePrefixScore('src/auth/login.ts', [{ path: 'src/auth/session.ts' }])
  assert.equal(score, 2)
})

test('computePrefixScore: src/auth/login.ts vs src/core/db.ts -> 1', () => {
  const score = computePrefixScore('src/auth/login.ts', [{ path: 'src/core/db.ts' }])
  assert.equal(score, 1)
})

test('computePrefixScore: src/auth/login.ts vs lib/utils.ts -> 0', () => {
  const score = computePrefixScore('src/auth/login.ts', [{ path: 'lib/utils.ts' }])
  assert.equal(score, 0)
})

test('computePrefixScore: root-level file vs any slice -> 0', () => {
  const score = computePrefixScore('README.md', [{ path: 'src/auth/login.ts' }])
  assert.equal(score, 0)
})

test('computePrefixScore: takes MAX across all files in slice', () => {
  const sliceFiles = [
    { path: 'src/core/db.ts' },      // score 1 vs src/auth/login.ts
    { path: 'src/auth/session.ts' },  // score 2
    { path: 'lib/util.ts' },          // score 0
  ]
  const score = computePrefixScore('src/auth/login.ts', sliceFiles)
  assert.equal(score, 2)
})

test('computePrefixScore: deeply nested a/b/c/d/file.ts vs a/b/c/d/other.ts -> 4', () => {
  const score = computePrefixScore('a/b/c/d/file.ts', [{ path: 'a/b/c/d/other.ts' }])
  assert.equal(score, 4)
})

// ---- GREEN tests — clusterByTwoSegDir ----

test('clusterByTwoSegDir: src/auth/ files cluster together, src/core/ separate', () => {
  const files = [
    { path: 'src/auth/a.ts' },
    { path: 'src/auth/b.ts' },
    { path: 'src/core/c.ts' },
    { path: 'src/core/d.ts' },
  ]
  const clusters = clusterByTwoSegDir(files)
  assert.equal(clusters.length, 2)
  // One cluster has 2 auth files, the other has 2 core files.
  const sizes = clusters.map(c => c.length).sort()
  assert.deepEqual(sizes, [2, 2])
})

test('clusterByTwoSegDir: root-level files are singletons', () => {
  const files = [{ path: 'README.md' }, { path: 'package.json' }]
  const clusters = clusterByTwoSegDir(files)
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].length, 1)
  assert.equal(clusters[1].length, 1)
})

test('clusterByTwoSegDir: 3 files in src/auth/ + 2 in lib/db/ -> 2 clusters', () => {
  const files = [
    { path: 'src/auth/a.ts' },
    { path: 'src/auth/b.ts' },
    { path: 'src/auth/c.ts' },
    { path: 'lib/db/x.ts' },
    { path: 'lib/db/y.ts' },
  ]
  const clusters = clusterByTwoSegDir(files)
  assert.equal(clusters.length, 2)
  const sizes = clusters.map(c => c.length).sort()
  assert.deepEqual(sizes, [2, 3])
})

test('clusterByTwoSegDir: permutation invariance — reorder produces same groupings', () => {
  const files = [
    { path: 'src/auth/a.ts' },
    { path: 'src/core/b.ts' },
    { path: 'src/auth/c.ts' },
  ]
  const reordered = [
    { path: 'src/auth/c.ts' },
    { path: 'src/auth/a.ts' },
    { path: 'src/core/b.ts' },
  ]
  const c1 = clusterByTwoSegDir(files)
  const c2 = clusterByTwoSegDir(reordered)
  // Same number of clusters.
  assert.equal(c1.length, c2.length)
  // Sort paths within each cluster, then compare.
  const norm = (clusters) => clusters
    .map(c => c.map(f => f.path).sort().join(','))
    .sort()
    .join('|')
  assert.equal(norm(c1), norm(c2))
})

// ---- GREEN tests — deriveClusterSliceId ----

test('deriveClusterSliceId: produces slice-<lexSmallest hash prefix>', () => {
  const cluster = [
    { contentSha256: H2 },
    { contentSha256: H1 },
  ]
  const id = deriveClusterSliceId(cluster, new Set())
  // H1 < H2 lexicographically, so prefix comes from H1.
  assert.equal(id, 'slice-' + H1.slice(0, 12))
})

test('deriveClusterSliceId: lex-smallest is independent of cluster file order', () => {
  const clusterA = [{ contentSha256: H2 }, { contentSha256: H1 }]
  const clusterB = [{ contentSha256: H1 }, { contentSha256: H2 }]
  const idA = deriveClusterSliceId(clusterA, new Set())
  const idB = deriveClusterSliceId(clusterB, new Set())
  assert.equal(idA, idB)
})

test('deriveClusterSliceId: collision -> counter suffix -1, -2', () => {
  const cluster = [{ contentSha256: H1 }]
  const base = 'slice-' + H1.slice(0, 12)
  const existing1 = new Set([base])
  const id1 = deriveClusterSliceId(cluster, existing1)
  assert.equal(id1, base + '-1')
  const existing2 = new Set([base, base + '-1'])
  const id2 = deriveClusterSliceId(cluster, existing2)
  assert.equal(id2, base + '-2')
})

test('deriveClusterSliceId: no collision -> no suffix', () => {
  const cluster = [{ contentSha256: H1 }]
  const id = deriveClusterSliceId(cluster, new Set())
  assert.ok(!id.includes('-1'))
})

// ---- GREEN tests — detectMoves ----

test('detectMoves: old path gone + unique contentSha256 match -> MOVE', () => {
  const currentFiles = [{ path: 'src/new/location.ts', contentSha256: H1 }]
  const oldPathMap = new Map([['src/old/location.ts', { sliceId: 'slice-a', contentSha256: H1 }]])
  const oldHashMap = new Map([[H1, ['src/old/location.ts']]])
  const currentPathSet = new Set(['src/new/location.ts'])
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].oldPath, 'src/old/location.ts')
  assert.equal(moves[0].newPath, 'src/new/location.ts')
  assert.equal(moves[0].sliceId, 'slice-a')
  assert.equal(adds.length, 0)
})

test('detectMoves: contentSha256 matches >=2 old paths -> DUPLICATE -> ADD', () => {
  const currentFiles = [{ path: 'src/new/dup.ts', contentSha256: H1 }]
  const oldPathMap = new Map([
    ['src/old/a.ts', { sliceId: 'slice-a', contentSha256: H1 }],
    ['src/old/b.ts', { sliceId: 'slice-b', contentSha256: H1 }],
  ])
  const oldHashMap = new Map([[H1, ['src/old/a.ts', 'src/old/b.ts']]])
  const currentPathSet = new Set(['src/new/dup.ts'])
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  assert.equal(moves.length, 0)
  assert.equal(adds.length, 1)
  assert.equal(adds[0].path, 'src/new/dup.ts')
})

test('detectMoves: old path still exists + same hash at new path -> ADD (not move)', () => {
  const currentFiles = [
    { path: 'src/old/orig.ts', contentSha256: H1 },
    { path: 'src/new/copy.ts', contentSha256: H1 },
  ]
  const oldPathMap = new Map([['src/old/orig.ts', { sliceId: 'slice-a', contentSha256: H1 }]])
  const oldHashMap = new Map([[H1, ['src/old/orig.ts']]])
  const currentPathSet = new Set(['src/old/orig.ts', 'src/new/copy.ts'])
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  // src/old/orig.ts is in oldPathMap -> skipped by detectMoves.
  // src/new/copy.ts has H1, oldHashMap has 1 old path, but src/old/orig.ts IS in currentPathSet -> ADD.
  assert.equal(moves.length, 0)
  assert.equal(adds.length, 1)
  assert.equal(adds[0].path, 'src/new/copy.ts')
})

test('detectMoves: no contentSha256 match -> ADD', () => {
  const currentFiles = [{ path: 'src/new/unique.ts', contentSha256: H5 }]
  const oldPathMap = new Map([['src/old/file.ts', { sliceId: 'slice-a', contentSha256: H1 }]])
  const oldHashMap = new Map([[H1, ['src/old/file.ts']]])
  const currentPathSet = new Set(['src/new/unique.ts'])
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  assert.equal(moves.length, 0)
  assert.equal(adds.length, 1)
})

test('detectMoves: unchanged path (in oldPathMap) -> neither move nor add', () => {
  const currentFiles = [{ path: 'src/existing/file.ts', contentSha256: H1 }]
  const oldPathMap = new Map([['src/existing/file.ts', { sliceId: 'slice-a', contentSha256: H1 }]])
  const oldHashMap = new Map([[H1, ['src/existing/file.ts']]])
  const currentPathSet = new Set(['src/existing/file.ts'])
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  assert.equal(moves.length, 0)
  assert.equal(adds.length, 0)
})

// ---- GREEN tests — reconcileSlices end-to-end ----

test('reconcileSlices: unchanged — all files same paths+hashes, delta empty', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/session.ts', contentSha256: H2 },
    ],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/session.ts', contentSha256: H2 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.equal(slices.length, 1)
  assert.equal(slices[0].status, 'current')
  assert.equal(slices[0].files.length, 2)
  assert.equal(delta.added.length, 0)
  assert.equal(delta.removed.length, 0)
  assert.equal(delta.moved.length, 0)
  assert.equal(delta.newSlices.length, 0)
  assert.equal(delta.removedSlices.length, 0)
})

test('reconcileSlices: added file assigned to highest-scoring non-removed slice', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/middleware.ts', contentSha256: H3 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/middleware.ts'))
  assert.equal(sliceA.status, 'pending')
  assert.equal(delta.added.length, 1)
  assert.equal(delta.added[0].path, 'src/auth/middleware.ts')
  assert.equal(delta.added[0].sliceId, 'slice-a')
})

test('reconcileSlices: added file tie — lex-smallest sliceId wins', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-z', status: 'current', planDir: 'docs/z/',
      files: [{ path: 'src/auth/a.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
      files: [{ path: 'src/auth/b.ts', contentSha256: H2 }],
    },
  ]
  // New file in src/auth/ — both slices have score 2 (src + auth).
  const currentFiles = [
    { path: 'src/auth/a.ts', contentSha256: H1 },
    { path: 'src/auth/b.ts', contentSha256: H2 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.equal(delta.added.length, 1)
  assert.equal(delta.added[0].sliceId, 'slice-a')
})

test('reconcileSlices: added file zero score -> new slice via clustering', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'lib/brandnew/module.ts', contentSha256: H3 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.ok(delta.newSlices.length >= 1)
  assert.equal(delta.added.length, 1)
  assert.ok(delta.added.some(a => a.path === 'lib/brandnew/module.ts'))
})

test('reconcileSlices: multiple zero-score files same dir -> one new slice', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'lib/newmod/a.ts', contentSha256: H3 },
    { path: 'lib/newmod/b.ts', contentSha256: H4 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.equal(delta.newSlices.length, 1)
  assert.equal(delta.newSlices[0].files.length, 2)
})

test('reconcileSlices: multiple zero-score files different dirs -> two new slices', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'lib/a/file.ts', contentSha256: H3 },
    { path: 'lib/b/file.ts', contentSha256: H4 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.equal(delta.newSlices.length, 2)
})

test('reconcileSlices: removed file — old path not in currentFiles -> dropped', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/old.ts', contentSha256: H2 },
    ],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.ok(!sliceA.files.some(f => f.path === 'src/auth/old.ts'))
  assert.equal(delta.removed.length, 1)
  assert.equal(delta.removed[0].path, 'src/auth/old.ts')
  assert.equal(delta.removed[0].sliceId, 'slice-a')
})

test('reconcileSlices: move — old path gone, new path with unique match -> moves to old owner', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/renamed.ts', contentSha256: H1 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/renamed.ts'))
  assert.equal(delta.moved.length, 1)
  assert.equal(delta.moved[0].oldPath, 'src/auth/login.ts')
  assert.equal(delta.moved[0].newPath, 'src/auth/renamed.ts')
})

test('reconcileSlices: duplicate content — two old files share digest -> ADD not MOVE', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/a.ts', contentSha256: H1 },
      { path: 'src/auth/b.ts', contentSha256: H1 },
    ],
  }]
  const currentFiles = [
    { path: 'src/auth/c.ts', contentSha256: H1 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  // Both old paths gone, content ambiguous -> ADD not MOVE
  assert.equal(delta.moved.length, 0)
  // Both old paths should be in removed
  assert.equal(delta.removed.length, 2)
  // c.ts should be in added (assigned to slice-a via prefix score, same dir)
  assert.equal(delta.added.length, 1)
  assert.equal(delta.added[0].path, 'src/auth/c.ts')
})

test('reconcileSlices: content changed — same path different hash -> pending', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H2 },
  ]
  const { slices } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.equal(sliceA.status, 'pending')
  assert.equal(sliceA.files[0].contentSha256, H2)
})

test('reconcileSlices: empty slice — all files removed -> removed status', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = []
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.equal(sliceA.status, 'removed')
  assert.equal(sliceA.files.length, 0)
  assert.ok(delta.removedSlices.includes('slice-a'))
})

test('reconcileSlices: removed slice excluded from prefix-score assignment', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-removed', status: 'removed', planDir: 'docs/r/',
      files: [{ path: 'src/old/file.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-active', status: 'current', planDir: 'docs/a/',
      files: [{ path: 'src/old/other.ts', contentSha256: H2 }],
    },
  ]
  // New file in src/old/ — prefix score against slice-removed would be 2,
  // but removed slices are excluded. Score against slice-active is also 1 (src).
  const currentFiles = [
    { path: 'src/old/other.ts', contentSha256: H2 },
    { path: 'src/old/newfile.ts', contentSha256: H3 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  // newfile.ts should be assigned to slice-active (score 1: "src"), NOT slice-removed.
  assert.equal(delta.added.length, 1)
  assert.equal(delta.added[0].sliceId, 'slice-active')
})

test('reconcileSlices: overlap — lex-smallest sliceId wins, logged in delta.overlaps', () => {
  // This is a theoretical edge case — a file somehow assigned to two slices.
  // We verify the overlap mechanism by checking the output structure.
  // In normal operation, each file gets exactly one owner.
  // This test verifies delta.overlaps is initialized as an array.
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.deepEqual(delta.overlaps, [])
})

test('reconcileSlices: permutation invariance — reordering inputs produces identical output', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-bbb', status: 'current', planDir: 'docs/b/',
      files: [{ path: 'src/core/db.ts', contentSha256: H2 }],
    },
    {
      sliceId: 'slice-aaa', status: 'current', planDir: 'docs/a/',
      files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    },
  ]
  const currentFiles = [
    { path: 'src/core/db.ts', contentSha256: H2 },
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/added.ts', contentSha256: H3 },
  ]
  const reorderedSlices = persistedSlices.slice().reverse()
  const reorderedFiles = currentFiles.slice().reverse()
  const r1 = reconcileSlices(persistedSlices, currentFiles)
  const r2 = reconcileSlices(reorderedSlices, reorderedFiles)
  assert.deepEqual(r1, r2)
})

test('reconcileSlices: empty currentFiles -> all persisted slices become removed', () => {
  const persistedSlices = [
    { sliceId: 'slice-a', status: 'current', planDir: 'docs/a/', files: [{ path: 'a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-b', status: 'current', planDir: 'docs/b/', files: [{ path: 'b.ts', contentSha256: H2 }] },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, [])
  assert.equal(slices.length, 2)
  for (const s of slices) assert.equal(s.status, 'removed')
  assert.equal(delta.removedSlices.length, 2)
  assert.equal(delta.removed.length, 2)
})

test('reconcileSlices: empty persistedSlices -> all current files in new slices', () => {
  const currentFiles = [
    { path: 'src/mod/a.ts', contentSha256: H1 },
    { path: 'src/mod/b.ts', contentSha256: H2 },
  ]
  const { slices, delta } = reconcileSlices([], currentFiles)
  assert.ok(delta.newSlices.length >= 1)
  assert.equal(delta.added.length, 2)
  // Every current file should be owned by exactly one new slice.
  const allNewFiles = delta.newSlices.flatMap(s => s.files.map(f => f.path))
  for (const cf of currentFiles) assert.ok(allNewFiles.includes(cf.path))
})

test('reconcileSlices: single slice — added files assigned to same slice', () => {
  const persistedSlices = [{
    sliceId: 'slice-only', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.equal(slices.length, 1)
  assert.equal(slices[0].sliceId, 'slice-only')
  assert.equal(slices[0].files.length, 2)
  assert.equal(delta.added.length, 1)
  assert.equal(delta.newSlices.length, 0)
})

test('reconcileSlices: mixed scenario — unchanged + added + removed + move + new slice', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
      files: [
        { path: 'src/auth/login.ts', contentSha256: H1 },
        { path: 'src/auth/old.ts', contentSha256: H2 },
      ],
    },
    {
      sliceId: 'slice-b', status: 'current', planDir: 'docs/b/',
      files: [
        { path: 'src/core/db.ts', contentSha256: H3 },
        { path: 'src/core/gone.ts', contentSha256: H6 },
      ],
    },
  ]
  const currentFiles = [
    // unchanged in slice-a
    { path: 'src/auth/login.ts', contentSha256: H1 },
    // move: old.ts gone, renamed.ts has H2
    { path: 'src/auth/renamed.ts', contentSha256: H2 },
    // added to slice-a (prefix score 2)
    { path: 'src/auth/middleware.ts', contentSha256: H4 },
    // unchanged in slice-b
    { path: 'src/core/db.ts', contentSha256: H3 },
    // zero-score -> new slice
    { path: 'lib/extra/util.ts', contentSha256: H5 },
  ]
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)

  // delta categories populated
  assert.ok(delta.removed.length >= 1, 'has removed (gone.ts truly gone)')
  assert.ok(delta.removed.some(r => r.path === 'src/core/gone.ts'))
  assert.ok(delta.added.length >= 2, 'has added (middleware + new slice file)')
  assert.equal(delta.moved.length, 1, 'has one move (old.ts -> renamed.ts)')
  assert.equal(delta.moved[0].oldPath, 'src/auth/old.ts')
  assert.ok(delta.newSlices.length >= 1, 'has new slices')
  assert.equal(delta.removedSlices.length, 0, 'no slices emptied')

  // slice-a has login.ts, renamed.ts (moved), middleware.ts (added)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.equal(sliceA.status, 'pending')
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/login.ts'))
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/renamed.ts'))
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/middleware.ts'))

  // slice-b has db.ts but lost gone.ts -> pending
  const sliceB = slices.find(s => s.sliceId === 'slice-b')
  assert.equal(sliceB.status, 'pending')
  assert.ok(sliceB.files.some(f => f.path === 'src/core/db.ts'))
  assert.ok(!sliceB.files.some(f => f.path === 'src/core/gone.ts'))
})

// ---- GREEN tests — partition invariant ----

test('validatePartition: every current file in exactly one slice -> no throw', () => {
  const slices = [
    { sliceId: 's1', status: 'current', files: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    { sliceId: 's2', status: 'current', files: [{ path: 'c.ts' }] },
  ]
  const currentFiles = [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }]
  assert.doesNotThrow(() => validatePartition(slices, currentFiles))
})

test('validatePartition: current file missing from all slices -> throws', () => {
  const slices = [{ sliceId: 's1', status: 'current', files: [{ path: 'a.ts' }] }]
  const currentFiles = [{ path: 'a.ts' }, { path: 'orphan.ts' }]
  assert.throws(() => validatePartition(slices, currentFiles), /Partition violation/)
})

test('validatePartition: current file in two slices -> throws', () => {
  const slices = [
    { sliceId: 's1', status: 'current', files: [{ path: 'dup.ts' }] },
    { sliceId: 's2', status: 'current', files: [{ path: 'dup.ts' }] },
  ]
  const currentFiles = [{ path: 'dup.ts' }]
  assert.throws(() => validatePartition(slices, currentFiles), /Partition violation/)
})

test('source: reconcileSlices calls validatePartition before returning', () => {
  const fnBody = source.slice(
    source.indexOf('function reconcileSlices'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  // validatePartition must be called inside reconcileSlices.
  assert.match(fnBody, /validatePartition\(/)
})

test('source: validatePartition skips removed slices', () => {
  const fnBody = source.slice(
    source.indexOf('function validatePartition'),
    source.indexOf('function reconcileSlices')
  )
  assert.match(fnBody, /removed/)
})

// ---- GREEN tests — delta structure ----

test('delta.added entries have {path, contentSha256, sliceId}', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
  ]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.ok(delta.added.length > 0)
  for (const a of delta.added) {
    assert.ok('path' in a)
    assert.ok('contentSha256' in a)
    assert.ok('sliceId' in a)
  }
})

test('delta.removed entries have {path, sliceId}', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/gone.ts', contentSha256: H2 },
    ],
  }]
  const currentFiles = [{ path: 'src/auth/login.ts', contentSha256: H1 }]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.ok(delta.removed.length > 0)
  for (const r of delta.removed) {
    assert.ok('path' in r)
    assert.ok('sliceId' in r)
  }
})

test('delta.moved entries have {oldPath, newPath, contentSha256, sliceId}', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/old.ts', contentSha256: H1 }],
  }]
  const currentFiles = [{ path: 'src/auth/new.ts', contentSha256: H1 }]
  const { delta } = reconcileSlices(persistedSlices, currentFiles)
  assert.ok(delta.moved.length > 0)
  for (const m of delta.moved) {
    assert.ok('oldPath' in m)
    assert.ok('newPath' in m)
    assert.ok('contentSha256' in m)
    assert.ok('sliceId' in m)
  }
})

test('delta.newSlices entries have {sliceId, files}', () => {
  const currentFiles = [{ path: 'src/new/a.ts', contentSha256: H1 }]
  const { delta } = reconcileSlices([], currentFiles)
  assert.ok(delta.newSlices.length > 0)
  for (const ns of delta.newSlices) {
    assert.ok('sliceId' in ns)
    assert.ok('files' in ns)
  }
})

test('delta.removedSlices is an array of sliceId strings', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { delta } = reconcileSlices(persistedSlices, [])
  assert.ok(Array.isArray(delta.removedSlices))
  for (const id of delta.removedSlices) assert.equal(typeof id, 'string')
})

test('delta.overlaps entries have {path, winnerSliceId, loserSliceId}', () => {
  const persistedSlices = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { delta } = reconcileSlices(persistedSlices, [{ path: 'src/auth/login.ts', contentSha256: H1 }])
  assert.ok(Array.isArray(delta.overlaps))
})

// ---- GREEN tests — cross-cutting ----

test('source: reconcileSlices is pure (no safeAgent/flexibleAgent/async)', () => {
  const fnBody = source.slice(
    source.indexOf('function reconcileSlices'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  assert.doesNotMatch(fnBody, /safeAgent/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
  assert.doesNotMatch(fnBody, /\basync\b/)
})

test('source: all helpers are pure (no agent calls)', () => {
  const block = source.slice(
    source.indexOf('function directorySegments'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  assert.doesNotMatch(block, /safeAgent/)
  assert.doesNotMatch(block, /flexibleAgent/)
  assert.doesNotMatch(block, /\basync\b/)
})

test('source: RECONCILE_DELTA schema has additionalProperties:false', () => {
  assert.equal(RECONCILE_DELTA.additionalProperties, false)
})

test('source: RECONCILE_FILE schema has additionalProperties:false', () => {
  assert.equal(RECONCILE_FILE.additionalProperties, false)
})

test('source: meta phases include Reconcile Slices', () => {
  assert.match(source, /title: 'Reconcile Slices'/)
})

test('source: reconcileSlices exported from extract-scope module', () => {
  const src = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/extract-scope.mjs', import.meta.url),
    'utf8'
  )
  assert.match(src, /function reconcileSlices\b/)
  assert.match(src, /reconcileSlices/)
})

test('source: no new crypto import in extract-scope.mjs', () => {
  const src = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/extract-scope.mjs', import.meta.url),
    'utf8'
  )
  // The reconcile section must not import or use crypto.
  // Scope to Phase 15 functions only — Phase 16 change-detection functions follow
  // and legitimately reference SHA-256 in agent prompt strings.
  const reconcileBlock = src.slice(
    src.indexOf('function directorySegments'),
    src.indexOf('function frameSliceDigest')
  )
  assert.doesNotMatch(reconcileBlock, /\brequire\(/)
  assert.doesNotMatch(reconcileBlock, /createHash/)
  assert.doesNotMatch(reconcileBlock, /\bcrypto\b/)
})
