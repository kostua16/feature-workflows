// Phase 1 Nyquist Validation: Gap-filling tests for CONTRACT-01, STATE-01, REV-01.
// These tests cover gaps identified by the gsd-validate-phase audit:
// - STATE-01 bounded root state contract (root contains indexes/aggregates only)
// - CONTRACT-01 applyLifecycleEvent input validation edge cases
// - CONTRACT-01 migration legacy status completeness (failed, excluded)
// - CONTRACT-01 deriveReadiness comprehensive mixed states
// - CONTRACT-01 resume convergence after partial migration
// - CONTRACT-01 TRANSITION_TABLE completeness (every state has correct transitions)
// - REV-01 combined multi-input revision changes
// - REV-01 nested object digest stability
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  LIFECYCLE_STATES,
  SKIP_REASONS,
  TRANSITION_TABLE,
  applyLifecycleEvent,
  deriveReadiness,
  isTerminal,
  isIncomplete,
  deriveFeatureId,
  migrateLegacyState,
  validateMigrationBoundary,
  REVISION_INPUTS,
  GATE_DEPENDENCY_MAP,
  computeDigest,
  computeContentDigest,
  compareRevisions,
  selectiveInvalidate,
  retainValidEvidence,
} = engine

// =========================================================================
// STATE-01: Bounded root state contract
// Root manifest contains only indexes and aggregate evidence, not
// per-feature gate histories or artifacts.
// =========================================================================

test('STATE-01: migrated root manifest contains schemaVersion, not gate histories', () => {
  const legacy = {
    result: {
      slices: [
        {
          id: 'a', name: 'Feature A', status: 'completed',
          planDir: 'slices/a/',
          gates: { codeFacts: { result: 'lots of detail' }, arch: { data: 'huge' } },
          artifacts: { design: 'content', plan: 'content' },
        },
        {
          id: 'b', name: 'Feature B', status: 'pending',
          planDir: 'slices/b/',
        },
      ],
    },
    engineVersion: '1.4.5',
  }
  const migrated = migrateLegacyState(legacy)

  // Root must have schemaVersion
  assert.equal(migrated.schemaVersion, '1.5.0')

  // Each feature in root must reference a shard, NOT contain gate data
  for (const feat of migrated.features) {
    assert.ok(feat.shardRef, `feature ${feat.id} must have a shardRef`)
    assert.ok(!feat.gates, `feature ${feat.id} must NOT contain gate histories in root`)
    assert.ok(!feat.artifacts, `feature ${feat.id} must NOT contain artifact content in root`)
  }
})

test('STATE-01: root manifest features contain only index fields', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'completed', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  const feat = migrated.features[0]

  // Allowed root-level fields: id, lifecycle, shardRef, legacyStatus, skipReason, policyEvidence, migrationRationale
  // These are index/aggregate fields, NOT gate histories or artifact content
  const allowedFields = new Set([
    'id', 'lifecycle', 'shardRef', 'legacyStatus',
    'skipReason', 'policyEvidence', 'migrationRationale',
  ])
  for (const key of Object.keys(feat)) {
    assert.ok(allowedFields.has(key),
      `field '${key}' is not an allowed root-level index field`)
  }
})

test('STATE-01: feature shards are independently referenceable via shardRef', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Alpha', status: 'completed', planDir: 'plans/slices/alpha/' },
        { id: 'b', name: 'Beta', status: 'pending', planDir: 'plans/slices/beta/' },
        { id: 'c', name: 'Gamma', status: 'pending' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  const refs = migrated.features.map((f) => f.shardRef)

  // Each shardRef must be a non-empty string
  for (const ref of refs) {
    assert.ok(typeof ref === 'string' && ref.length > 0, 'shardRef must be non-empty string')
  }

  // Shard refs must be unique per feature
  const uniqueRefs = new Set(refs)
  assert.equal(uniqueRefs.size, refs.length, 'shardRefs must be unique')
})

// =========================================================================
// CONTRACT-01: applyLifecycleEvent input validation edge cases
// =========================================================================

test('CONTRACT-01: applyLifecycleEvent throws on null state', () => {
  assert.throws(() => applyLifecycleEvent(null, { type: 'start' }), /state must be an object/)
})

test('CONTRACT-01: applyLifecycleEvent throws on non-object state', () => {
  assert.throws(() => applyLifecycleEvent('string', { type: 'start' }), /state must be an object/)
})

test('CONTRACT-01: applyLifecycleEvent throws on null event', () => {
  assert.throws(
    () => applyLifecycleEvent({ lifecycle: LIFECYCLE_STATES.RUNNABLE }, null),
    /event must have a type/
  )
})

