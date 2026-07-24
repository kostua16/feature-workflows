// Nyquist characterization tests for Change Detection (D2.2).
// Fills sampling gaps: framed distinctness, fail-closed matrix, decision matrix,
// permutation invariance, validateDigest64Hex boundary, source-assertion robustness.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const { frameSliceDigest, validateDigest64Hex, detectSliceChanges } = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

const H1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const H2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
const H3 = '1111111111111111222222222222222233333333333333334444444444444444'

// Seeded shuffle for permutation tests (deterministic).
function seededShuffle(arr, seed) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280
    const j = Math.floor((seed / 233280) * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- GAP-1: Framed distinctness (extensive scenarios) ----

test('NYQ: same content hash at different paths → different frames', () => {
  const r1 = frameSliceDigest([{ path: 'src/x.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/y.ts', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

test('NYQ: different content hash at same path → different frames', () => {
  const r1 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H2 }])
  assert.notEqual(r1, r2)
})

test('NYQ: path with slashes vs backslashes → different frames (normalization not applied)', () => {
  const r1 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src\\a.ts', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

test('NYQ: unicode path → frame preserves UTF-8', () => {
  const r = frameSliceDigest([{ path: 'src/ 日本語.ts', contentSha256: H1 }])
  assert.ok(r.includes('src/ 日本語.ts'))
})

test('NYQ: very long path (255+ chars) → frame handles it', () => {
  const longPath = 'a'.repeat(300) + '.ts'
  const r = frameSliceDigest([{ path: longPath, contentSha256: H1 }])
  assert.ok(r.includes(longPath))
})

test('NYQ: prefix collision — "src/a" vs "src/ab" → different frames', () => {
  const r1 = frameSliceDigest([{ path: 'src/a', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/ab', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

test('NYQ: paths differing only in case → different frames (case-sensitive)', () => {
  const r1 = frameSliceDigest([{ path: 'src/A.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

// ---- GAP-2: Fail-closed coverage matrix ----

test('NYQ: persisted digest null → changed (persisted-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: null, valid: false } }, { s1: { digest: H1, valid: true } })
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: persisted digest undefined → changed (persisted-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: undefined, valid: false } }, { s1: { digest: H1, valid: true } })
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: persisted digest empty string → changed (persisted-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: '', valid: false } }, { s1: { digest: H1, valid: true } })
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: persisted digest 32-hex (MD5 length) → changed (persisted-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: H1.slice(0, 32), valid: false } }, { s1: { digest: H1, valid: true } })
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: persisted digest 64-uppercase-hex → changed (persisted-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: H1.toUpperCase(), valid: false } }, { s1: { digest: H1, valid: true } })
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: current digest null → changed (current-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: H1, valid: true } }, { s1: { digest: null, valid: false } })
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('NYQ: current digest undefined → changed (current-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: H1, valid: true } }, { s1: { digest: undefined, valid: false } })
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('NYQ: current digest non-hex string → changed (current-invalid)', () => {
  const result = detectSliceChanges({ s1: { digest: H1, valid: true } }, { s1: { digest: 'zzz', valid: false } })
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('NYQ: both invalid → current-invalid takes precedence (checked first)', () => {
  const result = detectSliceChanges(
    { s1: { digest: 'bad1', valid: false } },
    { s1: { digest: 'bad2', valid: false } }
  )
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

// ---- GAP-3: Decision matrix completeness ----

test('NYQ: 1 unchanged + 1 changed + 1 new + 1 removed → 4 decisions', () => {
  const persisted = {
    unchanged: { digest: H1, valid: true },
    changed: { digest: H2, valid: true },
    removed: { digest: H3, valid: true },
  }
  const current = {
    unchanged: { digest: H1, valid: true },
    changed: { digest: H3, valid: true },
    added: { digest: H2, valid: true },
  }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions.length, 4)
  assert.equal(result.unchangedCount, 1)
  assert.equal(result.changedCount, 3)
})

test('NYQ: all 4 fail-closed reasons exercised in one run', () => {
  const persisted = {
    s_match: { digest: H1, valid: true },    // digest-match → unchanged
    s_mism: { digest: H2, valid: true },     // digest-mismatch
    s_pinv: { digest: 'bad', valid: false }, // persisted-invalid
    s_rem: { digest: H3, valid: true },      // slice-removed
  }
  const current = {
    s_match: { digest: H1, valid: true },
    s_mism: { digest: H1, valid: true },
    s_pinv: { digest: H2, valid: true },
    s_new: { digest: H3, valid: true },      // new-slice
  }
  const result = detectSliceChanges(persisted, current)
  const reasons = result.decisions.map(d => d.reason).sort()
  assert.ok(reasons.includes('digest-match'))
  assert.ok(reasons.includes('digest-mismatch'))
  assert.ok(reasons.includes('persisted-invalid'))
  assert.ok(reasons.includes('new-slice'))
  assert.ok(reasons.includes('slice-removed'))
})

test('NYQ: slice with identical digests but different file lists → still unchanged by digest comparison', () => {
  // detectSliceChanges only compares digests; membership delta is reconcileSlices' job.
  const persisted = { s1: { digest: H1, valid: true } }
  const current = { s1: { digest: H1, valid: true } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'unchanged')
})

test('NYQ: detectSliceChanges iterates current then persisted (two loops, not one)', () => {
  const fnBody = source.slice(
    source.indexOf('function detectSliceChanges'),
    source.indexOf('var SLICE_DIGEST_READ_RESULT')
  )
  // The function should have two separate iteration blocks (for-in current, for-in persisted).
  assert.ok(fnBody.includes('for (var sliceId in current)'))
  assert.ok(fnBody.includes('for (var oldSliceId in persisted)'))
})

// ---- GAP-4: Frame permutation invariance (extensive) ----

test('NYQ: 5-file slice — 120 permutations → identical frame', () => {
  const files = [
    { path: 'a/x.ts', contentSha256: H1 },
    { path: 'b/y.ts', contentSha256: H2 },
    { path: 'c/z.ts', contentSha256: H3 },
    { path: 'd/w.ts', contentSha256: H1 },
    { path: 'e/v.ts', contentSha256: H2 },
  ]
  const baseline = frameSliceDigest(files)
  for (let seed = 1; seed <= 120; seed++) {
    const shuffled = seededShuffle(files, seed)
    assert.equal(frameSliceDigest(shuffled), baseline, `seed ${seed}`)
  }
})

test('NYQ: 10-file slice — shuffled 50 times → identical frame', () => {
  const files = []
  for (let i = 0; i < 10; i++) {
    files.push({ path: 'f' + i + '.ts', contentSha256: i % 2 === 0 ? H1 : H2 })
  }
  const baseline = frameSliceDigest(files)
  for (let seed = 1; seed <= 50; seed++) {
    const shuffled = seededShuffle(files, seed * 7)
    assert.equal(frameSliceDigest(shuffled), baseline, `seed ${seed}`)
  }
})

test('NYQ: duplicate paths with different hashes produce different frames when reversed', () => {
  // Sort is by path only; stable sort preserves original order of equal-path items.
  // Duplicate paths shouldn't happen in practice — this documents the behavior.
  const files = [
    { path: 'a.ts', contentSha256: H1 },
    { path: 'a.ts', contentSha256: H2 },
  ]
  const baseline = frameSliceDigest(files)
  const reversed = frameSliceDigest(files.slice().reverse())
  assert.notEqual(baseline, reversed)
})

// ---- GAP-5: validateDigest64Hex boundary ----

test('NYQ: exactly 64 hex chars → valid', () => {
  assert.equal(validateDigest64Hex(H1).valid, true)
})

test('NYQ: 63 chars → invalid', () => {
  assert.equal(validateDigest64Hex(H1.slice(0, 63)).valid, false)
})

test('NYQ: 65 chars → invalid', () => {
  assert.equal(validateDigest64Hex(H1 + 'a').valid, false)
})

test('NYQ: mixed case → invalid', () => {
  const mixed = 'A' + H1.slice(1)
  assert.equal(validateDigest64Hex(mixed).valid, false)
})

test('NYQ: all zeros (64 zeros) → valid', () => {
  assert.equal(validateDigest64Hex('0'.repeat(64)).valid, true)
})

test('NYQ: all f (64 fs) → valid', () => {
  assert.equal(validateDigest64Hex('f'.repeat(64)).valid, true)
})

// ---- GAP-6: Source-assertion robustness ----

test('NYQ: frameSliceDigest final statement is return JSON.stringify', () => {
  const fnBody = source.slice(
    source.indexOf('function frameSliceDigest'),
    source.indexOf('function validateDigest64Hex')
  )
  // The outermost return (last in the function body) must be the JSON.stringify.
  const lines = fnBody.split('\n')
  const returnLines = lines.filter(l => /^  return /.test(l))
  assert.ok(returnLines.length > 0, 'at least one outer-level return')
  assert.match(returnLines[returnLines.length - 1], /return JSON\.stringify/)
})

test('NYQ: no Math.random or Date.now in any Phase 16 function', () => {
  const srcMod = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/extract-scope.mjs', import.meta.url),
    'utf8'
  )
  const block = srcMod.slice(
    srcMod.indexOf('function frameSliceDigest'),
    srcMod.indexOf('\nexport { seedExtractQueue')
  )
  assert.ok(!/Math\.random|Date\.now/.test(block))
})

test('NYQ: computeSliceDigests prompt contains sha256 or SHA-256', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.ok(/sha256|SHA-256/.test(fnBody), 'agent prompt must reference SHA-256')
})

// ---- GAP-7: Validity flag trust contract (fail-closed on flag mismatch) ----

test('NYQ: current valid-64hex digest but valid:false → changed (current-invalid)', () => {
  // detectSliceChanges trusts the caller's valid flag, not the digest format.
  // A valid 64-hex digest marked invalid must still classify as changed.
  const result = detectSliceChanges(
    { s1: { digest: H1, valid: true } },
    { s1: { digest: H1, valid: false } }
  )
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('NYQ: persisted valid-64hex digest but valid:false → changed (persisted-invalid)', () => {
  const result = detectSliceChanges(
    { s1: { digest: H1, valid: false } },
    { s1: { digest: H2, valid: true } }
  )
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('NYQ: invalid digest but valid:true and matching → unchanged (trusts caller)', () => {
  // Contract documentation: detectSliceChanges delegates validation to the caller.
  // If the caller incorrectly marks an invalid digest as valid AND both digests
  // match, the result is 'unchanged'. This is a pure comparator.
  const result = detectSliceChanges(
    { s1: { digest: 'garbage', valid: true } },
    { s1: { digest: 'garbage', valid: true } }
  )
  assert.equal(result.decisions[0].status, 'unchanged')
  assert.equal(result.decisions[0].reason, 'digest-match')
})

// ---- GAP-8: Rename-same-bytes (explicit scenarios) ----

test('NYQ: rename old.ts → new.ts same content → different frames', () => {
  const before = frameSliceDigest([{ path: 'src/old.ts', contentSha256: H1 }])
  const after = frameSliceDigest([{ path: 'src/new.ts', contentSha256: H1 }])
  assert.notEqual(before, after)
})

test('NYQ: move to different directory same content → different frames', () => {
  const before = frameSliceDigest([{ path: 'module-a/file.ts', contentSha256: H1 }])
  const after = frameSliceDigest([{ path: 'module-b/file.ts', contentSha256: H1 }])
  assert.notEqual(before, after)
})

test('NYQ: case-change rename (User.ts → user.ts) same content → different frames', () => {
  const before = frameSliceDigest([{ path: 'src/User.ts', contentSha256: H1 }])
  const after = frameSliceDigest([{ path: 'src/user.ts', contentSha256: H1 }])
  assert.notEqual(before, after)
})

// ---- GAP-9: 64-hex whitespace boundaries ----

test('NYQ: leading whitespace in digest → invalid', () => {
  assert.equal(validateDigest64Hex(' ' + H1).valid, false)
})

test('NYQ: trailing whitespace in digest → invalid', () => {
  assert.equal(validateDigest64Hex(H1 + ' ').valid, false)
})

test('NYQ: internal space in digest → invalid', () => {
  assert.equal(validateDigest64Hex(H1.slice(0, 32) + ' ' + H1.slice(32)).valid, false)
})

test('NYQ: newline prefix in digest → invalid', () => {
  assert.equal(validateDigest64Hex('\n' + H1).valid, false)
})

test('NYQ: all distinct hex chars cycled to 64 → valid', () => {
  const allHexChars = '0123456789abcdef'
  assert.equal(validateDigest64Hex(allHexChars.repeat(4)).valid, true)
})

// ---- GAP-10: Force-override source structure ----

test('NYQ: runChangeDetection force branch maps reason to "forced"', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /reason:\s*'forced'/)
})

test('NYQ: runChangeDetection force branch sets status to "changed"', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  const forceIdx = fnBody.indexOf('if (force)')
  assert.ok(forceIdx > -1, 'force branch exists')
  const forceBlock = fnBody.slice(forceIdx, forceIdx + 200)
  assert.match(forceBlock, /status:\s*'changed'/)
})

// ---- GAP-11: Decision ordering and extra property tolerance ----

test('NYQ: current slice decisions come before removed slice decisions', () => {
  const persisted = {
    z_removed: { digest: H1, valid: true },
    a_current: { digest: H2, valid: true },
  }
  const current = {
    a_current: { digest: H3, valid: true },
  }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].sliceId, 'a_current')
  assert.equal(result.decisions[1].sliceId, 'z_removed')
})

test('NYQ: extra properties on digest entries are ignored', () => {
  const result = detectSliceChanges(
    { s1: { digest: H1, valid: true, extra: 'ignored', timestamp: 123 } },
    { s1: { digest: H1, valid: true, foo: 'bar', nested: { a: 1 } } }
  )
  assert.equal(result.decisions[0].status, 'unchanged')
})

test('NYQ: extra properties on file hash entries are ignored by frameSliceDigest', () => {
  const result = frameSliceDigest([
    { path: 'a.ts', contentSha256: H1, size: 42, mode: 0o644 },
  ])
  assert.equal(result, '[[\"a.ts\",\"' + H1 + '\"]]')
})

// ---- GAP-12: runChangeDetection fail-closed source assertions ----

test('NYQ: runChangeDetection agent failure marks all slices valid:false', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /else\s*\{[\s\S]*?valid:\s*false/)
})

test('NYQ: runChangeDetection extractReady checks for current-invalid', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /extractReady/)
  assert.match(fnBody, /current-invalid/)
})

test('NYQ: runChangeDetection persists only when curEntry.valid is true', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /curEntry\.valid/)
})

// ---- GAP-13: Multi-file framing distinctness (path-hash boundary) ----

test('NYQ: two-file frame differs from concatenated single-file frame', () => {
  const twoFiles = frameSliceDigest([
    { path: 'ab', contentSha256: H1 },
    { path: 'cd', contentSha256: H2 },
  ])
  const oneFile = frameSliceDigest([{ path: 'abcd', contentSha256: H1 + H2 }])
  assert.notEqual(twoFiles, oneFile)
})

test('NYQ: path-hash swap produces different frame', () => {
  const r1 = frameSliceDigest([{ path: 'abc', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: H1.slice(0, 3), contentSha256: 'abc' }])
  assert.notEqual(r1, r2)
})

// ---- GAP-14: validateDigest64Hex reason quality ----

test('NYQ: invalid digest results always include non-empty reason string', () => {
  const cases = [null, undefined, '', 42, 'z' + H1.slice(1), H1.slice(0, 63), H1 + 'a', H1.toUpperCase(), ' ' + H1]
  for (const c of cases) {
    const result = validateDigest64Hex(c)
    assert.equal(result.valid, false)
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, `case: ${String(c)}`)
  }
})

test('NYQ: valid digest result has no reason field', () => {
  const result = validateDigest64Hex(H1)
  assert.equal(result.valid, true)
  assert.ok(result.reason === undefined, 'valid result should not have a reason')
})
