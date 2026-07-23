// Change Detection (D2.2): frameSliceDigest, validateDigest64Hex, detectSliceChanges,
// computeSliceDigests, writeSliceDigestFile, readSliceDigestFile, runChangeDetection.
// Tests pure functions + source assertions + schema validation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  frameSliceDigest,
  validateDigest64Hex,
  detectSliceChanges,
  SLICE_DIGEST,
  SLICE_DIGEST_RESULT,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

const srcModule = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-scope.mjs', import.meta.url),
  'utf8'
)

// Valid 64-hex SHA-256 values for tests (exactly 64 lowercase hex chars each).
const H1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const H2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
const H3 = '1111111111111111222222222222222233333333333333334444444444444444'

// ---- RED tests (must pass — functions must exist) ----

test('RED: frameSliceDigest is defined and callable', () => {
  assert.equal(typeof frameSliceDigest, 'function')
})

test('RED: validateDigest64Hex is defined and callable', () => {
  assert.equal(typeof validateDigest64Hex, 'function')
})

test('RED: detectSliceChanges is defined and callable', () => {
  assert.equal(typeof detectSliceChanges, 'function')
})

test('RED: no crypto/createHash in frameSliceDigest body', () => {
  const fnBody = source.slice(
    source.indexOf('function frameSliceDigest'),
    source.indexOf('function validateDigest64Hex')
  )
  assert.ok(!/crypto|createHash/.test(fnBody), 'frameSliceDigest must not hash')
})

test('RED: no crypto/createHash import in extract-scope source module', () => {
  // Agent prompt strings may reference SHA-256, but the source must not import crypto.
  assert.ok(!/import.*crypto/.test(srcModule), 'extract-scope must not import crypto module')
})

test('RED: detectSliceChanges is pure — no safeAgent/async/Date.now/Math.random', () => {
  const fnBody = source.slice(
    source.indexOf('function detectSliceChanges'),
    source.indexOf('SLICE_DIGEST_READ_RESULT')
  )
  assert.ok(!/safeAgent|flexibleAgent|async|Date\.now|Math\.random/.test(fnBody),
    'detectSliceChanges must be pure')
})

// ---- GREEN tests — frameSliceDigest ----

test('frameSliceDigest: single file → JSON string with sorted pair', () => {
  const result = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H1 }])
  assert.equal(result, '[["src/a.ts","' + H1 + '"]]')
})

test('frameSliceDigest: multiple files sorted by path ascending', () => {
  const result = frameSliceDigest([
    { path: 'c/a.ts', contentSha256: H3 },
    { path: 'b/d.ts', contentSha256: H2 },
    { path: 'b/c.ts', contentSha256: H1 },
  ])
  // Expected order: b/c.ts, b/d.ts, c/a.ts
  assert.deepEqual(JSON.parse(result), [
    ['b/c.ts', H1],
    ['b/d.ts', H2],
    ['c/a.ts', H3],
  ])
})

test('frameSliceDigest: permutation invariance — reordered input produces identical output', () => {
  const files = [
    { path: 'c/a.ts', contentSha256: H3 },
    { path: 'a/b.ts', contentSha256: H1 },
    { path: 'b/c.ts', contentSha256: H2 },
  ]
  const r1 = frameSliceDigest(files)
  const r2 = frameSliceDigest(files.slice().reverse())
  assert.equal(r1, r2)
})

test('frameSliceDigest: empty array → "[]"', () => {
  assert.equal(frameSliceDigest([]), '[]')
})

test('frameSliceDigest: null/undefined input → "[]"', () => {
  assert.equal(frameSliceDigest(null), '[]')
  assert.equal(frameSliceDigest(undefined), '[]')
})

test('frameSliceDigest: framed distinctness — ["ab","c"] differs from ["a","bc"]', () => {
  const r1 = frameSliceDigest([{ path: 'ab', contentSha256: 'c' + H1.slice(1) }])
  const r2 = frameSliceDigest([{ path: 'a', contentSha256: 'bc' + H1.slice(2) }])
  assert.notEqual(r1, r2)
})

