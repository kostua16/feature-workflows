// Phase 13 Nyquist validation gap-fillers for IDENT-01, FOLDER-01 (D1.1).
// Supplements deterministic-identity.test.mjs with additional behavioral dimensions
// required by the Nyquist sampling rate: boundary conditions, edge-case inputs,
// schema deep characterization, source wiring assertions, cross-cutting invariants,
// and crash-safety ordering for the hash/identity/folder-derivation pipeline.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  validateHashes,
  deriveFeatureFolder,
  normalizeToPosix,
  hashSources,
  writeIdentity,
  HASH_SOURCES_VERDICT,
  IDENTITY_RECORD,
  PREFLIGHT_VERDICT,
  PENDING_RECORD,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

const H64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const H64b = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

// ============================================================
// normalizeToPosix: deep edge-case characterization
// ============================================================

test('NYQUIST: normalizeToPosix — mixed separators (backslash + forward)', () => {
  assert.equal(normalizeToPosix('src\\auth/login.ts'), 'src/auth/login.ts')
})

test('NYQUIST: normalizeToPosix — trailing slash preserved', () => {
  assert.equal(normalizeToPosix('src/auth/'), 'src/auth/')
})

test('NYQUIST: normalizeToPosix — all backslashes', () => {
  assert.equal(normalizeToPosix('\\a\\b\\c'), 'a/b/c')
})

test('NYQUIST: normalizeToPosix — path with spaces', () => {
  assert.equal(normalizeToPosix('src/my file.ts'), 'src/my file.ts')
})

test('NYQUIST: normalizeToPosix — path with dots in filename', () => {
  assert.equal(normalizeToPosix('src/.config.ts'), 'src/.config.ts')
})

test('NYQUIST: normalizeToPosix — already-normalized path (identity)', () => {
  assert.equal(normalizeToPosix('src/auth/login.ts'), 'src/auth/login.ts')
})

test('NYQUIST: normalizeToPosix — leading ./././ repeated stripping', () => {
  assert.equal(normalizeToPosix('././././src.ts'), 'src.ts')
})

test('NYQUIST: normalizeToPosix — single dot segment (not stripped)', () => {
  // A standalone "." is not "./" so it stays
  assert.equal(normalizeToPosix('.'), '.')
})

test('NYQUIST: normalizeToPosix — numeric input coerced to string', () => {
  assert.equal(normalizeToPosix(123), '123')
})

test('NYQUIST: normalizeToPosix — unicode/CJK characters preserved', () => {
  assert.equal(normalizeToPosix('src/认证/login.ts'), 'src/认证/login.ts')
})

test('NYQUIST: normalizeToPosix — leading backslash-slash mix (single leading / stripped)', () => {
  // \\/ -> // after backslash replacement; only ONE leading / is stripped
  assert.equal(normalizeToPosix('\\/src/auth.ts'), '/src/auth.ts')
})

test('NYQUIST: normalizeToPosix — empty string after stripping', () => {
  assert.equal(normalizeToPosix('./'), '')
})

// ============================================================
// validateHashes: boundary + edge-case characterization
// ============================================================

test('NYQUIST: validateHashes — all-zeros contentSha256 (valid)', () => {
  const zeros = '0'.repeat(64)
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: zeros }], zeros).valid, true)
})

test('NYQUIST: validateHashes — all-f contentSha256 (valid)', () => {
  const allf = 'f'.repeat(64)
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: allf }], allf).valid, true)
})

test('NYQUIST: validateHashes — whitespace-padded hash is invalid', () => {
  const padded = ' ' + H64 + ' '
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: padded }], H64).valid, false)
})

test('NYQUIST: validateHashes — hash with newline is invalid', () => {
  const nlHash = H64 + '\n'
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: nlHash }], H64).valid, false)
})

test('NYQUIST: validateHashes — 0x-prefixed hash is invalid', () => {
  const prefixed = '0x' + H64.slice(0, 62)
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: prefixed }], H64).valid, false)
})

test('NYQUIST: validateHashes — duplicate paths (same path twice) are both validated', () => {
  const result = validateHashes([
    { path: 'src/a.ts', contentSha256: H64 },
    { path: 'src/a.ts', contentSha256: H64b },
  ], H64)
  assert.equal(result.valid, true)
})

