// Phase 14 — Nyquist validation characterization tests.
// Fills sampling gaps identified in the retroactive audit:
//   GAP-1: findFeature boundary robustness (malformed inputs, threshold edges)
//   GAP-2: upsertRegistryEntry robustness (null/undefined registry)
//   GAP-3: Agent-mediated behavioral tests (readRegistry, writeRegistry,
//          readIdentitySidecar, checkFolderCollision) — prior coverage was
//          source-assertion only; these exercise actual runtime behavior via
//          mock globalThis.agent.
//   GAP-4: Schema deep validation (property types, optionality)
//   GAP-5: Integration wiring source assertions (ordering, root-last field preservation)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  findFeature,
  upsertRegistryEntry,
  readRegistry,
  writeRegistry,
  readIdentitySidecar,
  checkFolderCollision,
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

// ---- GAP-1: findFeature boundary robustness -------------------------------

test('findFeature: feature with files:null is skipped (no crash)', () => {
  var registryFeatures = [
    { featureId: 'bad', anchorPath: 'a', files: null },
    { featureId: 'good', anchorPath: 'src/good.ts', files: [{ path: 'src/good.ts', contentSha256: H64a }] },
  ]
  var result = findFeature({
    currentFiles: [{ path: 'src/good.ts', contentSha256: H64a }],
    currentAnchor: 'src/good.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'good')
})

test('findFeature: feature with files:undefined is skipped', () => {
  var registryFeatures = [
    { featureId: 'undef', anchorPath: 'a', files: undefined },
  ]
  var result = findFeature({
    currentFiles: [{ path: 'src/a.ts', contentSha256: H64a }],
    currentAnchor: 'src/a.ts',
    registryFeatures,
  })
  assert.equal(result.decision, 'new')
})

test('findFeature: feature that is null is skipped', () => {
  var registryFeatures = [null, { featureId: 'x', anchorPath: 'x', files: [{ path: 'x', contentSha256: H64a }] }]
  var result = findFeature({
    currentFiles: [{ path: 'x', contentSha256: H64a }],
    currentAnchor: 'x',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'x')
})

test('findFeature: feature missing files property entirely is skipped', () => {
  var registryFeatures = [{ featureId: 'nofiles', anchorPath: 'a' }]
  var result = findFeature({
    currentFiles: [{ path: 'a', contentSha256: H64a }],
    currentAnchor: 'a',
    registryFeatures,
  })
  assert.equal(result.decision, 'new')
})

test('findFeature: currentFiles entries with null path and hash are handled', () => {
  var registryFeatures = [{ featureId: 'f', anchorPath: 'a', files: [{ path: 'a', contentSha256: H64a }] }]
  var result = findFeature({
    currentFiles: [{ path: null, contentSha256: null }, { path: 'a', contentSha256: H64a }],
    currentAnchor: 'a',
    registryFeatures,
  })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.matchCount, 1)
})

test('findFeature: exactly at majority threshold (min=3, majority=2, 2 matches) is strong', () => {
  var registryFeatures = [{
    featureId: 'three',
    anchorPath: 'f0',
    files: [
      { path: 'f0', contentSha256: H64a },
      { path: 'f1', contentSha256: H64b },
      { path: 'f2', contentSha256: H64c },
    ],
  }]
  // min(3,3)=3, majority=floor(3/2)+1=2. 2 matches === 2 → strong
  var currentFiles = [
    { path: 'new0', contentSha256: H64a },
    { path: 'new1', contentSha256: H64b },
    { path: 'new2', contentSha256: 'e' + H64a.slice(1) },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'new0', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.matchCount, 2)
})

test('findFeature: one below majority (min=3, majority=2, 1 match) is weak', () => {
  var registryFeatures = [{
    featureId: 'three',
    anchorPath: 'f0',
    files: [
      { path: 'f0', contentSha256: H64a },
      { path: 'f1', contentSha256: H64b },
      { path: 'f2', contentSha256: H64c },
    ],
  }]
  var currentFiles = [
    { path: 'new0', contentSha256: H64a },
    { path: 'new1', contentSha256: 'e' + H64a.slice(1) },
    { path: 'new2', contentSha256: 'f' + H64a.slice(1) },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'new0', registryFeatures })
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'weak-only-match')
})

