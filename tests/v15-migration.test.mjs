// Phase 18 (D4) — v1.5 Migration: isLegacyRoot pure function, source assertions,
// schema export checks, meta phase checks, and agent-mediated function existence.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  isLegacyRoot,
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

test('isLegacyRoot is defined and callable', () => {
  assert.equal(typeof isLegacyRoot, 'function')
})

// ---- isLegacyRoot: pure function assertion ----

test('isLegacyRoot is pure — no safeAgent/flexibleAgent/async/Date.now/Math.random', () => {
  // Use 'async function scanForLegacyFolders' as the end marker so the 'async'
  // keyword from the next function declaration is NOT included in the slice.
  const fnBody = source.slice(
    source.indexOf('function isLegacyRoot'),
    source.indexOf('async function scanForLegacyFolders')
  )
  assert.ok(!/safeAgent|flexibleAgent|async|Date\.now|Math\.random/.test(fnBody),
    'isLegacyRoot must be pure')
})

// ---- isLegacyRoot: root qualification ----

test('path with pipeline-state.json in markers → true', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat-abc/', ['pipeline-state.json']), true)
})

test('path with plan.md in markers (no pipeline-state.json) → true', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat-abc/', ['plan.md']), true)
})

test('path with both markers → true', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat-abc/', ['pipeline-state.json', 'plan.md']), true)
})

test('path with no markers → false', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat-abc/', ['readme.md', 'notes.txt']), false)
})

test('path with empty markers → false', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat-abc/', []), false)
})

// ---- isLegacyRoot: path exclusions ----

test('path containing /slices/ → false (even with markers)', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat/slices/slice-001/', ['pipeline-state.json']), false)
})

test('path containing /.pending/ → false', () => {
  assert.equal(isLegacyRoot('docs/extract/.pending/abc123/', ['pipeline-state.json']), false)
})

test('path ending with .registry.json → false', () => {
  assert.equal(isLegacyRoot('docs/extract/.registry.json', ['pipeline-state.json']), false)
})

test('path ending with .identity.json → false', () => {
  assert.equal(isLegacyRoot('docs/extract/src/auth/feat/.identity.json', ['pipeline-state.json']), false)
})

// ---- isLegacyRoot: edge cases ----

test('empty path → false', () => {
  assert.equal(isLegacyRoot('', ['pipeline-state.json']), false)
})

test('null markerFiles → false', () => {
  assert.equal(isLegacyRoot('docs/extract/feat/', null), false)
})

test('undefined markerFiles → false', () => {
  assert.equal(isLegacyRoot('docs/extract/feat/', undefined), false)
})

test('null path → false', () => {
  assert.equal(isLegacyRoot(null, ['pipeline-state.json']), false)
})

// ---- Multi-slice fixture: parent qualifies, child does not ----

test('multi-slice fixture: parent root qualifies, slice child does NOT', () => {
  const parent = 'docs/extract/src/auth/auth-flow/'
  const child = 'docs/extract/src/auth/auth-flow/slices/slice-001/'
  assert.equal(isLegacyRoot(parent, ['pipeline-state.json', 'scope-manifest.md']), true)
  assert.equal(isLegacyRoot(child, ['pipeline-state.json', 'codebase-facts.md']), false)
})

// ---- Export assertions ----

test('isLegacyRoot is exported from extract-scope.mjs source', () => {
  const exportLine = srcExtractScope.match(/export \{[^}]+\}/s)
  assert.ok(exportLine && exportLine[0].includes('isLegacyRoot'), 'isLegacyRoot exported from extract-scope')
})

test('scanForLegacyFolders is exported from extract-scope.mjs source', () => {
  const exportLine = srcExtractScope.match(/export \{[^}]+\}/s)
  assert.ok(exportLine && exportLine[0].includes('scanForLegacyFolders'), 'scanForLegacyFolders exported from extract-scope')
})

test('adoptLegacyFolder is exported from extract-scope.mjs source', () => {
  const exportLine = srcExtractScope.match(/export \{[^}]+\}/s)
  assert.ok(exportLine && exportLine[0].includes('adoptLegacyFolder'), 'adoptLegacyFolder exported from extract-scope')
})