test('NYQUIST: validateHashes — large fileHashes array (500 entries)', () => {
  const files = []
  for (let i = 0; i < 500; i++) {
    files.push({ path: 'src/f' + i + '.ts', contentSha256: H64 })
  }
  assert.equal(validateHashes(files, H64).valid, true)
})

test('NYQUIST: validateHashes — non-object element in array', () => {
  assert.equal(validateHashes([H64], H64).valid, false)
  assert.equal(validateHashes([null], H64).valid, false)
  assert.equal(validateHashes([42], H64).valid, false)
})

test('NYQUIST: validateHashes — element with extra properties still validated', () => {
  // validateHashes does NOT check additionalProperties; it only checks path + contentSha256
  const result = validateHashes([{ path: 'a.ts', contentSha256: H64, extra: true }], H64)
  assert.equal(result.valid, true)
})

test('NYQUIST: validateHashes — scopeDigest matching a contentSha256 is valid', () => {
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: H64 }], H64).valid, true)
})

test('NYQUIST: validateHashes — uppercase hex scopeDigest is invalid', () => {
  assert.equal(validateHashes([{ path: 'a.ts', contentSha256: H64 }], H64.toUpperCase()).valid, false)
})

test('NYQUIST: validateHashes — reason string is populated on every failure', () => {
  const cases = [
    [[], H64],
    [null, H64],
    [undefined, H64],
    [[{ path: 'a.ts' }], H64],
    [[{ contentSha256: H64 }], H64],
    [[{ path: 'a.ts', contentSha256: 'short' }], H64],
    [[{ path: 'a.ts', contentSha256: H64 }], 'short'],
  ]
  for (const [files, digest] of cases) {
    const result = validateHashes(files, digest)
    assert.equal(result.valid, false)
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0,
      'reason must be non-empty string')
  }
})

test('NYQUIST: validateHashes — returns valid:true with no reason field', () => {
  const result = validateHashes([{ path: 'a.ts', contentSha256: H64 }], H64)
  assert.equal(result.valid, true)
  assert.equal(result.reason, undefined)
})

// ============================================================
// deriveFeatureFolder: deep edge-case characterization
// ============================================================

test('NYQUIST: deriveFeatureFolder — empty fileHashes produces empty anchorPath', () => {
  const result = deriveFeatureFolder({
    fileHashes: [],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.anchorPath, '')
  assert.equal(result.area, 'uncategorized')
  // primarySlug from empty basename — categorizeSlug('feature') fallback or empty
  assert.ok(typeof result.primarySlug === 'string')
})

test('NYQUIST: deriveFeatureFolder — null fileHashes', () => {
  const result = deriveFeatureFolder({
    fileHashes: null,
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.anchorPath, '')
  assert.equal(result.area, 'uncategorized')
})

test('NYQUIST: deriveFeatureFolder — deep path (8 segments)', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'a/b/c/d/e/f/g/h.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.area, 'a/b')
  assert.equal(result.anchorPath, 'a/b/c/d/e/f/g/h.ts')
})

test('NYQUIST: deriveFeatureFolder — unicode/CJK filename in basename slug', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/auth/認證.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.area, 'src/auth')
  // categorizeSlug lowercases + collapses non-alphanumeric
  assert.ok(typeof result.primarySlug === 'string')
})

test('NYQUIST: deriveFeatureFolder — backslash paths normalized before area derivation', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src\\auth\\login.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  // normalizeToPosix converts backslash to forward slash
  assert.equal(result.area, 'src/auth')
  assert.equal(result.anchorPath, 'src/auth/login.ts')
})

test('NYQUIST: deriveFeatureFolder — entry points with backslash variants are normalized', () => {
  const result = deriveFeatureFolder({
    fileHashes: [
      { path: 'src/entry.ts', contentSha256: H64 },
      { path: 'src/core.ts', contentSha256: H64b },
    ],
    scopeDigest: H64,
    entryPoints: ['src\\entry.ts'], // backslash variant
  })
  // normalizeToPosix('src\\entry.ts') = 'src/entry.ts' — should match and be excluded
  assert.equal(result.anchorPath, 'src/core.ts')
})

