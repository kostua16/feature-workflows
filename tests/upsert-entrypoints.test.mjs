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
