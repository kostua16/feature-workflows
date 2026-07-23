// Phase 14 — Feature-Identity Registry, Lookup & Integrity (D1.2).
// Tests findFeature pure function, registry read/write helpers, collision guard,
// schema shapes, and main.mjs integration source assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  findFeature,
  upsertRegistryEntry,
  REGISTRY_PATH,
  REGISTRY_ENTRY,
  REGISTRY_FILE,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// Valid 64-hex SHA-256 for tests.
const H64a = 'a234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H64b = 'b234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H64c = 'c234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'
const H64d = 'd234567890abcdef01234567890abcdef01234567890abcdef01234567890abcdef'

// ---- RED tests (findFeature — must find by content hash even after full rename) ----

test('RED: full rename scenario — content hash match reuses existing feature', () => {
  // Registry feature with original paths
  var registryFeatures = [{
    featureId: 'auth-aabbccdd12345678',
    anchorPath: 'src/auth/login.ts',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H64a },
      { path: 'src/auth/session.ts', contentSha256: H64b },
      { path: 'src/auth/middleware.ts', contentSha256: H64c },
    ],
  }]
  // Current scope: ALL paths changed, but content hashes are the same
  var currentFiles = [
    { path: 'src/newauth/signin.ts', contentSha256: H64a },
    { path: 'src/newauth/token.ts', contentSha256: H64b },
    { path: 'src/newauth/guard.ts', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/newauth/signin.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'auth-aabbccdd12345678')
})