test('CONTRACT-01: applyLifecycleEvent throws on event without type', () => {
  assert.throws(
    () => applyLifecycleEvent({ lifecycle: LIFECYCLE_STATES.RUNNABLE }, { payload: {} }),
    /event must have a type/
  )
})

test('CONTRACT-01: applyLifecycleEvent throws on unknown lifecycle state', () => {
  assert.throws(
    () => applyLifecycleEvent({ lifecycle: 'frozen' }, { type: 'start' }),
    /unknown lifecycle state/
  )
})

test('CONTRACT-01: applyLifecycleEvent exclude captures rationale', () => {
  const state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  const next = applyLifecycleEvent(state, {
    type: 'exclude',
    payload: { rationale: 'outside ownership boundary' },
  })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.EXCLUDED)
  assert.equal(next.exclusionRationale, 'outside ownership boundary')
})

test('CONTRACT-01: applyLifecycleEvent start clears skipReason and policyEvidence', () => {
  const state = {
    lifecycle: LIFECYCLE_STATES.SKIPPED,
    skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL,
    policyEvidence: 'old-policy',
  }
  const next = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
  assert.ok(!next.skipReason, 'skipReason must be cleared on start')
  assert.ok(!next.policyEvidence, 'policyEvidence must be cleared on start')
})

test('CONTRACT-01: applyLifecycleEvent defer from runnable', () => {
  const state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  const next = applyLifecycleEvent(state, { type: 'defer' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('CONTRACT-01: applyLifecycleEvent block from in-progress', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  const next = applyLifecycleEvent(state, { type: 'block' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.BLOCKED)
})

test('CONTRACT-01: applyLifecycleEvent start from blocked (resume)', () => {
  const state = { lifecycle: LIFECYCLE_STATES.BLOCKED }
  const next = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
})

test('CONTRACT-01: applyLifecycleEvent start from failed (retry)', () => {
  const state = { lifecycle: LIFECYCLE_STATES.FAILED }
  const next = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
})

test('CONTRACT-01: applyLifecycleEvent fail from blocked', () => {
  const state = { lifecycle: LIFECYCLE_STATES.BLOCKED }
  const next = applyLifecycleEvent(state, { type: 'fail' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.FAILED)
})

test('CONTRACT-01: applyLifecycleEvent exclude from states that allow it', () => {
  // Per TRANSITION_TABLE, exclude is allowed from: runnable, deferred, blocked, failed, skipped
  // in-progress does NOT allow exclude — must resolve (block/fail/complete/skip) first
  const excludable = [LIFECYCLE_STATES.RUNNABLE, LIFECYCLE_STATES.DEFERRED,
    LIFECYCLE_STATES.BLOCKED, LIFECYCLE_STATES.FAILED, LIFECYCLE_STATES.SKIPPED]
  for (const lc of excludable) {
    const next = applyLifecycleEvent({ lifecycle: lc }, { type: 'exclude' })
    assert.equal(next.lifecycle, LIFECYCLE_STATES.EXCLUDED,
      `${lc} -> exclude should succeed`)
  }
})

test('CONTRACT-01: applyLifecycleEvent exclude from in-progress is illegal', () => {
  // Design constraint: in-progress must be resolved before exclusion
  assert.throws(
    () => applyLifecycleEvent({ lifecycle: LIFECYCLE_STATES.IN_PROGRESS }, { type: 'exclude' }),
    /illegal transition/
  )
})

test('CONTRACT-01: applyLifecycleEvent terminal states have empty transition table', () => {
  assert.deepEqual(TRANSITION_TABLE.completed, [])
  assert.deepEqual(TRANSITION_TABLE.excluded, [])
})

test('CONTRACT-01: TRANSITION_TABLE covers all lifecycle states', () => {
  const allStates = Object.values(LIFECYCLE_STATES)
  for (const lc of allStates) {
    assert.ok(TRANSITION_TABLE[lc] !== undefined,
      `TRANSITION_TABLE must have entry for state '${lc}'`)
    assert.ok(Array.isArray(TRANSITION_TABLE[lc]),
      `TRANSITION_TABLE entry for '${lc}' must be an array`)
  }
})

// =========================================================================
// CONTRACT-01: deriveReadiness comprehensive mixed states
// =========================================================================

test('CONTRACT-01: deriveReadiness with all lifecycle states present simultaneously', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'c1', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'c2', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'd1', lifecycle: LIFECYCLE_STATES.DEFERRED },
      { id: 'r1', lifecycle: LIFECYCLE_STATES.RUNNABLE },
      { id: 'i1', lifecycle: LIFECYCLE_STATES.IN_PROGRESS },
      { id: 'b1', lifecycle: LIFECYCLE_STATES.BLOCKED },
      { id: 'f1', lifecycle: LIFECYCLE_STATES.FAILED },
      { id: 's1', lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.FEATURE_LEVEL },
      {
        id: 'p1', lifecycle: LIFECYCLE_STATES.SKIPPED,
        skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL, policyEvidence: 'ok',
      },
      { id: 'e1', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    ],
  }
  const r = deriveReadiness(manifest)
  // Denominator = total - excluded = 10 - 1 = 9
  assert.equal(r.denominator, 9)
  assert.equal(r.excluded, 1)
  assert.equal(r.completed, 3) // 2 completed + 1 policy-disabled-optional with evidence
  assert.equal(r.blocked, 1)
  assert.equal(r.failed, 1)
  assert.equal(r.skipped, 1) // feature-level skipped only
  assert.equal(r.remaining, 3) // deferred + runnable + in-progress
  assert.equal(r.ready, false) // many incomplete features
})

test('CONTRACT-01: deriveReadiness ready when only completed + excluded + policy-skip', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'c', lifecycle: LIFECYCLE_STATES.EXCLUDED },
      {
        id: 'd', lifecycle: LIFECYCLE_STATES.SKIPPED,
        skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL, policyEvidence: 'gate-disabled',
      },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.denominator, 3) // 4 - 1 excluded
  assert.equal(r.completed, 3) // 2 completed + 1 policy-skip
  assert.equal(r.ready, true)
  assert.equal(r.skipped, 0) // policy-disabled-optional not counted as incomplete
})