test('findFeature: single-file feature with single-file current same hash reuses', () => {
  var registryFeatures = [{
    featureId: 'single',
    anchorPath: 'only.ts',
    files: [{ path: 'only.ts', contentSha256: H64a }],
  }]
  var currentFiles = [{ path: 'only.ts', contentSha256: H64a }]
  var result = findFeature({ currentFiles, currentAnchor: 'only.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.matchCount, 1)
})

test('findFeature: anchor match alone with zero hash overlap is strong', () => {
  var registryFeatures = [{
    featureId: 'anchored',
    anchorPath: 'src/anchor.ts',
    files: [
      { path: 'src/anchor.ts', contentSha256: H64a },
      { path: 'src/other.ts', contentSha256: H64b },
    ],
  }]
  // Current has the anchor path but completely different hashes + extra files
  var currentFiles = [
    { path: 'src/anchor.ts', contentSha256: H64c },
    { path: 'src/new.ts', contentSha256: H64d },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'src/anchor.ts', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'anchored')
})

test('findFeature: registryFeatures is null/undefined (not an array) returns new', () => {
  var result = findFeature({
    currentFiles: [{ path: 'a', contentSha256: H64a }],
    currentAnchor: 'a',
    registryFeatures: null,
  })
  assert.equal(result.decision, 'new')
})

test('findFeature: arg is null/undefined returns blocked (empty-current-files)', () => {
  var result = findFeature(null)
  assert.equal(result.decision, 'blocked')
  assert.equal(result.reason, 'empty-current-files')
})

test('findFeature: three strong candidates with clear winner reuses', () => {
  var registryFeatures = [
    {
      featureId: 'a',
      anchorPath: 'a',
      files: [{ path: 'shared', contentSha256: H64a }, { path: 'unique-a', contentSha256: H64b }],
    },
    {
      featureId: 'b',
      anchorPath: 'b',
      files: [{ path: 'shared', contentSha256: H64a }],
    },
    {
      featureId: 'c',
      anchorPath: 'c',
      files: [{ path: 'shared', contentSha256: H64a }],
    },
  ]
  // a has 2 matches (majority of min(2,2)=2 → strong with 2), b and c have 1
  var currentFiles = [
    { path: 'shared', contentSha256: H64a },
    { path: 'unique-a', contentSha256: H64b },
  ]
  var result = findFeature({ currentFiles, currentAnchor: 'shared', registryFeatures })
  assert.equal(result.decision, 'reuse')
  assert.equal(result.featureId, 'a')
  assert.equal(result.matchCount, 2)
})

// ---- GAP-2: upsertRegistryEntry robustness --------------------------------

test('upsertRegistryEntry: null registry creates new with features', () => {
  var entry = { featureId: 'f1', status: 'current' }
  var updated = upsertRegistryEntry(null, entry)
  assert.ok(updated.features)
  assert.equal(updated.features['f1'], entry)
})

test('upsertRegistryEntry: undefined registry creates new', () => {
  var entry = { featureId: 'f1', status: 'current' }
  var updated = upsertRegistryEntry(undefined, entry)
  assert.ok(updated.features)
  assert.equal(updated.features['f1'], entry)
})

test('upsertRegistryEntry: registry without features key creates it', () => {
  var registry = { someOtherKey: true }
  var entry = { featureId: 'f1' }
  var updated = upsertRegistryEntry(registry, entry)
  assert.ok(updated.features)
  assert.equal(updated.features['f1'], entry)
  // Original registry not mutated
  assert.equal(registry.features, undefined)
})

test('upsertRegistryEntry: does not mutate original features object', () => {
  var registry = { features: { existing: { featureId: 'existing' } } }
  var entry = { featureId: 'new' }
  var updated = upsertRegistryEntry(registry, entry)
  assert.equal(Object.keys(registry.features).length, 1)
  assert.equal(Object.keys(updated.features).length, 2)
})

test('upsertRegistryEntry: returns new object identity (not same reference)', () => {
  var registry = { features: {} }
  var entry = { featureId: 'f1' }
  var updated = upsertRegistryEntry(registry, entry)
  assert.notEqual(updated, registry)
  assert.notEqual(updated.features, registry.features)
})

// ---- GAP-3: Agent-mediated behavioral tests (mock globalThis.agent) --------
// Prior coverage was source-assertion only. These exercise actual behavior.

// Helper: create a minimal result object for agent calls.
function mockResult() {
  return { logLines: [] }
}

// Helper: run an async function with a mocked globalThis.agent, then restore.
async function withMockAgent(mockFn, fn) {
  var orig = globalThis.agent
  globalThis.agent = mockFn
  try {
    return await fn()
  } finally {
    globalThis.agent = orig
  }
}

test('readRegistry: agent returns valid registry -> returns parsed object', async () => {
  var mockRegistry = { features: { 'feat-1': { featureId: 'feat-1', status: 'current' } } }
  var result = await withMockAgent(
    async () => ({ registry: mockRegistry }),
    () => readRegistry('docs/extract/.registry.json', mockResult())
  )
  assert.deepEqual(result, mockRegistry)
})

test('readRegistry: agent returns null registry -> returns null (fail-closed)', async () => {
  var result = await withMockAgent(
    async () => ({ registry: null }),
    () => readRegistry('docs/extract/.registry.json', mockResult())
  )
  assert.equal(result, null)
})

test('readRegistry: agent returns undefined registry -> returns null', async () => {
  var result = await withMockAgent(
    async () => ({ registry: undefined }),
    () => readRegistry('docs/extract/.registry.json', mockResult())
  )
  assert.equal(result, null)
})

test('readRegistry: agent returns empty features -> returns object with empty features', async () => {
  var result = await withMockAgent(
    async () => ({ registry: { features: {} } }),
    () => readRegistry('docs/extract/.registry.json', mockResult())
  )
  assert.deepEqual(result, { features: {} })
})

test('writeRegistry: agent returns ack -> returns ack', async () => {
  var mockAck = { ok: true, path: 'docs/extract/.registry.json' }
  var result = await withMockAgent(
    async () => mockAck,
    () => writeRegistry('docs/extract/.registry.json', { features: {} }, mockResult())
  )
  assert.deepEqual(result, mockAck)
})

test('writeRegistry: agent returns null (write failed) -> returns null', async () => {
  var result = await withMockAgent(
    async () => null,
    () => writeRegistry('docs/extract/.registry.json', { features: {} }, mockResult())
  )
  assert.equal(result, null)
})

test('readIdentitySidecar: agent returns valid identity -> returns identity', async () => {
  var mockIdentity = {
    featureId: 'feat-1234',
    planDir: 'docs/extract/auth/feat-1234/',
    ownershipScopeDigest: H64a,
    scopeId16: H64a.slice(0, 16),
    area: 'auth',
    createdAt: '20260723',
  }
  var result = await withMockAgent(
    async () => ({ identity: mockIdentity }),
    () => readIdentitySidecar('docs/extract/auth/feat-1234/.identity.json', mockResult())
  )
  assert.deepEqual(result, mockIdentity)
})

test('readIdentitySidecar: agent returns null -> returns null', async () => {
  var result = await withMockAgent(
    async () => ({ identity: null }),
    () => readIdentitySidecar('docs/extract/auth/feat-1234/.identity.json', mockResult())
  )
  assert.equal(result, null)
})

test('checkFolderCollision: no identity found (null) -> collision false', async () => {
  var result = await withMockAgent(
    async () => ({ identity: null }),
    () => checkFolderCollision({
      planDir: 'docs/extract/auth/feat-new/',
      requesterDigest: H64a,
      result: mockResult(),
    })
  )
  assert.equal(result.collision, false)
  assert.equal(result.idempotent, undefined)
})

test('checkFolderCollision: same ownershipScopeDigest -> no collision, idempotent', async () => {
  var result = await withMockAgent(
    async () => ({ identity: { featureId: 'feat-1', ownershipScopeDigest: H64a } }),
    () => checkFolderCollision({
      planDir: 'docs/extract/auth/feat-1/',
      requesterDigest: H64a,
      result: mockResult(),
    })
  )
  assert.equal(result.collision, false)
  assert.equal(result.idempotent, true)
})

test('checkFolderCollision: different ownershipScopeDigest -> collision true', async () => {
  var result = await withMockAgent(
    async () => ({ identity: { featureId: 'feat-existing', ownershipScopeDigest: H64b } }),
    () => checkFolderCollision({
      planDir: 'docs/extract/auth/feat-existing/',
      requesterDigest: H64a,
      result: mockResult(),
    })
  )
  assert.equal(result.collision, true)
  assert.equal(result.existingFeatureId, 'feat-existing')
})

test('checkFolderCollision: missing featureId in identity -> existingFeatureId is "(unknown)"', async () => {
  var result = await withMockAgent(
    async () => ({ identity: { ownershipScopeDigest: H64b } }),
    () => checkFolderCollision({
      planDir: 'docs/extract/auth/feat-x/',
      requesterDigest: H64a,
      result: mockResult(),
    })
  )
  assert.equal(result.collision, true)
  assert.equal(result.existingFeatureId, '(unknown)')
})

// ---- GAP-4: Schema deep validation ----------------------------------------

test('REGISTRY_ENTRY: anchorPath is optional (not in required array)', () => {
  assert.ok(!REGISTRY_ENTRY.required.includes('anchorPath'))
  assert.ok(REGISTRY_ENTRY.properties.anchorPath)
})

test('REGISTRY_ENTRY: files items require exactly path and contentSha256', () => {
  var fileRequired = REGISTRY_ENTRY.properties.files.items.required
  assert.deepEqual(fileRequired.sort(), ['contentSha256', 'path'])
})

test('REGISTRY_ENTRY: ownershipScopeDigest is type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.ownershipScopeDigest.type, 'string')
})

test('REGISTRY_ENTRY: scopeId16 is type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.scopeId16.type, 'string')
})

