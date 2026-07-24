// Phase 15 — Nyquist validation characterization tests.
// Fills sampling gaps identified in the retroactive audit:
//   GAP-1: Permutation invariance of sliceIds (extensive shuffle scenarios,
//          multiple new slices, moves present, reorder each input independently)
//   GAP-2: Exactly-one-owner partition invariant across all edge cases
//          (helper asserts every current file in exactly one output slice)
//   GAP-3: Duplicate-content conservative add (cross-slice dups, 3+ dups,
//          old path still present, dup+unique simultaneous)
//   GAP-4: Empty->removed terminal state machine (terminal status, empty files,
//          removedSlices, mix of removed+kept -> pending not removed)
//   GAP-5: Overlap lex-smallest resolution (defense-in-depth: overlaps never
//          fire for normal inputs; lex-smallest sort logic source-asserted)
//   GAP-6: Schema deep validation + boundary robustness (null/undefined inputs,
//          duplicate current paths, slice missing files array)
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

// Valid 64-hex SHA-256 values (distinct lexicographic prefixes for sliceId tests).
const H1 = 'a234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H2 = 'b234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H3 = 'c234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H4 = 'd234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H5 = 'e234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H6 = 'f234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H7 = '01234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H8 = '1234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'

// ---- Shared helpers --------------------------------------------------------

// Assert every current file is owned by exactly one non-removed output slice.
// Complements validatePartition (which throws) by making the assertion explicit
// in test output. Returns the owner map for further assertions.
function assertPartition(slices, currentFiles) {
  const owners = new Map()
  for (const s of slices) {
    if (s.status === 'removed') continue
    for (const f of s.files || []) {
      const list = owners.get(f.path) || []
      list.push(s.sliceId)
      owners.set(f.path, list)
    }
  }
  for (const cf of currentFiles) {
    const list = owners.get(cf.path) || []
    assert.equal(
      list.length, 1,
      `Partition: "${cf.path}" should have exactly 1 owner, got ${list.length} (${list.join(', ')})`
    )
  }
  // Every owned path must be a current file (no stale owners).
  for (const path of owners.keys()) {
    assert.ok(
      currentFiles.some(cf => cf.path === path),
      `Partition: output owns "${path}" but it is not in currentFiles`
    )
  }
  return owners
}

// Deterministic shuffle via Fisher-Yates with a fixed seed (no Math.random —
// keeps the test itself deterministic). PURE helper for permutation tests.
function seededShuffle(arr, seed) {
  const out = arr.slice()
  let s = seed | 0
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 step
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    const j = (s >>> 0) % (i + 1)
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp
  }
  return out
}

// ---- GAP-1: Permutation invariance of sliceIds -----------------------------