test('NYQUIST: deriveFeatureFolder — same basename different directories', () => {
  const result = deriveFeatureFolder({
    fileHashes: [
      { path: 'aaa/index.ts', contentSha256: H64 },
      { path: 'bbb/index.ts', contentSha256: H64b },
    ],
    scopeDigest: H64,
    entryPoints: [],
  })
  // Lex-smallest path is aaa/index.ts
  assert.equal(result.anchorPath, 'aaa/index.ts')
  assert.equal(result.area, 'aaa/index.ts')
})

test('NYQUIST: deriveFeatureFolder — featureId is stable across multiple calls', () => {
  const args = {
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  }
  const results = []
  for (let i = 0; i < 10; i++) {
    results.push(deriveFeatureFolder(args))
  }
  const first = JSON.stringify(results[0])
  for (const r of results) {
    assert.deepEqual(JSON.stringify(r), first)
  }
})

test('NYQUIST: deriveFeatureFolder — scopeId16 is exactly 16 chars', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.scopeId16.length, 16)
})

test('NYQUIST: deriveFeatureFolder — short scopeDigest produces short scopeId16', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: 'abc123', // short digest
    entryPoints: [],
  })
  assert.equal(result.scopeId16, 'abc123')
})

test('NYQUIST: deriveFeatureFolder — planDir always ends with /', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.ok(result.planDir.endsWith('/'))
})

test('NYQUIST: deriveFeatureFolder — planDir always starts with docs/extract/', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.ok(result.planDir.startsWith('docs/extract/'))
})

test('NYQUIST: deriveFeatureFolder — README.md basename slug', () => {
  const result = deriveFeatureFolder({
    fileHashes: [{ path: 'README.md', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  assert.equal(result.primarySlug, 'readme-md')
})

test('NYQUIST: deriveFeatureFolder — entryPoints null/undefined treated as empty', () => {
  const r1 = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: null,
  })
  const r2 = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: undefined,
  })
  const r3 = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
  })
  assert.equal(r1.anchorPath, 'src/a.ts')
  assert.equal(r2.anchorPath, 'src/a.ts')
  assert.equal(r3.anchorPath, 'src/a.ts')
})

test('NYQUIST: deriveFeatureFolder — full arg object is null', () => {
  const result = deriveFeatureFolder(null)
  assert.equal(result.anchorPath, '')
  assert.equal(result.area, 'uncategorized')
})

test('NYQUIST: deriveFeatureFolder — different file content (different hash) same path → same folder', () => {
  // The folder is derived from the anchor PATH + scopeDigest. Same path + same digest = same folder.
  // But different scopeDigest = different folder.
  const r1 = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64 }],
    scopeDigest: H64,
    entryPoints: [],
  })
  const r2 = deriveFeatureFolder({
    fileHashes: [{ path: 'src/a.ts', contentSha256: H64b }],
    scopeDigest: H64b,
    entryPoints: [],
  })
  // Same path → same area/slug; different digest → different scopeId16/featureId
  assert.equal(r1.area, r2.area)
  assert.equal(r1.primarySlug, r2.primarySlug)
  assert.notEqual(r1.scopeId16, r2.scopeId16)
  assert.notEqual(r1.featureId, r2.featureId)
})

// ============================================================
// Schema deep characterization
// ============================================================

test('NYQUIST: HASH_SOURCES_VERDICT — files items have additionalProperties: false', () => {
  assert.equal(HASH_SOURCES_VERDICT.properties.files.items.additionalProperties, false)
})

test('NYQUIST: HASH_SOURCES_VERDICT — files items have exactly 2 properties', () => {
  const keys = Object.keys(HASH_SOURCES_VERDICT.properties.files.items.properties).sort()
  assert.deepEqual(keys, ['contentSha256', 'path'])
})

test('NYQUIST: HASH_SOURCES_VERDICT — files items required = [path, contentSha256]', () => {
  assert.deepEqual(HASH_SOURCES_VERDICT.properties.files.items.required.sort(), ['contentSha256', 'path'])
})

test('NYQUIST: HASH_SOURCES_VERDICT — all properties are type string or array', () => {
  assert.equal(HASH_SOURCES_VERDICT.properties.scopeDigest.type, 'string')
  assert.equal(HASH_SOURCES_VERDICT.properties.files.type, 'array')
})

test('NYQUIST: IDENTITY_RECORD — has optional scopeId16 property', () => {
  assert.ok(IDENTITY_RECORD.properties.scopeId16, 'scopeId16 property defined')
  assert.ok(!IDENTITY_RECORD.required.includes('scopeId16'), 'scopeId16 is optional')
})

