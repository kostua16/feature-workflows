// Phase 12 — pending-confirmation protocol + promotion (extract D0).
// Tests pure helpers (generatePendingId, buildPendingRecord, isPendingExpired,
// resolveLocatorEntry), schema validation, and source assertions for the
// agent-calling functions and the --confirm leg in main.mjs.
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

// ---- generatePendingId (pure) -----------------------------------------------

test('generatePendingId: returns a 16-hex-char string', () => {
  const id = generatePendingId('extract auth flow', '20260723-1200')
  assert.equal(typeof id, 'string')
  assert.equal(id.length, 16)
  assert.match(id, /^[0-9a-f]{16}$/)
})

test('generatePendingId: deterministic for same task+timestamp', () => {
  const id1 = generatePendingId('extract auth flow', '20260723-1200')
  const id2 = generatePendingId('extract auth flow', '20260723-1200')
  assert.equal(id1, id2)
})

test('generatePendingId: different tasks produce different ids', () => {
  const id1 = generatePendingId('extract auth flow', '20260723-1200')
  const id2 = generatePendingId('extract parser module', '20260723-1200')
  assert.notEqual(id1, id2)
})

test('generatePendingId: different timestamps produce different ids', () => {
  const id1 = generatePendingId('extract auth flow', '20260723-1200')
  const id2 = generatePendingId('extract auth flow', '20260723-1300')
  assert.notEqual(id1, id2)
})

test('generatePendingId: handles empty/undefined input gracefully', () => {
  const id = generatePendingId('', '')
  assert.equal(id.length, 16)
  assert.match(id, /^[0-9a-f]{16}$/)
})

// ---- buildPendingRecord (pure) -----------------------------------------------

test('buildPendingRecord: constructs a PENDING-shaped record', () => {
  const verdict = { files: ['src/a.js'], summary: 'test scope' }
  const record = buildPendingRecord('abc123', 'my task', verdict, '20260723')
  assert.equal(record.pendingId, 'abc123')
  assert.equal(record.task, 'my task')
  assert.equal(record.verdict, verdict)
  assert.equal(record.state, 'PENDING')
  assert.equal(record.createdAt, '20260723')
})

test('buildPendingRecord: does not include promotedAt or planDir (unset in PENDING)', () => {
  const record = buildPendingRecord('abc123', 'my task', {}, '20260723')
  assert.equal(record.promotedAt, undefined)
  assert.equal(record.planDir, undefined)
})

// ---- isPendingExpired (pure) -------------------------------------------------