test('frameSliceDigest: two files same hash different paths → different from one file', () => {
  const r1 = frameSliceDigest([
    { path: 'a.ts', contentSha256: H1 },
    { path: 'b.ts', contentSha256: H1 },
  ])
  const r2 = frameSliceDigest([{ path: 'a.ts', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

test('frameSliceDigest: same content hash at different paths → different frames', () => {
  const r1 = frameSliceDigest([{ path: 'src/x.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/y.ts', contentSha256: H1 }])
  assert.notEqual(r1, r2)
})

test('frameSliceDigest: different content hash at same path → different frames', () => {
  const r1 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H1 }])
  const r2 = frameSliceDigest([{ path: 'src/a.ts', contentSha256: H2 }])
  assert.notEqual(r1, r2)
})

// ---- GREEN tests — validateDigest64Hex ----

test('validateDigest64Hex: valid 64-lowercase-hex → { valid: true }', () => {
  assert.deepEqual(validateDigest64Hex(H1), { valid: true })
})

test('validateDigest64Hex: uppercase hex → { valid: false }', () => {
  assert.equal(validateDigest64Hex(H1.toUpperCase()).valid, false)
})

test('validateDigest64Hex: 63-hex too short → { valid: false }', () => {
  assert.equal(validateDigest64Hex(H1.slice(0, 63)).valid, false)
})

test('validateDigest64Hex: 65-hex too long → { valid: false }', () => {
  assert.equal(validateDigest64Hex(H1 + 'a').valid, false)
})

test('validateDigest64Hex: empty string → { valid: false }', () => {
  assert.equal(validateDigest64Hex('').valid, false)
})

test('validateDigest64Hex: non-string null → { valid: false }', () => {
  assert.equal(validateDigest64Hex(null).valid, false)
})

test('validateDigest64Hex: non-string undefined → { valid: false }', () => {
  assert.equal(validateDigest64Hex(undefined).valid, false)
})

test('validateDigest64Hex: non-string number → { valid: false }', () => {
  assert.equal(validateDigest64Hex(42).valid, false)
})

test('validateDigest64Hex: non-hex char → { valid: false }', () => {
  const bad = 'z' + H1.slice(1)
  assert.equal(validateDigest64Hex(bad).valid, false)
})

test('validateDigest64Hex: all zeros (64 zeros) → { valid: true }', () => {
  assert.equal(validateDigest64Hex('0'.repeat(64)).valid, true)
})

test('validateDigest64Hex: all f (64 fs) → { valid: true }', () => {
  assert.equal(validateDigest64Hex('f'.repeat(64)).valid, true)
})

// ---- GREEN tests — detectSliceChanges ----

test('detectSliceChanges: matching digests → unchanged', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  const current = { s1: { digest: H1, valid: true } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'unchanged')
  assert.equal(result.decisions[0].reason, 'digest-match')
  assert.equal(result.unchangedCount, 1)
  assert.equal(result.changedCount, 0)
})

test('detectSliceChanges: differing digests → changed (digest-mismatch)', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  const current = { s1: { digest: H2, valid: true } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'digest-mismatch')
  assert.equal(result.changedCount, 1)
})

test('detectSliceChanges: new slice (in current, not in persisted) → changed (new-slice)', () => {
  const persisted = {}
  const current = { s1: { digest: H1, valid: true } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'new-slice')
})

test('detectSliceChanges: removed slice (in persisted, not in current) → changed (slice-removed)', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  const current = {}
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'slice-removed')
})

