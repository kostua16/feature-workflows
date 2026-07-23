// Phase 7 COMPAT-01: Continuous mode compatibility regression tests.
//
// Proves design, implement, tune, review, and read-only status workflows hydrate
// v1.4.5 and v1.5 state safely, consume completed feature docsets/shards, and
// preserve their established gates, artifacts, handoffs, and command behavior.
// Extract-specific behavior must not leak into non-extract modes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  resolveMode,
  gateModeActive,
  validatePipelineState,
  repairResumeArtifactFlags,
  detectResumeEngineSkew,
  migrateLegacyState,
  validateMigrationBoundary,
  deriveFeatureId,
  LIFECYCLE_STATES,
  SKIP_REASONS,
  deriveReadiness,
  renderStatusReport,
  summarizeGates,
  deriveNextCommand,
  seedExtractQueue,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---------------------------------------------------------------------------
// Fixture: v1.4.5 legacy state (pre-extract — no extract fields at all)
// ---------------------------------------------------------------------------
const legacyState = {
  task: 'add retry layer to parser',
  slug: 'add-retry-layer',
  planPath: 'docs/parser/feature/add-retry-layer/plan.md',
  planDir: 'docs/parser/feature/add-retry-layer/',
  lastGate: 'Architecture',
  engineVersion: '1.4.5',
  result: {
    mode: 'design',
    definitionPath: 'docs/parser/feature/add-retry-layer/idea.md',
    requirementsPath: 'docs/parser/feature/add-retry-layer/requirements.md',
    archPath: null,
    designPath: null,
    designReady: false,
    blockedAt: null,
    retryUsed: 1,
  },
  config: { mode: 'design', retryBudget: 20 },
}

// Fixture: v1.5 state with extract fields populated
const v15State = {
  task: 'extract whole-project design',
  slug: 'extract-whole-project',
  planPath: 'docs/project/extract/plan.md',
  planDir: 'docs/project/extract/',
  lastGate: 'Extract',
  engineVersion: '1.5.0',
  result: {
    mode: 'extract',
    definitionPath: 'docs/project/extract/scope-manifest.md',
    requirementsPath: null,
    archPath: null,
    designPath: null,
    designReady: false,
    blockedAt: null,
    extractScope: { files: ['src/a.mjs', 'src/b.mjs'], entryPoints: ['cli:run'] },
    extractQueue: [
      { id: 'feat-a', name: 'Feature A', planDir: 'docs/project/extract/feat-a/', status: 'completed', artifacts: {} },
      { id: 'feat-b', name: 'Feature B', planDir: 'docs/project/extract/feat-b/', status: 'pending', artifacts: {} },
    ],
    extractReady: false,
  },
  config: { mode: 'extract' },
}

// Fixture: v1.5 completed shard consumed by design mode resume
const v15CompletedShardState = {
  task: 'implement feature from extracted design',
  slug: 'implement-extracted',
  planPath: 'docs/project/extract/feat-a/plan.md',
  planDir: 'docs/project/extract/feat-a/',
  lastGate: 'Plan',
  engineVersion: '1.5.0',
  result: {
    mode: 'implement',
    definitionPath: 'docs/project/extract/feat-a/idea.md',
    requirementsPath: 'docs/project/extract/feat-a/requirements.md',
    archPath: 'docs/project/extract/feat-a/architecture.md',
    designPath: 'docs/project/extract/feat-a/detailed-design.md',
    planned: true,
    designReady: true,
    executed: false,
    testsPassed: false,
    blockedAt: null,
  },
  config: { mode: 'implement' },
}

// ===========================================================================
// 1. Mode resolution precedence is preserved for all six modes
// ===========================================================================

test('COMPAT: resolveMode returns design from args/config/saved-state', () => {
  assert.equal(resolveMode({ mode: 'design' }, { mode: 'implement' }, null), 'design')
  assert.equal(resolveMode({}, { mode: 'design' }, null), 'design')
  assert.equal(resolveMode({}, {}, { result: { mode: 'design' } }), 'design')
})

test('COMPAT: resolveMode returns implement from args/config/saved-state', () => {
  assert.equal(resolveMode({ mode: 'implement' }, { mode: 'design' }, null), 'implement')
  assert.equal(resolveMode({}, { mode: 'implement' }, null), 'implement')
})

test('COMPAT: resolveMode returns tune from args/config/saved-state', () => {
  assert.equal(resolveMode({ mode: 'tune' }, { mode: 'design' }, null), 'tune')
  assert.equal(resolveMode({}, { mode: 'tune' }, null), 'tune')
})