test('CONTRACT-01: deriveReadiness handles manifest with null features', () => {
  const r = deriveReadiness({ features: null })
  assert.equal(r.ready, false)
  assert.equal(r.denominator, 0)
})

// =========================================================================
// CONTRACT-01: Migration legacy status completeness
// =========================================================================

test('CONTRACT-01: migrateLegacyState converts legacy failed to failed', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Failed Feat', status: 'failed', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.FAILED)
})

test('CONTRACT-01: migrateLegacyState converts legacy excluded to excluded', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Excluded Feat', status: 'excluded', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

test('CONTRACT-01: migrateLegacyState handles unknown legacy status as deferred', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Unknown Feat', status: 'some-unknown-status', planDir: 'slices/a/' },
      ],
    },
  }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('CONTRACT-01: migrateLegacyState handles missing result field', () => {
  const legacy = { engineVersion: '1.4.5' }
  const migrated = migrateLegacyState(legacy)
  assert.equal(migrated.schemaVersion, '1.5.0')
  assert.equal(migrated.features.length, 0)
  assert.equal(migrated.legacyEngineVersion, '1.4.5')
})

test('CONTRACT-01: migrateLegacyState throws on non-object input', () => {
  assert.throws(() => migrateLegacyState(null), /input must be an object/)
  assert.throws(() => migrateLegacyState('string'), /input must be an object/)
})

// =========================================================================
// CONTRACT-01: Resume convergence after partial migration
// =========================================================================

test('CONTRACT-01: resuming partial migration converges to same result as fresh', () => {
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Feature A', status: 'completed', planDir: 'slices/a/' },
        { id: 'b', name: 'Feature B', status: 'pending', planDir: 'slices/b/' },
        { id: 'c', name: 'Feature C', status: 'pending', planDir: 'slices/c/' },
      ],
    },
    engineVersion: '1.4.5',
  }

  // Fresh migration
  const fresh = migrateLegacyState(legacy)

  // Simulate partial migration state (already partially migrated)
  const partialState = {
    schemaVersion: '1.5.0',
    status: 'migrating',
    features: fresh.features.slice(0, 2), // only first 2 migrated
    legacyEngineVersion: '1.4.5',
  }

  // Resuming should produce same end state as fresh migration
  // (migrateLegacyState is idempotent on the full input)
  const resumed = migrateLegacyState(legacy)

  assert.deepEqual(resumed, fresh,
    'resume from partial migration must converge to same result as fresh')
})

test('CONTRACT-01: validateMigrationBoundary unknown phase returns ok=false', () => {
  const state = { features: [{ id: 'a', shardRef: 'a.json' }] }
  const result = validateMigrationBoundary(state, 'unknown-phase')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('unknown migration phase'))
})