test('isPendingExpired: false for a recent record within TTL', () => {
  const record = { createdAt: '2026-07-01T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), false)
})

test('isPendingExpired: true for a record older than 30 days', () => {
  const record = { createdAt: '2026-06-01T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), true)
})

test('isPendingExpired: true for a record exactly at 31 days', () => {
  const record = { createdAt: '2026-06-14T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), true)
})

test('isPendingExpired: false for a record at 29 days', () => {
  const record = { createdAt: '2026-06-16T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, '2026-07-15T00:00:00Z'), false)
})

test('isPendingExpired: true for an already-EXPIRED record', () => {
  const record = { createdAt: '2026-07-01T00:00:00Z', state: 'EXPIRED' }
  assert.equal(isPendingExpired(record, 30, '2026-07-02T00:00:00Z'), true)
})

test('isPendingExpired: true for a record with no createdAt', () => {
  assert.equal(isPendingExpired({}, 30, '2026-07-15'), true)
  assert.equal(isPendingExpired(null, 30, '2026-07-15'), true)
})

test('isPendingExpired: false for unparseable timestamps (cannot determine)', () => {
  const record = { createdAt: 'garbage', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 30, 'alsogarbage'), false)
})

test('isPendingExpired: custom maxAgeDays', () => {
  const record = { createdAt: '2026-07-10T00:00:00Z', state: 'PENDING' }
  assert.equal(isPendingExpired(record, 4, '2026-07-15T00:00:00Z'), true)
  assert.equal(isPendingExpired(record, 10, '2026-07-15T00:00:00Z'), false)
})

// ---- resolveLocatorEntry (pure) ----------------------------------------------

test('resolveLocatorEntry: finds a matching entry', () => {
  const locator = [
    { pendingId: 'aaa', featureId: 'f1', planDir: 'docs/x/f1/', promotedAt: 't1' },
    { pendingId: 'bbb', featureId: 'f2', planDir: 'docs/x/f2/', promotedAt: 't2' },
  ]
  const entry = resolveLocatorEntry(locator, 'bbb')
  assert.equal(entry.featureId, 'f2')
  assert.equal(entry.planDir, 'docs/x/f2/')
})

test('resolveLocatorEntry: returns null for no match', () => {
  const locator = [{ pendingId: 'aaa', planDir: 'docs/x/' }]
  assert.equal(resolveLocatorEntry(locator, 'zzz'), null)
})

test('resolveLocatorEntry: returns null for empty/null locator', () => {
  assert.equal(resolveLocatorEntry([], 'aaa'), null)
  assert.equal(resolveLocatorEntry(null, 'aaa'), null)
  assert.equal(resolveLocatorEntry(undefined, 'aaa'), null)
})

// ---- Constants ---------------------------------------------------------------

test('PENDING_DIR points to the pending checkpoint directory', () => {
  assert.equal(PENDING_DIR, 'docs/extract/.pending/')
})

test('PENDING_LOCATOR_PATH points to the permanent locator file', () => {
  assert.equal(PENDING_LOCATOR_PATH, 'docs/extract/.pending-locator.json')
})

// ---- Schema validation -------------------------------------------------------

test('PREFLIGHT_VERDICT schema requires pendingId, task, verdict, state, createdAt', () => {
  assert.deepEqual(PREFLIGHT_VERDICT.required.sort(),
    ['createdAt', 'pendingId', 'state', 'task', 'verdict'].sort())
})

test('PREFLIGHT_VERDICT state enum includes PENDING, CONFIRMED, PROMOTED', () => {
  const stateProp = PREFLIGHT_VERDICT.properties.state
  assert.deepEqual(stateProp.enum.sort(), ['CONFIRMED', 'PENDING', 'PROMOTED'].sort())
})

test('PENDING_RECORD schema requires pendingId, task, verdict, state, createdAt', () => {
  assert.deepEqual(PENDING_RECORD.required.sort(),
    ['createdAt', 'pendingId', 'state', 'task', 'verdict'].sort())
})

test('PENDING_RECORD state enum includes EXPIRED', () => {
  const stateProp = PENDING_RECORD.properties.state
  assert.ok(stateProp.enum.includes('EXPIRED'))
})

test('LOCATOR_ENTRY schema requires pendingId, featureId, planDir, promotedAt', () => {
  assert.deepEqual(LOCATOR_ENTRY.required.sort(),
    ['featureId', 'pendingId', 'planDir', 'promotedAt'].sort())
})

// ---- Source assertions: extract-scope.mjs functions exist --------------------

test('source: resolveScopePreflight function is defined', () => {
  assert.match(source, /function resolveScopePreflight\b/)
})

test('source: resolveScopePreflight calls flexibleAgent (agent scope resolution)', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /flexibleAgent\(/)
})

test('source: resolveScopePreflight prompt says DO NOT WRITE ANY FILES', () => {
  const fnBody = source.slice(
    source.indexOf('function resolveScopePreflight'),
    source.indexOf('function writePendingRecord')
  )
  assert.match(fnBody, /DO NOT WRITE ANY FILES/)
})

test('source: writePendingRecord function is defined', () => {
  assert.match(source, /function writePendingRecord\b/)
})

test('source: readPendingRecord function is defined', () => {
  assert.match(source, /function readPendingRecord\b/)
})

test('source: appendLocatorEntry function is defined', () => {
  assert.match(source, /function appendLocatorEntry\b/)
})

test('source: resolveLocator function is defined', () => {
  assert.match(source, /function resolveLocator\b/)
})

test('source: promotePendingRecord function is defined', () => {
  assert.match(source, /function promotePendingRecord\b/)
})

test('source: promotePendingRecord handles NEW-feature branch (flushPipelineState root-last)', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  // NEW branch checks for existing pipeline-state.json and creates identity if absent
  assert.match(fnBody, /isExisting/)
  // Phase 13: writeIdentity replaces writeIdentityStub
  assert.match(fnBody, /writeIdentity\(/)
  // Root-last: flushPipelineState after identity + manifest
  const flushIdx = fnBody.indexOf('flushPipelineState')
  const identityIdx = fnBody.indexOf('writeIdentity(')
  assert.ok(flushIdx > identityIdx, 'flushPipelineState called after writeIdentity (root-last)')
})

test('source: promotePendingRecord does NOT overwrite identity on EXISTING branch', () => {
  // Search the entire source for the EXISTING branch markers
  const existingIdx = source.indexOf('EXISTING feature')
  assert.ok(existingIdx > 0, 'EXISTING branch marker found in source')
  const updateIdx = source.indexOf('Update pending record to PROMOTED', existingIdx)
  assert.ok(updateIdx > existingIdx, 'Update pending record marker found after EXISTING')
  const existingSection = source.slice(existingIdx, updateIdx)
  // The EXISTING branch should NOT call writeIdentity
  assert.doesNotMatch(existingSection, /writeIdentity\(/)
})

test('source: promotePendingRecord appends locator entry', () => {
  const fnBody = source.slice(
    source.indexOf('function promotePendingRecord'),
    source.indexOf('export { seedExtractQueue')
  )
  assert.match(fnBody, /appendLocatorEntry/)
})

// ---- Source assertions: main.mjs --confirm leg -------------------------------

test('source: main has a --confirm handler that reads pending record', () => {
  assert.match(source, /args\.confirm/)
  assert.match(source, /readPendingRecord/)
  assert.match(source, /confirmRecord/)
})

test('source: --confirm on PROMOTED redirects to --resume', () => {
  // The --confirm handler checks for PROMOTED state and sets args.resume
  const confirmSection = source.slice(
    source.indexOf("--confirm"),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /PROMOTED/)
  assert.match(confirmSection, /resume/)
})

test('source: --confirm on unknown pendingId returns blocked result', () => {
  const confirmSection = source.slice(
    source.indexOf("--confirm"),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /confirm-not-found/)
})

test('source: --confirm checks locator as fallback for expired payloads', () => {
  const confirmSection = source.slice(
    source.indexOf("--confirm"),
    source.indexOf('const resumeArg')
  )
  assert.match(confirmSection, /resolveLocator/)
})

test('source: fresh extract run uses preflight (resolveScopePreflight)', () => {
  // The extract mode branch calls resolveScopePreflight for fresh runs
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /resolveScopePreflight/)
})

test('source: preflight awaiting-confirm return does NOT call consolidate', () => {
  // Check the normal return path (after writePendingRecord) does NOT call consolidate.
  // The blocked-error path (preflight fails) may call consolidate — that's acceptable.
  const writeStart = source.indexOf('Write pending record', source.indexOf('Fresh run'))
  const returnIdx = source.indexOf('return result', writeStart)
  assert.ok(writeStart > 0, 'writePendingRecord call found in preflight section')
  assert.ok(returnIdx > writeStart, 'return found after writePendingRecord')
  const section = source.slice(writeStart, returnIdx)
  // Check for actual function call, not comment mentions
  assert.doesNotMatch(section, /await\s+consolidate\b/)
})

test('source: preflight return writes pending record', () => {
  const preflightStart = source.indexOf('Fresh run — preflight')
  const section = source.slice(preflightStart, preflightStart + 7000)
  assert.match(section, /writePendingRecord/)
})

test('source: preflight return includes pendingId in handoff', () => {
  const preflightStart = source.indexOf('Fresh run — preflight')
  const section = source.slice(preflightStart, preflightStart + 6000)
  assert.match(section, /pendingId/)
  assert.match(section, /awaiting-scope-confirm/)
})

test('source: extract mode has a Promote phase call for --confirm promotion', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /phase\('Promote'\)/)
})

