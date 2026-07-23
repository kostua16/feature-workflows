// Phase 12 Nyquist validation gap-fillers for PROMO-01, PROMO-02, LOCATOR-01.
// Supplements pending-confirmation.test.mjs with additional behavioral dimensions
// required by the Nyquist sampling rate: boundary conditions, edge-case inputs,
// schema deep characterization, promotion ordering, and --confirm handler wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  generatePendingId,
  buildPendingRecord,
  isPendingExpired,
  resolveLocatorEntry,
  PENDING_DIR,
  PENDING_LOCATOR_PATH,
  PREFLIGHT_VERDICT,
  PENDING_RECORD,
  LOCATOR_ENTRY,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ============================================================
// generatePendingId: deep edge-case characterization
// ============================================================

test('NYQUIST: generatePendingId — unicode/CJK characters do not crash', () => {
  const id = generatePendingId('抽取认证流程', '20260723')
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — emoji in task text does not crash', () => {
  const id = generatePendingId('extract auth 🔐 flow', '20260723')
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — very long task string (1000+ chars)', () => {
  const longTask = 'a'.repeat(2000)
  const id = generatePendingId(longTask, '20260723')
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — pipe character in task does not cause ambiguity', () => {
  // The separator is '|'; a task containing '|' should still produce a unique id
  const id1 = generatePendingId('task|with|pipes', '20260723')
  const id2 = generatePendingId('task', '|with|pipes20260723')
  assert.notEqual(id1, id2)
})

test('NYQUIST: generatePendingId — newlines/tabs in task', () => {
  const id = generatePendingId('extract\nauth\tflow', '20260723')
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — numeric timestamp is coerced to string', () => {
  const id = generatePendingId('task', 20260723)
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — null task and null timestamp produce valid id', () => {
  const id = generatePendingId(null, null)
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — undefined task and undefined timestamp', () => {
  const id = generatePendingId(undefined, undefined)
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — always lowercase hex', () => {
  const id = generatePendingId('SOME UPPERCASE TASK', '20260723')
  assert.equal(id, id.toLowerCase())
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('NYQUIST: generatePendingId — similar tasks do not collide', () => {
  const id1 = generatePendingId('extract auth', '20260723')
  const id2 = generatePendingId('extract auth flow', '20260723')
  const id3 = generatePendingId('extract auth2', '20260723')
  assert.notEqual(id1, id2)
  assert.notEqual(id1, id3)
  assert.notEqual(id2, id3)
})

// ============================================================
// buildPendingRecord: deep edge-case characterization
// ============================================================

test('NYQUIST: buildPendingRecord — null verdict passes through as-is', () => {
  const record = buildPendingRecord('id1', 'task', null, '20260723')
  assert.equal(record.verdict, null)
})

test('NYQUIST: buildPendingRecord — undefined verdict passes through', () => {
  const record = buildPendingRecord('id1', 'task', undefined, '20260723')
  assert.equal(record.verdict, undefined)
})

test('NYQUIST: buildPendingRecord — verdict object reference preserved', () => {
  const verdict = { files: ['a.js'] }
  const record = buildPendingRecord('id1', 'task', verdict, '20260723')
  assert.equal(record.verdict, verdict) // same reference, not cloned
})

test('NYQUIST: buildPendingRecord — each call returns a NEW object', () => {
  const r1 = buildPendingRecord('id1', 'task', {}, '20260723')
  const r2 = buildPendingRecord('id1', 'task', {}, '20260723')
  assert.notEqual(r1, r2) // different objects
  assert.deepEqual(r1, r2) // but same shape
})

test('NYQUIST: buildPendingRecord — numeric task coerced to string', () => {
  const record = buildPendingRecord('id1', 12345, {}, '20260723')
  assert.equal(record.task, '12345')
  assert.equal(typeof record.task, 'string')
})

test('NYQUIST: buildPendingRecord — state is always PENDING', () => {
  const record = buildPendingRecord('id1', 'task', {}, '20260723')
  assert.equal(record.state, 'PENDING')
})

test('NYQUIST: buildPendingRecord — numeric createdAt coerced to string', () => {
  const record = buildPendingRecord('id1', 'task', {}, 12345)
  assert.equal(record.createdAt, '12345')
  assert.equal(typeof record.createdAt, 'string')
})

test('NYQUIST: buildPendingRecord — complex nested verdict', () => {
  const verdict = { files: ['a.js', 'b.ts'], entryPoints: ['main()'], nested: { deep: [1, 2, 3] } }
  const record = buildPendingRecord('id1', 'task', verdict, '20260723')
  assert.deepEqual(record.verdict, verdict)
  assert.equal(record.verdict.nested.deep.length, 3)
})

// ============================================================
// isPendingExpired: boundary + edge-case characterization
// ============================================================

test('NYQUIST: isPendingExpired — exactly at 30 days boundary (NOT expired)', () => {
  // ageMs > maxMs is strict: at exactly 30 days it should be false
  const record = { createdAt: '2026-06-15T00:00:00Z', state: 'PENDING' }
  // 2026-07-15T00:00:00Z is exactly 30 days later
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), false)
})