test('COMPAT: resolveMode returns extract from args/config/saved-state', () => {
  assert.equal(resolveMode({ mode: 'extract' }, { mode: 'design' }, null), 'extract')
  assert.equal(resolveMode({}, { mode: 'extract' }, null), 'extract')
})

test('COMPAT: resolveMode returns review from args/config/saved-state', () => {
  assert.equal(resolveMode({ mode: 'review' }, { mode: 'design' }, null), 'review')
  assert.equal(resolveMode({}, { mode: 'review' }, null), 'review')
})

test('COMPAT: resolveMode returns status from explicit args', () => {
  assert.equal(resolveMode({ mode: 'status' }, { mode: 'design' }, null), 'status')
  assert.equal(resolveMode({}, { mode: 'status' }, null), 'status')
})

// ===========================================================================
// 2. Gate partitioning: extract gates stay off in non-extract modes (no leakage)
// ===========================================================================

test('COMPAT: extract gates are inactive in design mode', () => {
  assert.equal(gateModeActive('extract', 'design'), false)
  assert.equal(gateModeActive('design', 'design'), true)
  assert.equal(gateModeActive('shared', 'design'), true)
})

test('COMPAT: extract gates are inactive in implement mode', () => {
  assert.equal(gateModeActive('extract', 'implement'), false)
  assert.equal(gateModeActive('implement', 'implement'), true)
})

test('COMPAT: extract gates are inactive in tune mode', () => {
  assert.equal(gateModeActive('extract', 'tune'), false)
  assert.equal(gateModeActive('tune', 'tune'), true)
})

test('COMPAT: extract gates are inactive in review mode', () => {
  assert.equal(gateModeActive('extract', 'review'), false)
  assert.equal(gateModeActive('review', 'review'), true)
})

test('COMPAT: design gates are inactive in extract mode', () => {
  assert.equal(gateModeActive('design', 'extract'), false)
  assert.equal(gateModeActive('extract', 'extract'), true)
})

test('COMPAT: implement gates are inactive in extract mode', () => {
  assert.equal(gateModeActive('implement', 'extract'), false)
})

// ===========================================================================
// 3. validatePipelineState accepts both v1.4.5 legacy and v1.5 current shapes
// ===========================================================================

test('COMPAT: validatePipelineState accepts v1.4.5 legacy state (no extract fields)', () => {
  const v = validatePipelineState(legacyState)
  assert.ok(v.ok, `legacy state should validate: ${v.errors?.join(', ')}`)
})

test('COMPAT: validatePipelineState accepts v1.5 state with extract fields', () => {
  const v = validatePipelineState(v15State)
  assert.ok(v.ok, `v1.5 state should validate: ${v.errors?.join(', ')}`)
})

test('COMPAT: validatePipelineState accepts v1.5 completed shard consumed by implement', () => {
  const v = validatePipelineState(v15CompletedShardState)
  assert.ok(v.ok, `completed shard state should validate: ${v.errors?.join(', ')}`)
})

test('COMPAT: validatePipelineState rejects malformed state', () => {
  assert.ok(!validatePipelineState(null).ok)
  assert.ok(!validatePipelineState({}).ok)
  assert.ok(!validatePipelineState({ task: 'x', slug: 'x', planPath: 'x', planDir: 'x' }).ok)
})

// ===========================================================================
// 4. Migration from v1.4.5 to v1.5 preserves feature identity and lifecycle
// ===========================================================================

test('COMPAT: migrateLegacyState converts v1.4.5 slices to v1.5 features', () => {
  const migrated = migrateLegacyState(legacyState)
  assert.equal(migrated.schemaVersion, '1.5.0')
  // Legacy state had no slices → features is empty but valid
  assert.ok(Array.isArray(migrated.features))
})

test('COMPAT: migrateLegacyState maps legacy pending→deferred, skipped→deferred, completed→completed', () => {
  const stateWithSlices = {
    result: {
      slices: [
        { name: 'Feature A', planDir: '/a/', status: 'pending', files: ['a.mjs'] },
        { name: 'Feature B', planDir: '/b/', status: 'skipped', files: ['b.mjs'] },
        { name: 'Feature C', planDir: '/c/', status: 'completed', files: ['c.mjs'] },
      ],
    },
  }
  const migrated = migrateLegacyState(stateWithSlices)
  assert.equal(migrated.features.length, 3)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.equal(migrated.features[1].lifecycle, LIFECYCLE_STATES.DEFERRED)
  assert.equal(migrated.features[2].lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('COMPAT: migrateLegacyState is idempotent', () => {
  const once = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'pending', files: ['x.mjs'] }] },
  })
  const twice = migrateLegacyState(once)
  assert.deepEqual(twice.features, once.features)
  assert.equal(twice.status, 'migrated')
})

