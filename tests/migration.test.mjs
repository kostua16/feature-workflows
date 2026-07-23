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
  migrateResumeState,
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

// ---- migrateResumeState (INT-MIGRATION-RESUME: explicit --migrate flag) ----

test('migrateResumeState: v1.4.5 state with result.slices migrates to v1.5.0', () => {
  const legacyState = {
    task: 'extract whole-project design',
    slug: 'extract-whole-project',
    planPath: 'docs/project/extract/plan.md',
    planDir: 'docs/project/extract/',
    engineVersion: '1.4.5',
    config: { mode: 'extract' },
    result: {
      mode: 'extract',
      slices: [
        { name: 'Feature A', planDir: 'docs/project/extract/feat-a/', status: 'pending', files: ['src/a.mjs'] },
        { name: 'Feature B', planDir: 'docs/project/extract/feat-b/', status: 'completed', files: ['src/b.mjs'] },
      ],
    },
  }
  const migrated = migrateResumeState(legacyState)
  assert.equal(migrated.schemaVersion, '1.5.0')
  assert.ok(migrated.result.projectManifest, 'migrated state must carry the project manifest')
  assert.equal(migrated.result.projectManifest.schemaVersion, '1.5.0')
  assert.equal(migrated.result.projectManifest.features.length, 2)
  // Core pipeline-state fields preserved
  assert.equal(migrated.task, legacyState.task)
  assert.equal(migrated.slug, legacyState.slug)
  assert.equal(migrated.planPath, legacyState.planPath)
  assert.equal(migrated.planDir, legacyState.planDir)
  assert.deepEqual(migrated.config, legacyState.config)
})

test('migrateResumeState: migrated state passes validatePipelineState', () => {
  const { validatePipelineState } = engine
  const legacyState = {
    task: 'add retry layer',
    slug: 'add-retry-layer',
    planPath: 'docs/parser/feature/add-retry-layer/plan.md',
    planDir: 'docs/parser/feature/add-retry-layer/',
    engineVersion: '1.4.5',
    config: { mode: 'design' },
    result: {
      mode: 'design',
      slices: [
        { name: 'Auth', planDir: 'docs/extract/auth/', status: 'pending', files: ['auth.mjs'] },
      ],
    },
  }
  const migrated = migrateResumeState(legacyState)
  const validation = validatePipelineState(migrated)
  assert.ok(validation.ok, `migrated state should validate: ${validation.errors?.join(', ')}`)
})

test('migrateResumeState: v1.5.0 state passes through unchanged', () => {
  const v15State = {
    schemaVersion: '1.5.0',
    task: 'already migrated',
    slug: 'already-migrated',
    planPath: 'docs/x/plan.md',
    planDir: 'docs/x/',
    result: { mode: 'design' },
  }
  const result = migrateResumeState(v15State)
  assert.equal(result, v15State, 'already-v1.5.0 state must return as the same object')
})

test('migrateResumeState: state without slices passes through unchanged', () => {
  const noSlicesState = {
    task: 'no slices here',
    slug: 'no-slices',
    planPath: 'docs/y/plan.md',
    planDir: 'docs/y/',
    engineVersion: '1.4.5',
    result: { mode: 'design', definitionPath: 'docs/y/idea.md' },
  }
  const result = migrateResumeState(noSlicesState)
  assert.equal(result, noSlicesState, 'state without slices must return as-is')
  assert.equal(result.schemaVersion, undefined, 'must not inject schemaVersion')
})

test('migrateResumeState: strips stale checksum after mutation', () => {
  const legacyState = {
    task: 'has checksum',
    slug: 'has-checksum',
    planPath: 'docs/z/plan.md',
    planDir: 'docs/z/',
    engineVersion: '1.4.5',
    checksum: 'stale-checksum-value',
    result: {
      mode: 'extract',
      slices: [
        { name: 'X', planDir: 'docs/z/x/', status: 'pending', files: ['x.mjs'] },
      ],
    },
  }
  const migrated = migrateResumeState(legacyState)
  assert.equal(migrated.checksum, undefined, 'stale checksum must be stripped after migration')
})

test('migrateResumeState: null/undefined/non-object passes through', () => {
  assert.equal(migrateResumeState(null), null)
  assert.equal(migrateResumeState(undefined), undefined)
  assert.equal(migrateResumeState('string'), 'string')
})

test('migrateResumeState: idempotent — double migration produces same result', () => {
  const legacyState = {
    task: 'idempotent test',
    slug: 'idempotent',
    planPath: 'docs/i/plan.md',
    planDir: 'docs/i/',
    engineVersion: '1.4.5',
    result: {
      mode: 'extract',
      slices: [
        { name: 'A', planDir: 'docs/i/a/', status: 'pending', files: ['a.mjs'] },
        { name: 'B', planDir: 'docs/i/b/', status: 'completed', files: ['b.mjs'] },
      ],
    },
  }
  const once = migrateResumeState(legacyState)
  const twice = migrateResumeState(once)
  assert.equal(twice, once, 'second migration of already-v1.5.0 state must be a no-op (same object)')
})