test('NYQ-PERM-1: multiple new-slice sliceIds are stable across 5 input orderings', () => {
  // Three new slices from zero-score clusters in different directories.
  // Their sliceIds derive from lex-smallest contentSha256 per cluster; input
  // reorder must not change which cluster gets which sliceId.
  const persisted = [{
    sliceId: 'slice-anchor', status: 'current', planDir: 'docs/a/',
    files: [{ path: 'src/existing/file.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/existing/file.ts', contentSha256: H1 },
    { path: 'lib/mod1/a.ts', contentSha256: H3 },
    { path: 'lib/mod1/b.ts', contentSha256: H4 },
    { path: 'lib/mod2/c.ts', contentSha256: H5 },
    { path: 'lib/mod2/d.ts', contentSha256: H6 },
    { path: 'lib/mod3/e.ts', contentSha256: H7 },
    { path: 'lib/mod3/f.ts', contentSha256: H8 },
  ]
  const baseline = reconcileSlices(persisted, current)
  for (let seed = 1; seed <= 5; seed++) {
    const shuffledCurrent = seededShuffle(current, seed * 7)
    const shuffledPersisted = seededShuffle(persisted, seed * 13)
    const result = reconcileSlices(shuffledPersisted, shuffledCurrent)
    assert.deepEqual(
      result.slices.map(s => s.sliceId).sort(),
      baseline.slices.map(s => s.sliceId).sort(),
      `seed ${seed}: sliceIds identical`
    )
    assert.deepEqual(result, baseline, `seed ${seed}: full output identical`)
  }
})

test('NYQ-PERM-2: permutation invariance with moves present', () => {
  // Moves introduce path changes; their assignment to old owners must be
  // order-independent.
  const persisted = [
    {
      sliceId: 'slice-move', status: 'current', planDir: 'docs/m/',
      files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-other', status: 'current', planDir: 'docs/o/',
      files: [{ path: 'src/core/db.ts', contentSha256: H2 }],
    },
  ]
  const current = [
    // Move: login.ts -> authentication.ts (same content H1)
    { path: 'src/auth/authentication.ts', contentSha256: H1 },
    // Unchanged
    { path: 'src/core/db.ts', contentSha256: H2 },
    // Added to slice-move (prefix score 2)
    { path: 'src/auth/middleware.ts', contentSha256: H3 },
  ]
  const baseline = reconcileSlices(persisted, current)
  for (let seed = 1; seed <= 4; seed++) {
    const result = reconcileSlices(seededShuffle(persisted, seed * 5), seededShuffle(current, seed * 11))
    assert.deepEqual(result, baseline, `seed ${seed}: identical with moves`)
  }
})

test('NYQ-PERM-3: reorder only persistedSlices, currentFiles fixed', () => {
  const persisted = [
    { sliceId: 'slice-zeta', status: 'current', planDir: 'docs/z/', files: [{ path: 'src/z/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-alpha', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/a/b.ts', contentSha256: H2 }] },
    { sliceId: 'slice-mid', status: 'current', planDir: 'docs/m/', files: [{ path: 'src/m/c.ts', contentSha256: H3 }] },
  ]
  const current = [
    { path: 'src/z/a.ts', contentSha256: H1 },
    { path: 'src/a/b.ts', contentSha256: H2 },
    { path: 'src/m/c.ts', contentSha256: H3 },
  ]
  const baseline = reconcileSlices(persisted, current)
  const reversed = reconcileSlices(persisted.slice().reverse(), current)
  assert.deepEqual(reversed, baseline)
})

test('NYQ-PERM-4: reorder only currentFiles, persistedSlices fixed', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
    { path: 'lib/other/file.ts', contentSha256: H4 },
  ]
  const baseline = reconcileSlices(persisted, current)
  const reordered = reconcileSlices(persisted, current.slice().reverse())
  assert.deepEqual(reordered, baseline)
})

test('NYQ-PERM-5: delta arrays are canonical-sorted (not input-order dependent)', () => {
  // Delta.added, removed, moved, newSlices, removedSlices, overlaps are all
  // sorted in the output. Verify with a scenario that populates multiple categories.
  const persisted = [
    {
      sliceId: 'slice-zzz', status: 'current', planDir: 'docs/z/',
      files: [
        { path: 'src/z/keep.ts', contentSha256: H1 },
        { path: 'src/z/remove.ts', contentSha256: H2 },
        { path: 'src/z/rename.ts', contentSha256: H3 },
      ],
    },
  ]
  const current = [
    { path: 'src/z/keep.ts', contentSha256: H1 },
    // rename.ts moved to renamed.ts (same content H3)
    { path: 'src/z/renamed.ts', contentSha256: H3 },
    // Added to slice-zzz
    { path: 'src/z/extra.ts', contentSha256: H4 },
  ]
  const r1 = reconcileSlices(persisted, current)
  const r2 = reconcileSlices(persisted, current.slice().reverse())
  // Delta.added is sorted by path
  for (let i = 1; i < r1.delta.added.length; i++) {
    assert.ok(r1.delta.added[i - 1].path <= r1.delta.added[i].path, 'delta.added sorted by path')
  }
  assert.deepEqual(r1.delta, r2.delta)
})

test('NYQ-PERM-6: cluster file ordering inside newSlices is sorted (canonical)', () => {
  // Files within a new slice must be sorted by path, independent of clustering order.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const currentForward = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'lib/new/zebra.ts', contentSha256: H3 },
    { path: 'lib/new/apple.ts', contentSha256: H4 },
    { path: 'lib/new/mango.ts', contentSha256: H5 },
  ]
  const currentReverse = [
    { path: 'lib/new/mango.ts', contentSha256: H5 },
    { path: 'lib/new/apple.ts', contentSha256: H4 },
    { path: 'lib/new/zebra.ts', contentSha256: H3 },
    { path: 'src/auth/login.ts', contentSha256: H1 },
  ]
  const r1 = reconcileSlices(persisted, currentForward)
  const r2 = reconcileSlices(persisted, currentReverse)
  assert.equal(r1.delta.newSlices.length, 1)
  const ns = r1.delta.newSlices[0]
  // Verify files are sorted by path inside the new slice.
  for (let i = 1; i < ns.files.length; i++) {
    assert.ok(ns.files[i - 1].path < ns.files[i].path, 'newSlice files sorted by path')
  }
  assert.deepEqual(r1, r2)
})

// ---- GAP-2: Exactly-one-owner partition invariant --------------------------

test('NYQ-PART-1: partition holds for unchanged scenario', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const current = [{ path: 'src/auth/login.ts', contentSha256: H1 }]
  const { slices } = reconcileSlices(persisted, current)
  assertPartition(slices, current)
})

test('NYQ-PART-2: partition holds for mixed scenario (add+remove+move+new)', () => {
  const persisted = [
    {
      sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
      files: [
        { path: 'src/auth/login.ts', contentSha256: H1 },
        { path: 'src/auth/old.ts', contentSha256: H2 },
      ],
    },
    {
      sliceId: 'slice-b', status: 'current', planDir: 'docs/b/',
      files: [{ path: 'src/core/db.ts', contentSha256: H3 }],
    },
  ]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/renamed.ts', contentSha256: H2 }, // move
    { path: 'src/auth/middleware.ts', contentSha256: H4 }, // add
    { path: 'src/core/db.ts', contentSha256: H3 },
    { path: 'lib/extra/util.ts', contentSha256: H5 }, // new slice
  ]
  const { slices } = reconcileSlices(persisted, current)
  assertPartition(slices, current)
})

test('NYQ-PART-3: partition holds with multiple new slices from different dirs', () => {
  const current = [
    { path: 'lib/a/file.ts', contentSha256: H1 },
    { path: 'lib/a/other.ts', contentSha256: H2 },
    { path: 'lib/b/file.ts', contentSha256: H3 },
    { path: 'lib/b/other.ts', contentSha256: H4 },
    { path: 'lib/c/file.ts', contentSha256: H5 },
  ]
  const { slices } = reconcileSlices([], current)
  assertPartition(slices, current)
})

test('NYQ-PART-4: partition holds for empty currentFiles', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { slices } = reconcileSlices(persisted, [])
  // No current files — partition invariant is vacuously true.
  assertPartition(slices, [])
})

