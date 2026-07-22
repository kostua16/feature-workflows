// Phase 1 CONTRACT-01: Root-last migration fault-injection tests.
// Tests: migrateLegacyState, deriveFeatureId, validateMigrationBoundary.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  LIFECYCLE_STATES,
  deriveFeatureId,
  migrateLegacyState,
  validateMigrationBoundary,
} = engine

// ---- deriveFeatureId ----

test('deriveFeatureId: deterministic from slice name', () => {
  const slice = { id: 'auth', name: 'Authentication Module', files: ['src/auth.mjs'], entryPoints: ['login'] }
  const id1 = deriveFeatureId(slice)
  const id2 = deriveFeatureId(slice)
  assert.equal(id1, id2, 'same input must produce same ID')
})

test('deriveFeatureId: different slices produce different IDs', () => {
  const slice1 = { id: 'a', name: 'Auth Module', files: ['auth.mjs'] }
  const slice2 = { id: 'b', name: 'Payment Module', files: ['pay.mjs'] }
  assert.notEqual(deriveFeatureId(slice1), deriveFeatureId(slice2))
})

test('deriveFeatureId: handles null/undefined gracefully', () => {
  assert.ok(deriveFeatureId(null))
  assert.ok(deriveFeatureId(undefined))
  assert.ok(deriveFeatureId({}))
})

// ---- migrateLegacyState ----

test('migrateLegacyState: converts legacy pending slices to deferred', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'pending', planDir: 'slices/a/' },
        { id: 'b', name: 'Feature B', status: 'pending', planDir: 'slices/b/' },
      ],
    },
    engineVersion: '1.4.5',
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.schemaVersion, '1.5.0')
  assert.equal(migrated.features.length, 2)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.equal(migrated.features[1].lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('migrateLegacyState: converts legacy skipped to deferred with rationale', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'skipped', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.ok(migrated.features[0].migrationRationale, 'cap-exceeded slices need migration rationale')
})

test('migrateLegacyState: preserves completed slices as completed', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'completed', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('migrateLegacyState: idempotent — calling twice produces same output', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'pending', planDir: 'slices/a/' },
        { id: 'b', name: 'Feature B', status: 'completed', planDir: 'slices/b/' },
      ],
    },
    engineVersion: '1.4.5',
  }
  const run1 = migrateLegacyState(legacy)
  const run2 = migrateLegacyState(legacy)
  assert.deepEqual(run1, run2, 'migration must be idempotent')
})

test('migrateLegacyState: already migrated state passes through', () => {
  const alreadyMigrated = {
    schemaVersion: '1.5.0',
    features: [{ id: 'x', lifecycle: 'completed', shardRef: 'x.json' }],
    engineVersion: '1.5.0',
  }
  const result = migrateLegacyState(alreadyMigrated)
  assert.equal(result.status, 'migrated')
  assert.equal(result.features.length, 1)
})

test('migrateLegacyState: legacy engine version preserved', () => {
  const legacy = {
    result: { slices: [] },
    engineVersion: '1.4.2',
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.legacyEngineVersion, '1.4.2')
})

test('migrateLegacyState: empty slices array produces empty features', () => {
  const legacy = { result: { slices: [] } }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features.length, 0)
  assert.equal(migrated.schemaVersion, '1.5.0')
})

// ---- validateMigrationBoundary ----

test('validateMigrationBoundary: before-root with unvalidated children fails', () => {
  const state = {
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'a.json' },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json' },
    ],
  }
  const result = validateMigrationBoundary(state, 'before-root')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('not yet durable'))
})

test('validateMigrationBoundary: after-children with all validated succeeds', () => {
  const state = {
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'a.json', _durable: true },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json', _durable: true },
    ],
  }
  const result = validateMigrationBoundary(state, 'after-children')
  assert.equal(result.ok, true)
})

test('validateMigrationBoundary: child-write marks specific child as durable', () => {
  const state = {
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'a.json' },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json' },
    ],
  }
  // Write child 'a' first
  let result = validateMigrationBoundary(state, 'child-write', 'a')
  assert.equal(result.ok, true)
  // Root before 'b' is durable should fail
  result = validateMigrationBoundary(state, 'before-root')
  assert.equal(result.ok, false)
  // Write child 'b'
  result = validateMigrationBoundary(state, 'child-write', 'b')
  assert.equal(result.ok, true)
  // Now root should succeed
  result = validateMigrationBoundary(state, 'after-children')
  assert.equal(result.ok, true)
})

test('validateMigrationBoundary: excluded children do not need durable write', () => {
  const state = {
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.EXCLUDED, shardRef: null },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json', _durable: true },
    ],
  }
  const result = validateMigrationBoundary(state, 'after-children')
  assert.equal(result.ok, true, 'excluded features should not require durable shard')
})

test('validateMigrationBoundary: root never acknowledged before every child is durable', () => {
  // This is the critical fault-injection test: simulate partial migration
  const state = {
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'a.json', _durable: true },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json' }, // NOT durable
      { id: 'c', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'c.json', _durable: true },
    ],
  }
  // Root acknowledgement must fail
  const result = validateMigrationBoundary(state, 'before-root')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('b'), 'reason must identify the undurable child')
})

test('validateMigrationBoundary: mixed-version ready state never observable', () => {
  // After partial migration, deriveReadiness on the partially-migrated state
  // must never show ready=true
  const state = {
    schemaVersion: '1.5.0',
    status: 'migrating',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED, shardRef: 'a.json', _durable: true },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED, shardRef: 'b.json' }, // still migrating
    ],
  }
  const { deriveReadiness } = engine
  const r = deriveReadiness(state)
  assert.equal(r.ready, false, 'partially migrated state must not be ready')
})