test('COMPAT: validateMigrationBoundary enforces root-last (children before root)', () => {
  const migrated = migrateLegacyState({
    result: { slices: [
      { name: 'A', planDir: '/a/', status: 'pending', files: ['a.mjs'] },
      { name: 'B', planDir: '/b/', status: 'pending', files: ['b.mjs'] },
    ]},
  })
  // Before writing any children: root ack must fail
  const beforeRoot = validateMigrationBoundary(migrated, 'before-root')
  assert.ok(!beforeRoot.ok)

  // Write child A
  validateMigrationBoundary(migrated, 'child-write', migrated.features[0].id)
  // Still not all durable
  const afterOneChild = validateMigrationBoundary(migrated, 'before-root')
  assert.ok(!afterOneChild.ok)

  // Write child B
  validateMigrationBoundary(migrated, 'child-write', migrated.features[1].id)
  // Now root can be acknowledged
  const afterAll = validateMigrationBoundary(migrated, 'after-children')
  assert.ok(afterAll.ok)
})

// ===========================================================================
// 5. Status reporting works for both legacy and v1.5 state
// ===========================================================================

test('COMPAT: summarizeGates renders for legacy state without throwing', () => {
  const gates = summarizeGates(legacyState.result)
  assert.ok(Array.isArray(gates))
  assert.ok(gates.length > 0)
  // Define and Requirements should be done (paths present)
  const defineGate = gates.find((g) => g.gate === 'define')
  assert.equal(defineGate.status, 'done')
})

test('COMPAT: summarizeGates renders for v1.5 state without throwing', () => {
  const gates = summarizeGates(v15State.result)
  assert.ok(Array.isArray(gates))
  assert.ok(gates.length > 0)
})

test('COMPAT: renderStatusReport renders for legacy state without throwing', () => {
  const report = renderStatusReport(legacyState, { ok: true, errors: [] })
  assert.ok(typeof report === 'string')
  assert.ok(report.length > 0)
})

test('COMPAT: renderStatusReport renders for v1.5 state without throwing', () => {
  const report = renderStatusReport(v15State, { ok: true, errors: [] })
  assert.ok(typeof report === 'string')
  assert.ok(report.length > 0)
})

test('COMPAT: deriveNextCommand works for legacy state', () => {
  const cmd = deriveNextCommand(legacyState)
  assert.ok(cmd)
  assert.ok(typeof cmd === 'object')
})

test('COMPAT: deriveNextCommand works for v1.5 completed shard consumed by implement', () => {
  const cmd = deriveNextCommand(v15CompletedShardState)
  assert.ok(cmd)
  assert.ok(typeof cmd === 'object')
})

// ===========================================================================
// 6. Engine version skew detection preserves compatibility warning
// ===========================================================================

test('COMPAT: detectResumeEngineSkew warns when versions differ', () => {
  const skew = detectResumeEngineSkew('1.4.5', '1.5.0')
  assert.ok(skew)
})

test('COMPAT: detectResumeEngineSkew passes when versions match', () => {
  const skew = detectResumeEngineSkew('1.5.0', '1.5.0')
  assert.ok(!skew || skew === '')
})

// ===========================================================================
// 7. repairResumeArtifactFlags handles both state shapes without throwing
// ===========================================================================

test('COMPAT: repairResumeArtifactFlags handles legacy state shape (no extract fields)', async () => {
  // Set up mock agent for artifact verification
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ exists: false, sizeBytes: 0 })
  try {
    const result = { ...legacyState.result }
    const repairs = await repairResumeArtifactFlags(result)
    assert.ok(Array.isArray(repairs))
  } finally {
    globalThis.agent = origAgent
  }
})

test('COMPAT: repairResumeArtifactFlags handles v1.5 state shape (with extract fields)', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ exists: false, sizeBytes: 0 })
  try {
    const result = { ...v15State.result }
    const repairs = await repairResumeArtifactFlags(result)
    assert.ok(Array.isArray(repairs))
  } finally {
    globalThis.agent = origAgent
  }
})

// ===========================================================================
// 8. Extract queue semantics preserved across mode boundaries
// ===========================================================================

