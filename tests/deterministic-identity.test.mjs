// Phase 13 — Deterministic Identity & Hashing (D1.1).
// Tests pure validation + derivation functions, schema shapes, source assertions
// for hashSources/resolveScopePreflight/writeIdentity/promotePendingRecord/main.mjs
// integration, and the no-in-engine-hashing invariant.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  validateHashes,
  deriveFeatureFolder,
  normalizeToPosix,
  HASH_SOURCES_VERDICT,
  IDENTITY_RECORD,
  PREFLIGHT_VERDICT,
  PENDING_RECORD,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// A valid 64-hex SHA-256 for tests.
const H64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const H64b = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

// ---- normalizeToPosix (pure) ------------------------------------------------

test('normalizeToPosix: backslash to forward slash', () => {
  assert.equal(normalizeToPosix('src\\auth\\login.ts'), 'src/auth/login.ts')
})

test('normalizeToPosix: strips leading ./', () => {
  assert.equal(normalizeToPosix('./src/auth.ts'), 'src/auth.ts')
})

test('normalizeToPosix: strips leading /', () => {
  assert.equal(normalizeToPosix('/src/auth.ts'), 'src/auth.ts')
})

test('normalizeToPosix: strips repeated leading ./', () => {
  assert.equal(normalizeToPosix('././src.ts'), 'src.ts')
})

test('normalizeToPosix: empty/null returns empty', () => {
  assert.equal(normalizeToPosix(''), '')
  assert.equal(normalizeToPosix(null), '')
})

// ---- validateHashes (pure) --------------------------------------------------

test('validateHashes: all 64-hex contentSha256 + 64-hex scopeDigest → valid', () => {
  const files = [{ path: 'src/a.ts', contentSha256: H64 }, { path: 'src/b.ts', contentSha256: H64b }]
  const result = validateHashes(files, H64)
  assert.equal(result.valid, true)
})

test('validateHashes: empty fileHashes array → invalid', () => {
  const result = validateHashes([], H64)
  assert.equal(result.valid, false)
  assert.ok(result.reason)
})

test('validateHashes: null/undefined fileHashes → invalid', () => {
  assert.equal(validateHashes(null, H64).valid, false)
  assert.equal(validateHashes(undefined, H64).valid, false)
})

test('validateHashes: null/undefined scopeDigest → invalid', () => {
  const files = [{ path: 'src/a.ts', contentSha256: H64 }]
  assert.equal(validateHashes(files, null).valid, false)
  assert.equal(validateHashes(files, undefined).valid, false)
})

test('validateHashes: 63-hex contentSha256 → invalid (too short)', () => {
  const shortHex = H64.slice(0, 63)
  const files = [{ path: 'src/a.ts', contentSha256: shortHex }]
  assert.equal(validateHashes(files, H64).valid, false)
})

test('validateHashes: 65-hex contentSha256 → invalid (too long)', () => {
  const longHex = H64 + 'a'
  const files = [{ path: 'src/a.ts', contentSha256: longHex }]
  assert.equal(validateHashes(files, H64).valid, false)
})

test('validateHashes: uppercase hex contentSha256 → invalid', () => {
  const upperHex = H64.toUpperCase()
  const files = [{ path: 'src/a.ts', contentSha256: upperHex }]
  assert.equal(validateHashes(files, H64).valid, false)
})

test('validateHashes: malformed scopeDigest (32-hex) → invalid', () => {
  const files = [{ path: 'src/a.ts', contentSha256: H64 }]
  assert.equal(validateHashes(files, H64.slice(0, 32)).valid, false)
})

test('validateHashes: missing contentSha256 field → invalid', () => {
  const files = [{ path: 'src/a.ts' }]
  assert.equal(validateHashes(files, H64).valid, false)
})

test('validateHashes: missing path field → invalid', () => {
  const files = [{ contentSha256: H64 }]
  assert.equal(validateHashes(files, H64).valid, false)
})

// ---- deriveFeatureFolder (pure) ---------------------------------------------

test('deriveFeatureFolder: 3-segment path → area = first 2 segments', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/auth/login.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.area, 'src/auth')
})

test('deriveFeatureFolder: 1-segment path → area = uncategorized', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'README.md', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.area, 'uncategorized')
})

test('deriveFeatureFolder: 2-segment path → area = both segments', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'lib/utils.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  // area is first 2 path segments: lib/utils.ts
  assert.equal(result.area, 'lib/utils.ts')
})

test('deriveFeatureFolder: entry points excluded from anchor', () => {
  const result = deriveFeatureFolder({
    fileHashes: [
      { path: 'aaa/entry.ts', contentSha256: H64 },
      { path: 'bbb/core.ts', contentSha256: H64b },
    ],
    scopeDigest: H64,
    entryPoints: ['aaa/entry.ts'],
  })
  assert.equal(result.anchorPath, 'bbb/core.ts')
  assert.equal(result.area, 'bbb/core.ts')
})

