// Phase 18 (D3) — Upsert Entrypoints: resolveUpsertMode, deriveForkedFeatureId,
// update-flow source assertions, schema validation, meta phases.
// Tests pure functions + source assertions + schema validation.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  resolveUpsertMode,
  deriveForkedFeatureId,
  refreshRegistryFiles,
  UPSERT_MODE_VERDICT,
  ADOPT_RESULT,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

const srcExtractScope = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-scope.mjs', import.meta.url),
  'utf8'
)

const srcMain = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/main.mjs', import.meta.url),
  'utf8'
)

// ---- Existence tests ----

test('resolveUpsertMode is defined and callable', () => {
  assert.equal(typeof resolveUpsertMode, 'function')
})

test('deriveForkedFeatureId is defined and callable', () => {
  assert.equal(typeof deriveForkedFeatureId, 'function')
})

// ---- resolveUpsertMode: pure function assertions ----

test('resolveUpsertMode is pure — no safeAgent/flexibleAgent/async/Date.now/Math.random', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveUpsertMode'),
    source.indexOf('function deriveForkedFeatureId')
  )
  assert.ok(!/safeAgent|flexibleAgent|async|Date\.now|Math\.random/.test(fnBody),
    'resolveUpsertMode must be pure')
})

// ---- resolveUpsertMode: mode resolution ----

test('--new + --feature present → error mutually-exclusive', () => {
  const r = resolveUpsertMode({ newFolder: true, feature: 'my-feat' }, { decision: 'reuse' })
  assert.deepEqual(r, { mode: 'error', reason: 'mutually-exclusive' })
})

test('--new present → mode new (regardless of findResult)', () => {
  assert.deepEqual(resolveUpsertMode({ newFolder: true }, { decision: 'reuse' }), { mode: 'new' })
  assert.deepEqual(resolveUpsertMode({ new: true }, { decision: 'new' }), { mode: 'new' })
})

test('--feature=<id> → mode feature with featureId', () => {
  const r = resolveUpsertMode({ feature: 'my-feat' }, { decision: 'reuse' })
  assert.deepEqual(r, { mode: 'feature', featureId: 'my-feat' })
})

test('--force → mode force', () => {
  assert.deepEqual(resolveUpsertMode({ force: true }, { decision: 'reuse' }), { mode: 'force' })
})

test('--no-update → mode continue-incomplete', () => {
  assert.deepEqual(resolveUpsertMode({ noUpdate: true }, { decision: 'reuse' }), { mode: 'continue-incomplete' })
})

test('--update + findResult.decision=reuse → mode auto-update', () => {
  assert.deepEqual(resolveUpsertMode({ update: true }, { decision: 'reuse' }), { mode: 'auto-update' })
})

test('no flags + findResult.decision=reuse → mode auto-update (DEFAULT)', () => {
  assert.deepEqual(resolveUpsertMode({}, { decision: 'reuse' }), { mode: 'auto-update' })
})

test('no flags + findResult.decision=new → mode new (first extraction)', () => {
  assert.deepEqual(resolveUpsertMode({}, { decision: 'new' }), { mode: 'new' })
})

test('no flags + findResult.decision=blocked → mode blocked with reason', () => {
  const r = resolveUpsertMode({}, { decision: 'blocked', reason: 'ambiguous' })
  assert.deepEqual(r, { mode: 'blocked', reason: 'ambiguous' })
})

test('no flags + findResult.decision=blocked + no reason → default ambiguous', () => {
  const r = resolveUpsertMode({}, { decision: 'blocked' })
  assert.deepEqual(r, { mode: 'blocked', reason: 'ambiguous' })
})

test('fallback (unknown decision) → mode new', () => {
  assert.deepEqual(resolveUpsertMode({}, { decision: 'unknown' }), { mode: 'new' })
})

test('null args and null findResult → mode new', () => {
  assert.deepEqual(resolveUpsertMode(null, null), { mode: 'new' })
})

// ---- deriveForkedFeatureId ----

test('deriveForkedFeatureId is pure — no I/O, no agent calls', () => {
  const fnBody = source.slice(
    source.indexOf('function deriveForkedFeatureId'),
    source.indexOf('function isLegacyRoot')
  )
  assert.ok(!/safeAgent|flexibleAgent|async|Date\.now|Math\.random/.test(fnBody),
    'deriveForkedFeatureId must be pure')
})