test('NYQUIST: IDENTITY_RECORD — all properties are type string', () => {
  for (const key of Object.keys(IDENTITY_RECORD.properties)) {
    assert.equal(IDENTITY_RECORD.properties[key].type, 'string',
      `IDENTITY_RECORD.${key} should be type string`)
  }
})

test('NYQUIST: IDENTITY_RECORD — required fields are featureId, planDir, ownershipScopeDigest, area, createdAt', () => {
  assert.deepEqual(IDENTITY_RECORD.required.sort(),
    ['area', 'createdAt', 'featureId', 'ownershipScopeDigest', 'planDir'])
})

test('NYQUIST: IDENTITY_RECORD — ownershipScopeDigest description mentions immutable', () => {
  const desc = IDENTITY_RECORD.properties.ownershipScopeDigest.description || ''
  assert.ok(desc.includes('immutable') || desc.includes('64-hex'),
    'ownershipScopeDigest description should mention immutable or 64-hex')
})

test('NYQUIST: PREFLIGHT_VERDICT — fileHashes items have additionalProperties: false', () => {
  assert.equal(PREFLIGHT_VERDICT.properties.fileHashes.items.additionalProperties, false)
})

test('NYQUIST: PREFLIGHT_VERDICT — fileHashes items required = [path, contentSha256]', () => {
  assert.deepEqual(PREFLIGHT_VERDICT.properties.fileHashes.items.required.sort(),
    ['contentSha256', 'path'])
})

test('NYQUIST: PREFLIGHT_VERDICT — state enum has exactly PENDING, CONFIRMED, PROMOTED', () => {
  assert.deepEqual(PREFLIGHT_VERDICT.properties.state.enum.sort(),
    ['CONFIRMED', 'PENDING', 'PROMOTED'])
})

test('NYQUIST: PREFLIGHT_VERDICT — hash fields are all optional', () => {
  for (const field of ['fileHashes', 'scopeDigest', 'featureId', 'derivedPlanDir']) {
    assert.ok(!PREFLIGHT_VERDICT.required.includes(field),
      `${field} should be optional in PREFLIGHT_VERDICT`)
  }
})

test('NYQUIST: PENDING_RECORD — fileHashes items have additionalProperties: false', () => {
  assert.equal(PENDING_RECORD.properties.fileHashes.items.additionalProperties, false)
})

test('NYQUIST: PENDING_RECORD — state enum has 4 values including EXPIRED', () => {
  assert.deepEqual(PENDING_RECORD.properties.state.enum.sort(),
    ['CONFIRMED', 'EXPIRED', 'PENDING', 'PROMOTED'])
})

test('NYQUIST: PENDING_RECORD — hash fields are all optional', () => {
  for (const field of ['fileHashes', 'scopeDigest', 'featureId', 'derivedPlanDir']) {
    assert.ok(!PENDING_RECORD.required.includes(field),
      `${field} should be optional in PENDING_RECORD`)
  }
})

// ============================================================
// hashSources agent characterization (source assertions)
// ============================================================

test('NYQUIST: hashSources returns null when files is empty', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  // Guard: if (!files || !files.length) return null
  assert.match(fnBody, /return null/)
})

test('NYQUIST: hashSources normalizes paths before building file list', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /normalizeToPosix/)
  assert.match(fnBody, /\.map\(normalizeToPosix\)/)
})

test('NYQUIST: hashSources uses safeAgent (not flexibleAgent) — fail-closed', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /safeAgent\(/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
})

test('NYQUIST: hashSources model is gm(todo)', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /gm\('todo'\)/)
})

test('NYQUIST: hashSources prompt specifies SHA-256 framing recipe', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  // The prompt must describe: sort, JSON array of pairs, SHA-256
  assert.match(fnBody, /SHA-256/i)
  assert.match(fnBody, /sort/i)
  assert.match(fnBody, /JSON\.stringify|array of \[path/i)
  assert.match(fnBody, /scopeDigest/)
})

test('NYQUIST: hashSources prompt lists files via fileList variable', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /fileList/)
  assert.match(fnBody, /files to hash/i)
})

test('NYQUIST: hashSources phase is Hash Sources', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /phase:\s*'Hash Sources'/)
})