test('deriveFeatureFolder: all files are entry points → fallback to all paths', () => {
  const result = deriveFeatureFolder({
    fileHashes: [
      { path: 'aaa/entry.ts', contentSha256: H64 },
      { path: 'bbb/main.ts', contentSha256: H64b },
    ],
    scopeDigest: H64,
    entryPoints: ['aaa/entry.ts', 'bbb/main.ts'],
  })
  // Fallback: lex-smallest of the full set
  assert.equal(result.anchorPath, 'aaa/entry.ts')
})

test('deriveFeatureFolder: primarySlug from anchor filename', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/auth/login-controller.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  // categorizeSlug collapses non-alphanumeric to hyphens (.ts → -ts)
  assert.equal(result.primarySlug, 'login-controller-ts')
})

test('deriveFeatureFolder: scopeId16 = first 16 hex of scopeDigest', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.scopeId16, H64.slice(0, 16))
})

test('deriveFeatureFolder: featureId = <primarySlug>-<scopeId16>', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.featureId, result.primarySlug + '-' + result.scopeId16)
})

test('deriveFeatureFolder: planDir = docs/extract/<area>/<featureId>/', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.planDir, 'docs/extract/' + result.area + '/' + result.featureId + '/')
})

test('deriveFeatureFolder: same inputs → identical output (deterministic)', () => {
  const args = {
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }, { path: 'src/b.ts', contentSha256: H64b }],
    scopeDigest: H64,
    entryPoints: [],
  }
  const r1 = deriveFeatureFolder(args)
  const r2 = deriveFeatureFolder(args)
  assert.deepEqual(r1, r2)
})

test('deriveFeatureFolder: different scopeDigest → different featureId/planDir', () => {
  const args1 = {
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  }
  const args2 = {
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64b,
    entryPoints: [],
  }
  const r1 = deriveFeatureFolder(args1)
  const r2 = deriveFeatureFolder(args2)
  assert.notEqual(r1.featureId, r2.featureId)
  assert.notEqual(r1.planDir, r2.planDir)
})

test('deriveFeatureFolder: lex-smallest non-entry-point is anchor', () => {
  const result = deriveFeatureFolder({
    fileHashes: [
      { path: 'src/zzz.ts', contentSha256: H64 },
      { path: 'src/aaa.ts', contentSha256: H64b },
    ],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.anchorPath, 'src/aaa.ts')
})

// ---- Schema assertions ------------------------------------------------------

test('HASH_SOURCES_VERDICT schema has additionalProperties: false', () => {
  assert.equal(HASH_SOURCES_VERDICT.additionalProperties, false)
})

test('HASH_SOURCES_VERDICT requires files and scopeDigest', () => {
  assert.deepEqual(HASH_SOURCES_VERDICT.required.sort(), ['files', 'scopeDigest'].sort())
})

test('IDENTITY_RECORD schema has additionalProperties: false', () => {
  assert.equal(IDENTITY_RECORD.additionalProperties, false)
})

test('IDENTITY_RECORD requires featureId, planDir, ownershipScopeDigest, area, createdAt', () => {
  assert.deepEqual(IDENTITY_RECORD.required.sort(),
    ['area', 'createdAt', 'featureId', 'ownershipScopeDigest', 'planDir'].sort())
})

test('PREFLIGHT_VERDICT accepts fileHashes, scopeDigest, featureId, derivedPlanDir', () => {
  assert.ok(PREFLIGHT_VERDICT.properties.fileHashes, 'fileHashes property exists')
  assert.ok(PREFLIGHT_VERDICT.properties.scopeDigest, 'scopeDigest property exists')
  assert.ok(PREFLIGHT_VERDICT.properties.featureId, 'featureId property exists')
  assert.ok(PREFLIGHT_VERDICT.properties.derivedPlanDir, 'derivedPlanDir property exists')
})

test('PENDING_RECORD accepts fileHashes, scopeDigest, featureId, derivedPlanDir', () => {
  assert.ok(PENDING_RECORD.properties.fileHashes, 'fileHashes property exists')
  assert.ok(PENDING_RECORD.properties.scopeDigest, 'scopeDigest property exists')
  assert.ok(PENDING_RECORD.properties.featureId, 'featureId property exists')
  assert.ok(PENDING_RECORD.properties.derivedPlanDir, 'derivedPlanDir property exists')
})

// ---- Source assertions: pure functions exist --------------------------------

test('source: normalizeToPosix function is defined', () => {
  assert.match(source, /function normalizeToPosix\b/)
})

test('source: validateHashes function is defined', () => {
  assert.match(source, /function validateHashes\b/)
})

test('source: deriveFeatureFolder function is defined', () => {
  assert.match(source, /function deriveFeatureFolder\b/)
})

test('source: hashSources function is defined', () => {
  assert.match(source, /function hashSources\b/)
})

// ---- Source assertions: hashSources agent integration -----------------------

test('source: hashSources uses safeAgent (agent-mediated hashing)', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /safeAgent\(/)
})

test('source: hashSources uses HASH_SOURCES_VERDICT schema', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /HASH_SOURCES_VERDICT/)
})