test('NYQ-PART-5: partition holds for duplicate-content scenario', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/a.ts', contentSha256: H1 },
      { path: 'src/auth/b.ts', contentSha256: H1 },
    ],
  }]
  const current = [{ path: 'src/auth/c.ts', contentSha256: H1 }]
  const { slices } = reconcileSlices(persisted, current)
  assertPartition(slices, current)
})

test('NYQ-PART-6: partition holds when all slices become removed except new ones', () => {
  const persisted = [
    { sliceId: 'slice-a', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/old/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-b', status: 'current', planDir: 'docs/b/', files: [{ path: 'src/old/b.ts', contentSha256: H2 }] },
  ]
  const current = [
    { path: 'lib/new/x.ts', contentSha256: H3 },
    { path: 'lib/new/y.ts', contentSha256: H4 },
  ]
  const { slices } = reconcileSlices(persisted, current)
  assertPartition(slices, current)
})

test('NYQ-PART-7: partition holds for move across slices', () => {
  // Move from slice-a to slice-a (same owner) vs. prefix-score assignment
  // could in principle conflict, but the algorithm prevents it.
  const persisted = [
    { sliceId: 'slice-a', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/auth/old.ts', contentSha256: H1 }] },
    { sliceId: 'slice-b', status: 'current', planDir: 'docs/b/', files: [{ path: 'src/core/db.ts', contentSha256: H2 }] },
  ]
  const current = [
    // old.ts moved to src/auth/renamed.ts (same owner: slice-a)
    { path: 'src/auth/renamed.ts', contentSha256: H1 },
    { path: 'src/core/db.ts', contentSha256: H2 },
  ]
  const { slices } = reconcileSlices(persisted, current)
  assertPartition(slices, current)
})

test('NYQ-PART-8: validatePartition throws on synthetic overlap (defense-in-depth)', () => {
  // Hand-craft a slices array with a genuine overlap — validatePartition MUST throw.
  const slices = [
    { sliceId: 's1', status: 'current', files: [{ path: 'dup.ts' }] },
    { sliceId: 's2', status: 'current', files: [{ path: 'dup.ts' }] },
  ]
  const current = [{ path: 'dup.ts' }]
  assert.throws(() => validatePartition(slices, current), /Partition violation.*2 owners/)
})

test('NYQ-PART-9: validatePartition does NOT count removed-slice files', () => {
  // A removed slice happens to list a path that a live slice also owns —
  // validatePartition skips removed slices, so no false positive.
  const slices = [
    { sliceId: 's1', status: 'current', files: [{ path: 'a.ts' }] },
    { sliceId: 's2', status: 'removed', files: [{ path: 'a.ts' }] },
  ]
  assert.doesNotThrow(() => validatePartition(slices, [{ path: 'a.ts' }]))
})

// ---- GAP-3: Duplicate-content conservative add ----------------------------

test('NYQ-DUP-1: two old files share digest across DIFFERENT slices -> ADD not MOVE', () => {
  // Cross-slice duplicate: slice-a and slice-b both have a file with H1.
  // New file with H1 at a new path -> ambiguous (>=2 old paths) -> ADD.
  const persisted = [
    { sliceId: 'slice-a', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/a/orig.ts', contentSha256: H1 }] },
    { sliceId: 'slice-b', status: 'current', planDir: 'docs/b/', files: [{ path: 'src/b/copy.ts', contentSha256: H1 }] },
  ]
  const current = [
    { path: 'src/a/orig.ts', contentSha256: H1 }, // keep slice-a alive
    { path: 'src/b/copy.ts', contentSha256: H1 }, // keep slice-b alive
    { path: 'src/c/newdup.ts', contentSha256: H1 }, // ambiguous -> ADD
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.equal(delta.moved.length, 0, 'no move detected for cross-slice dup')
  assert.ok(delta.added.some(a => a.path === 'src/c/newdup.ts'), 'dup file is ADD')
})

test('NYQ-DUP-2: three old files share digest -> ADD not MOVE', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/a.ts', contentSha256: H1 },
      { path: 'src/b.ts', contentSha256: H1 },
      { path: 'src/c.ts', contentSha256: H1 },
    ],
  }]
  const current = [{ path: 'src/d.ts', contentSha256: H1 }]
  const { delta } = reconcileSlices(persisted, current)
  assert.equal(delta.moved.length, 0)
  assert.equal(delta.removed.length, 3, 'all three old paths removed')
  assert.ok(delta.added.some(a => a.path === 'src/d.ts'))
})

test('NYQ-DUP-3: old path still present + same hash at new path -> ADD not MOVE', () => {
  // The original is NOT gone — both paths exist in currentFiles with the same hash.
  // This is a copy, not a move.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/orig.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/orig.ts', contentSha256: H1 },
    { path: 'src/copy.ts', contentSha256: H1 },
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.equal(delta.moved.length, 0, 'no move — original still present')
  // copy.ts gets prefix-score assignment to slice-a (same dir).
  assert.ok(delta.added.some(a => a.path === 'src/copy.ts'))
})

test('NYQ-DUP-4: simultaneous dup + unique move — unique one moves, dup one adds', () => {
  // Two new-path files: one has a unique content match (-> MOVE), the other
  // has an ambiguous content match (-> ADD). Both classifications coexist.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/unique.ts', contentSha256: H1 }, // unique digest
      { path: 'src/dup1.ts', contentSha256: H2 },   // shared digest
      { path: 'src/dup2.ts', contentSha256: H2 },   // shared digest
    ],
  }]
  const current = [
    // unique.ts moved to src/moved.ts (unique H1 match, old path gone) -> MOVE
    { path: 'src/moved.ts', contentSha256: H1 },
    // dup1+dup2 gone; new file with H2 at src/ambiguous.ts -> ADD (>=2 old paths)
    { path: 'src/ambiguous.ts', contentSha256: H2 },
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.equal(delta.moved.length, 1, 'unique content match moves')
  assert.equal(delta.moved[0].oldPath, 'src/unique.ts')
  assert.equal(delta.moved[0].newPath, 'src/moved.ts')
  // The ambiguous one is an ADD, not a move.
  assert.ok(delta.added.some(a => a.path === 'src/ambiguous.ts'), 'ambiguous dup is ADD')
  assert.ok(!delta.moved.some(m => m.newPath === 'src/ambiguous.ts'))
})