test('detectSliceChanges: invalid current digest → changed (current-invalid)', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  const current = { s1: { digest: 'bad', valid: false } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('detectSliceChanges: invalid persisted digest → changed (persisted-invalid)', () => {
  const persisted = { s1: { digest: 'bad', valid: false } }
  const current = { s1: { digest: H1, valid: true } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'persisted-invalid')
})

test('detectSliceChanges: missing current entry (undefined) → changed (current-invalid)', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  const current = { s1: undefined }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

test('detectSliceChanges: mix of unchanged + changed + new + removed', () => {
  const persisted = {
    s1: { digest: H1, valid: true }, // unchanged
    s2: { digest: H2, valid: true }, // will mismatch
    s4: { digest: H3, valid: true }, // removed (not in current)
  }
  const current = {
    s1: { digest: H1, valid: true }, // unchanged
    s2: { digest: H3, valid: true }, // changed
    s3: { digest: H2, valid: true }, // new
  }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions.length, 4)
  assert.equal(result.unchangedCount, 1)
  assert.equal(result.changedCount, 3)
  // Verify each decision
  const bySlice = {}
  for (const d of result.decisions) bySlice[d.sliceId] = d
  assert.equal(bySlice.s1.status, 'unchanged')
  assert.equal(bySlice.s2.status, 'changed')
  assert.equal(bySlice.s2.reason, 'digest-mismatch')
  assert.equal(bySlice.s3.status, 'changed')
  assert.equal(bySlice.s3.reason, 'new-slice')
  assert.equal(bySlice.s4.status, 'changed')
  assert.equal(bySlice.s4.reason, 'slice-removed')
})

test('detectSliceChanges: empty persisted + non-empty current → all new-slice', () => {
  const current = { s1: { digest: H1, valid: true }, s2: { digest: H2, valid: true } }
  const result = detectSliceChanges({}, current)
  assert.equal(result.changedCount, 2)
  assert.equal(result.unchangedCount, 0)
  for (const d of result.decisions) assert.equal(d.reason, 'new-slice')
})

test('detectSliceChanges: empty current + non-empty persisted → all slice-removed', () => {
  const persisted = { s1: { digest: H1, valid: true }, s2: { digest: H2, valid: true } }
  const result = detectSliceChanges(persisted, {})
  assert.equal(result.changedCount, 2)
  assert.equal(result.unchangedCount, 0)
  for (const d of result.decisions) assert.equal(d.reason, 'slice-removed')
})

test('detectSliceChanges: both empty → no decisions', () => {
  const result = detectSliceChanges({}, {})
  assert.equal(result.decisions.length, 0)
  assert.equal(result.changedCount, 0)
  assert.equal(result.unchangedCount, 0)
})

test('detectSliceChanges: null/undefined inputs → treated as empty objects', () => {
  const result = detectSliceChanges(null, undefined)
  assert.equal(result.decisions.length, 0)
  assert.doesNotThrow(() => detectSliceChanges(null, null))
})

test('detectSliceChanges: all unchanged → unchangedCount === N', () => {
  const persisted = {
    a: { digest: H1, valid: true },
    b: { digest: H2, valid: true },
  }
  const current = {
    a: { digest: H1, valid: true },
    b: { digest: H2, valid: true },
  }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.unchangedCount, 2)
  assert.equal(result.changedCount, 0)
})

test('detectSliceChanges: all changed → changedCount === N', () => {
  const persisted = {
    a: { digest: H1, valid: true },
    b: { digest: H2, valid: true },
  }
  const current = {
    a: { digest: H2, valid: true },
    b: { digest: H3, valid: true },
  }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.changedCount, 2)
  assert.equal(result.unchangedCount, 0)
})

test('detectSliceChanges: both invalid → current-invalid takes precedence (checked first)', () => {
  const persisted = { s1: { digest: 'bad1', valid: false } }
  const current = { s1: { digest: 'bad2', valid: false } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].reason, 'current-invalid')
})

// ---- GREEN tests — source assertions ----

test('source: computeSliceDigests is defined', () => {
  assert.match(source, /function computeSliceDigests\b/)
})

test('source: computeSliceDigests calls safeAgent', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.match(fnBody, /safeAgent/)
})

test('source: computeSliceDigests agent label includes slice-digest', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.match(fnBody, /slice-digest/)
})

test('source: computeSliceDigests agent phase is Change Detection', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.match(fnBody, /Change Detection/)
})

test('source: computeSliceDigests prompt instructs SHA-256 hashing', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.ok(/sha256|SHA-256/.test(fnBody), 'agent prompt must instruct SHA-256')
})

test('source: computeSliceDigests no crypto/createHash in body', () => {
  const fnBody = source.slice(
    source.indexOf('function computeSliceDigests'),
    source.indexOf('function writeSliceDigestFile')
  )
  assert.ok(!/crypto|createHash/.test(fnBody), 'engine must not hash directly')
})

test('source: computeSliceDigests is async', () => {
  assert.match(source, /async function computeSliceDigests\b/)
})

test('source: writeSliceDigestFile is defined', () => {
  assert.match(source, /function writeSliceDigestFile\b/)
})

test('source: writeSliceDigestFile calls safeAgent (file-writer)', () => {
  const fnBody = source.slice(
    source.indexOf('function writeSliceDigestFile'),
    source.indexOf('function readSliceDigestFile')
  )
  assert.match(fnBody, /safeAgent/)
})

test('source: writeSliceDigestFile validates digest via validateDigest64Hex before agent call', () => {
  const fnBody = source.slice(
    source.indexOf('function writeSliceDigestFile'),
    source.indexOf('function readSliceDigestFile')
  )
  const validateIdx = fnBody.indexOf('validateDigest64Hex')
  const agentIdx = fnBody.indexOf('safeAgent')
  assert.ok(validateIdx > -1, 'validateDigest64Hex called')
  assert.ok(agentIdx > -1, 'safeAgent called')
  assert.ok(validateIdx < agentIdx, 'validate called before agent')
})

test('source: writeSliceDigestFile returns null when digest invalid', () => {
  const fnBody = source.slice(
    source.indexOf('function writeSliceDigestFile'),
    source.indexOf('function readSliceDigestFile')
  )
  assert.match(fnBody, /if \(!validation\.valid\) return null/)
})

test('source: writeSliceDigestFile is async', () => {
  assert.match(source, /async function writeSliceDigestFile\b/)
})