test('source: hashSources agent label is hash-sources', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /label:\s*'hash-sources'/)
})

// ---- Source assertions: resolveScopePreflight integration -------------------

test('source: resolveScopePreflight calls hashSources', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /hashSources\(/)
})

test('source: resolveScopePreflight calls validateHashes before deriveFeatureFolder', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  const validateIdx = fnBody.indexOf('validateHashes')
  const deriveIdx = fnBody.indexOf('deriveFeatureFolder')
  assert.ok(validateIdx > -1, 'validateHashes called')
  assert.ok(deriveIdx > -1, 'deriveFeatureFolder called')
  assert.ok(validateIdx < deriveIdx, 'validateHashes called before deriveFeatureFolder')
})

test('source: resolveScopePreflight returns derivedPlanDir and fileHashes on success', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /derivedPlanDir/)
  assert.match(fnBody, /fileHashes/)
  assert.match(fnBody, /scopeDigest/)
  assert.match(fnBody, /featureId/)
})

test('source: resolveScopePreflight returns hashError on validation failure', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /hashError/)
})

// ---- Source assertions: writeIdentity (replaces stub) -----------------------

test('source: writeIdentity function is defined', () => {
  assert.match(source, /function writeIdentity\b/)
})

test('source: writeIdentityStub is NOT defined (replaced)', () => {
  assert.doesNotMatch(source, /function writeIdentityStub\b/)
})

test('source: writeIdentity accepts an object arg with identity fields', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /identityPath/)
  assert.match(fnBody, /scopeDigest/)
  assert.match(fnBody, /ownershipScopeDigest/)
  assert.match(fnBody, /temp-then-rename/)
})

test('source: writeIdentity writes ownershipScopeDigest (not null)', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  // Must assign scopeDigest to ownershipScopeDigest (not null)
  assert.match(fnBody, /ownershipScopeDigest:\s*scopeDigest/)
  assert.doesNotMatch(fnBody, /ownershipScopeDigest:\s*null/)
})

// ---- Source assertions: promotePendingRecord integration --------------------

test('source: promotePendingRecord NEW branch calls writeIdentity (not stub)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /writeIdentity\(/)
  assert.doesNotMatch(fnBody, /writeIdentityStub/)
})

test('source: promotePendingRecord accepts identityFields arg', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /identityFields/)
})

test('source: promotePendingRecord EXISTING branch does NOT call writeIdentity', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const existingIdx = fnBody.indexOf('EXISTING feature')
  const promotedIdx = fnBody.indexOf('Update pending record to PROMOTED')
  assert.ok(existingIdx > -1, 'EXISTING branch found')
  assert.ok(promotedIdx > existingIdx, 'Update pending marker after EXISTING')
  const existingSection = fnBody.slice(existingIdx, promotedIdx)
  assert.doesNotMatch(existingSection, /writeIdentity/)
})

// ---- Source assertions: main.mjs extract mode planDir override --------------

test('source: extract mode bypasses categorizer for fresh runs', () => {
  // Look for the bypass: extract mode without confirmRecord uses placeholder
  assert.match(source, /docs\/extract\/\.pending\/plan\.md/)
})

test('source: --confirm uses derivedPlanDir from pending record', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /confirmRecord\.derivedPlanDir/)
})

test('source: preflight result overrides planDir with derivedPlanDir', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /preflight\.derivedPlanDir/)
})

test('source: hashError blocks with blockedAt', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /extract-hash-error/)
  assert.match(extractBranch, /hashError/)
})

test('source: promotion passes identityFields to promotePendingRecord', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /identityFields/)
  assert.match(extractBranch, /scopeDigest:\s*confirmRecord\.scopeDigest/)
})

// ---- Source assertions: categorizer NOT called for extract mode -------------

test('source: CATEGORY_VERDICT is not in the extract fresh-run path', () => {
  // The categorizer block should be guarded by gateModeActive('design', mode)
  // and NOT include isExtractMode
  const catSection = source.slice(
    source.indexOf('gateModeActive'),
    source.indexOf('const definitionPath')
  )
  // The first gateModeActive check should NOT have isExtractMode as an alternative
  // (extract has its own branches before this)
  const firstGateCheck = catSection.slice(0, 200)
  assert.doesNotMatch(firstGateCheck, /isExtractMode/)
})

// ---- Source assertions: no in-engine SHA-256 --------------------------------

test('source: no crypto/createHash import in engine source files', () => {
  // The engine source must NOT import crypto or use createHash
  // (hashing is exclusively agent-mediated)
  assert.doesNotMatch(source, /import.*crypto/)
  assert.doesNotMatch(source, /require\(['"]crypto['"]\)/)
  assert.doesNotMatch(source, /createHash\(/)
})

test('source: hashSources prompt describes SHA-256 framing recipe', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /SHA-256/i)
  assert.match(fnBody, /scopeDigest/)
  assert.match(fnBody, /sort/i)
})

// ---- Source assertions: meta phases -----------------------------------------

test('source: meta declares Hash Sources phase', () => {
  assert.match(source, /title:\s*'Hash Sources'/)
})