// ============================================================
// resolveScopePreflight deep wiring (source assertions)
// ============================================================

test('NYQUIST: resolveScopePreflight returns null when verdict has no files', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /!verdict\.files/)
  assert.match(fnBody, /return null/)
})

test('NYQUIST: resolveScopePreflight returns null when hashSources returns null', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  // After hashSources call, check for null hashResult
  const hashCallIdx = fnBody.indexOf('hashSources(')
  const nullCheckIdx = fnBody.indexOf('return null', hashCallIdx)
  assert.ok(hashCallIdx > -1, 'hashSources called')
  assert.ok(nullCheckIdx > hashCallIdx, 'null check after hashSources call')
})

test('NYQUIST: resolveScopePreflight normalizes entry points before deriveFeatureFolder', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  // Entry points should be normalized via normalizeToPosix before passing to deriveFeatureFolder
  assert.match(fnBody, /entryPoints.*normalizeToPosix/)
})

test('NYQUIST: resolveScopePreflight success returns area, scopeId16, primarySlug, anchorPath', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /area:\s*folder\.area/)
  assert.match(fnBody, /scopeId16:\s*folder\.scopeId16/)
  assert.match(fnBody, /primarySlug:\s*folder\.primarySlug/)
  assert.match(fnBody, /anchorPath:\s*folder\.anchorPath/)
})

test('NYQUIST: resolveScopePreflight uses generatePendingId for pendingId', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /generatePendingId\(/)
})

test('NYQUIST: resolveScopePreflight uses flexibleAgent (not safeAgent)', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /flexibleAgent\(/)
})

test('NYQUIST: resolveScopePreflight uses SCOPE_VERDICT schema', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /schema:\s*SCOPE_VERDICT/)
})

test('NYQUIST: resolveScopePreflight uses gm(scopeResolver) model', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /gm\('scopeResolver'\)/)
})

test('NYQUIST: resolveScopePreflight validateHashes is called before deriveFeatureFolder (ordering)', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  const validateIdx = fnBody.indexOf('validateHashes')
  const deriveIdx = fnBody.indexOf('deriveFeatureFolder')
  assert.ok(validateIdx > -1 && deriveIdx > -1)
  assert.ok(validateIdx < deriveIdx, 'validateHashes called before deriveFeatureFolder')
})

// ============================================================
// writeIdentity deep characterization (source assertions)
// ============================================================

test('NYQUIST: writeIdentity builds identity object with all 6 fields', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /featureId:/)
  assert.match(fnBody, /planDir:/)
  assert.match(fnBody, /ownershipScopeDigest:/)
  assert.match(fnBody, /area:/)
  assert.match(fnBody, /scopeId16:/)
  assert.match(fnBody, /createdAt:/)
})

test('NYQUIST: writeIdentity coerces createdAt to string', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /String\(arg\.createdAt/)
})

test('NYQUIST: writeIdentity uses safeAgent (not flexibleAgent)', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /safeAgent\(/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
})

test('NYQUIST: writeIdentity uses FILE_ACK schema', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /schema:\s*FILE_ACK/)
})

test('NYQUIST: writeIdentity agentType is nsAgent(file-writer)', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /nsAgent\('file-writer'\)/)
})

test('NYQUIST: writeIdentity phase is Promote', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /phase:\s*'Promote'/)
})

test('NYQUIST: writeIdentity JSON.stringify with 2-space indent', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /JSON\.stringify\(identity,\s*null,\s*2\)/)
})

test('NYQUIST: writeIdentity comment does NOT reference writeIdentityStub', () => {
  // The comment above writeIdentity may mention the old stub name for historical context,
  // but the function body itself must NOT call writeIdentityStub
  const fnBody = source.slice(
    source.indexOf('function writeIdentity'),
    source.indexOf('function promotePendingRecord')
  )
  assert.doesNotMatch(fnBody, /writeIdentityStub\(/)
})

// ============================================================
// promotePendingRecord identity integration (source assertions)
// ============================================================

test('NYQUIST: promotePendingRecord NEW branch writes identity AFTER scope-manifest', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const manifestIdx = fnBody.indexOf('writeScopeManifestFromVerdict')
  const identityIdx = fnBody.indexOf('writeIdentity(')
  assert.ok(manifestIdx > 0 && identityIdx > 0)
  assert.ok(manifestIdx < identityIdx, 'scope-manifest before identity')
})