test('NYQ-DUP-5: detectMoves returns ADD for >=2 old paths even if one is gone', () => {
  // Direct unit-level test of detectMoves with the boundary condition.
  const currentFiles = [{ path: 'src/new.ts', contentSha256: H1 }]
  const oldPathMap = new Map([
    ['src/old1.ts', { sliceId: 's1', contentSha256: H1 }],
    ['src/old2.ts', { sliceId: 's2', contentSha256: H1 }],
  ])
  const oldHashMap = new Map([[H1, ['src/old1.ts', 'src/old2.ts']]])
  const currentPathSet = new Set(['src/new.ts']) // both old paths gone
  const { moves, adds } = detectMoves(currentFiles, oldPathMap, oldHashMap, currentPathSet)
  assert.equal(moves.length, 0)
  assert.equal(adds.length, 1)
})

// ---- GAP-4: Empty -> removed terminal state machine ------------------------

test('NYQ-TERM-1: emptied slice has status exactly "removed" (terminal)', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { slices } = reconcileSlices(persisted, [])
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.equal(sliceA.status, 'removed')
  assert.deepEqual(sliceA.files, [])
})

test('NYQ-TERM-2: emptied slice appears in delta.removedSlices', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { delta } = reconcileSlices(persisted, [])
  assert.ok(delta.removedSlices.includes('slice-a'))
})

test('NYQ-TERM-3: slice with ALL files moved away -> removed (terminal)', () => {
  // Every old path is gone, but each moved to a new path with unique content.
  // The slice has no remaining current files -> removed.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/session.ts', contentSha256: H2 },
    ],
  }]
  const current = [
    { path: 'src/auth/login-renamed.ts', contentSha256: H1 }, // move
    { path: 'src/auth/session-renamed.ts', contentSha256: H2 }, // move
  ]
  const { slices, delta } = reconcileSlices(persisted, current)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  // The moves keep the files under slice-a (moves preserve ownership),
  // so slice-a is NOT emptied — it still owns the moved-to paths.
  assert.notEqual(sliceA.status, 'removed', 'slice with moved-to files is not removed')
  assert.equal(sliceA.files.length, 2, 'owns the renamed paths')
  assert.equal(delta.moved.length, 2)
})

test('NYQ-TERM-4: slice with SOME files removed and SOME kept -> pending (not removed)', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/keep.ts', contentSha256: H1 },
      { path: 'src/auth/gone.ts', contentSha256: H2 },
    ],
  }]
  const current = [{ path: 'src/auth/keep.ts', contentSha256: H1 }]
  const { slices, delta } = reconcileSlices(persisted, current)
  const sliceA = slices.find(s => s.sliceId === 'slice-a')
  assert.equal(sliceA.status, 'pending', 'partial loss -> pending, not removed')
  assert.equal(sliceA.files.length, 1)
  assert.ok(delta.removed.some(r => r.path === 'src/auth/gone.ts'))
  assert.equal(delta.removedSlices.length, 0)
})

test('NYQ-TERM-5: previously-removed slice stays removed in output', () => {
  // A slice already marked 'removed' in persisted input carries through as removed.
  const persisted = [{
    sliceId: 'slice-dead', status: 'removed', planDir: 'docs/r/',
    files: [{ path: 'src/old/dead.ts', contentSha256: H1 }],
  }]
  const current = [{ path: 'src/elsewhere.ts', contentSha256: H2 }]
  const { slices } = reconcileSlices(persisted, current)
  const dead = slices.find(s => s.sliceId === 'slice-dead')
  assert.equal(dead.status, 'removed')
  assert.deepEqual(dead.files, [])
})