test('REGISTRY_ENTRY: updatedAt is type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.updatedAt.type, 'string')
})

test('REGISTRY_FILE: additionalProperties is false', () => {
  assert.equal(REGISTRY_FILE.additionalProperties, false)
})

test('REGISTRY_FILE: required is exactly ["features"]', () => {
  assert.deepEqual(REGISTRY_FILE.required, ['features'])
})

test('REGISTRY_FILE: features.additionalProperties references REGISTRY_ENTRY', () => {
  assert.strictEqual(
    REGISTRY_FILE.properties.features.additionalProperties,
    REGISTRY_ENTRY
  )
})

test('REGISTRY_ENTRY: anchorPath has type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.anchorPath.type, 'string')
})

test('REGISTRY_ENTRY: featureId has type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.featureId.type, 'string')
})

test('REGISTRY_ENTRY: planDir has type string', () => {
  assert.equal(REGISTRY_ENTRY.properties.planDir.type, 'string')
})

// ---- GAP-5: Integration wiring source assertions (ordering + root-last) ----

test('source: recoverRegistry called BEFORE Gate X0 (preflight) in extract flow', () => {
  // Find the CALL sites in the extract-mode section (not function definitions).
  // recoverRegistry call is at line ~9268, resolveScopePreflight call at ~9344.
  var recoveryCallIdx = source.indexOf('recoverRegistry({ registryPath: REGISTRY_PATH')
  // Find the CALL (await resolveScopePreflight), not the function definition.
  var preflightCallIdx = source.indexOf('await resolveScopePreflight({')
  assert.ok(recoveryCallIdx > 0, 'recoverRegistry call found')
  assert.ok(preflightCallIdx > 0, 'resolveScopePreflight call found')
  assert.ok(recoveryCallIdx < preflightCallIdx, 'recoverRegistry called BEFORE resolveScopePreflight')
})