test('RED: weak-only match (shared config file) is blocked', () => {
  var registryFeatures = [{
    featureId: 'feat-0000000000000001',
    anchorPath: 'src/feat/index.ts',
    files: [
      { path: 'src/feat/index.ts', contentSha256: H64a },
      { path: 'src/feat/handler.ts', contentSha256: H64b },
      { path: 'package.json', contentSha256: H64c },
    ],
  }]
  // Current scope only shares package.json (config), no anchor, no majority
  var currentFiles = [
    { path: 'src/other/main.ts', contentSha256: H64d },
    { path: 'package.json', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/other/main.ts', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'weak-only-match')
})

test('RED: tie in match counts is blocked (ambiguous-match)', () => {
  var registryFeatures = [
    {
      featureId: 'feat-aaaa111122334455',
      anchorPath: 'src/a/index.ts',
      files: [
        { path: 'src/a/index.ts', contentSha256: H64a },
        { path: 'shared.ts', contentSha256: H64c },
      ],
    },
    {
      featureId: 'feat-bbbb667788990011',
      anchorPath: 'src/b/index.ts',
      files: [
        { path: 'src/b/index.ts', contentSha256: H64b },
        { path: 'shared.ts', contentSha256: H64c },
      ],
    },
  ]
  // Current scope matches both equally (shared file = majority for both small features)
  var currentFiles = [
    { path: 'shared.ts', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'shared.ts', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'ambiguous-match')
})

// ---- GREEN tests — findFeature pure function ----

test('findFeature: anchor match reuses even if all paths changed', () => {
  var registryFeatures = [{
    featureId: 'auth-aaaabbbbccccdddd',
    anchorPath: 'src/auth/login.ts',
    files: [
      { path: 'src/auth/login.ts', contentSha256: H64a },
      { path: 'src/auth/session.ts', contentSha256: H64b },
    ],
  }]
  // All paths renamed, anchor path is the same
  var currentFiles = [
    { path: 'src/auth/login.ts', contentSha256: H64a },
    { path: 'src/auth/renamed.ts', contentSha256: H64d },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/auth/login.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'auth-aaaabbbbccccdddd')
})

test('findFeature: majority match reuses', () => {
  var registryFeatures = [{
    featureId: 'mod-aaaabbbbccccdddd',
    anchorPath: 'src/mod/core.ts',
    files: [
      { path: 'src/mod/core.ts', contentSha256: H64a },
      { path: 'src/mod/util.ts', contentSha256: H64b },
      { path: 'src/mod/api.ts', contentSha256: H64c },
      { path: 'src/mod/db.ts', contentSha256: H64d },
    ],
  }]
  // 3 of 4 files match by path (majority of min(4,4) = 3)
  var currentFiles = [
    { path: 'src/mod/core.ts', contentSha256: H64a },
    { path: 'src/mod/util.ts', contentSha256: H64b },
    { path: 'src/mod/api.ts', contentSha256: H64c },
    { path: 'src/mod/newfile.ts', contentSha256: 'e' + H64d.slice(1) },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/mod/core.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
})

test('findFeature: zero strong candidates returns new', () => {
  var registryFeatures = [{
    featureId: 'other-aaaabbbbccccdddd',
    anchorPath: 'src/other/index.ts',
    files: [{ path: 'src/other/index.ts', contentSha256: H64a }],
  }]
  var currentFiles = [
    { path: 'src/newfeature/main.ts', contentSha256: H64b },
    { path: 'src/newfeature/util.ts', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/newfeature/main.ts', registryFeatures })
  assert.equal(result.decision, 'new')
})

test('findFeature: two strong candidates different counts → strictly-highest reuses', () => {
  var registryFeatures = [
    {
      featureId: 'feat-a-0000000000000011',
      anchorPath: 'src/a/index.ts',
      files: [
        { path: 'src/a/index.ts', contentSha256: H64a },
        { path: 'shared/config.ts', contentSha256: H64c },
        { path: 'src/a/helper.ts', contentSha256: 'f' + H64a.slice(1) },
      ],
    },
    {
      featureId: 'feat-b-0000000000000022',
      anchorPath: 'src/b/index.ts',
      files: [
        { path: 'shared/config.ts', contentSha256: H64c },
      ],
    },
  ]
  // feat-a matches 2 (H64a by path+hash, H64c by path+hash), feat-b matches 1
  // min(2, 3) for feat-a = 2, majority = 2 → strong with 2 matches
  // min(2, 1) for feat-b = 1, majority = 1 → strong with 1 match
  var currentFiles = [
    { path: 'src/a/index.ts', contentSha256: H64a },
    { path: 'shared/config.ts', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/a/index.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'feat-a-0000000000000011')
  assert.equal(result.matchCount, 2)
})

test('findFeature: two strong candidates same match count → blocked', () => {
  var registryFeatures = [
    {
      featureId: 'feat-x-0000000000000033',
      anchorPath: 'src/x/index.ts',
      files: [
        { path: 'src/x/index.ts', contentSha256: H64a },
        { path: 'shared.ts', contentSha256: H64c },
      ],
    },
    {
      featureId: 'feat-y-0000000000000044',
      anchorPath: 'src/y/index.ts',
      files: [
        { path: 'src/y/index.ts', contentSha256: H64b },
        { path: 'shared.ts', contentSha256: H64c },
      ],
    },
  ]
  // Both match shared.ts → min(1,2)=1, majority=1 → both strong with 1 match each
  var currentFiles = [
    { path: 'shared.ts', contentSha256: H64c },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'shared.ts', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'ambiguous-match')
  assert.ok(result.candidates && result.candidates.length >= 2)
})

test('findFeature: weak-only match (shared config) → blocked', () => {
  var registryFeatures = [{
    featureId: 'big-aaaabbbbccccdddd',
    anchorPath: 'src/big/main.ts',
    files: [
      { path: 'src/big/main.ts', contentSha256: H64a },
      { path: 'src/big/a.ts', contentSha256: H64b },
      { path: 'src/big/b.ts', contentSha256: H64c },
      { path: 'src/big/c.ts', contentSha256: H64d },
      { path: 'tsconfig.json', contentSha256: 'e' + H64a.slice(1) },
    ],
  }]
  // Current only shares tsconfig.json (1 of 5) — not majority
  var currentFiles = [
    { path: 'src/small/main.ts', contentSha256: 'f' + H64a.slice(1) },
    { path: 'tsconfig.json', contentSha256: 'e' + H64a.slice(1) },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/small/main.ts', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'weak-only-match')
  assert.ok(result.weakMatches && result.weakMatches.length > 0)
})

test('findFeature: uses min(currentCount, featureCount) for majority threshold', () => {
  // A single shared file IS a majority for a small feature (min=1, majority=1)
  // but NOT for a large feature
  var registryFeatures = [{
    featureId: 'large-aaaabbbbccccdddd',
    anchorPath: 'src/large/index.ts',
    files: Array.from({ length: 10 }, function (_, i) {
      return { path: 'src/large/file' + i + '.ts', contentSha256: 'f' + i + H64a.slice(2) }
    }),
  }]
  var currentFiles = [
    { path: 'src/small/index.ts', contentSha256: H64a },
    { path: 'src/large/file0.ts', contentSha256: 'f0' + H64a.slice(2) },
  ]
  // min(2, 10) = 2, majority = 2 → 1 match < 2 → NOT strong → weak-only
  var result = findFeature({ currentFiles, currentAnchor: 'src/small/index.ts', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'weak-only-match')
})

test('findFeature: empty registry → new', () => {
  var result = findFeature({
    currentFiles: [{ path: 'src/a.ts', contentSha256: H64a }],
    currentAnchor: 'src/a.ts',
    registryFeatures: [],
  })
  assert.equal(result.decision, 'new')
})

test('findFeature: empty currentFiles → blocked', () => {
  var result = findFeature({
    currentFiles: [],
    currentAnchor: '',
    registryFeatures: [{ featureId: 'x', anchorPath: 'a', files: [{ path: 'a', contentSha256: H64a }] }],
  })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'empty-current-files')
})

test('findFeature: matchCount deduplicates path+hash dual matches', () => {
  // A file that matches both by path AND hash should count once
  var registryFeatures = [{
    featureId: 'dedup-aaaabbbbccccdddd',
    anchorPath: 'src/x.ts',
    files: [{ path: 'src/x.ts', contentSha256: H64a }],
  }]
  var currentFiles = [
    { path: 'src/x.ts', contentSha256: H64a }, // matches both path AND hash
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/x.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.matchCount, 1) // NOT 2
})

test('findFeature: returns structured result without throwing on ambiguous', () => {
  var registryFeatures = [
    { featureId: 'a', anchorPath: 'a', files: [{ path: 'shared', contentSha256: H64a }] },
    { featureId: 'b', anchorPath: 'b', files: [{ path: 'shared', contentSha256: H64a }] },
  ]
  var currentFiles = [{ path: 'shared', contentSha256: H64a }]
  var result = findFeature({ currentFiles, currentAnchor: 'shared', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.ok(result.reason)
  assert.doesNotThrow(function () { JSON.stringify(result) })
})

// ---- GREEN tests — upsertRegistryEntry (pure) ----

test('upsertRegistryEntry: does not mutate input registry', () => {
  var original = { features: { 'a': { featureId: 'a', status: 'current' } } }
  var entry = { featureId: 'b', status: 'extracting' }
  var updated = upsertRegistryEntry(original, entry)
  assert.equal(original.features['b'], undefined)
  assert.ok(updated.features['b'])
})

test('upsertRegistryEntry: adds new entry to features map', () => {
  var registry = { features: {} }
  var entry = { featureId: 'new-feature', planDir: 'docs/extract/x/' }
  var updated = upsertRegistryEntry(registry, entry)
  assert.equal(updated.features['new-feature'], entry)
})

test('upsertRegistryEntry: overwrites existing entry with same featureId', () => {
  var registry = { features: { 'f1': { featureId: 'f1', status: 'extracting' } } }
  var entry = { featureId: 'f1', status: 'current' }
  var updated = upsertRegistryEntry(registry, entry)
  assert.equal(updated.features['f1'].status, 'current')
})

// ---- GREEN tests — schema shapes ----

test('REGISTRY_ENTRY: has additionalProperties:false', () => {
  assert.equal(REGISTRY_ENTRY.additionalProperties, false)
})

test('REGISTRY_ENTRY: requires all 7 fields', () => {
  var required = REGISTRY_ENTRY.required
  assert.ok(required.includes('featureId'))
  assert.ok(required.includes('planDir'))
  assert.ok(required.includes('ownershipScopeDigest'))
  assert.ok(required.includes('scopeId16'))
  assert.ok(required.includes('files'))
  assert.ok(required.includes('status'))
  assert.ok(required.includes('updatedAt'))
  assert.equal(required.length, 7)
})

test('REGISTRY_FILE: has features as object with additionalProperties', () => {
  assert.ok(REGISTRY_FILE.properties.features)
  assert.equal(REGISTRY_FILE.properties.features.type, 'object')
  assert.ok(REGISTRY_FILE.properties.features.additionalProperties)
})

test('REGISTRY_ENTRY.status enum is extracting/current/stale', () => {
  assert.deepEqual(REGISTRY_ENTRY.properties.status.enum, ['extracting', 'current', 'stale'])
})

test('REGISTRY_ENTRY.files items have additionalProperties:false', () => {
  var fileItem = REGISTRY_ENTRY.properties.files.items
  assert.equal(fileItem.additionalProperties, false)
})

// ---- Source assertions — function definitions exist in dist ----

test('source: findFeature function is defined', () => {
  assert.match(source, /function findFeature\b/)
})

test('source: upsertRegistryEntry function is defined', () => {
  assert.match(source, /function upsertRegistryEntry\b/)
})

test('source: readRegistry function is defined', () => {
  assert.match(source, /function readRegistry\b/)
})

test('source: writeRegistry function is defined', () => {
  assert.match(source, /function writeRegistry\b/)
})

test('source: checkFolderCollision function is defined', () => {
  assert.match(source, /function checkFolderCollision\b/)
})

test('source: recoverRegistry function is defined', () => {
  assert.match(source, /function recoverRegistry\b/)
})

// ---- Source assertions — registry path constant ----

test('source: REGISTRY_PATH is docs/extract/.registry.json', () => {
  assert.match(source, /const REGISTRY_PATH = 'docs\/extract\/\.registry\.json'/)
})

// ---- Source assertions — findFeature purity (no agent/async/io) ----

test('source: findFeature has no safeAgent/flexibleAgent/async', () => {
  var fnBody = source.slice(
    source.indexOf('function findFeature'),
    source.indexOf('function upsertRegistryEntry')
  )
  assert.doesNotMatch(fnBody, /safeAgent/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
  assert.doesNotMatch(fnBody, /\basync\b/)
})

test('source: upsertRegistryEntry has no agent calls', () => {
  var fnBody = source.slice(
    source.indexOf('function upsertRegistryEntry'),
    source.indexOf('// readRegistry:')
  )
  assert.doesNotMatch(fnBody, /safeAgent/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
  assert.doesNotMatch(fnBody, /\basync\b/)
})

test('source: no Math.random or Date.now in findFeature or upsertRegistryEntry', () => {
  var block = source.slice(
    source.indexOf('function findFeature'),
    source.indexOf('// readRegistry:')
  )
  assert.doesNotMatch(block, /Math\.random/)
  assert.doesNotMatch(block, /Date\.now/)
})

// ---- Source assertions — collision guard uses ownershipScopeDigest ----

test('source: checkFolderCollision compares ownershipScopeDigest (not featureId)', () => {
  var fnBody = source.slice(
    source.indexOf('function checkFolderCollision'),
    source.indexOf('function recoverRegistry')
  )
  assert.match(fnBody, /ownershipScopeDigest/)
})

// ---- Source assertions — readIdentitySidecar validates against IDENTITY_RECORD ----

test('source: readIdentitySidecar exists and validates identity', () => {
  assert.match(source, /function readIdentitySidecar\b/)
})

// ---- Source assertions — main.mjs integration ----

test('source: fresh extract run calls findFeature after preflight', () => {
  assert.match(source, /findFeature\(\{/)
  assert.match(source, /currentFiles:.*fileHashes/)
})

test('source: findFeature reuse sets planDir to reused feature planDir', () => {
  var block = source.slice(
    source.indexOf("findResult.decision === 'reuse'"),
    source.indexOf("findResult.decision === 'blocked'")
  )
  assert.match(block, /planDir\s*=\s*reusedEntry\.planDir/)
})

test('source: findFeature new calls checkFolderCollision before promotion', () => {
  var block = source.slice(
    source.indexOf("findResult.decision === 'new'"),
    source.indexOf('Write pending record')
  )
  assert.match(block, /checkFolderCollision/)
})

test('source: findFeature blocked returns blocked handoff, does NOT promote', () => {
  var block = source.slice(
    source.indexOf("findResult.decision === 'blocked'"),
    source.indexOf("findResult.decision === 'new'")
  )
  assert.match(block, /blockedAt/)
  assert.match(block, /return result/)
})

test('source: after promotion upsertRegistryEntry + writeRegistry called', () => {
  assert.match(source, /upsertRegistryEntry\(existingReg/)
  assert.match(source, /writeRegistry\(REGISTRY_PATH/)
})

test('source: registry entry initial status is extracting', () => {
  assert.match(source, /status:\s*'extracting'/)
})

test('source: root-last readiness commit updates status to current', () => {
  // The root-last block should set status to 'current' after readiness.ready
  var block = source.slice(source.indexOf('Root-last readiness commit'))
  assert.match(block, /status\s*=\s*'current'/)
})

test('source: findFeature matchCount uses path OR hash deduplication', () => {
  var fnBody = source.slice(
    source.indexOf('function findFeature'),
    source.indexOf('function upsertRegistryEntry')
  )
  assert.match(fnBody, /matchByPath \|\| matchByHash/)
})

// ---- Source assertions — writeRegistry uses temp-then-rename ----

test('source: writeRegistry uses temp-then-rename', () => {
  var fnBody = source.slice(
    source.indexOf('function writeRegistry'),
    source.indexOf('function readIdentitySidecar')
  )
  assert.match(fnBody, /temp-then-rename/)
})

test('source: writeRegistry uses JSON.stringify with 2-space indent', () => {
  var fnBody = source.slice(
    source.indexOf('function writeRegistry'),
    source.indexOf('function readIdentitySidecar')
  )
  assert.match(fnBody, /JSON\.stringify\(registry, null, 2\)/)
})

// ---- Source assertions — meta phases ----

test('source: Registry Lookup phase declared in meta', () => {
  assert.match(source, /title: 'Registry Lookup'/)
})

test('source: Registry Recovery phase declared in meta', () => {
  assert.match(source, /title: 'Registry Recovery'/)
})

// ---- Source assertions — startup recovery integration ----

test('source: extract mode calls recoverRegistry at startup', () => {
  assert.match(source, /recoverRegistry\(\{ registryPath: REGISTRY_PATH/)
})