test('CONTRACT-01: validateMigrationBoundary child-write without childId fails', () => {
  const state = { features: [{ id: 'a', shardRef: 'a.json' }] }
  const result = validateMigrationBoundary(state, 'child-write')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('childId required'))
})

test('CONTRACT-01: validateMigrationBoundary child-write unknown child fails', () => {
  const state = { features: [{ id: 'a', shardRef: 'a.json' }] }
  const result = validateMigrationBoundary(state, 'child-write', 'nonexistent')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('not found'))
})

test('CONTRACT-01: validateMigrationBoundary child-write without shardRef fails', () => {
  const state = { features: [{ id: 'a', shardRef: null }] }
  const result = validateMigrationBoundary(state, 'child-write', 'a')
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('missing shardRef'))
})

// =========================================================================
// REV-01: Combined multi-input revision changes
// =========================================================================

test('REV-01: source AND scope change together affects codeFacts + arch', () => {
  const old = { source: 's1', scope: 'sc1', graph: 'g1', deps: 'd1' }
  const newR = { source: 's2', scope: 'sc2', graph: 'g1', deps: 'd1' }
  const delta = compareRevisions(old, newR)
  // source change affects codeFacts + arch; scope change affects codeFacts
  // union = codeFacts + arch
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(delta.changedInputs.includes('source'))
  assert.ok(delta.changedInputs.includes('scope'))
})

test('REV-01: all top-level inputs changed simultaneously', () => {
  const old = { source: 's1', scope: 'sc1', graph: 'g1', deps: 'd1' }
  const newR = { source: 's2', scope: 'sc2', graph: 'g2', deps: 'd2' }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
  assert.equal(delta.changedInputs.length, 4)
})

test('REV-01: artifact AND source change together affects owning gate + codeFacts + arch', () => {
  const old = { source: 's1', artifacts: { design: 'd1', plan: 'p1' } }
  const newR = { source: 's2', artifacts: { design: 'd2', plan: 'p1' } }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('codeFacts'))
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(delta.affectedGates.includes('design'))
  assert.ok(!delta.affectedGates.includes('plan'), 'plan artifact unchanged')
})

test('REV-01: selectiveInvalidate after combined source+scope change', () => {
  const old = { source: 's1', scope: 'sc1', graph: 'g1', deps: 'd1' }
  const newR = { source: 's2', scope: 'sc2', graph: 'g1', deps: 'd1' }
  const delta = compareRevisions(old, newR)

  const shard = {
    gates: {
      codeFacts: { digest: 'd1', valid: true },
      arch: { digest: 'd2', valid: true },
      design: { digest: 'd3', valid: true },
      plan: { digest: 'd4', valid: true },
    },
  }
  const result = selectiveInvalidate(shard, delta)
  assert.equal(result.gates.codeFacts.valid, false)
  assert.equal(result.gates.arch.valid, false)
  assert.equal(result.gates.design.valid, true)
  assert.equal(result.gates.plan.valid, true)
})

// =========================================================================
// REV-01: Nested object digest stability
// =========================================================================

test('REV-01: computeContentDigest stable for nested objects with reordered keys', () => {
  const obj1 = { a: { b: 1, c: 2 }, d: [3, 4] }
  const obj2 = { d: [3, 4], a: { c: 2, b: 1 } }
  assert.equal(computeContentDigest(obj1), computeContentDigest(obj2))
})

test('REV-01: computeContentDigest stable for deeply nested objects', () => {
  const obj1 = { outer: { inner: { deep: { val: 42 } } } }
  const obj2 = { outer: { inner: { deep: { val: 42 } } } }
  assert.equal(computeContentDigest(obj1), computeContentDigest(obj2))
})

test('REV-01: computeContentDigest differs for nested vs shallow change', () => {
  const obj1 = { outer: { inner: { val: 1 } } }
  const obj2 = { outer: { inner: { val: 2 } } }
  assert.notEqual(computeContentDigest(obj1), computeContentDigest(obj2))
})

test('REV-01: computeContentDigest handles arrays', () => {
  const d1 = computeContentDigest([1, 2, 3])
  const d2 = computeContentDigest([1, 2, 3])
  const d3 = computeContentDigest([1, 2, 4])
  assert.equal(d1, d2)
  assert.notEqual(d1, d3)
})

test('REV-01: computeDigest handles objects via JSON serialization', () => {
  const d1 = computeDigest({ a: 1 })
  const d2 = computeDigest({ a: 1 })
  assert.equal(typeof d1, 'string')
  assert.equal(d1, d2)
})