test('NYQUIST: isPendingExpired — 30 days + 1 second IS expired', () => {
  const record = { createdAt: '2026-06-15T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:01Z'), true)
})

test('NYQUIST: isPendingExpired — maxAgeDays=0 defaults to 30 (falsy)', () => {
  const record = { createdAt: '2026-06-01T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 0, '2026-07-15T00:00:00Z'), true)
})

test('NYQUIST: isPendingExpired — negative maxAgeDays defaults to 30 (falsy)', () => {
  const record = { createdAt: '2026-06-01T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, -5, '2026-07-15T00:00:00Z'), true)
})

test('NYQUIST: isPendingExpired — fractional maxAgeDays (1.5 days)', () => {
  const record = { createdAt: '2026-07-14T00:00:00Z', state: 'PENDING' }
  // 1.5 days = 36 hours; 2026-07-15T12:00:00Z is exactly 36h → NOT expired (not >)
  assert.equal(isPendingExpired(record, 1.5, '2026-07-15T12:00:00Z'), false)
  // 2026-07-15T13:00:00Z is 37h → IS expired
  assert.equal(isPendingExpired(record, 1.5, '2026-07-15T13:00:00Z'), true)
})

test('NYQUIST: isPendingExpired — future createdAt (negative age) not expired', () => {
  const record = { createdAt: '2026-12-31T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), false)
})

test('NYQUIST: isPendingExpired — date-only createdAt (no timezone)', () => {
  const record = { createdAt: '2026-06-01', state: 'PENDING' }
  // Date.parse on '2026-06-01' treats it as UTC midnight
  assert.equal(isPendingExpired(record, 30, '2026-07-15'), true)
})

test('NYQUIST: isPendingExpired — CONFIRMED state uses createdAt comparison', () => {
  const record = { createdAt: '2026-07-10T00:00:00Z', state: 'CONFIRMED' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), false)
  assert.equal(isPendingExpired(record, 2, '2026-07-15T00:00:00Z'), true)
})

test('NYQUIST: isPendingExpired — PROMOTED state uses createdAt comparison', () => {
  // PROMOTED records also have a bulky payload that can expire
  const record = { createdAt: '2026-06-01T00:00:00Z', state: 'PROMOTED' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), true)
})

// ============================================================
// resolveLocatorEntry: deep edge-case characterization
// ============================================================

test('NYQUIST: resolveLocatorEntry — first entry matches (early return)', () => {
  const locator = [
    { pendingId: 'first', featureId: 'f1', planDir: 'd1/', promotedAt: 't1' },
    { pendingId: 'second', featureId: 'f2', planDir: 'd2/', promotedAt: 't2' },
  ]
  const entry = resolveLocatorEntry(locator, 'first')
  assert.equal(entry.featureId, 'f1')
})

test('NYQUIST: resolveLocatorEntry — last entry matches (worst case)', () => {
  const locator = [
    { pendingId: 'a', planDir: 'd1/' },
    { pendingId: 'b', planDir: 'd2/' },
    { pendingId: 'c', planDir: 'd3/' },
    { pendingId: 'target', planDir: 'd4/' },
  ]
  const entry = resolveLocatorEntry(locator, 'target')
  assert.equal(entry.planDir, 'd4/')
})

test('NYQUIST: resolveLocatorEntry — duplicate pendingId: first wins', () => {
  const locator = [
    { pendingId: 'dup', planDir: 'first-dir/' },
    { pendingId: 'dup', planDir: 'second-dir/' },
  ]
  const entry = resolveLocatorEntry(locator, 'dup')
  assert.equal(entry.planDir, 'first-dir/')
})

test('NYQUIST: resolveLocatorEntry — null entry in array skipped', () => {
  const locator = [null, { pendingId: 'target', planDir: 'd/' }]
  const entry = resolveLocatorEntry(locator, 'target')
  assert.equal(entry.planDir, 'd/')
})

test('NYQUIST: resolveLocatorEntry — entry with null pendingId skipped', () => {
  const locator = [
    { pendingId: null, planDir: 'd1/' },
    { pendingId: 'target', planDir: 'd2/' },
  ]
  const entry = resolveLocatorEntry(locator, 'target')
  assert.equal(entry.planDir, 'd2/')
})

test('NYQUIST: resolveLocatorEntry — empty-string pendingId can be matched', () => {
  const locator = [{ pendingId: '', planDir: 'd/' }]
  const entry = resolveLocatorEntry(locator, '')
  assert.equal(entry.planDir, 'd/')
})

test('NYQUIST: resolveLocatorEntry — large locator (100 entries)', () => {
  const locator = []
  for (var i = 0; i < 100; i++) locator.push({ pendingId: 'id' + i, planDir: 'd' + i + '/' })
  const entry = resolveLocatorEntry(locator, 'id99')
  assert.equal(entry.planDir, 'd99/')
})

test('NYQUIST: resolveLocatorEntry — entry missing planDir still returned', () => {
  const locator = [{ pendingId: 'x', featureId: 'f' }]
  const entry = resolveLocatorEntry(locator, 'x')
  assert.ok(entry)
  assert.equal(entry.featureId, 'f')
})

// ============================================================
// Schema deep characterization
// ============================================================

test('NYQUIST: PREFLIGHT_VERDICT — additionalProperties is false', () => {
  assert.equal(PREFLIGHT_VERDICT.additionalProperties, false)
})

test('NYQUIST: PREFLIGHT_VERDICT — has optional promotedAt property', () => {
  assert.ok(PREFLIGHT_VERDICT.properties.promotedAt, 'promotedAt property defined')
  assert.ok(!PREFLIGHT_VERDICT.required.includes('promotedAt'), 'promotedAt not required')
})

test('NYQUIST: PREFLIGHT_VERDICT — has optional planDir property', () => {
  assert.ok(PREFLIGHT_VERDICT.properties.planDir, 'planDir property defined')
  assert.ok(!PREFLIGHT_VERDICT.required.includes('planDir'), 'planDir not required')
})

test('NYQUIST: PREFLIGHT_VERDICT — pendingId property is type string', () => {
  assert.equal(PREFLIGHT_VERDICT.properties.pendingId.type, 'string')
})

test('NYQUIST: PREFLIGHT_VERDICT — verdict property is type object', () => {
  assert.equal(PREFLIGHT_VERDICT.properties.verdict.type, 'object')
})

test('NYQUIST: PENDING_RECORD — additionalProperties is false', () => {
  assert.equal(PENDING_RECORD.additionalProperties, false)
})

test('NYQUIST: PENDING_RECORD — has expiredAt property', () => {
  assert.ok(PENDING_RECORD.properties.expiredAt, 'expiredAt property defined')
})

test('NYQUIST: PENDING_RECORD — state enum has exactly 4 values', () => {
  assert.deepEqual(PENDING_RECORD.properties.state.enum.sort(),
    ['CONFIRMED', 'EXPIRED', 'PENDING', 'PROMOTED'].sort())
  assert.equal(PENDING_RECORD.properties.state.enum.length, 4)
})

test('NYQUIST: PENDING_RECORD — has optional promotedAt and planDir', () => {
  assert.ok(PENDING_RECORD.properties.promotedAt)
  assert.ok(PENDING_RECORD.properties.planDir)
  assert.ok(!PENDING_RECORD.required.includes('promotedAt'))
  assert.ok(!PENDING_RECORD.required.includes('planDir'))
})

test('NYQUIST: LOCATOR_ENTRY — additionalProperties is false', () => {
  assert.equal(LOCATOR_ENTRY.additionalProperties, false)
})

test('NYQUIST: LOCATOR_ENTRY — exactly 4 properties, all required', () => {
  const propKeys = Object.keys(LOCATOR_ENTRY.properties).sort()
  assert.deepEqual(propKeys, ['featureId', 'pendingId', 'planDir', 'promotedAt'])
  assert.deepEqual(LOCATOR_ENTRY.required.sort(), propKeys)
})

test('NYQUIST: LOCATOR_ENTRY — all properties are type string', () => {
  for (const key of Object.keys(LOCATOR_ENTRY.properties)) {
    assert.equal(LOCATOR_ENTRY.properties[key].type, 'string',
      `LOCATOR_ENTRY.${key} should be type string`)
  }
})

// ============================================================
// Source assertions: resolveScopePreflight behavioral characterization
// ============================================================

test('NYQUIST: resolveScopePreflight uses SCOPE_VERDICT schema', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /schema:\s*SCOPE_VERDICT/)
})