test('no existing fork → featureId <base>-2, n=2', () => {
  const r = deriveForkedFeatureId('auth-abc123', { features: {} })
  assert.deepEqual(r, { featureId: 'auth-abc123-2', n: 2 })
})

test('empty registry → featureId <base>-2, n=2', () => {
  const r = deriveForkedFeatureId('auth-abc123', null)
  assert.deepEqual(r, { featureId: 'auth-abc123-2', n: 2 })
})

test('<base>-2 exists → featureId <base>-3, n=3', () => {
  const reg = { features: { 'auth-abc123-2': { featureId: 'auth-abc123-2' } } }
  const r = deriveForkedFeatureId('auth-abc123', reg)
  assert.deepEqual(r, { featureId: 'auth-abc123-3', n: 3 })
})

test('<base>-2 and <base>-3 exist → featureId <base>-4, n=4', () => {
  const reg = { features: {
    'auth-abc123-2': { featureId: 'auth-abc123-2' },
    'auth-abc123-3': { featureId: 'auth-abc123-3' },
  } }
  const r = deriveForkedFeatureId('auth-abc123', reg)
  assert.deepEqual(r, { featureId: 'auth-abc123-4', n: 4 })
})

// ---- Update flow source assertions ----

test('reconcileSlices IS imported in main.mjs from extract-scope.mjs', () => {
  const importLine = srcMain.match(/from '\.\/extract-scope\.mjs'/)
  assert.ok(importLine, 'extract-scope import exists')
  const line = srcMain.slice(0, srcMain.indexOf("from './extract-scope.mjs'"))
  assert.ok(line.includes('reconcileSlices'), 'reconcileSlices is imported from extract-scope')
})

test('runChangeDetection IS imported in main.mjs from extract-scope.mjs', () => {
  const line = srcMain.slice(0, srcMain.indexOf("from './extract-scope.mjs'"))
  assert.ok(line.includes('runChangeDetection'), 'runChangeDetection is imported from extract-scope')
})

test('invalidateSliceChain IS imported in main.mjs from extract-slice.mjs', () => {
  const line = srcMain.slice(0, srcMain.indexOf("from './extract-slice.mjs'"))
  assert.ok(line.includes('invalidateSliceChain'), 'invalidateSliceChain is imported from extract-slice')
})

test('markStaleForSlice IS imported in main.mjs from synthesis.mjs', () => {
  const line = srcMain.slice(0, srcMain.indexOf("from './synthesis.mjs'"))
  assert.ok(line.includes('markStaleForSlice'), 'markStaleForSlice is imported from synthesis')
})

test('resolveUpsertMode IS called in the extract block of main.mjs', () => {
  assert.ok(srcMain.includes('resolveUpsertMode('), 'resolveUpsertMode is called in main.mjs')
})

test('deriveForkedFeatureId IS called when mode=new and base feature exists', () => {
  assert.ok(srcMain.includes('deriveForkedFeatureId('), 'deriveForkedFeatureId is called in main.mjs')
})

test('update flow calls reconcileSlices then runChangeDetection then invalidateSliceChain', () => {
  // Find the upsert block in main.mjs source.
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  assert.ok(upsertIdx > -1, 'auto-update block exists')
  const block = srcMain.slice(upsertIdx, upsertIdx + 5000)
  assert.ok(block.includes('reconcileSlices('), 'reconcileSlices called in update path')
  assert.ok(block.includes('runChangeDetection('), 'runChangeDetection called in update path')
  assert.ok(block.includes('invalidateSliceChain('), 'invalidateSliceChain called in update path')
})

test('onSliceRemoved IS called for removed slices in update path', () => {
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  const block = srcMain.slice(upsertIdx, upsertIdx + 3000)
  assert.ok(block.includes('onSliceRemoved('), 'onSliceRemoved called for removed slices')
})

// ---- Schema validation ----

test('UPSERT_MODE_VERDICT has additionalProperties: false', () => {
  assert.equal(UPSERT_MODE_VERDICT.additionalProperties, false)
})