test('source: extract mode calls promotePendingRecord for --confirm path', () => {
  const extractBranch = source.slice(source.indexOf('Extract mode: reverse'))
  assert.match(extractBranch, /promotePendingRecord/)
})

// ---- Source assertions: meta phases ------------------------------------------

test('source: meta declares Pending Confirm and Promote phases', () => {
  assert.match(source, /title: 'Pending Confirm'/)
  assert.match(source, /title: 'Promote'/)
})

// ---- Source assertions: crash-idempotent / atomic writes ---------------------

test('source: writePendingRecord uses temp-then-rename pattern', () => {
  const fnBody = source.slice(
    source.indexOf('function writePendingRecord'),
    source.indexOf('function readPendingRecord')
  )
  assert.match(fnBody, /temp-then-rename/i)
})

test('source: appendLocatorEntry reads existing array before appending', () => {
  const fnBody = source.slice(
    source.indexOf('function appendLocatorEntry'),
    source.indexOf('function resolveLocator(')
  )
  assert.match(fnBody, /file-reader/)
  assert.match(fnBody, /entries/)
})

// ---- Source assertions: no forbidden tokens in D0 code -----------------------

test('source: no Math.random calls in pending-confirmation code', () => {
  const d0Section = source.slice(
    source.indexOf('Pending-confirmation protocol'),
    source.indexOf('function promotePendingRecord')
  )
  assert.doesNotMatch(d0Section, /Math\.random\s*\(/)
})

test('source: no Date.now calls in pending-confirmation code', () => {
  const d0Section = source.slice(
    source.indexOf('Pending-confirmation protocol'),
    source.indexOf('function promotePendingRecord')
  )
  assert.doesNotMatch(d0Section, /Date\.now\s*\(/)
})