test('NYQUIST: resolveScopePreflight phase is Pending Confirm', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /phase:\s*'Pending Confirm'/)
})

test('NYQUIST: resolveScopePreflight uses gm scopeResolver model', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /gm\('scopeResolver'\)/)
})

test('NYQUIST: resolveScopePreflight returns null when verdict has no files', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /!verdict\.files/)
  assert.match(fnBody, /return null/)
})

test('NYQUIST: resolveScopePreflight sets scopePath to pending (not a real path)', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /scopePath.*pending/)
})

// ============================================================
// Source assertions: writePendingRecord / readPendingRecord wiring
// ============================================================

test('NYQUIST: writePendingRecord uses nsAgent file-writer agentType', () => {
  const fnBody = source.slice(
    source.indexOf('function writePendingRecord'),
    source.indexOf('function readPendingRecord')
  )
  assert.match(fnBody, /nsAgent\('file-writer'\)/)
})

test('NYQUIST: writePendingRecord uses FILE_ACK schema', () => {
  const fnBody = source.slice(
    source.indexOf('function writePendingRecord'),
    source.indexOf('function readPendingRecord')
  )
  assert.match(fnBody, /schema:\s*FILE_ACK/)
})

test('NYQUIST: writePendingRecord phase is Pending Confirm', () => {
  const fnBody = source.slice(
    source.indexOf('function writePendingRecord'),
    source.indexOf('function readPendingRecord')
  )
  assert.match(fnBody, /phase:\s*'Pending Confirm'/)
})