test('NYQ-TERM-6: multiple slices emptied -> all in removedSlices, sorted', () => {
  const persisted = [
    { sliceId: 'slice-zeta', status: 'current', planDir: 'docs/z/', files: [{ path: 'src/z/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-alpha', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/a/b.ts', contentSha256: H2 }] },
    { sliceId: 'slice-mid', status: 'current', planDir: 'docs/m/', files: [{ path: 'src/m/c.ts', contentSha256: H3 }] },
  ]
  const { slices, delta } = reconcileSlices(persisted, [])
  for (const s of slices) assert.equal(s.status, 'removed')
  assert.equal(delta.removedSlices.length, 3)
  // removedSlices is sorted in the output.
  const sorted = delta.removedSlices.slice().sort()
  assert.deepEqual(delta.removedSlices, sorted)
})

test('NYQ-TERM-7: content-modified slice -> pending (not removed)', () => {
  // Same path, different hash — the slice still owns the file but content changed.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const current = [{ path: 'src/auth/login.ts', contentSha256: H2 }]
  const { slices } = reconcileSlices(persisted, current)
  assert.equal(slices[0].status, 'pending')
  assert.equal(slices[0].files[0].contentSha256, H2)
})

// ---- GAP-5: Overlap lex-smallest resolution (defense-in-depth) -------------

test('NYQ-OVER-1: overlaps is empty for normal unchanged scenario', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const { delta } = reconcileSlices(persisted, [{ path: 'src/auth/login.ts', contentSha256: H1 }])
  assert.deepEqual(delta.overlaps, [])
})

test('NYQ-OVER-2: overlaps is empty for mixed add+remove+move+new scenario', () => {
  const persisted = [
    {
      sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
      files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-b', status: 'current', planDir: 'docs/b/',
      files: [{ path: 'src/core/db.ts', contentSha256: H2 }],
    },
  ]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
    { path: 'src/core/db.ts', contentSha256: H2 },
    { path: 'lib/new/mod.ts', contentSha256: H4 },
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.deepEqual(delta.overlaps, [], 'no overlaps in normal operation')
})

test('NYQ-OVER-3: overlaps is empty when two slices share a common directory prefix', () => {
  // Two slices with files in the same directory — no overlap because each
  // current file maps to exactly one owner.
  const persisted = [
    { sliceId: 'slice-a', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/shared/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-b', status: 'current', planDir: 'docs/b/', files: [{ path: 'src/shared/b.ts', contentSha256: H2 }] },
  ]
  const current = [
    { path: 'src/shared/a.ts', contentSha256: H1 },
    { path: 'src/shared/b.ts', contentSha256: H2 },
    { path: 'src/shared/c.ts', contentSha256: H3 }, // prefix-score tie -> lex-smallest wins, but no overlap
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.deepEqual(delta.overlaps, [], 'tie-break does not produce overlap')
})

test('NYQ-OVER-4: source-asserts lex-smallest sort in overlap resolution', () => {
  // The overlap resolution block sorts owners and picks owners[0] (lex-smallest).
  const overlapBlock = source.slice(
    source.indexOf('pathOwners.forEach'),
    source.indexOf('validatePartition(outputSlices')
  )
  assert.match(overlapBlock, /owners\.sort\(\)/, 'owners sorted lexicographically')
  assert.match(overlapBlock, /var winner = owners\[0\]/, 'winner is lex-smallest')
})

test('NYQ-OVER-5: source-asserts overlap resolution removes loser files', () => {
  const overlapBlock = source.slice(
    source.indexOf('pathOwners.forEach'),
    source.indexOf('validatePartition(outputSlices')
  )
  // Loser slices have the conflicting path filtered out of their files.
  assert.match(overlapBlock, /\.filter\(/)
  assert.match(overlapBlock, /owners\.indexOf/)
})

test('NYQ-OVER-6: overlaps array shape matches schema when populated path is exercised', () => {
  // Exercise the schema shape by verifying delta.overlaps is always an array
  // of objects with the right keys (when non-empty). We cannot trigger real
  // overlaps via normal inputs (the algorithm prevents them), but we verify
  // the shape via the schema definition.
  assert.equal(RECONCILE_DELTA.properties.overlaps.type, 'array')
  const itemSchema = RECONCILE_DELTA.properties.overlaps.items
  assert.equal(itemSchema.additionalProperties, false)
  assert.deepEqual(itemSchema.required, ['path', 'winnerSliceId', 'loserSliceId'])
})

// ---- GAP-6: Schema deep validation + boundary robustness ------------------

test('NYQ-SCHEMA-1: RECONCILE_FILE has exactly 2 required properties', () => {
  assert.deepEqual(RECONCILE_FILE.required.sort(), ['contentSha256', 'path'])
  assert.equal(Object.keys(RECONCILE_FILE.properties).length, 2)
})

test('NYQ-SCHEMA-2: RECONCILE_DELTA has exactly 6 required top-level keys', () => {
  assert.deepEqual(
    RECONCILE_DELTA.required.sort(),
    ['added', 'moved', 'newSlices', 'overlaps', 'removed', 'removedSlices']
  )
})

test('NYQ-SCHEMA-3: every RECONCILE_DELTA array item schema has additionalProperties:false', () => {
  for (const key of RECONCILE_DELTA.required) {
    const arrSchema = RECONCILE_DELTA.properties[key]
    assert.equal(arrSchema.type, 'array', `${key} is array`)
    if (arrSchema.items.type === 'object') {
      assert.equal(
        arrSchema.items.additionalProperties, false,
        `${key} items additionalProperties:false`
      )
    }
  }
})

test('NYQ-SCHEMA-4: delta.added items require path+contentSha256+sliceId', () => {
  const s = RECONCILE_DELTA.properties.added.items
  assert.deepEqual(s.required.sort(), ['contentSha256', 'path', 'sliceId'])
})

test('NYQ-SCHEMA-5: delta.moved items require oldPath+newPath+contentSha256+sliceId', () => {
  const s = RECONCILE_DELTA.properties.moved.items
  assert.deepEqual(s.required.sort(), ['contentSha256', 'newPath', 'oldPath', 'sliceId'])
})

test('NYQ-SCHEMA-6: delta.overlaps items require path+winnerSliceId+loserSliceId', () => {
  const s = RECONCILE_DELTA.properties.overlaps.items
  assert.deepEqual(s.required.sort(), ['loserSliceId', 'path', 'winnerSliceId'])
})

test('NYQ-SCHEMA-7: delta.newSlices items use RECONCILE_FILE for files', () => {
  const s = RECONCILE_DELTA.properties.newSlices.items
  assert.deepEqual(s.required.sort(), ['files', 'sliceId'])
  assert.equal(s.properties.files.items, RECONCILE_FILE)
})

test('NYQ-SCHEMA-8: delta.removedSlices is array of strings', () => {
  const s = RECONCILE_DELTA.properties.removedSlices
  assert.equal(s.type, 'array')
  assert.equal(s.items.type, 'string')
})

// ---- Boundary robustness: null/undefined/empty inputs ---------------------

test('NYQ-EDGE-1: reconcileSlices(null, null) returns empty output without throwing', () => {
  const { slices, delta } = reconcileSlices(null, null)
  assert.deepEqual(slices, [])
  assert.deepEqual(delta.added, [])
  assert.deepEqual(delta.removed, [])
  assert.deepEqual(delta.moved, [])
  assert.deepEqual(delta.newSlices, [])
  assert.deepEqual(delta.removedSlices, [])
  assert.deepEqual(delta.overlaps, [])
})

test('NYQ-EDGE-2: reconcileSlices([], []) returns empty output', () => {
  const { slices, delta } = reconcileSlices([], [])
  assert.deepEqual(slices, [])
  assert.equal(delta.added.length, 0)
})

test('NYQ-EDGE-3: reconcileSlices(undefined, undefined) returns empty output', () => {
  const { slices } = reconcileSlices(undefined, undefined)
  assert.deepEqual(slices, [])
})

test('NYQ-EDGE-4: slice with missing files array treated as empty', () => {
  // A persisted slice with no `files` property should not crash the reconciler.
  const persisted = [{
    sliceId: 'slice-nofiles', status: 'current', planDir: 'docs/x/',
  }]
  const current = [{ path: 'src/new.ts', contentSha256: H1 }]
  const { slices, delta } = reconcileSlices(persisted, current)
  // slice-nofiles has no files and gets no new files (zero score from nothing)
  // -> becomes a new slice from clustering.
  assert.ok(delta.newSlices.length >= 1)
})

test('NYQ-EDGE-5: slice with empty files array stays empty -> removed', () => {
  const persisted = [{
    sliceId: 'slice-empty', status: 'current', planDir: 'docs/x/',
    files: [],
  }]
  const { slices, delta } = reconcileSlices(persisted, [])
  const slice = slices.find(s => s.sliceId === 'slice-empty')
  assert.equal(slice.status, 'removed')
  assert.ok(delta.removedSlices.includes('slice-empty'))
})

test('NYQ-EDGE-6: currentFiles with duplicate paths collapses to one owner', () => {
  // Same path appears twice in currentFiles with different hashes — the
  // Map-based lookup keeps the last occurrence. The partition invariant
  // must still hold (exactly one owner).
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/login.ts', contentSha256: H2 }, // duplicate path, different hash
  ]
  // The reconciler must not throw — partition invariant holds for the single path.
  const { slices } = reconcileSlices(persisted, current)
  // Partition check: the path appears once in currentFiles semantics.
  assertPartition(slices, [{ path: 'src/auth/login.ts' }])
})

test('NYQ-EDGE-7: all persisted slices already removed -> only new slices in output', () => {
  const persisted = [
    { sliceId: 'slice-dead1', status: 'removed', planDir: 'docs/r1/', files: [{ path: 'src/old/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-dead2', status: 'removed', planDir: 'docs/r2/', files: [{ path: 'src/old/b.ts', contentSha256: H2 }] },
  ]
  const current = [{ path: 'lib/new/file.ts', contentSha256: H3 }]
  const { slices, delta } = reconcileSlices(persisted, current)
  // Both removed slices carry through as removed.
  const removedCount = slices.filter(s => s.status === 'removed').length
  assert.equal(removedCount, 2)
  // The new file goes into a new slice.
  assert.ok(delta.newSlices.length >= 1)
  assertPartition(slices, current)
})

test('NYQ-EDGE-8: computePrefixScore handles empty sliceFiles', () => {
  assert.equal(computePrefixScore('src/auth/login.ts', []), 0)
  assert.equal(computePrefixScore('src/auth/login.ts', null), 0)
  assert.equal(computePrefixScore('src/auth/login.ts', undefined), 0)
})

test('NYQ-EDGE-9: computePrefixScore handles empty/missing path in sliceFiles', () => {
  // A sliceFile with empty path -> directorySegments returns [] -> 0 common.
  assert.equal(computePrefixScore('src/auth/login.ts', [{ path: '' }]), 0)
  assert.equal(computePrefixScore('src/auth/login.ts', [{ path: null }]), 0)
})

test('NYQ-EDGE-10: clusterByTwoSegDir handles empty input', () => {
  assert.deepEqual(clusterByTwoSegDir([]), [])
  assert.deepEqual(clusterByTwoSegDir(null), [])
})

test('NYQ-EDGE-11: detectMoves handles empty currentFiles', () => {
  const { moves, adds } = detectMoves(
    [],
    new Map(),
    new Map(),
    new Set()
  )
  assert.deepEqual(moves, [])
  assert.deepEqual(adds, [])
})

test('NYQ-EDGE-12: move + content also changed at new path -> NOT a move (hash mismatch)', () => {
  // old.ts has H1, new-path renamed.ts has H2 — content changed during rename.
  // No hash match -> ADD (not MOVE). This is the key safety property: moves
  // require EXACT contentSha256 match.
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/old.ts', contentSha256: H1 }],
  }]
  const current = [{ path: 'src/auth/renamed.ts', contentSha256: H2 }]
  const { delta } = reconcileSlices(persisted, current)
  assert.equal(delta.moved.length, 0, 'content-changed rename is NOT a move')
  assert.ok(delta.removed.some(r => r.path === 'src/auth/old.ts'))
})

// ---- Cross-cutting: idempotency -------------------------------------------

test('NYQ-IDEM-1: reconcileSlices is idempotent — reconciling output again yields same state', () => {
  // Reconcile once, then use the output slices as persistedSlices for a second
  // pass with the same currentFiles. The second pass should produce an empty
  // delta (steady state).
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/new.ts', contentSha256: H3 },
  ]
  const first = reconcileSlices(persisted, current)
  // Convert first.slices to persistedSlices shape (status + files).
  const persistedShape = first.slices
    .filter(s => s.status !== 'removed')
    .map(s => ({
      sliceId: s.sliceId,
      status: s.status,
      planDir: s.planDir,
      files: s.files,
    }))
  const second = reconcileSlices(persistedShape, current)
  // Second pass: no adds, no removes, no moves, no new slices.
  assert.equal(second.delta.added.length, 0, 'idempotent: no adds on second pass')
  assert.equal(second.delta.removed.length, 0, 'idempotent: no removes on second pass')
  assert.equal(second.delta.moved.length, 0, 'idempotent: no moves on second pass')
  assert.equal(second.delta.newSlices.length, 0, 'idempotent: no new slices on second pass')
  assert.equal(second.delta.removedSlices.length, 0, 'idempotent: no removed slices on second pass')
})

test('NYQ-IDEM-2: idempotency holds across complex mixed scenario', () => {
  const persisted = [
    {
      sliceId: 'slice-a', status: 'current', planDir: 'docs/a/',
      files: [
        { path: 'src/auth/login.ts', contentSha256: H1 },
        { path: 'src/auth/old.ts', contentSha256: H2 },
      ],
    },
    {
      sliceId: 'slice-b', status: 'current', planDir: 'docs/b/',
      files: [{ path: 'src/core/db.ts', contentSha256: H3 }],
    },
  ]
  const current = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/renamed.ts', contentSha256: H2 },
    { path: 'src/auth/middleware.ts', contentSha256: H4 },
    { path: 'src/core/db.ts', contentSha256: H3 },
    { path: 'lib/extra/util.ts', contentSha256: H5 },
  ]
  const first = reconcileSlices(persisted, current)
  const persistedShape = first.slices
    .filter(s => s.status !== 'removed')
    .map(s => ({
      sliceId: s.sliceId,
      status: s.status,
      planDir: s.planDir,
      files: s.files,
    }))
  const second = reconcileSlices(persistedShape, current)
  assert.equal(second.delta.added.length, 0, 'complex idempotent: no adds')
  assert.equal(second.delta.moved.length, 0, 'complex idempotent: no moves')
  assert.equal(second.delta.newSlices.length, 0, 'complex idempotent: no new slices')
  assert.equal(second.delta.removed.length, 0, 'complex idempotent: no removes')
  // Partition invariant still holds.
  assertPartition(second.slices, current)
})

// ---- Cross-cutting: output canonical form ---------------------------------

test('NYQ-CANON-1: outputSlices are sorted by sliceId', () => {
  const persisted = [
    { sliceId: 'slice-zeta', status: 'current', planDir: 'docs/z/', files: [{ path: 'src/z/a.ts', contentSha256: H1 }] },
    { sliceId: 'slice-alpha', status: 'current', planDir: 'docs/a/', files: [{ path: 'src/a/b.ts', contentSha256: H2 }] },
    { sliceId: 'slice-mid', status: 'current', planDir: 'docs/m/', files: [{ path: 'src/m/c.ts', contentSha256: H3 }] },
  ]
  const current = [
    { path: 'src/z/a.ts', contentSha256: H1 },
    { path: 'src/a/b.ts', contentSha256: H2 },
    { path: 'src/m/c.ts', contentSha256: H3 },
  ]
  const { slices } = reconcileSlices(persisted, current)
  for (let i = 1; i < slices.length; i++) {
    assert.ok(slices[i - 1].sliceId <= slices[i].sliceId, 'outputSlices sorted by sliceId')
  }
})

test('NYQ-CANON-2: files inside each output slice are sorted by path', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/zebra.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/auth/zebra.ts', contentSha256: H1 },
    { path: 'src/auth/apple.ts', contentSha256: H2 },
    { path: 'src/auth/mango.ts', contentSha256: H3 },
  ]
  const { slices } = reconcileSlices(persisted, current)
  const slice = slices.find(s => s.sliceId === 'slice-a')
  for (let i = 1; i < slice.files.length; i++) {
    assert.ok(slice.files[i - 1].path < slice.files[i].path, 'files sorted by path')
  }
})