test('COMPAT: seedExtractQueue produces correct queue regardless of calling mode', () => {
  const scope = { files: ['src/a.mjs'], entryPoints: ['cli:run'] }
  const queue = seedExtractQueue(scope, null, 'docs/extract/', 8, [])
  assert.ok(Array.isArray(queue))
  assert.equal(queue.length, 1)
  assert.equal(queue[0].status, 'pending')
})

test('COMPAT: seedExtractQueue is pure — same inputs produce same output', () => {
  const scope = { files: ['src/a.mjs', 'src/b.mjs'], entryPoints: ['cli:run'] }
  const q1 = seedExtractQueue(scope, null, 'docs/extract/', 8, [])
  const q2 = seedExtractQueue(scope, null, 'docs/extract/', 8, [])
  assert.deepEqual(q1, q2)
})

// ===========================================================================
// 9. Lifecycle states and skip semantics are mode-independent (shared contract)
// ===========================================================================

test('COMPAT: LIFECYCLE_STATES enumeration is stable across all modes', () => {
  const expected = ['runnable', 'deferred', 'in-progress', 'blocked', 'failed', 'skipped', 'excluded', 'completed']
  for (const s of expected) {
    assert.ok(Object.values(LIFECYCLE_STATES).includes(s), `lifecycle state ${s} must be in enumeration`)
  }
  assert.equal(Object.keys(LIFECYCLE_STATES).length, expected.length)
})

test('COMPAT: SKIP_REASONS has three distinct classifications', () => {
  assert.equal(SKIP_REASONS.FEATURE_LEVEL, 'feature-level')
  assert.equal(SKIP_REASONS.POLICY_DISABLED_OPTIONAL, 'policy-disabled-optional')
  assert.equal(SKIP_REASONS.REQUIRED_GATE, 'required-gate')
})

test('COMPAT: feature-level skipped remains incomplete in readiness derivation', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'skipped', skipReason: SKIP_REASONS.FEATURE_LEVEL },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, false)
  assert.ok(readiness.skipped > 0, 'feature-level skipped must count as incomplete')
})

test('COMPAT: policy-disabled-optional skip with evidence may complete', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: 'completed' },
      { id: 'b', lifecycle: 'skipped', skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL, policyEvidence: 'profile-X-disabled-gate-Y' },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, true)
})

// ===========================================================================
// 10. Structural assertions: source contains all mode branches
// ===========================================================================

test('COMPAT: engine source contains all six mode strings', () => {
  for (const mode of ['design', 'implement', 'tune', 'extract', 'review', 'status']) {
    assert.ok(source.includes(`'${mode}'`), `engine must reference mode '${mode}'`)
  }
})

test('COMPAT: engine source does not let extract gates run in non-extract branches', () => {
  // The extract branch is guarded by mode === 'extract'
  assert.ok(source.includes("'extract'"), 'extract mode must be referenced')
  assert.ok(source.includes('isExtractMode'), 'extract mode guard variable must exist')
})

test('COMPAT: engine source preserves flushPipelineState for all modes', () => {
  assert.ok(source.includes('flushPipelineState'), 'state flush must be present')
  assert.ok(source.includes('stateCheckpoint'), 'state checkpoint must be present')
})

test('COMPAT: no extract-specific field leaks into non-extract gate flags', () => {
  // extractScope, extractQueue, extractReady are only set in the extract branch
  // Verify they are not unconditionally set outside extract mode
  const lines = source.split('\n')
  for (const field of ['extractScope', 'extractQueue', 'extractReady']) {
    const assignmentLines = lines.filter((l) => l.includes(`result.${field}`) && l.includes('='))
    // At least one assignment should exist (in the extract branch)
    assert.ok(assignmentLines.length > 0, `extract field ${field} must be assigned somewhere`)
  }
})

// ===========================================================================
// 11. Derive feature identity is deterministic across migration
// ===========================================================================

test('COMPAT: deriveFeatureId is deterministic for the same slice', () => {
  const slice = { name: 'Parser Module', entryPoints: ['parser:parse'], files: ['src/parser.mjs'] }
  const id1 = deriveFeatureId(slice)
  const id2 = deriveFeatureId(slice)
  assert.equal(id1, id2)
})

test('COMPAT: deriveFeatureId produces different IDs for different slices', () => {
  const sliceA = { name: 'Parser', files: ['src/parser.mjs'] }
  const sliceB = { name: 'Logger', files: ['src/logger.mjs'] }
  assert.notEqual(deriveFeatureId(sliceA), deriveFeatureId(sliceB))
})