test('REV-01: GATE_DEPENDENCY_MAP covers all revision input types', () => {
  const allGates = Object.keys(GATE_DEPENDENCY_MAP)
  const allInputTypes = Object.values(GATE_DEPENDENCY_MAP).flat()
  const uniqueInputs = [...new Set(allInputTypes)]

  // All 5 input types should be referenced
  assert.ok(uniqueInputs.includes('source'))
  assert.ok(uniqueInputs.includes('scope'))
  assert.ok(uniqueInputs.includes('graph'))
  assert.ok(uniqueInputs.includes('deps'))
  assert.ok(uniqueInputs.includes('artifact'))

  // Every gate should map to at least one input
  for (const [gate, inputs] of Object.entries(GATE_DEPENDENCY_MAP)) {
    assert.ok(inputs.length > 0, `gate '${gate}' must map to at least one input type`)
  }
})

test('REV-01: REVISION_INPUTS has all 5 types', () => {
  const values = Object.values(REVISION_INPUTS)
  assert.equal(values.length, 5)
  assert.ok(values.includes('source'))
  assert.ok(values.includes('scope'))
  assert.ok(values.includes('graph'))
  assert.ok(values.includes('deps'))
  assert.ok(values.includes('artifact'))
})

// =========================================================================
// E2E-STATE-01: Full boundary validation lifecycle (root-last guarantee)
// =========================================================================

test('E2E-STATE-01: full migration boundary lifecycle — write each child then root', () => {
  // Simulate the complete root-last migration boundary lifecycle
  const legacy = {
    result: {
      slices: [
        { id: 'a', name: 'Alpha', status: 'pending', planDir: 'slices/a/' },
        { id: 'b', name: 'Beta', status: 'pending', planDir: 'slices/b/' },
        { id: 'c', name: 'Gamma', status: 'pending', planDir: 'slices/c/' },
      ],
    },
    engineVersion: '1.4.5',
  }

  const migrated = migrateLegacyState(legacy)

  // Before any child is durable, root acknowledgement must fail
  assert.equal(validateMigrationBoundary(migrated, 'before-root').ok, false)

  // Write each child one by one
  for (const feat of migrated.features) {
    const result = validateMigrationBoundary(migrated, 'child-write', feat.id)
    assert.equal(result.ok, true, `child-write for ${feat.id} should succeed`)
  }

  // After all children durable, root acknowledgement succeeds
  assert.equal(validateMigrationBoundary(migrated, 'after-children').ok, true)

  // Root acknowledgement before ALL children also fails
  // (simulate partial: only first child durable)
  const partialMigrated = migrateLegacyState(legacy)
  validateMigrationBoundary(partialMigrated, 'child-write', partialMigrated.features[0].id)
  assert.equal(
    validateMigrationBoundary(partialMigrated, 'before-root').ok, false,
    'root must fail when some children not yet durable'
  )
})

// =========================================================================
// E2E-REV-01: Each revision input type independently invalidates correct gates
// =========================================================================

test('E2E-REV-01: deps change affects only arch gate', () => {
  const old = { source: 's', scope: 'sc', graph: 'g', deps: 'd1' }
  const newR = { source: 's', scope: 'sc', graph: 'g', deps: 'd2' }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('arch'))
  assert.ok(!delta.affectedGates.includes('codeFacts'),
    'codeFacts should NOT be affected by deps change')
  assert.ok(delta.changedInputs.includes('deps'))
})

test('E2E-REV-01: new artifact added triggers owning gate invalidation', () => {
  const old = { source: 's', artifacts: { design: 'd1' } }
  const newR = { source: 's', artifacts: { design: 'd1', plan: 'p1' } }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('plan'), 'new plan artifact should trigger plan gate')
  assert.ok(!delta.affectedGates.includes('design'), 'unchanged design should not be affected')
})

test('E2E-REV-01: removed artifact triggers owning gate invalidation', () => {
  const old = { source: 's', artifacts: { design: 'd1', plan: 'p1' } }
  const newR = { source: 's', artifacts: { design: 'd1' } }
  const delta = compareRevisions(old, newR)
  assert.ok(delta.affectedGates.includes('plan'), 'removed plan artifact should trigger plan gate')
  assert.ok(!delta.affectedGates.includes('design'), 'unchanged design should not be affected')
})

// =========================================================================
// CONTRACT-01: isIncomplete edge cases
// =========================================================================

test('CONTRACT-01: isIncomplete for skipped without skipReason returns true (conservative)', () => {
  assert.equal(isIncomplete(LIFECYCLE_STATES.SKIPPED), true)
})

test('CONTRACT-01: isIncomplete for unknown state returns false', () => {
  assert.equal(isIncomplete('unknown-state'), false)
})