test('NYQUIST: readPendingRecord uses PENDING_READ_RESULT schema', () => {
  const fnBody = source.slice(
    source.indexOf('function readPendingRecord'),
    source.indexOf('function appendLocatorEntry')
  )
  assert.match(fnBody, /PENDING_READ_RESULT/)
})

test('NYQUIST: readPendingRecord returns loaded result (record or null)', () => {
  const fnBody = source.slice(
    source.indexOf('function readPendingRecord'),
    source.indexOf('function appendLocatorEntry')
  )
  assert.match(fnBody, /return loaded/)
})

// ============================================================
// Source assertions: appendLocatorEntry / resolveLocator wiring
// ============================================================

test('NYQUIST: appendLocatorEntry write step uses temp-then-rename', () => {
  const fnBody = source.slice(
    source.indexOf('function appendLocatorEntry'),
    source.indexOf('function resolveLocator(')
  )
  // The write step should mention temp-then-rename
  assert.match(fnBody, /temp-then-rename/)
})

test('NYQUIST: appendLocatorEntry write phase is Promote', () => {
  const fnBody = source.slice(
    source.indexOf('function appendLocatorEntry'),
    source.indexOf('function resolveLocator(')
  )
  // The write (second safeAgent call) uses phase: 'Promote'
  assert.match(fnBody, /phase:\s*'Promote'/)
})

test('NYQUIST: resolveLocator delegates to resolveLocatorEntry', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveLocator('),
    source.indexOf('function writeScopeManifestFromVerdict')
  )
  assert.match(fnBody, /resolveLocatorEntry/)
})

test('NYQUIST: resolveLocator read phase is Pending Confirm', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveLocator('),
    source.indexOf('function writeScopeManifestFromVerdict')
  )
  assert.match(fnBody, /phase:\s*'Pending Confirm'/)
})

// ============================================================
// Source assertions: writeIdentityStub / writeScopeManifestFromVerdict
// ============================================================

test('NYQUIST: writeIdentityStub sets ownershipScopeDigest to null', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentityStub'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /ownershipScopeDigest:\s*null/)
})

test('NYQUIST: writeIdentityStub derives featureId from planDir basename', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentityStub'),
    source.indexOf('function promotePendingRecord')
  )
  // featureId is the last segment of planDir
  assert.match(fnBody, /planDir\.split.*filter.*pop/)
})