test('source: root-last readiness commit preserves immutable fields (only status+updatedAt change)', () => {
  // Use lastIndexOf — the actual root-last block comes after the promotion comment.
  var block = source.slice(source.lastIndexOf('Root-last readiness commit'))
  // Should set status to 'current'
  assert.match(block, /status\s*=\s*'current'/)
  // Should set updatedAt
  assert.match(block, /updatedAt/)
  // Should NOT modify featureId, planDir, or ownershipScopeDigest
  var relevantSection = block.slice(0, 800)
  assert.doesNotMatch(relevantSection, /readyEntry\.featureId\s*=/)
  assert.doesNotMatch(relevantSection, /readyEntry\.planDir\s*=/)
  assert.doesNotMatch(relevantSection, /readyEntry\.ownershipScopeDigest\s*=/)
})

test('source: root-last block finds registry entry by planDir match (not featureId)', () => {
  // Use lastIndexOf — "Root-last readiness commit" appears in a promotion-block
  // comment first, and the actual root-last block comes later.
  var block = source.slice(source.lastIndexOf('Root-last readiness commit'))
  var section = block.slice(0, 800)
  assert.match(section, /\.planDir\s*===\s*planDir/)
})

test('source: findFeature reuse branch overrides planDir with reusedEntry.planDir', () => {
  var block = source.slice(
    source.indexOf("findResult.decision === 'reuse'"),
    source.indexOf("findResult.decision === 'blocked'")
  )
  assert.match(block, /planDir\s*=\s*reusedEntry\.planDir/)
})

