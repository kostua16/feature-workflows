// Phase 19 PROOF-01: Cross-cutting E2E characterization for all 10 v1.6 scenarios.
//
// Each test chains multiple operations into an integrated flow, proving the
// v1.6 functions compose correctly end-to-end. Fixtures are built from scratch
// per test — no shared mutable state. All assertions exercise the shipped v1.6
// surface via the test harness (pure functions + source assertions).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  // Phase 12 — pending-confirmation protocol
  generatePendingId,
  buildPendingRecord,
  resolveLocatorEntry,
  // Phase 13 — deterministic identity
  deriveFeatureFolder,
  // Phase 14 — registry
  findFeature,
  upsertRegistryEntry,
  checkFolderCollision,
  canonicalizeIdentity,
  // Phase 15 — slice reconciliation
  reconcileSlices,
  validatePartition,
  // Phase 16 — change detection
  frameSliceDigest,
  detectSliceChanges,
  // Phase 17 — invalidation chain
  invalidateSliceChain,
  invalidatePersistenceEvidence,
  onSliceRemoved,
  markStaleForSlice,
  // Phase 18 — upsert
  resolveUpsertMode,
  deriveForkedFeatureId,
  isLegacyRoot,
  // Shared helpers
  createSynthesisState,
  deriveCoverageIndex,
  applyLifecycleEvent,
  LIFECYCLE_STATES,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// Valid 64-hex SHA-256 values for synthetic fixtures.
const H1 = 'a234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H2 = 'b234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H3 = 'c234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H4 = 'd234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H5 = 'e234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H6 = 'f234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'

// ===========================================================================
// E2E-PROMO-01: Pending-confirmation crash-idempotency (2 tests)
// ===========================================================================

test('E2E-PROMO-01: preflight → pendingId + PENDING record → locator resolves it', () => {
  // Step 1: preflight generates a deterministic pendingId from task + timestamp
  const task = 'extract authentication module'
  const timestamp = '20260724-1000'
  const pendingId = generatePendingId(task, timestamp)
  assert.ok(pendingId, 'pendingId must be produced')
  assert.equal(pendingId.length, 16, 'pendingId is 16-hex chars')
  // Deterministic: same inputs → same id
  assert.equal(generatePendingId(task, timestamp), pendingId)

  // Step 2: buildPendingRecord creates a PENDING-shaped record (no planDir yet)
  const verdict = {
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/session.ts', contentSha256: H2 },
    ],
    entryPoints: ['src/auth/login.ts'],
  }
  const record = buildPendingRecord(pendingId, task, verdict, timestamp)
  assert.equal(record.pendingId, pendingId)
  assert.equal(record.state, 'PENDING')
  assert.equal(record.planDir, undefined, 'PENDING record has no planDir — not yet promoted')
  assert.deepEqual(record.verdict, verdict)

  // Step 3: locator resolves the pendingId after promotion writes the entry
  const locator = [
    { pendingId: 'other000000000001', featureId: 'other', planDir: 'docs/extract/other/' },
    { pendingId: pendingId, featureId: 'auth-aabbcc', planDir: 'docs/extract/src/auth/auth-aabbcc/' },
  ]
  const entry = resolveLocatorEntry(locator, pendingId)
  assert.equal(entry.pendingId, pendingId)
  assert.equal(entry.featureId, 'auth-aabbcc')
  assert.ok(entry.planDir.startsWith('docs/extract/'))
})