test('NYQUIST: writeIdentityStub phase is Promote', () => {
  const fnBody = source.slice(
    source.indexOf('function writeIdentityStub'),
    source.indexOf('function promotePendingRecord')
  )
  assert.match(fnBody, /phase:\s*'Promote'/)
})

test('NYQUIST: writeScopeManifestFromVerdict formats markdown with files list', () => {
  const fnBody = source.slice(
    source.indexOf('function writeScopeManifestFromVerdict'),
    source.indexOf('function writeIdentityStub')
  )
  assert.match(fnBody, /Scope Manifest/)
  assert.match(fnBody, /Files in scope/)
})

test('NYQUIST: writeScopeManifestFromVerdict phase is Promote', () => {
  const fnBody = source.slice(
    source.indexOf('function writeScopeManifestFromVerdict'),
    source.indexOf('function writeIdentityStub')
  )
  assert.match(fnBody, /phase:\s*'Promote'/)
})

test('NYQUIST: writeScopeManifestFromVerdict includes summary when present', () => {
  const fnBody = source.slice(
    source.indexOf('function writeScopeManifestFromVerdict'),
    source.indexOf('function writeIdentityStub')
  )
  assert.match(fnBody, /summary/)
})

// ============================================================
// Source assertions: promotePendingRecord ordering + branches
// ============================================================

test('NYQUIST: promotePendingRecord uses ARTIFACT_CHECK for existing-folder check', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /ARTIFACT_CHECK/)
})

test('NYQUIST: promotePendingRecord NEW branch writes scope-manifest BEFORE identity', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const manifestIdx = fnBody.indexOf('writeScopeManifestFromVerdict')
  const identityIdx = fnBody.indexOf('writeIdentityStub')
  assert.ok(manifestIdx > 0 && identityIdx > 0)
  assert.ok(manifestIdx < identityIdx,
    'scope-manifest written before identity stub')
})

test('NYQUIST: promotePendingRecord NEW branch calls flushPipelineState (root-last)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // flushPipelineState appears in the NEW branch section
  assert.match(fnBody, /flushPipelineState/)
})

test('NYQUIST: promotePendingRecord EXISTING branch does NOT call flushPipelineState', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const existingIdx = fnBody.indexOf('EXISTING feature')
  assert.ok(existingIdx > 0, 'EXISTING branch found')
  // Find the end of the EXISTING branch (before "Update pending record")
  const updateIdx = fnBody.indexOf('Update pending record', existingIdx)
  assert.ok(updateIdx > existingIdx, 'Update marker found')
  const existingSection = fnBody.slice(existingIdx, updateIdx)
  assert.doesNotMatch(existingSection, /flushPipelineState/,
    'EXISTING branch must NOT call flushPipelineState')
})

test('NYQUIST: promotePendingRecord EXISTING branch writes scope-manifest (revision)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  const existingIdx = fnBody.indexOf('EXISTING feature')
  const updateIdx = fnBody.indexOf('Update pending record', existingIdx)
  const existingSection = fnBody.slice(existingIdx, updateIdx)
  assert.match(existingSection, /writeScopeManifestFromVerdict/,
    'EXISTING branch updates scope-manifest')
})

test('NYQUIST: promotePendingRecord updates record state to PROMOTED', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /state:\s*'PROMOTED'/)
})

test('NYQUIST: promotePendingRecord sets promotedAt on updated record', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /promotedAt/)
})

test('NYQUIST: promotePendingRecord sets planDir on updated record', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /planDir:\s*planDir/)
})

test('NYQUIST: promotePendingRecord locator featureId = planDir basename', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // Locator entry featureId is derived from planDir split/filter/pop (same as identity)
  assert.match(fnBody, /featureId.*planDir\.split.*filter.*pop/)
})

test('NYQUIST: promotePendingRecord returns object with promoted and isNew', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExport')
  )
  assert.match(fnBody, /promoted:\s*true/)
  assert.match(fnBody, /isNew/)
})

test('NYQUIST: promotePendingRecord logs promotion with NEW/EXISTING label', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /NEW.*EXISTING|EXISTING.*NEW/)
})

// ============================================================
// Source assertions: --confirm handler in main.mjs
// ============================================================

test('NYQUIST: --confirm handler calls phase Pending Confirm', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /phase\('Pending Confirm'\)/)
})

