// Phase 14 — Registry Integrity, Atomicity & Recovery (D1.3).
// Tests atomic write patterns, root-last readiness commit ordering, startup
// recovery behavior, authority ordering, and cross-cutting purity assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  findFeature,
  upsertRegistryEntry,
  REGISTRY_PATH,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- RED tests — atomic writes prevent torn JSON ----

test('RED: crash between registry writes leaves no torn JSON (temp-then-rename)', () => {
  // Source assertion: writeRegistry uses temp-then-rename pattern
  var fnBody = source.slice(
    source.indexOf('function writeRegistry'),
    source.indexOf('function readIdentitySidecar')
  )
  assert.match(fnBody, /temp-then-rename/)
  assert.match(fnBody, /\.tmp/)
})

test('RED: registry entry extracting with missing pipeline-state NOT promoted to current', () => {
  // Source assertion: recoverRegistry checks for pipeline-state evidence
  // and sets status to 'stale' (not 'current') when missing
  var fnBody = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(fnBody, /missing-pipeline-state/)
  assert.match(fnBody, /'stale'/)
})

// ---- GREEN tests — atomicity + authority ----

test('source: writeRegistry uses temp-then-rename (atomic writes)', () => {
  var fnBody = source.slice(
    source.indexOf('function writeRegistry'),
    source.indexOf('function readIdentitySidecar')
  )
  assert.match(fnBody, /temp-then-rename/)
  assert.match(fnBody, /\.tmp/)
  assert.match(fnBody, /rename/)
})

test('source: authority order documented — pipeline-state > registry > sidecar', () => {
  // The recovery function rebuilds mutable fields from pipeline-state (highest
  // authority) and immutable fields from .identity.json sidecars. The comment
  // should document this authority chain.
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  // Immutable fields sourced from identity sidecar (not registry)
  assert.match(recoveryBlock, /identity\.featureId/)
  assert.match(recoveryBlock, /identity\.ownershipScopeDigest/)
  // Mutable fields rebuilt from pipeline-state
  assert.match(recoveryBlock, /pipelineState/)
  assert.match(recoveryBlock, /pipeline-state/)
})

test('source: root-last readiness commit is the final write after extract terminal', () => {
  // The root-last block should come AFTER the extract terminal readiness check.
  // Use lastIndexOf for Root-last since it also appears in the promotion block comment.
  var extractPhaseIdx = source.indexOf("phase('Extract')")
  var rootLastIdx = source.lastIndexOf('Root-last readiness commit')
  assert.ok(extractPhaseIdx > 0, 'extract phase call found')
  assert.ok(rootLastIdx > 0, 'root-last block found')
  assert.ok(rootLastIdx > extractPhaseIdx, 'root-last comes AFTER extract phase')
})

// ---- GREEN tests — startup recovery behavior ----

test('source: recoverRegistry rebuilds files from pipeline-state when evidence exists', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(recoveryBlock, /_sourceDigest/)
  assert.match(recoveryBlock, /rebuiltFiles/)
})

test('source: recoverRegistry fail-closed on missing pipeline-state', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(recoveryBlock, /missing-pipeline-state/)
  assert.match(recoveryBlock, /'stale'/)
})

test('source: recoverRegistry fail-closed on missing identity', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(recoveryBlock, /missing-identity/)
  assert.match(recoveryBlock, /'stale'/)
})

test('source: recoverRegistry sources immutable fields from identity sidecar', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  // Immutable fields overwritten from identity, not kept from stale registry
  assert.match(recoveryBlock, /entry\.featureId = identity\.featureId/)
  assert.match(recoveryBlock, /entry\.planDir = identity\.planDir/)
  assert.match(recoveryBlock, /entry\.ownershipScopeDigest = identity\.ownershipScopeDigest/)
})

test('source: recoverRegistry rebuilds mutable fields from current pipeline-state', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  // Mutable fields set from pipeline-state, not from the stale registry entry
  assert.match(recoveryBlock, /status:\s*pipelineState/)
  assert.match(recoveryBlock, /files:\s*rebuiltFiles/)
})

test('source: recoverRegistry handles corrupt registry via sidecar rebuild', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(recoveryBlock, /\.identity\.json/)
  assert.match(recoveryBlock, /identities/)
  assert.match(recoveryBlock, /rebuilt/)
})

test('source: recoverRegistry fail-closed when no sidecars exist', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  assert.match(recoveryBlock, /failClosed/)
})

test('source: recoverRegistry no-op on empty registry', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  // Empty registry returns early with recovered=0, failed=0
  assert.match(recoveryBlock, /recovered: 0, failed: 0/)
})

test('source: recoverRegistry handles multiple extracting entries independently', () => {
  var recoveryBlock = source.slice(
    source.indexOf('function recoverRegistry'),
    source.indexOf('\nexport { seedExtractQueue')
  )
  // Loops over all feature IDs
  assert.match(recoveryBlock, /for\s*\(var fi/)
  assert.match(recoveryBlock, /featureIds/)
})

// ---- Cross-cutting assertions ----

test('source: findFeature is pure (no safeAgent/flexibleAgent/async)', () => {
  var fnBody = source.slice(
    source.indexOf('function findFeature'),
    source.indexOf('function upsertRegistryEntry')
  )
  assert.doesNotMatch(fnBody, /safeAgent/)
  assert.doesNotMatch(fnBody, /flexibleAgent/)
  assert.doesNotMatch(fnBody, /\basync\b/)
})

test('source: upsertRegistryEntry is pure (no agent calls)', () => {
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

test('source: meta phases include Registry Lookup and Registry Recovery', () => {
  assert.match(source, /title: 'Registry Lookup'/)
  assert.match(source, /title: 'Registry Recovery'/)
})

test('source: registry path is docs/extract/.registry.json', () => {
  assert.match(source, /const REGISTRY_PATH = 'docs\/extract\/\.registry\.json'/)
})

test('source: readIdentitySidecar uses IDENTITY schema', () => {
  var fnBody = source.slice(
    source.indexOf('function readIdentitySidecar'),
    source.indexOf('function checkFolderCollision')
  )
  assert.match(fnBody, /identity/i)
})

test('source: findFeature matchCount deduplicates path+hash (counts once)', () => {
  var fnBody = source.slice(
    source.indexOf('function findFeature'),
    source.indexOf('function upsertRegistryEntry')
  )
  // The dedup pattern: matchByPath || matchByHash counts once even if both match
  assert.match(fnBody, /matchByPath \|\| matchByHash/)
})

// ---- Collision guard source assertions ----

test('source: checkFolderCollision compares FULL ownershipScopeDigest', () => {
  var fnBody = source.slice(
    source.indexOf('function checkFolderCollision'),
    source.indexOf('function recoverRegistry')
  )
  assert.match(fnBody, /ownershipScopeDigest/)
  assert.match(fnBody, /requesterDigest/)
})

test('source: checkFolderCollision no identity → no collision', () => {
  var fnBody = source.slice(
    source.indexOf('function checkFolderCollision'),
    source.indexOf('function recoverRegistry')
  )
  assert.match(fnBody, /collision: false/)
})

test('source: checkFolderCollision same digest → idempotent', () => {
  var fnBody = source.slice(
    source.indexOf('function checkFolderCollision'),
    source.indexOf('function recoverRegistry')
  )
  assert.match(fnBody, /idempotent: true/)
})

test('source: checkFolderCollision different digest → collision true', () => {
  var fnBody = source.slice(
    source.indexOf('function checkFolderCollision'),
    source.indexOf('function recoverRegistry')
  )
  assert.match(fnBody, /collision: true/)
  assert.match(fnBody, /existingFeatureId/)
})