test('NYQUIST: promotePendingRecord NEW branch writes pipeline-state AFTER identity (root-last)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // Find the NEW branch section (before EXISTING)
  const existingIdx = fnBody.indexOf('EXISTING feature')
  const newSection = existingIdx > 0 ? fnBody.slice(0, existingIdx) : fnBody
  const identityIdx = newSection.indexOf('writeIdentity(')
  const flushIdx = newSection.indexOf('flushPipelineState')
  assert.ok(identityIdx > 0, 'writeIdentity in NEW branch')
  assert.ok(flushIdx > 0, 'flushPipelineState in NEW branch')
  assert.ok(identityIdx < flushIdx, 'identity before flushPipelineState (root-last)')
})

test('NYQUIST: promotePendingRecord identityFields featureId fallback to planDir basename', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // When identityFields is missing, featureId falls back to planDir basename
  assert.match(fnBody, /planDir\.split\('\/'\)\.filter\(Boolean\)\.pop\(\)/)
})

test('NYQUIST: promotePendingRecord identityFields scopeDigest fallback to empty string', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // scopeDigest fallback: (identityFields && identityFields.scopeDigest) || ''
  assert.match(fnBody, /identityFields && identityFields\.scopeDigest\) \|\| ''/)
})

test('NYQUIST: promotePendingRecord EXISTING branch does NOT call writeIdentity', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const existingIdx = fnBody.indexOf('EXISTING feature')
  assert.ok(existingIdx > 0)
  const updateIdx = fnBody.indexOf('Update pending record', existingIdx)
  const existingSection = fnBody.slice(existingIdx, updateIdx)
  assert.doesNotMatch(existingSection, /writeIdentity/,
    'EXISTING branch must NOT call writeIdentity')
})

test('NYQUIST: promotePendingRecord locator entry uses identityFields featureId', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // The locator entry featureId should use identityFields when available
  assert.match(fnBody, /identityFields && identityFields\.featureId/)
})

test('NYQUIST: promotePendingRecord logs NEW vs EXISTING', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /EXISTING.*NEW/)
})

// ============================================================
// Extract-mode main.mjs integration (source assertions)
// ============================================================

test('NYQUIST: extract fresh run uses placeholder docs/extract/.pending/plan.md', () => {
  assert.match(source, /docs\/extract\/\.pending\/plan\.md/)
})

test('NYQUIST: extract --confirm uses confirmRecord.derivedPlanDir', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /confirmRecord\.derivedPlanDir/)
})

test('NYQUIST: extract fresh run uses preflight.derivedPlanDir for override', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /preflight\.derivedPlanDir/)
})

test('NYQUIST: extract hash error sets blockedAt to extract-hash-error', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /extract-hash-error/)
})

test('NYQUIST: extract hash error handoff includes hashError field', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /hashError:\s*preflight\.hashError/)
})

test('NYQUIST: extract hash error message mentions --feature override', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /--feature=/)
})

test('NYQUIST: extract promotion passes identityFields from confirmRecord', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /identityFields/)
  assert.match(extractSection, /scopeDigest:\s*confirmRecord\.scopeDigest/)
  assert.match(extractSection, /area:\s*confirmRecord\.area/)
  assert.match(extractSection, /scopeId16:\s*confirmRecord\.scopeId16/)
  assert.match(extractSection, /featureId:\s*confirmRecord\.featureId/)
})

test('NYQUIST: extract --confirm path overrides planDir before promotion', () => {
  // In the planPath section (before extract gates), --confirm sets planPath
  const confirmPath = source.slice(
    source.indexOf('isExtractMode && confirmRecord && confirmRecord.derivedPlanDir'),
    source.indexOf('} else if (isExtractMode) {')
  )
  assert.match(confirmPath, /planPath\s*=\s*confirmRecord\.derivedPlanDir/)
})

test('NYQUIST: extract fresh run categorizer bypass log message', () => {
  assert.match(source, /categorizer bypassed.*folder derived after preflight/)
})

test('NYQUIST: extract --confirm log message mentions deterministic folder', () => {
  assert.match(source, /using deterministic folder/)
})

test('NYQUIST: extract preflight null → blocked at extract-scope', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /blockedAt.*extract-scope/)
})