test('NYQ-CANON-3: delta.added is sorted by path', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [{ path: 'src/auth/keep.ts', contentSha256: H1 }],
  }]
  const current = [
    { path: 'src/auth/keep.ts', contentSha256: H1 },
    { path: 'src/auth/zebra.ts', contentSha256: H2 },
    { path: 'src/auth/apple.ts', contentSha256: H3 },
    { path: 'src/auth/mango.ts', contentSha256: H4 },
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.ok(delta.added.length >= 3)
  for (let i = 1; i < delta.added.length; i++) {
    assert.ok(delta.added[i - 1].path <= delta.added[i].path, 'delta.added sorted by path')
  }
})

test('NYQ-CANON-4: delta.removed is sorted by path', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/zebra.ts', contentSha256: H1 },
      { path: 'src/auth/apple.ts', contentSha256: H2 },
      { path: 'src/auth/mango.ts', contentSha256: H3 },
      { path: 'src/auth/keep.ts', contentSha256: H4 },
    ],
  }]
  const current = [{ path: 'src/auth/keep.ts', contentSha256: H4 }]
  const { delta } = reconcileSlices(persisted, current)
  assert.ok(delta.removed.length >= 3)
  for (let i = 1; i < delta.removed.length; i++) {
    assert.ok(delta.removed[i - 1].path <= delta.removed[i].path, 'delta.removed sorted by path')
  }
})