test('UPSERT_MODE_VERDICT.mode is an enum with all 7 modes', () => {
  const modes = UPSERT_MODE_VERDICT.properties.mode.enum
  assert.deepEqual(modes.sort(), ['auto-update', 'blocked', 'continue-incomplete', 'error', 'feature', 'force', 'new'])
})

test('UPSERT_MODE_VERDICT requires mode', () => {
  assert.ok(UPSERT_MODE_VERDICT.required.includes('mode'))
})

test('ADOPT_RESULT has additionalProperties: false', () => {
  assert.equal(ADOPT_RESULT.additionalProperties, false)
})

test('ADOPT_RESULT.reason is an enum with all 4 values', () => {
  const reasons = ADOPT_RESULT.properties.reason.enum
  assert.deepEqual(reasons.sort(), ['already-adopted', 'collision-forked', 'not-a-root', 'success'])
})

test('ADOPT_RESULT requires adopted', () => {
  assert.ok(ADOPT_RESULT.required.includes('adopted'))
})

test('UPSERT_MODE_VERDICT is exported from schemas', () => {
  const srcSchemas = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/schemas.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(srcSchemas.includes('UPSERT_MODE_VERDICT'), 'UPSERT_MODE_VERDICT defined in schemas')
  const exportLine = srcSchemas.match(/export \{[^}]+\}/)
  assert.ok(exportLine && exportLine[0].includes('UPSERT_MODE_VERDICT'), 'UPSERT_MODE_VERDICT exported')
})

test('ADOPT_RESULT is exported from schemas', () => {
  const srcSchemas = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/schemas.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(srcSchemas.includes('ADOPT_RESULT'), 'ADOPT_RESULT defined in schemas')
  const exportLine = srcSchemas.match(/export \{[^}]+\}/)
  assert.ok(exportLine && exportLine[0].includes('ADOPT_RESULT'), 'ADOPT_RESULT exported')
})

// ---- Meta phases ----

test('meta phases include Upsert', () => {
  const metaSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(metaSrc.includes("title: 'Upsert'"), 'Upsert phase declared in meta')
})

test('meta phases include Adopt', () => {
  const metaSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(metaSrc.includes("title: 'Adopt'"), 'Adopt phase declared in meta')
})

test('meta phases include Migrate', () => {
  const metaSrc = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(metaSrc.includes("title: 'Migrate'"), 'Migrate phase declared in meta')
})

// ---- Export assertions ----

test('resolveUpsertMode is exported from extract-scope.mjs source', () => {
  assert.ok(srcExtractScope.includes('resolveUpsertMode'), 'resolveUpsertMode in extract-scope')
  const exportLine = srcExtractScope.match(/export \{[^}]+\}/s)
  assert.ok(exportLine && exportLine[0].includes('resolveUpsertMode'), 'resolveUpsertMode exported')
})

test('deriveForkedFeatureId is exported from extract-scope.mjs source', () => {
  const exportLine = srcExtractScope.match(/export \{[^}]+\}/s)
  assert.ok(exportLine && exportLine[0].includes('deriveForkedFeatureId'), 'deriveForkedFeatureId exported')
})

test('--adopt path exists in main.mjs (adoptLegacyFolder called)', () => {
  assert.ok(srcMain.includes('adoptLegacyFolder('), 'adoptLegacyFolder called in main.mjs')
})

test('auto-scan trigger exists in main.mjs (scanForLegacyFolders called)', () => {
  assert.ok(srcMain.includes('scanForLegacyFolders('), 'scanForLegacyFolders called in main.mjs')
})

// ---- Nyquist validation gap-filling: update-flow wiring source assertions ----

test('runChangeDetection receives force parameter wired to mode check', () => {
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  const block = srcMain.slice(upsertIdx, upsertIdx + 5000)
  assert.ok(block.includes("force: upsertMode.mode === 'force'"),
    'force parameter wired to mode===force in runChangeDetection call')
})

test('deriveForkedFeatureId called inside new+reuse branch specifically', () => {
  const newBranchIdx = srcMain.indexOf("upsertMode.mode === 'new' && findResult.decision === 'reuse'")
  assert.ok(newBranchIdx > -1, 'new+reuse branch exists')
  const branch = srcMain.slice(newBranchIdx, newBranchIdx + 500)
  assert.ok(branch.includes('deriveForkedFeatureId('),
    'deriveForkedFeatureId called inside the new+reuse conditional branch')
})