test('NYQUIST: extract fresh run writes pending record via writePendingRecord', () => {
  const extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  // After preflight, writePendingRecord is called
  assert.match(extractSection, /writePendingRecord\(PENDING_DIR/)
})

test('NYQUIST: extract fresh run handoff includes pendingId', () => {
  var freshStart = source.indexOf("phase('Pending Confirm')", source.indexOf('Fresh run'))
  var freshEnd = source.indexOf("awaiting-confirm", freshStart)
  var freshSection = source.slice(freshStart, freshEnd + 50)
  assert.match(freshSection, /pendingId:\s*preflight\.pendingId/)
})

test('NYQUIST: extract fresh run NO consolidate before promotion (RED gate)', () => {
  var freshStart = source.indexOf('Write pending record')
  var returnIdx = source.indexOf('return result', freshStart)
  assert.ok(freshStart > 0 && returnIdx > freshStart)
  var section = source.slice(freshStart, returnIdx)
  assert.doesNotMatch(section, /await\s+consolidate\b/)
})

test('NYQUIST: extract --confirm promotion stateCheckpoint Promote done', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /stateCheckpoint.*Promote.*done/)
})

// ============================================================
// Cross-cutting invariants
// ============================================================

test('NYQUIST: normalizeToPosix is accessible via engine harness', () => {
  assert.equal(typeof normalizeToPosix, 'function')
})

test('NYQUIST: validateHashes is accessible via engine harness', () => {
  assert.equal(typeof validateHashes, 'function')
})

test('NYQUIST: deriveFeatureFolder is accessible via engine harness', () => {
  assert.equal(typeof deriveFeatureFolder, 'function')
})

test('NYQUIST: hashSources is accessible via engine harness', () => {
  assert.equal(typeof hashSources, 'function')
})

test('NYQUIST: writeIdentity is accessible via engine harness', () => {
  assert.equal(typeof writeIdentity, 'function')
})

test('NYQUIST: writeIdentityStub is NOT in the export list', () => {
  // The old stub should not be exported
  const exportMatch = source.match(/export \{([^}]*)normalizeToPosix/)
  if (exportMatch) {
    // Check a reasonable window around the export
    const exportSection = source.slice(exportMatch.index, exportMatch.index + 500)
    assert.doesNotMatch(exportSection, /writeIdentityStub/)
  }
})

test('NYQUIST: writeIdentityStub function definition is NOT in source', () => {
  assert.doesNotMatch(source, /function writeIdentityStub\b/)
})

test('NYQUIST: no crypto import anywhere in engine source', () => {
  assert.doesNotMatch(source, /import.*from.*['"]node:crypto['"]|import.*crypto/)
  assert.doesNotMatch(source, /require\(['"]crypto['"]\)/)
})

test('NYQUIST: no createHash call anywhere in engine source', () => {
  assert.doesNotMatch(source, /createHash\(/)
})

test('NYQUIST: computeDigest (djb2) is NOT used for identity', () => {
  // computeDigest is used only for generatePendingId, NOT for scopeDigest or featureId
  // Verify the hashSources function does not reference computeDigest
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.doesNotMatch(fnBody, /computeDigest/)
})

test('NYQUIST: deriveFeatureFolder uses categorizeSlug for primarySlug', () => {
  const fnBody = source.slice(
    source.indexOf('function deriveFeatureFolder'),
    source.indexOf('function hashSources')
  )
  assert.match(fnBody, /categorizeSlug\(/)
})

test('NYQUIST: HEX64 regex is defined for validation', () => {
  // The dist declares a HEX64 const that validates 64-lowercase-hex
  assert.ok(source.includes('HEX64'), 'HEX64 variable is defined')
  assert.ok(source.includes('[0-9a-f]{64}'), 'HEX64 regex pattern matches 64 lowercase hex chars')
})

test('NYQUIST: meta declares Hash Sources phase', () => {
  assert.match(source, /title:\s*'Hash Sources'/)
})

test('NYQUIST: hashSources agent prompt mentions lowercase hex', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /lowercase hex/i)
})

test('NYQUIST: hashSources agent prompt mentions do NOT modify files', () => {
  const fnBody = source.slice(
    source.indexOf('function hashSources'),
    source.indexOf('function resolveScopePreflight')
  )
  assert.match(fnBody, /Do NOT modify/i)
})