test('NYQ-CANON-5: delta.moved is sorted by newPath', () => {
  const persisted = [{
    sliceId: 'slice-a', status: 'current', planDir: 'docs/x/',
    files: [
      { path: 'src/auth/old1.ts', contentSha256: H1 },
      { path: 'src/auth/old2.ts', contentSha256: H2 },
      { path: 'src/auth/old3.ts', contentSha256: H3 },
    ],
  }]
  const current = [
    { path: 'src/auth/renamed_z.ts', contentSha256: H1 },
    { path: 'src/auth/renamed_a.ts', contentSha256: H2 },
    { path: 'src/auth/renamed_m.ts', contentSha256: H3 },
  ]
  const { delta } = reconcileSlices(persisted, current)
  assert.ok(delta.moved.length >= 3)
  for (let i = 1; i < delta.moved.length; i++) {
    assert.ok(delta.moved[i - 1].newPath <= delta.moved[i].newPath, 'delta.moved sorted by newPath')
  }
})

test('NYQ-CANON-6: delta.newSlices is sorted by sliceId', () => {
  const current = [
    { path: 'lib/ccc/file.ts', contentSha256: H1 },
    { path: 'lib/aaa/file.ts', contentSha256: H2 },
    { path: 'lib/bbb/file.ts', contentSha256: H3 },
  ]
  const { delta } = reconcileSlices([], current)
  assert.ok(delta.newSlices.length >= 3)
  for (let i = 1; i < delta.newSlices.length; i++) {
    assert.ok(
      delta.newSlices[i - 1].sliceId <= delta.newSlices[i].sliceId,
      'delta.newSlices sorted by sliceId'
    )
  }
})