test('source: readSliceDigestFile is defined', () => {
  assert.match(source, /function readSliceDigestFile\b/)
})

test('source: readSliceDigestFile calls safeAgent (file-reader)', () => {
  const fnBody = source.slice(
    source.indexOf('function readSliceDigestFile'),
    source.indexOf('function runChangeDetection')
  )
  assert.match(fnBody, /safeAgent/)
})

test('source: readSliceDigestFile is async', () => {
  assert.match(source, /async function readSliceDigestFile\b/)
})

test('source: readSliceDigestFile validates digest and includes validity flag', () => {
  const fnBody = source.slice(
    source.indexOf('function readSliceDigestFile'),
    source.indexOf('function runChangeDetection')
  )
  assert.match(fnBody, /validateDigest64Hex/)
  assert.match(fnBody, /valid/)
})

test('source: runChangeDetection is defined', () => {
  assert.match(source, /function runChangeDetection\b/)
})

test('source: runChangeDetection calls frameSliceDigest', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /frameSliceDigest/)
})

test('source: runChangeDetection calls computeSliceDigests', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /computeSliceDigests/)
})

test('source: runChangeDetection calls validateDigest64Hex', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /validateDigest64Hex/)
})

test('source: runChangeDetection calls detectSliceChanges', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /detectSliceChanges/)
})

test('source: runChangeDetection calls writeSliceDigestFile', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /writeSliceDigestFile/)
})

test('source: runChangeDetection handles force override', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /force/)
})

test('source: runChangeDetection is async', () => {
  assert.match(source, /async function runChangeDetection\b/)
})

test('source: runChangeDetection does NOT call invalidateSliceChain', () => {
  const fnBody = source.slice(
    source.indexOf('function runChangeDetection'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.ok(!/invalidateSliceChain/.test(fnBody), 'invalidation is Phase 17 scope')
})

test('source: all pure functions (frameSliceDigest, validateDigest64Hex, detectSliceChanges) have no safeAgent/flexibleAgent/async', () => {
  const pureBlock = source.slice(
    source.indexOf('function frameSliceDigest'),
    source.indexOf('var SLICE_DIGEST_READ_RESULT')
  )
  assert.ok(!/safeAgent|flexibleAgent|async/.test(pureBlock), 'pure functions must not call agents or be async')
})

test('source: no Math.random or Date.now in any Phase 16 function', () => {
  const block = srcModule.slice(
    srcModule.indexOf('function frameSliceDigest'),
    srcModule.indexOf('\nexport { seedExtractQueue')
  )
  assert.ok(!/Math\.random|Date\.now/.test(block), 'no randomness in change detection functions')
})

// ---- GREEN tests — schema validation ----

test('SLICE_DIGEST schema has additionalProperties: false', () => {
  assert.equal(SLICE_DIGEST.additionalProperties, false)
})

test('SLICE_DIGEST_RESULT schema has additionalProperties: false', () => {
  assert.equal(SLICE_DIGEST_RESULT.additionalProperties, false)
})

test('SLICE_DIGEST requires files and digest', () => {
  assert.ok(SLICE_DIGEST.required.includes('files'))
  assert.ok(SLICE_DIGEST.required.includes('digest'))
})

test('SLICE_DIGEST_RESULT requires slices', () => {
  assert.ok(SLICE_DIGEST_RESULT.required.includes('slices'))
})

test('SLICE_DIGEST is exported and accessible', () => {
  assert.ok(SLICE_DIGEST, 'SLICE_DIGEST schema is defined')
  assert.equal(SLICE_DIGEST.type, 'object')
})

test('SLICE_DIGEST_RESULT is exported and accessible', () => {
  assert.ok(SLICE_DIGEST_RESULT, 'SLICE_DIGEST_RESULT schema is defined')
  assert.equal(SLICE_DIGEST_RESULT.type, 'object')
})

// ---- GREEN tests — meta + cross-cutting ----

test('meta phases include Change Detection', () => {
  assert.match(source, /title: 'Change Detection'/)
})

test('source: no crypto import in extract-scope source module', () => {
  assert.ok(!/import.*crypto/.test(srcModule), 'extract-scope must not import crypto')
})

test('source: all new functions exported from extract-scope module', () => {
  assert.match(srcModule, /frameSliceDigest/)
  assert.match(srcModule, /validateDigest64Hex/)
  assert.match(srcModule, /detectSliceChanges/)
  assert.match(srcModule, /computeSliceDigests/)
  assert.match(srcModule, /writeSliceDigestFile/)
  assert.match(srcModule, /readSliceDigestFile/)
  assert.match(srcModule, /runChangeDetection/)
})