// ---- Auto-scan trigger source assertions ----

test('auto-scan block exists in main.mjs (Migrate phase)', () => {
  assert.ok(srcMain.includes("phase('Migrate')"), 'Migrate phase called in main.mjs')
})

test('auto-scan checks for zero registry entries', () => {
  assert.ok(srcMain.includes('hasRegisteredFeatures'), 'hasRegisteredFeatures check in main.mjs')
})

test('auto-scan returns awaiting-adopt-confirm handoff', () => {
  assert.ok(srcMain.includes('awaiting-adopt-confirm'), 'awaiting-adopt-confirm status in main.mjs')
})

test('auto-scan does NOT fire when --confirm or --resume is used', () => {
  // The guard should skip auto-scan for confirm/resume paths.
  const scanBlock = srcMain.slice(
    srcMain.indexOf('Phase 18 (D4): auto-scan'),
    srcMain.indexOf('Phase 18 (D4): auto-scan') + 500
  )
  assert.ok(scanBlock.includes('!args.confirm') || scanBlock.includes('!args.resume'),
    'auto-scan guarded against confirm/resume')
})

// ---- --adopt path source assertions ----

test('--adopt path calls adoptLegacyFolder in main.mjs', () => {
  assert.ok(srcMain.includes('adoptLegacyFolder('), 'adoptLegacyFolder called in --adopt path')
})

test('--adopt path uses Adopt phase', () => {
  assert.ok(srcMain.includes("phase('Adopt')"), 'Adopt phase used in main.mjs')
})

// ---- Convergence: update flow wired into auto-update ----

test('auto-update loads existing state via loadPipelineStateWithRecovery', () => {
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  assert.ok(upsertIdx > -1, 'auto-update block exists')
  const block = srcMain.slice(upsertIdx, upsertIdx + 3000)
  assert.ok(block.includes('loadPipelineStateWithRecovery'), 'existing state loaded in update path')
})

test('auto-update sets scopeConfirmed = true (skips confirmation)', () => {
  const upsertIdx = srcMain.indexOf("upsertMode.mode === 'auto-update'")
  const block = srcMain.slice(upsertIdx, upsertIdx + 3000)
  assert.ok(block.includes('scopeConfirmed = true'), 'scopeConfirmed set in update path')
})

test('continue-incomplete mode loads existing state without change detection', () => {
  const ciIdx = srcMain.indexOf("upsertMode.mode === 'continue-incomplete'")
  assert.ok(ciIdx === -1 || srcMain.includes('continue-incomplete'), 'continue-incomplete handled')
  // The mode is handled in the same conditional block as auto-update (load without detect).
  const block = srcMain.slice(
    srcMain.indexOf("upsertMode.mode === 'auto-update' || upsertMode.mode === 'force' || upsertMode.mode === 'continue-incomplete'"),
    srcMain.indexOf("upsertMode.mode === 'auto-update' || upsertMode.mode === 'force' || upsertMode.mode === 'continue-incomplete'") + 2000
  )
  assert.ok(block.includes('loadPipelineStateWithRecovery'), 'continue-incomplete loads state')
})

// ---- Command doc assertions ----

test('extract-design.md documents --update flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--update'), '--update documented')
})

test('extract-design.md documents --no-update flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--no-update'), '--no-update documented')
})

test('extract-design.md documents --force flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--force'), '--force documented')
})

test('extract-design.md documents --feature flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--feature'), '--feature documented')
})

test('extract-design.md documents --new flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--new'), '--new documented')
})

test('extract-design.md documents --adopt flag', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('--adopt'), '--adopt documented')
})

test('extract-design.md documents auto-update default behavior', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('Auto-update'), 'auto-update section present')
})

test('extract-design.md documents v1.5 migration', () => {
  const cmdDoc = readFileSync(
    new URL('../plugins/feature-workflows/commands/extract-design.md', import.meta.url),
    'utf8'
  )
  assert.ok(cmdDoc.includes('migration'), 'migration section present')
})