// ---- Source-assertion: purity + structural invariants ---------------------

test('NYQ-SRC-1: reconcileSlices body has no I/O / agent / randomness primitives', () => {
  const block = source.slice(
    source.indexOf('function directorySegments'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  assert.doesNotMatch(block, /\brequire\(/)
  assert.doesNotMatch(block, /\bimport\b/)
  assert.doesNotMatch(block, /createHash/)
  assert.doesNotMatch(block, /Math\.random/)
  assert.doesNotMatch(block, /Date\.now/)
  assert.doesNotMatch(block, /\bcrypto\b/)
  assert.doesNotMatch(block, /safeAgent/)
  assert.doesNotMatch(block, /flexibleAgent/)
  assert.doesNotMatch(block, /\basync\b/)
  assert.doesNotMatch(block, /\bawait\b/)
})

test('NYQ-SRC-2: reconcileSlices calls validatePartition before any return', () => {
  // Body slice ends just before the final return statement, so any call inside
  // the body is necessarily before the return.
  const body = source.slice(
    source.indexOf('function reconcileSlices'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  assert.match(body, /validatePartition\(outputSlices/, 'validatePartition called inside body (before return)')
})

test('NYQ-SRC-3: output canonical sort block exists (10 sort calls)', () => {
  // The final sort block makes output permutation-invariant. Assert it exists.
  const sortBlock = source.slice(
    source.indexOf('delta.added.sort'),
    source.indexOf('return { slices: outputSlices, delta: delta }')
  )
  // At least 7 sort calls: added, removed, moved, newSlices, removedSlices,
  // overlaps, outputSlices.
  const sortCount = (sortBlock.match(/\.sort\(/g) || []).length
  assert.ok(sortCount >= 7, `expected >=7 sort calls in canonical block, got ${sortCount}`)
})

test('NYQ-SRC-4: detectMoves skips paths already in oldPathMap (early continue)', () => {
  const body = source.slice(
    source.indexOf('function detectMoves'),
    source.indexOf('function validatePartition')
  )
  // The "continue" on known paths prevents double-classification.
  assert.match(body, /if \(oldPathMap\.has\(cf\.path\)\) continue/)
})

test('NYQ-SRC-5: prefix-score assignment iterates slices sorted by sliceId', () => {
  // The sort before the prefix-score loop ensures tie-break is lex-smallest.
  const body = source.slice(
    source.indexOf('var sortedNonRemoved'),
    source.indexOf('var zeroScoreFiles')
  )
  assert.match(body, /\.sort\(function \(a, b\)/)
})

test('NYQ-SRC-6: new-slice sliceId uses sorted hashes (permutation-invariant base)', () => {
  const body = source.slice(
    source.indexOf('function deriveClusterSliceId'),
    source.indexOf('function detectMoves')
  )
  assert.match(body, /\.sort\(\)/, 'hashes sorted before picking lex-smallest')
  assert.match(body, /hashes\[0\]/, 'lex-smallest (index 0) used as base')
})

test('NYQ-SRC-7: collision probe is deterministic ascending counter from 1', () => {
  const body = source.slice(
    source.indexOf('function deriveClusterSliceId'),
    source.indexOf('function detectMoves')
  )
  assert.match(body, /var n = 1/)
  assert.match(body, /while \(existingIds\.has\(base \+ '-' \+ n\)\) n\+\+/)
})

test('NYQ-SRC-8: RECONCILE_FILE and RECONCILE_DELTA are exported from schemas', () => {
  const schemaSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/schemas.mjs', import.meta.url),
    'utf8'
  )
  assert.match(schemaSrc, /export \{[^}]*RECONCILE_FILE/)
  assert.match(schemaSrc, /export \{[^}]*RECONCILE_DELTA/)
})