test('--no-update (continue-incomplete) is EXCLUDED from change-detection inner block', () => {
  // The change-detection inner block must include only auto-update + force,
  // NOT continue-incomplete (--no-update must skip change detection).
  const innerMatch = srcMain.match(/upsertMode\.mode === 'auto-update' \|\| upsertMode\.mode === 'force'\)\s*\{/)
  assert.ok(innerMatch, 'inner change-detection condition with only auto-update+force')
  const innerIdx = srcMain.indexOf(innerMatch[0])
  const innerBlock = srcMain.slice(innerIdx, innerIdx + 100)
  assert.ok(!innerBlock.includes('continue-incomplete'),
    'continue-incomplete must NOT appear in change-detection condition (--no-update opt-out)')
})

test('--feature mode reassigns to auto-update for fallthrough', () => {
  const featureBranchIdx = srcMain.indexOf("upsertMode.mode === 'feature'")
  assert.ok(featureBranchIdx > -1, 'feature branch exists')
  const branch = srcMain.slice(featureBranchIdx, featureBranchIdx + 1200)
  assert.ok(branch.includes("upsertMode.mode = 'auto-update'"),
    'feature mode reassigns to auto-update to fall through to update path')
  // Codex review fix: --feature must update findResult so downstream registry
  // refresh (refreshRegistryFiles) targets the correct feature, not a stale lookup.
  assert.ok(branch.includes('findResult.featureId = upsertMode.featureId'),
    '--feature updates findResult.featureId for correct registry refresh')
  assert.ok(branch.includes("findResult.decision = 'reuse'"),
    '--feature updates findResult.decision to reuse')
})

test('--feature nonexistent blocks with feature-not-found handoff', () => {
  assert.ok(srcMain.includes("'feature-not-found'"),
    'feature-not-found blockedAt exists')
  assert.ok(srcMain.includes('not found in registry'),
    'feature-not-found handoff message exists')
})

test('error mode blocks with upsert-mutually-exclusive handoff', () => {
  assert.ok(srcMain.includes("'upsert-mutually-exclusive'"),
    'upsert-mutually-exclusive blockedAt exists')
  assert.ok(srcMain.includes('mutually exclusive'),
    'mutual-exclusion handoff message exists')
})

test('--new fork sets preflight.forkedFeatureId and preflight.forkedN', () => {
  const newBranchIdx = srcMain.indexOf("upsertMode.mode === 'new' && findResult.decision === 'reuse'")
  const branch = srcMain.slice(newBranchIdx, newBranchIdx + 500)
  assert.ok(branch.includes('preflight.forkedFeatureId'),
    'forkedFeatureId set in preflight for --new fork')
  assert.ok(branch.includes('preflight.forkedN'),
    'forkedN set in preflight for --new fork')
})

test('auto-update/force/continue-incomplete resets extractReady to false', () => {
  const updateBlockIdx = srcMain.indexOf(
    "upsertMode.mode === 'auto-update' || upsertMode.mode === 'force' || upsertMode.mode === 'continue-incomplete'"
  )
  assert.ok(updateBlockIdx > -1, 'update block condition exists')
  const block = srcMain.slice(updateBlockIdx, updateBlockIdx + 2000)
  assert.ok(block.includes('result.extractReady = false'),
    'extractReady reset to false in update path (forces re-extraction)')
})

test('auto-update copies extractQueue from loaded existing state', () => {
  const updateBlockIdx = srcMain.indexOf(
    "upsertMode.mode === 'auto-update' || upsertMode.mode === 'force' || upsertMode.mode === 'continue-incomplete'"
  )
  const block = srcMain.slice(updateBlockIdx, updateBlockIdx + 2000)
  assert.ok(block.includes('existingResult.extractQueue'),
    'extractQueue copied from loaded state for resume continuity')
  assert.ok(block.includes('loadPipelineStateWithRecovery'),
    'existing state loaded via loadPipelineStateWithRecovery')
})

// ---- INT-W2: auto-update refreshes registry entry files from current revision ----

test('INT-W2: refreshRegistryFiles is defined and callable', () => {
  assert.equal(typeof refreshRegistryFiles, 'function')
})