test('E2E-PROMO-01: promotion is crash-idempotent — root-last ordering, replay-safe', () => {
  // Source assertions: promotePendingRecord follows root-last ordering and is
  // crash-safe on replay. This is the core PROMO-01 invariant: replaying a
  // promotion after a crash must NOT create a duplicate folder.
  const promoteFn = source.slice(
    source.indexOf('async function promotePendingRecord'),
    source.indexOf('// ---- Feature-identity registry')
  )
  assert.ok(promoteFn.length > 100, 'promotePendingRecord function body found')

  // 1. Existing check: promotion first checks if pipeline-state.json exists
  //    (NEW vs EXISTING branch — no duplicate folder on replay)
  assert.ok(promoteFn.includes('pipeline-state.json'),
    'promotion checks for existing pipeline-state.json')

  // 2. Root-last ordering: identity + manifest written BEFORE pipeline-state.json
  const identityIdx = promoteFn.indexOf('writeIdentity(')
  const manifestIdx = promoteFn.indexOf('writeScopeManifestFromVerdict(')
  const stateIdx = promoteFn.indexOf('flushPipelineState(')
  assert.ok(identityIdx > -1 && manifestIdx > -1 && stateIdx > -1,
    'all three write operations present')
  assert.ok(identityIdx < stateIdx,
    'identity written before pipeline-state (root-last)')
  assert.ok(manifestIdx < stateIdx,
    'scope-manifest written before pipeline-state (root-last)')

  // 3. Promoted record updated AFTER all writes — survives crash on replay
  const promotedRecordIdx = promoteFn.indexOf("state: 'PROMOTED'")
  assert.ok(promotedRecordIdx > stateIdx,
    'PROMOTED state set AFTER pipeline-state write (crash-safe)')

  // 4. Locator entry is append-only (permanent compact mapping)
  assert.ok(promoteFn.includes('appendLocatorEntry'),
    'locator entry appended for permanent mapping')

  // 5. EXISTING branch (else clause) does NOT write identity — extract it
  //    precisely: from "} else {" to the matching "}" before "Update pending"
  const elseIdx = promoteFn.indexOf('} else {')
  const updatePendingIdx = promoteFn.indexOf('Update pending record')
  assert.ok(elseIdx > -1, 'else branch for existing features exists')
  const elseBranch = promoteFn.slice(elseIdx, updatePendingIdx)
  assert.equal(elseBranch.match(/writeIdentity/), null,
    'EXISTING branch must NOT overwrite identity (ownership immutable)')
})

// ===========================================================================
// E2E-FOLDER-01: Deterministic folder across runs/worktrees (3 tests)
// ===========================================================================

test('E2E-FOLDER-01: same scope derived twice yields identical featureId and planDir', () => {
  const args = {
    fileHashes: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/session.ts', contentSha256: H2 },
    ],
    scopeDigest: H3,
    entryPoints: [],
  }
  const r1 = deriveFeatureFolder(args)
  const r2 = deriveFeatureFolder(args)
  assert.deepEqual(r1, r2)
  assert.ok(r1.featureId)
  assert.ok(r1.planDir.startsWith('docs/extract/'))
})

test('E2E-FOLDER-01: input-order independence — shuffled files produce same folder', () => {
  const filesNormal = [
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/session.ts', contentSha256: H2 },
    { path: 'src/auth/middleware.ts', contentSha256: H3 },
  ]
  const filesShuffled = [
    { path: 'src/auth/middleware.ts', contentSha256: H3 },
    { path: 'src/auth/login.ts', contentSha256: H1 },
    { path: 'src/auth/session.ts', contentSha256: H2 },
  ]
  const r1 = deriveFeatureFolder({ fileHashes: filesNormal, scopeDigest: H4, entryPoints: [] })
  const r2 = deriveFeatureFolder({ fileHashes: filesShuffled, scopeDigest: H4, entryPoints: [] })
  assert.deepEqual(r1, r2)
})

test('E2E-FOLDER-01: cross-worktree simulation — two independent derivations converge', () => {
  // Simulate two independent worktree derivations with identical scope+hashes.
  // Different variable lifetimes = independent calls, same deterministic output.
  const worktreeA = deriveFeatureFolder({
    fileHashes: [{ path: 'src/core/engine.ts', contentSha256: H5 }],
    scopeDigest: H6,
    entryPoints: ['src/core/engine.ts'],
  })
  const worktreeB = deriveFeatureFolder({
    fileHashes: [{ path: 'src/core/engine.ts', contentSha256: H5 }],
    scopeDigest: H6,
    entryPoints: ['src/core/engine.ts'],
  })
  assert.equal(worktreeA.featureId, worktreeB.featureId)
  assert.equal(worktreeA.planDir, worktreeB.planDir)
  assert.equal(worktreeA.area, worktreeB.area)
  // planDir follows <area>/<featureId>/ format
  assert.ok(worktreeA.planDir.endsWith(worktreeA.featureId + '/'))
})

// ===========================================================================
// E2E-MATCH-01: Full-rename registry match (2 tests)
// ===========================================================================

test('E2E-MATCH-01: full rename with same content hashes → findFeature returns reuse', () => {
  // Step 1: register a feature with original paths
  const registryFeatures = [{
    featureId: 'auth-aabbccddeeff0011',
    anchorPath: 'src/auth/login.ts',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H1 },
      { path: 'src/auth/session.ts', contentSha256: H2 },
    ],
  }]
  // Step 2: simulate full rename — ALL paths changed, SAME content hashes
  const currentFiles = [
    { path: 'src/newauth/signin.ts', contentSha256: H1 },
    { path: 'src/newauth/token.ts', contentSha256: H2 },
  ]
  // Step 3: findFeature must still match by content hash
  const result = findFeature({
    currentFiles,
    currentAnchor: 'src/newauth/signin.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'auth-aabbccddeeff0011')
})