test('NYQUIST: --confirm PROMOTED redirect sets args.resume and clears confirm', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /resume:\s*pr\.planDir/)
  assert.match(confirmSection, /confirm:\s*null/)
})

test('NYQUIST: --confirm EXPIRED with locator redirects to resume', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /EXPIRED/)
  assert.match(confirmSection, /resolveLocator/)
})

test('NYQUIST: --confirm EXPIRED without locator returns blocked confirm-expired', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /confirm-expired/)
  assert.match(confirmSection, /blockedAt:\s*'confirm-expired'/)
})

test('NYQUIST: --confirm PENDING sets confirmRecord and task from record', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /confirmRecord\s*=\s*pr/)
  assert.match(confirmSection, /task:\s*pr\.task/)
})

test('NYQUIST: --confirm CONFIRMED falls through to promote (else branch)', () => {
  // CONFIRMED is not PROMOTED or EXPIRED, so it hits the else branch
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  // The else branch handles PENDING and CONFIRMED
  assert.match(confirmSection, /PENDING or CONFIRMED/)
})

test('NYQUIST: --confirm not found checks locator as fallback', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  // After pendingRead fails, check locator
  assert.match(confirmSection, /resolveLocator/)
  assert.match(confirmSection, /locEntry2/)
})

test('NYQUIST: --confirm not found anywhere returns blocked confirm-not-found', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /confirm-not-found/)
  assert.match(confirmSection, /blockedAt:\s*'confirm-not-found'/)
})

test('NYQUIST: --confirm not found handoff says to run fresh extract', () => {
  const confirmSection = source.slice(
    source.indexOf('--confirm'),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /extract-design/)
})

// ============================================================
// Source assertions: fresh extract preflight path
// ============================================================

test('NYQUIST: fresh extract calls phase Pending Confirm for preflight', () => {
  const freshSection = source.slice(
    source.indexOf('Fresh run — preflight'),
    source.indexOf('return result', source.indexOf('Fresh run — preflight'))
  )
  assert.match(freshSection, /phase\('Pending Confirm'\)/)
})

test('NYQUIST: fresh extract preflight passes args.timestamp to resolveScopePreflight', () => {
  const freshSection = source.slice(
    source.indexOf('Fresh run — preflight'),
    source.indexOf('return result', source.indexOf('Fresh run — preflight'))
  )
  assert.match(freshSection, /timestamp.*args.*timestamp/)
})

test('NYQUIST: fresh extract preflight null → blocked at extract-scope', () => {
  const freshSection = source.slice(
    source.indexOf('Fresh run — preflight'),
    source.indexOf('return result', source.indexOf('Fresh run — preflight'))
  )
  assert.match(freshSection, /blockedAt.*extract-scope/)
})

test('NYQUIST: fresh extract pending record written via writePendingRecord', () => {
  // Slice from phase('Pending Confirm') in the fresh-run section to the awaiting-confirm checkpoint
  var freshStart = source.indexOf("phase('Pending Confirm')", source.indexOf('Fresh run'))
  var freshEnd = source.indexOf("awaiting-confirm", freshStart)
  var freshSection = source.slice(freshStart, freshEnd)
  assert.match(freshSection, /writePendingRecord/)
  assert.match(freshSection, /PENDING_DIR/)
})

test('NYQUIST: fresh extract handoff includes scopeSummary with correct fields', () => {
  var freshStart = source.indexOf("phase('Pending Confirm')", source.indexOf('Fresh run'))
  var freshEnd = source.indexOf("awaiting-confirm", freshStart)
  var freshSection = source.slice(freshStart, freshEnd)
  assert.match(freshSection, /scopeSummary/)
  assert.match(freshSection, /files/)
  assert.match(freshSection, /entryPoints/)
  assert.match(freshSection, /confidence/)
  assert.match(freshSection, /wide/)
  assert.match(freshSection, /suggestedSlices/)
})

test('NYQUIST: fresh extract stateCheckpoint Pending Confirm awaiting-confirm', () => {
  var freshStart = source.indexOf("phase('Pending Confirm')", source.indexOf('Fresh run'))
  var freshEnd = source.indexOf("awaiting-confirm", freshStart)
  var freshSection = source.slice(freshStart, freshEnd + 50)
  assert.match(freshSection, /stateCheckpoint.*Pending Confirm.*awaiting-confirm/)
})