test('INT-W2: refreshRegistryFiles updates files to the current revision', () => {
  const registry = {
    features: {
      'auth-abc123': {
        featureId: 'auth-abc123',
        planDir: 'docs/extract/auth/auth-abc123/',
        ownershipScopeDigest: 'a'.repeat(64),
        scopeId16: 'abc123',
        anchorPath: 'src/auth/login.ts',
        area: 'src/auth',
        files: [{ path: 'src/auth/login.ts', contentSha256: 'old-hash' }],
        status: 'extracting',
        updatedAt: '2026-01-01',
      },
    },
  }
  const currentHashes = [
    { path: 'src/auth/login.ts', contentSha256: 'new-hash' },
    { path: 'src/auth/logout.ts', contentSha256: 'hash-logout' },
  ]
  const result = refreshRegistryFiles(registry, 'auth-abc123', currentHashes)
  assert.deepEqual(result.features['auth-abc123'].files, currentHashes,
    'files reflect the current revision, not the promotion-time snapshot')
})

test('INT-W2: refreshRegistryFiles leaves immutable ownership identity untouched', () => {
  const registry = {
    features: {
      'auth-abc123': {
        featureId: 'auth-abc123',
        planDir: 'docs/extract/auth/auth-abc123/',
        ownershipScopeDigest: 'a'.repeat(64),
        scopeId16: 'abc123',
        anchorPath: 'src/auth/login.ts',
        area: 'src/auth',
        files: [{ path: 'src/auth/login.ts', contentSha256: 'old-hash' }],
        status: 'extracting',
        updatedAt: '2026-01-01',
      },
    },
  }
  const currentHashes = [{ path: 'src/auth/logout.ts', contentSha256: 'new-hash' }]
  const result = refreshRegistryFiles(registry, 'auth-abc123', currentHashes)
  const entry = result.features['auth-abc123']
  assert.equal(entry.featureId, 'auth-abc123', 'featureId immutable')
  assert.equal(entry.planDir, 'docs/extract/auth/auth-abc123/', 'planDir immutable')
  assert.equal(entry.ownershipScopeDigest, 'a'.repeat(64), 'ownershipScopeDigest immutable')
  assert.equal(entry.scopeId16, 'abc123', 'scopeId16 immutable')
  assert.equal(entry.anchorPath, 'src/auth/login.ts', 'anchorPath immutable')
  assert.equal(entry.area, 'src/auth', 'area immutable')
})

test('INT-W2: refreshRegistryFiles does not mutate the input registry', () => {
  const registry = {
    features: {
      'auth-abc123': {
        featureId: 'auth-abc123',
        files: [{ path: 'old.ts', contentSha256: 'old' }],
      },
    },
  }
  const currentHashes = [{ path: 'new.ts', contentSha256: 'new' }]
  refreshRegistryFiles(registry, 'auth-abc123', currentHashes)
  assert.deepEqual(registry.features['auth-abc123'].files, [{ path: 'old.ts', contentSha256: 'old' }],
    'input registry unchanged (pure function)')
})

test('INT-W2: refreshRegistryFiles returns same ref when feature absent', () => {
  const registry = { features: {} }
  const result = refreshRegistryFiles(registry, 'missing', [{ path: 'x.ts', contentSha256: 'x' }])
  assert.equal(result, registry, 'same reference returned when feature not found')
})

test('INT-W2: refreshRegistryFiles handles null/missing registry', () => {
  assert.equal(refreshRegistryFiles(null, 'x', []), null)
  assert.deepEqual(refreshRegistryFiles({ features: {} }, 'x', []), { features: {} })
})

test('INT-W2: auto-update block calls refreshRegistryFiles after change detection (source assertion)', () => {
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  const block = srcMain.slice(upsertIdx, upsertIdx + 6000)
  assert.ok(block.includes('refreshRegistryFiles('),
    'auto-update block calls refreshRegistryFiles to refresh registry entry files')
  assert.ok(block.includes('preflight.fileHashes'),
    'refresh uses current preflight file hashes, not the promotion-time snapshot')
})

test('INT-W2: refreshRegistryFiles is exported from extract-scope.mjs', () => {
  assert.ok(srcExtractScope.match(/export \{[^}]*refreshRegistryFiles/),
    'refreshRegistryFiles exported from extract-scope')
})