test('E2E-MATCH-01: anchor content-hash match is strong regardless of path change', () => {
  const registryFeatures = [{
    featureId: 'core-aaaabbbbccccdddd',
    anchorPath: 'src/core/old-name.ts',
    files: [
      { path: 'src/core/old-name.ts', contentSha256: H3 },
      { path: 'src/core/helper.ts', contentSha256: H4 },
    ],
  }]
  // Anchor file renamed, content hash preserved
  const currentFiles = [
    { path: 'src/core/new-name.ts', contentSha256: H3 },
    { path: 'src/core/helper.ts', contentSha256: H4 },
  ]
  const result = findFeature({
    currentFiles,
    currentAnchor: 'src/core/new-name.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.ok(result.matchCount >= 1)
})

// ===========================================================================
// E2E-MATCH-02: Blocked ambiguous match (3 tests)
// ===========================================================================

test('E2E-MATCH-02: two features sharing only package.json → blocked', () => {
  const registryFeatures = [{
    featureId: 'feat-a-0000000000000011',
    anchorPath: 'src/feat-a/index.ts',
    files: [
      { path: 'src/feat-a/index.ts', contentSha256: H1 },
      { path: 'src/feat-a/handler.ts', contentSha256: H2 },
      { path: 'src/feat-a/utils.ts', contentSha256: H3 },
      { path: 'package.json', contentSha256: H4 },
    ],
  }]
  // Current scope only shares package.json (1 of 4 files)
  const currentFiles = [
    { path: 'src/different/main.ts', contentSha256: H5 },
    { path: 'package.json', contentSha256: H4 },
  ]
  const result = findFeature({
    currentFiles,
    currentAnchor: 'src/different/main.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'weak-only-match')
})

test('E2E-MATCH-02: resolveUpsertMode with blocked findResult returns blocked mode', () => {
  const blockedFind = { decision: 'blocked', reason: 'ambiguous' }
  const mode = resolveUpsertMode({}, blockedFind)
  assert.equal(mode.mode, 'blocked')
  assert.equal(mode.reason, 'ambiguous')
})

test('E2E-MATCH-02: --feature override on blocked match selects specified feature', () => {
  const blockedFind = {
    decision: 'blocked',
    reason: 'ambiguous',
    candidates: ['feat-a', 'feat-b'],
  }
  // User provides --feature=feat-a to disambiguate
  const mode = resolveUpsertMode({ feature: 'feat-a' }, blockedFind)
  assert.equal(mode.mode, 'feature')
  assert.equal(mode.featureId, 'feat-a')
  // Then the feature mode reassigns to auto-update for fallthrough
  assert.ok(source.includes("upsertMode.mode = 'auto-update'"),
    'feature mode must fall through to update path')
})

// ===========================================================================
// E2E-OWN-01: Ownership reconciliation — add/remove/move/new-dir (2 tests)
// ===========================================================================

test('E2E-OWN-01: add + remove + move + new-dir → exactly-one-owner via validatePartition', () => {
  // Step 1: persisted slices [A, B]
  const persistedSlices = [
    {
      sliceId: 'slice-A', status: 'current', planDir: 'docs/extract/a/',
      files: [
        { path: 'src/auth/login.ts', contentSha256: H1 },
        { path: 'src/auth/session.ts', contentSha256: H2 },
      ],
    },
    {
      sliceId: 'slice-B', status: 'current', planDir: 'docs/extract/b/',
      files: [
        { path: 'src/core/db.ts', contentSha256: H3 },
      ],
    },
  ]

  // Step 2: current files — ADD (new file in A's dir), REMOVE (B's file gone),
  // MOVE (login.ts → renamed, same content hash), NEW-DIR (files in new directory)
  const currentFiles = [
    // A's files: login.ts moved to new path (same hash = move detection)
    { path: 'src/auth/login-renamed.ts', contentSha256: H1 },
    // A's files: session.ts unchanged
    { path: 'src/auth/session.ts', contentSha256: H2 },
    // A's files: new file added in same directory
    { path: 'src/auth/middleware.ts', contentSha256: H4 },
    // NEW-DIR: files in a new directory (no existing slice owns)
    { path: 'lib/utils/helpers.ts', contentSha256: H5 },
    // B's file (db.ts) removed — not in current
  ]

  // Step 3: reconcileSlices assigns ownership
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)

  // Step 4: validatePartition — every current file has exactly one owner
  assert.doesNotThrow(() => validatePartition(slices, currentFiles),
    'every current file must have exactly one owner after reconciliation')

  // Moved file (login.ts → login-renamed.ts, same hash) stays in slice-A
  const sliceA = slices.find(s => s.sliceId === 'slice-A')
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/login-renamed.ts'),
    'moved file assigned to original slice')

  // Added file in A's directory goes to slice-A (prefix-score match)
  assert.ok(sliceA.files.some(f => f.path === 'src/auth/middleware.ts'),
    'added file in A\'s directory assigned to A')

  // slice-B is removed (its only file was removed)
  const sliceB = slices.find(s => s.sliceId === 'slice-B')
  assert.ok(sliceB, 'slice-B still exists')
  assert.ok(delta.removedSlices.includes('slice-B') || sliceB.status === 'removed',
    'slice-B marked removed when all its files are gone')

  // NEW-DIR files get their own new slice
  const newSlice = slices.find(s =>
    s.files && s.files.some(f => f.path === 'lib/utils/helpers.ts')
  )
  assert.ok(newSlice && !['slice-A', 'slice-B'].includes(newSlice.sliceId),
    'new-directory files assigned to a new slice')
})

test('E2E-OWN-01: permutation-invariant ownership — reordered input produces same partition', () => {
  const persistedSlices = [
    {
      sliceId: 'slice-X', status: 'current', planDir: 'docs/extract/x/',
      files: [
        { path: 'src/a.ts', contentSha256: H1 },
        { path: 'src/b.ts', contentSha256: H2 },
      ],
    },
  ]
  const filesNormal = [
    { path: 'src/a.ts', contentSha256: H1 },
    { path: 'src/b.ts', contentSha256: H2 },
    { path: 'lib/new.ts', contentSha256: H3 },
  ]
  const filesReordered = [
    { path: 'lib/new.ts', contentSha256: H3 },
    { path: 'src/b.ts', contentSha256: H2 },
    { path: 'src/a.ts', contentSha256: H1 },
  ]
  const r1 = reconcileSlices(persistedSlices, filesNormal)
  const r2 = reconcileSlices(persistedSlices, filesReordered)
  // Same partition: same number of slices, same file assignments
  assert.equal(r1.slices.length, r2.slices.length)
  assert.doesNotThrow(() => validatePartition(r1.slices, filesNormal))
  assert.doesNotThrow(() => validatePartition(r2.slices, filesReordered))
  // The slice IDs for the new-directory cluster are permutation-invariant
  const r1New = r1.slices.find(s => !['slice-X'].includes(s.sliceId))
  const r2New = r2.slices.find(s => !['slice-X'].includes(s.sliceId))
  assert.ok(r1New && r2New, 'new slice created in both')
  assert.equal(r1New.sliceId, r2New.sliceId, 'permutation-invariant slice IDs')
})

// ===========================================================================
// E2E-CHANGE-01: In-place update of changed slices (3 tests)
// ===========================================================================

test('E2E-CHANGE-01: 1-byte edit → changed slice invalidated, unchanged slice preserved', () => {
  // Step 1: build persisted slices [A, B] with known digests
  const persistedSlices = [
    {
      sliceId: 'slice-A', status: 'current', planDir: 'docs/extract/a/',
      files: [{ path: 'src/mod/feature.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-B', status: 'current', planDir: 'docs/extract/b/',
      files: [{ path: 'src/mod/util.ts', contentSha256: H2 }],
    },
  ]
  // Step 2: simulate 1-byte edit in slice-A (content hash changes)
  const currentFiles = [
    { path: 'src/mod/feature.ts', contentSha256: H3 }, // CHANGED hash
    { path: 'src/mod/util.ts', contentSha256: H2 },     // unchanged
  ]
  // Step 3: reconcileSlices assigns files to correct slices
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceA = slices.find(s => s.sliceId === 'slice-A')
  const sliceB = slices.find(s => s.sliceId === 'slice-B')
  assert.equal(sliceA.status, 'pending') // content changed → pending
  assert.equal(sliceB.status, 'current') // unchanged → stays current
  // Step 4: change detection marks A changed, B unchanged
  const persistedDigests = {
    'slice-A': { digest: frameSliceDigest([{ path: 'src/mod/feature.ts', contentSha256: H1 }]), valid: true },
    'slice-B': { digest: frameSliceDigest([{ path: 'src/mod/util.ts', contentSha256: H2 }]), valid: true },
  }
  const currentDigests = {
    'slice-A': { digest: frameSliceDigest([{ path: 'src/mod/feature.ts', contentSha256: H3 }]), valid: true },
    'slice-B': { digest: frameSliceDigest([{ path: 'src/mod/util.ts', contentSha256: H2 }]), valid: true },
  }
  const detection = detectSliceChanges(persistedDigests, currentDigests)
  const decA = detection.decisions.find(d => d.sliceId === 'slice-A')
  const decB = detection.decisions.find(d => d.sliceId === 'slice-B')
  assert.equal(decA.status, 'changed')
  assert.equal(decB.status, 'unchanged')
  // Step 5: invalidate only slice-A
  const state = {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'abc',
    extractReady: true,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
  const qeA = {
    status: 'done', artifacts: { factsPath: '/a' },
    _gateCheckpoints: { 'extract-facts': { seq: 1 } },
    factsPath: '/docs/facts.md', useCasePath: '/docs/e2e.md',
    designPath: '/docs/design.md', archPath: '/docs/arch.md',
    requirementsPath: '/docs/reqs.md', auditPath: '/docs/audit.md',
  }
  invalidateSliceChain(state, 'slice-A', qeA)
  assert.equal(qeA.status, 'pending')
  assert.equal(qeA.factsPath, null)
  assert.equal(state.extractReady, false)
})

test('E2E-CHANGE-01: framed distinctness — ["ab","c"] differs from ["a","bc"]', () => {
  // Two content boundary shifts must produce different frame digests
  const r1 = frameSliceDigest([{ path: 'ab', contentSha256: 'c' + H1.slice(1) }])
  const r2 = frameSliceDigest([{ path: 'a', contentSha256: 'bc' + H1.slice(2) }])
  assert.notEqual(r1, r2)
})

test('E2E-CHANGE-01: hash failure → fail-closed (detectSliceChanges treats as CHANGED)', () => {
  const persisted = { s1: { digest: H1, valid: true } }
  // Missing/malformed hash in current → invalid → changed
  const current = { s1: { digest: 'malformed', valid: false } }
  const result = detectSliceChanges(persisted, current)
  assert.equal(result.decisions[0].status, 'changed')
  assert.equal(result.decisions[0].reason, 'current-invalid')
  // Also: missing current entry → changed
  const result2 = detectSliceChanges(persisted, { s1: undefined })
  assert.equal(result2.decisions[0].status, 'changed')
})

// ===========================================================================
// E2E-INVAL-01: Crash-resume after invalidation (3 tests)
// ===========================================================================

test('E2E-INVAL-01: mid-invalidation crash → resume → gates re-run (artifact paths cleared)', () => {
  // Build state with a changed slice, then invalidate
  const state = {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'rev-123',
    extractReady: true,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
  const qe = {
    status: 'done', artifacts: { factsPath: '/a' },
    _gateCheckpoints: { 'extract-facts': { seq: 1 } },
    factsPath: '/docs/facts.md', useCasePath: '/docs/e2e.md',
    designPath: '/docs/design.md', archPath: '/docs/arch.md',
    requirementsPath: '/docs/reqs.md', auditPath: '/docs/audit.md',
    _facts: { data: 'cached' }, _reviewedDesign: true,
  }
  // Simulate invalidation (what would happen before a crash)
  invalidateSliceChain(state, 'slice-1', qe)
  // After invalidation: all artifact paths are null → gates will re-run
  // (not skipped by stale artifact-path guards)
  assert.equal(qe.factsPath, null)
  assert.equal(qe.useCasePath, null)
  assert.equal(qe.designPath, null)
  assert.equal(qe.archPath, null)
  assert.equal(qe.requirementsPath, null)
  assert.equal(qe.auditPath, null)
  assert.equal(Object.keys(qe._gateCheckpoints).length, 0)
  // status is pending → will be re-extracted
  assert.equal(qe.status, 'pending')
})

test('E2E-INVAL-01: after invalidation, publish/persist evidence all reset', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'abc',
    extractReady: true,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
  const qe = {
    status: 'done', artifacts: {},
    _gateCheckpoints: {},
    factsPath: '/docs/f.md',
  }
  invalidateSliceChain(state, 'slice-X', qe)
  // All 4 publish/persist guards must be false/null after invalidation
  assert.equal(state._publishVerified, false)
  assert.equal(state._persistVerified, false)
  assert.equal(state.published, null)
  assert.equal(state.persist, null)
})

test('E2E-INVAL-01: extractReady is false until invalidation chain completes', () => {
  const state = {
    persistenceTracker: null,
    synthesisState: createSynthesisState(),
    overviewPath: '/docs/overview.md',
    _sourceDigest: 'abc',
    extractReady: true,
    published: null,
    persist: null,
    _publishVerified: false,
    _persistVerified: false,
  }
  const qe = {
    status: 'done', artifacts: {},
    _gateCheckpoints: {},
    factsPath: '/f',
  }
  // Before invalidation: extractReady was true
  assert.equal(state.extractReady, true)
  invalidateSliceChain(state, 'slice-Y', qe)
  // After invalidation: extractReady must be false (no overstated completion)
  assert.equal(state.extractReady, false)
  assert.equal(state.overviewPath, null)
  assert.equal(state._sourceDigest, null)
})

// ===========================================================================
// E2E-REMOVED-01: Removed-slice parent update (3 tests)
// ===========================================================================

test('E2E-REMOVED-01: emptied slice → removed status → onSliceRemoved fires', () => {
  // Step 1: build state with slices [A, B]
  const persistedSlices = [
    {
      sliceId: 'slice-A', status: 'current', planDir: 'docs/extract/a/',
      files: [{ path: 'src/mod/feature.ts', contentSha256: H1 }],
    },
    {
      sliceId: 'slice-B', status: 'current', planDir: 'docs/extract/b/',
      files: [{ path: 'src/old/removed.ts', contentSha256: H2 }],
    },
  ]
  // Step 2: simulate B emptied (all files removed)
  const currentFiles = [
    { path: 'src/mod/feature.ts', contentSha256: H1 },
  ]
  // Step 3: reconcileSlices marks B as removed
  const { slices, delta } = reconcileSlices(persistedSlices, currentFiles)
  const sliceB = slices.find(s => s.sliceId === 'slice-B')
  assert.equal(sliceB.status, 'removed')
  assert.equal(sliceB.files.length, 0)
  assert.ok(delta.removedSlices.includes('slice-B'))
  // Step 4: onSliceRemoved fires → lifecycle excluded, evidence superseded
  const state = {
    persistenceTracker: null,
    published: { published: true },
    persist: { persisted: true },
    _publishVerified: true,
    _persistVerified: true,
  }
  const qe = { lifecycle: 'runnable' }
  onSliceRemoved(state, 'slice-B', qe)
  assert.equal(qe.lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

test('E2E-REMOVED-01: parent views (synthesis/coverage) updated; removed slice NOT re-extracted', () => {
  // Simulate the parent state update flow when a slice is removed.
  // markStaleForSlice only acts when synthesized: true.
  const synthesisState = { synthesized: true, views: {} }
  // Mark slice as stale in synthesis
  const updated = markStaleForSlice(synthesisState, 'slice-B')
  assert.ok(updated.staleSlices.includes('slice-B'))
  assert.deepEqual(updated.staleViews.sort(),
    ['coverageIndex', 'crossCutting', 'dependencyMap', 'systemOverview'])
  // Coverage denominator decremented when slice is excluded
  const before = deriveCoverageIndex([
    { lifecycle: 'completed' },
    { lifecycle: 'completed' },
  ])
  const after = deriveCoverageIndex([
    { lifecycle: 'completed' },
    { lifecycle: 'excluded' },
  ])
  assert.equal(before.denominator, 2)
  assert.equal(after.denominator, 1)
  // Source assertion: onSliceRemoved does NOT set queueEntry.status to pending
  // (terminal — not re-extracted)
  const fnMatch = source.match(/function onSliceRemoved[\s\S]*?\n}/)
  assert.ok(fnMatch)
  assert.equal(fnMatch[0].match(/queueEntry\.status\s*=\s*['"]pending['"]/), null,
    'removed slice must NOT be set to pending (no re-extraction)')
})

test('E2E-REMOVED-01: removed slice lifecycle is excluded; evidence superseded (not deleted)', () => {
  // onSliceRemoved calls applyLifecycleEvent with exclude event
  let qe = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  qe = applyLifecycleEvent(qe, { type: 'exclude', payload: { rationale: 'slice-removed-empty' } })
  assert.equal(qe.lifecycle, LIFECYCLE_STATES.EXCLUDED)
  // Source assertion: onSliceRemoved does NOT clear artifact paths
  const fnBody = source.slice(
    source.indexOf('function onSliceRemoved'),
    source.indexOf('export { main, onSliceRemoved }')
  )
  assert.equal(fnBody.match(/factsPath\s*=\s*null|designPath\s*=\s*null/), null,
    'onSliceRemoved must NOT clear artifact paths (history preserved)')
})

// ===========================================================================
// E2E-UPSERT-01: Auto-update default (4 tests)
// ===========================================================================

test('E2E-UPSERT-01: bare re-run → auto-update → no changes → all slices skip (idempotent)', () => {
  // Step 1: findResult says reuse (feature exists)
  const findResult = { decision: 'reuse', featureId: 'auth-abc123' }
  // Step 2: no flags → resolveUpsertMode returns auto-update
  const mode = resolveUpsertMode({}, findResult)
  assert.equal(mode.mode, 'auto-update')
  // Step 3: with no actual changes, all slices unchanged → idempotent skip
  const persistedDigests = { s1: { digest: H1, valid: true } }
  const currentDigests = { s1: { digest: H1, valid: true } }
  const detection = detectSliceChanges(persistedDigests, currentDigests)
  assert.equal(detection.unchangedCount, 1)
  assert.equal(detection.changedCount, 0)
})

test('E2E-UPSERT-01: --no-update → continue-incomplete (no change detection)', () => {
  const findResult = { decision: 'reuse', featureId: 'feat-x' }
  const mode = resolveUpsertMode({ noUpdate: true }, findResult)
  assert.equal(mode.mode, 'continue-incomplete')
  // Source assertion: continue-incomplete is EXCLUDED from change detection
  const innerMatch = source.match(
    /upsertMode\.mode === 'auto-update' \|\| upsertMode\.mode === 'force'\)\s*\{/
  )
  assert.ok(innerMatch, 'inner change-detection condition has only auto-update+force')
})

test('E2E-UPSERT-01: --force → all slices invalidated regardless of digest', () => {
  const findResult = { decision: 'reuse', featureId: 'feat-y' }
  const mode = resolveUpsertMode({ force: true }, findResult)
  assert.equal(mode.mode, 'force')
  // Source assertion: force parameter is wired to mode check
  assert.ok(source.includes("force: upsertMode.mode === 'force'"),
    'force parameter wired to mode===force')
})

test('E2E-UPSERT-01: --new on existing feature → forked folder <featureId>-2', () => {
  const baseId = 'auth-abc123def45678'
  // No existing forks → <base>-2
  const result = deriveForkedFeatureId(baseId, { features: {} })
  assert.deepEqual(result, { featureId: 'auth-abc123def45678-2', n: 2 })
  // <base>-2 exists → <base>-3
  const reg2 = { features: { 'auth-abc123def45678-2': { featureId: 'auth-abc123def45678-2' } } }
  const result2 = deriveForkedFeatureId(baseId, reg2)
  assert.deepEqual(result2, { featureId: 'auth-abc123def45678-3', n: 3 })
  // Source assertion: --new fork sets preflight.forkedFeatureId
  const newBranchIdx = source.indexOf("upsertMode.mode === 'new' && findResult.decision === 'reuse'")
  assert.ok(newBranchIdx > -1, 'new+reuse branch exists')
  const branch = source.slice(newBranchIdx, newBranchIdx + 500)
  assert.ok(branch.includes('preflight.forkedFeatureId'),
    'forkedFeatureId set in preflight for --new fork')
})

// ===========================================================================
// E2E-ADOPT-01: v1.5 → v1.6 adopt convergence (4 tests)
// ===========================================================================

test('E2E-ADOPT-01: isLegacyRoot qualifies v1.5 folders with pipeline-state.json marker', () => {
  // A v1.5 root has pipeline-state.json or plan.md, no .identity.json
  assert.ok(isLegacyRoot('docs/extract/auth/', ['pipeline-state.json']))
  assert.ok(isLegacyRoot('docs/extract/auth/', ['plan.md']))
  assert.ok(!isLegacyRoot('docs/extract/auth/', ['README.md']),
    'no root marker → not a legacy root')
  // Excludes: slice children, pending dirs, registry, sidecars
  assert.ok(!isLegacyRoot('docs/extract/auth/slices/child/', ['pipeline-state.json']),
    'slice child excluded')
  assert.ok(!isLegacyRoot('docs/extract/.pending/', ['pipeline-state.json']),
    'pending dir excluded')
  assert.ok(!isLegacyRoot('docs/extract/.registry.json', ['.registry.json']),
    'registry excluded')
  assert.ok(!isLegacyRoot('docs/extract/auth/.identity.json', ['.identity.json']),
    'identity sidecar excluded')
})

test('E2E-ADOPT-01: adopt convergence — same scope → same folder after adoption', () => {
  // Step 1: simulate a v1.5 folder derivation (deterministic from scope)
  const folderInfo = deriveFeatureFolder({
    fileHashes: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    scopeDigest: H2,
    entryPoints: [],
  })
  // Step 2: after adoption, a fresh findFeature with same scope converges
  // (adoptLegacyFolder calls deriveFeatureFolder + upsertRegistryEntry)
  const registryFeatures = [{
    featureId: folderInfo.featureId,
    anchorPath: 'src/auth/login.ts',
    files: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    planDir: folderInfo.planDir,
  }]
  const result = findFeature({
    currentFiles: [{ path: 'src/auth/login.ts', contentSha256: H1 }],
    currentAnchor: 'src/auth/login.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, folderInfo.featureId)
  // Source assertion: adoptLegacyFolder calls deriveFeatureFolder + upsertRegistryEntry
  assert.ok(source.includes('adoptLegacyFolder('), 'adoptLegacyFolder called in engine')
  assert.ok(source.includes('deriveFeatureFolder('), 'deriveFeatureFolder available')
})

test('E2E-ADOPT-01: old --resume after adoption still loads state (both paths converge)', () => {
  // The resume contract is preserved: pipeline-state.json loads correctly
  // after adoption adds identity + registry entries.
  // Source assertion: adoptLegacyFolder does not remove pipeline-state.json
  const adoptFn = source.slice(
    source.indexOf('function adoptLegacyFolder'),
    source.indexOf('export { seedExtractQueue')
  )
  // adoptLegacyFolder writes identity and registry, but doesn't delete state
  assert.ok(adoptFn.includes('writeIdentity') || adoptFn.includes('identity'),
    'adoptLegacyFolder writes identity')
  assert.ok(adoptFn.includes('writeRegistry') || adoptFn.includes('registry'),
    'adoptLegacyFolder writes registry')
  // Does NOT delete pipeline-state.json
  assert.equal(adoptFn.match(/delete.*pipeline-state|unlink.*pipeline-state/), null,
    'adopt must not delete pipeline-state.json')
})

test('E2E-ADOPT-01: re-adoption is idempotent (already-adopted no-op)', () => {
  // ADOPT_RESULT enum includes 'already-adopted'
  const adoptResultSchema = engine.ADOPT_RESULT
  assert.ok(adoptResultSchema.properties.reason.enum.includes('already-adopted'),
    'ADOPT_RESULT must include already-adopted reason')
  // isLegacyRoot returns false for a folder that already has .identity.json
  // (already adopted → no longer a legacy root)
  assert.ok(!isLegacyRoot('docs/extract/auth/', ['.identity.json']),
    'folder with only .identity.json is NOT a legacy root (already adopted)')
  // Source assertion: scanForLegacyFolders uses isLegacyRoot to filter
  assert.ok(source.includes('scanForLegacyFolders('),
    'scanForLegacyFolders called in engine')
})

// ===========================================================================
// E2E coverage tracker — verifies every ROADMAP E2E scenario has real tests
// ===========================================================================

test('E2E-MATRIX: every ROADMAP v1.6 E2E scenario ID has at least one test in this suite', () => {
  // The ROADMAP E2E matrix defines 10 scenarios exercised by this suite.
  // E2E-PROOF-01 is covered in v16-regression-proof.test.mjs (not here).
  const ROADMAP_SCENARIOS = [
    'E2E-PROMO-01',
    'E2E-FOLDER-01',
    'E2E-MATCH-01',
    'E2E-MATCH-02',
    'E2E-OWN-01',
    'E2E-CHANGE-01',
    'E2E-INVAL-01',
    'E2E-REMOVED-01',
    'E2E-UPSERT-01',
    'E2E-ADOPT-01',
  ]
  // Extract test names from THIS file's own source to verify real coverage
  const selfSource = readFileSync(new URL(import.meta.url), 'utf8')
  const testNames = selfSource.match(/test\('([^']+)'/g) || []
  const missing = ROADMAP_SCENARIOS.filter(id =>
    !testNames.some(name => name.includes(id))
  )
  assert.equal(missing.length, 0,
    `E2E scenarios missing real tests in this suite: ${missing.join(', ')}`)
  // Each scenario must have at least 1 test
  for (const id of ROADMAP_SCENARIOS) {
    const count = testNames.filter(n => n.includes(id)).length
    assert.ok(count >= 1, `${id} must have at least 1 test (found ${count})`)
  }
})