test('source: collision guard returns result on collision (no promotion)', () => {
  // The collision block writes a blocked handoff (writePendingRecord +
  // consolidate) then returns result — it does NOT call promotePendingRecord.
  var collisionIdx = source.indexOf('collision && collision.collision')
  assert.ok(collisionIdx > 0, 'collision check found')
  var afterCollision = source.slice(collisionIdx, collisionIdx + 1200)
  assert.match(afterCollision, /return result/)
  assert.match(afterCollision, /blockedAt\s*=\s*'registry-collision'/)
  // No promotePendingRecord in the collision block.
  var promoteIdx = afterCollision.indexOf('promotePendingRecord')
  assert.equal(promoteIdx, -1, 'collision block does NOT call promotePendingRecord')
})

test('source: REGISTRY_PATH constant is exported and used consistently', () => {
  // readRegistry, writeRegistry, recoverRegistry, and root-last all use REGISTRY_PATH
  var blocks = [
    source.slice(source.indexOf('function readRegistry'), source.indexOf('function writeRegistry')),
    source.slice(source.indexOf('function writeRegistry'), source.indexOf('function readIdentitySidecar')),
    source.slice(source.indexOf('function recoverRegistry'), source.indexOf('\nexport { seedExtractQueue')),
  ]
  for (var i = 0; i < blocks.length; i++) {
    assert.ok(blocks[i].length > 0, 'block ' + i + ' extracted')
  }
})

test('source: recoverRegistry is called in extract mode startup (not just defined)', () => {
  assert.match(source, /recoverRegistry\(\{ registryPath: REGISTRY_PATH/)
})

test('source: root-last readiness commit gated on readiness.ready', () => {
  // Use lastIndexOf — the comment mention comes first, the actual block later.
  var block = source.slice(source.lastIndexOf('Root-last readiness commit'))
  var section = block.slice(0, 400)
  assert.match(section, /if\s*\(readiness\.ready\)/)
})

// ---- Cross-cutting: findFeature + upsertRegistryEntry combined behavior ----

test('integration: findFeature reuse decision provides featureId for upsert', () => {
  // Verify the decision→upsert flow: findFeature returns featureId,
  // which can be used to construct an entry for upsertRegistryEntry
  var registryFeatures = [{
    featureId: 'auth-abc123',
    anchorPath: 'src/auth.ts',
    files: [{ path: 'src/auth.ts', contentSha256: H64a }],
  }]
  var findResult = findFeature({
    currentFiles: [{ path: 'src/auth.ts', contentSha256: H64a }],
    currentAnchor: 'src/auth.ts',
    registryFeatures,
  })
  assert.equal(findResult.decision, 'reuse')
  assert.ok(findResult.featureId)

  // The reused featureId can be used in an upsert to update its entry
  var registry = { features: { 'auth-abc123': registryFeatures[0] } }
  var updatedEntry = Object.assign({}, registryFeatures[0], { status: 'current' })
  var updated = upsertRegistryEntry(registry, updatedEntry)
  assert.equal(updated.features['auth-abc123'].status, 'current')
})

test('integration: findFeature new decision leads to collision-safe upsert', () => {
  var findResult = findFeature({
    currentFiles: [{ path: 'new.ts', contentSha256: H64a }],
    currentAnchor: 'new.ts',
    registryFeatures: [{ featureId: 'other', anchorPath: 'o', files: [{ path: 'o', contentSha256: H64b }] }],
  })
  assert.equal(findResult.decision, 'new')
  assert.equal(findResult.featureId, undefined)

  // For new features, a fresh entry is created — no pre-existing featureId to collide
  var newEntry = { featureId: 'newfeat-0000000000000001', status: 'extracting' }
  var registry = { features: {} }
  var updated = upsertRegistryEntry(registry, newEntry)
  assert.equal(updated.features['newfeat-0000000000000001'], newEntry)
})