test('NYQUIST: fresh extract intentionally does NOT call consolidate (no pipeline-state)', () => {
  // The section between writePendingRecord and return should NOT have consolidate
  var freshStart = source.indexOf('Write pending record')
  var returnIdx = source.indexOf('return result', freshStart)
  assert.ok(freshStart > 0 && returnIdx > freshStart)
  var section = source.slice(freshStart, returnIdx)
  // Check for actual call, not comment
  assert.doesNotMatch(section, /await\s+consolidate\b/)
})

// ============================================================
// Source assertions: promotion during --confirm extract path
// ============================================================

test('NYQUIST: promotion path calls phase Promote', () => {
  // Slice from the confirmRecord guard to stateCheckpoint('Promote', 'done')
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /phase\('Promote'\)/)
})

test('NYQUIST: promotion path checks !result.scopeManifestPath guard', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  assert.ok(promoStart > 0, 'confirmRecord guard found in source')
})

test('NYQUIST: promotion sets result.scopeManifestPath to planDir + scope-manifest.md', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /scopeManifestPath.*scope-manifest\.md/)
})

test('NYQUIST: promotion sets result.scopeConfirmed to true', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /scopeConfirmed\s*=\s*true/)
})

test('NYQUIST: promotion writes ambiguities to open-questions', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /writeOpenQuestions/)
  assert.match(promoSection, /ambiguities/)
})

test('NYQUIST: promotion stateCheckpoint Promote done', () => {
  var promoStart = source.indexOf('confirmRecord && !result.scopeManifestPath')
  var promoEnd = source.indexOf("stateCheckpoint('Promote', 'done')", promoStart)
  var promoSection = source.slice(promoStart, promoEnd + 50)
  assert.match(promoSection, /stateCheckpoint.*Promote.*done/)
})

// ============================================================
// Cross-cutting: import wiring + meta phases
// ============================================================

test('NYQUIST: main calls promotePendingRecord in the confirm path', () => {
  // In the dist, imports are concatenated; verify the function is CALLED in the extract section
  var extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /promotePendingRecord/)
})

test('NYQUIST: main references PENDING_DIR and PENDING_LOCATOR_PATH', () => {
  // PENDING_DIR is used in the extract/promotion section; PENDING_LOCATOR_PATH in the --confirm handler
  var confirmSection = source.slice(source.indexOf('--confirm'), source.indexOf('const resumeArg'))
  assert.match(confirmSection, /PENDING_LOCATOR_PATH/)
  var extractSection = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractSection, /PENDING_DIR/)
})

test('NYQUIST: meta phases array includes both Pending Confirm and Promote', () => {
  assert.match(source, /title:\s*'Pending Confirm'/)
  assert.match(source, /title:\s*'Promote'/)
})

// ============================================================
// Crash-idempotency source assertions
// ============================================================

test('NYQUIST: writePendingRecord uses temp-then-rename (crash-safe writes)', () => {
  const fnBody = source.slice(
    source.indexOf('function writePendingRecord'),
    source.indexOf('function readPendingRecord')
  )
  assert.match(fnBody, /temp-then-rename/)
})

test('NYQUIST: appendLocatorEntry reads before appending (no data loss on crash)', () => {
  const fnBody = source.slice(
    source.indexOf('function appendLocatorEntry'),
    source.indexOf('function resolveLocator(')
  )
  // Must read existing entries first, then push, then write
  assert.match(fnBody, /file-reader/)
  assert.match(fnBody, /entries\.push/)
})

test('NYQUIST: promotePendingRecord updates pending record BEFORE locator (crash order)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // writePendingRecord (updates to PROMOTED) should come before appendLocatorEntry
  const recordUpdateIdx = fnBody.indexOf('writePendingRecord(pendingDir, promotedRecord')
  const locatorIdx = fnBody.indexOf('appendLocatorEntry(PENDING_LOCATOR_PATH')
  assert.ok(recordUpdateIdx > 0, 'pending record update found')
  assert.ok(locatorIdx > 0, 'locator append found')
  assert.ok(recordUpdateIdx < locatorIdx,
    'pending record updated BEFORE locator entry appended')
})

test('NYQUIST: PENDING_DIR and PENDING_LOCATOR_PATH are distinct paths', () => {
  assert.notEqual(PENDING_DIR, PENDING_LOCATOR_PATH)
  assert.ok(PENDING_DIR.endsWith('/'))
  assert.ok(PENDING_LOCATOR_PATH.endsWith('.json'))
})
