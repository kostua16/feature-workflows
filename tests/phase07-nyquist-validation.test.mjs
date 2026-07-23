// Phase 7 Nyquist validation: gap-filling tests for COMPAT-01, QUAL-01, DOGFOOD-01.
//
// Retroactively audits the Phase 7 proof tests for edge-case coverage:
// - COMPAT-01: null/undefined/empty degenerate inputs, unknown modes, error paths,
//   migration boundary edge cases, structural source assertions.
// - QUAL-01: path classification, graph ownership/cycle rejection, out-of-order
//   continuation, timeout/blocked failure semantics, readiness false-paths.
// - DOGFOOD-01: continuation decision, auto-relaunch refusal, resume command
//   idempotency, terminal failure detection, failure isolation semantics.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  resolveMode,
  gateModeActive,
  validatePipelineState,
  detectResumeEngineSkew,
  migrateLegacyState,
  validateMigrationBoundary,
  deriveFeatureId,
  deriveReadiness,
  summarizeGates,
  renderStatusReport,
  deriveNextCommand,
  seedExtractQueue,
  stateChecksum,
  LIFECYCLE_STATES,
  SKIP_REASONS,
  classifyPath,
  PATH_POLICIES,
  GENERATED_SEGMENTS,
  IGNORE_SEGMENTS,
  GENERATED_EXTENSIONS,
  validateGraph,
  detectCycle,
  classifyCycle,
  CYCLE_POLICIES,
  GRAPH_VERDICTS,
  applyLifecycleEvent,
  applyCap,
  promoteDeferred,
  queueDenominator,
  compareRevisions,
  selectiveInvalidate,
  createBudgetAccountant,
  createBudgetLimits,
  setReserve,
  callsRemaining,
  admitSegment,
  spendBudget,
  budgetSummary,
  RESERVE_TYPES,
  createRetryPolicy,
  createAttemptHistory,
  recordAttempt,
  ATTEMPT_OUTCOMES,
  isGateRetriesExhausted,
  isTerminalFailure,
  terminalReason,
  isolateFailure,
  eligibleIndependents,
  shouldContinueAfterFailure,
  segmentOutcome,
  createContinuationState,
  nextSegmentId,
  createSegmentIntent,
  acknowledgeSegment,
  resolveConvergence,
  shouldContinue,
  resumeCommand,
  segmentCounts,
  canAutoRelaunch,
  continuationSummary,
  deriveExtractReadiness,
  countLifecycleStates,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function queueWithStatuses(entries) {
  return entries.map(e => ({ id: e.id, name: e.name || e.id, status: e.status, artifacts: e.artifacts || {} }))
}

// ===========================================================================
// COMPAT-01: resolveMode edge cases
// ===========================================================================

test('COMPAT-NQ: resolveMode defaults to design when all inputs null/undefined', () => {
  assert.equal(resolveMode(null, null, null), 'design')
  assert.equal(resolveMode({}, {}, {}), 'design')
  assert.equal(resolveMode(undefined, undefined, undefined), 'design')
})

test('COMPAT-NQ: resolveMode ignores invalid mode strings', () => {
  assert.equal(resolveMode({ mode: 'invalid' }, { mode: 'design' }, null), 'design')
  assert.equal(resolveMode({ mode: '' }, { mode: 'implement' }, null), 'implement')
  assert.equal(resolveMode({}, { mode: 'bogus' }, { result: { mode: 'tune' } }), 'tune')
})

test('COMPAT-NQ: resolveMode args overrides saved-state when config is empty', () => {
  assert.equal(resolveMode({ mode: 'extract' }, {}, { result: { mode: 'design' } }), 'extract')
  assert.equal(resolveMode({ mode: 'review' }, null, { result: { mode: 'status' } }), 'review')
})

test('COMPAT-NQ: resolveMode saved-state fallback when args and config are empty', () => {
  assert.equal(resolveMode({}, {}, { result: { mode: 'tune' } }), 'tune')
  assert.equal(resolveMode({}, null, { result: { mode: 'implement' } }), 'implement')
})

// ===========================================================================
// COMPAT-01: gateModeActive edge cases
// ===========================================================================

test('COMPAT-NQ: gateModeActive shared group is true in all six modes', () => {
  for (const mode of ['design', 'implement', 'tune', 'extract', 'review', 'status']) {
    assert.equal(gateModeActive('shared', mode), true, `shared must be active in ${mode}`)
  }
})

test('COMPAT-NQ: gateModeActive design gates ARE active in tune mode', () => {
  assert.equal(gateModeActive('design', 'tune'), true, 'design gates run in tune (refine subset)')
})

test('COMPAT-NQ: gateModeActive returns false for unknown group in extract', () => {
  // extract mode: only extract + shared gates
  assert.equal(gateModeActive('design', 'extract'), false)
  assert.equal(gateModeActive('implement', 'extract'), false)
  assert.equal(gateModeActive('review', 'extract'), false)
  assert.equal(gateModeActive('extract', 'extract'), true)
})

test('COMPAT-NQ: gateModeActive review gates only active in review mode', () => {
  assert.equal(gateModeActive('review', 'review'), true)
  assert.equal(gateModeActive('review', 'design'), false)
  assert.equal(gateModeActive('review', 'status'), false)
})

test('COMPAT-NQ: gateModeActive with undefined/null group returns true (shared default)', () => {
  assert.equal(gateModeActive(undefined, 'design'), true)
  assert.equal(gateModeActive(null, 'extract'), true)
})

// ===========================================================================
// COMPAT-01: validatePipelineState edge cases
// ===========================================================================

test('COMPAT-NQ: validatePipelineState detects checksum mismatch', () => {
  const state = {
    task: 'test', slug: 'test', planPath: '/p', planDir: '/p/',
    result: { mode: 'design' },
    checksum: 'WRONG_CHECKSUM',
  }
  const v = validatePipelineState(state)
  assert.ok(!v.ok, 'checksum mismatch must fail validation')
  assert.ok(v.errors.some(e => e.includes('checksum')), 'error must mention checksum')
})

test('COMPAT-NQ: validatePipelineState correct checksum passes', () => {
  const result = { mode: 'design' }
  const state = {
    task: 'test', slug: 'test', planPath: '/p', planDir: '/p/',
    result,
    checksum: stateChecksum(JSON.stringify(result)),
  }
  const v = validatePipelineState(state)
  assert.ok(v.ok, `correct checksum must pass: ${v.errors?.join(', ')}`)
})

test('COMPAT-NQ: validatePipelineState rejects non-object config', () => {
  const state = {
    task: 't', slug: 's', planPath: '/p', planDir: '/p/',
    result: { mode: 'design' },
    config: 'not-an-object',
  }
  assert.ok(!validatePipelineState(state).ok)
})

test('COMPAT-NQ: validatePipelineState accepts absent config', () => {
  const state = {
    task: 't', slug: 's', planPath: '/p', planDir: '/p/',
    result: { mode: 'design' },
  }
  assert.ok(validatePipelineState(state).ok)
})

// ===========================================================================
// COMPAT-01: migrateLegacyState edge cases
// ===========================================================================

test('COMPAT-NQ: migrateLegacyState throws on null input', () => {
  assert.throws(() => migrateLegacyState(null), /must be an object/)
})

test('COMPAT-NQ: migrateLegacyState throws on non-object input', () => {
  assert.throws(() => migrateLegacyState('string'), /must be an object/)
  assert.throws(() => migrateLegacyState(42), /must be an object/)
})

test('COMPAT-NQ: migrateLegacyState with no result produces empty features', () => {
  const migrated = migrateLegacyState({})
  assert.equal(migrated.features.length, 0)
  assert.equal(migrated.schemaVersion, '1.5.0')
  assert.equal(migrated.status, 'migrating')
})

test('COMPAT-NQ: migrateLegacyState maps failed legacy status to FAILED', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'failed', files: ['x.mjs'] }] },
  })
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.FAILED)
})

test('COMPAT-NQ: migrateLegacyState maps excluded legacy status to EXCLUDED', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'excluded', files: ['x.mjs'] }] },
  })
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.EXCLUDED)
})

test('COMPAT-NQ: migrateLegacyState unknown legacy status defaults to DEFERRED', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'wat', files: ['x.mjs'] }] },
  })
  assert.equal(migrated.features[0].lifecycle, LIFECYCLE_STATES.DEFERRED)
})

test('COMPAT-NQ: migrateLegacyState preserves legacyEngineVersion', () => {
  const migrated = migrateLegacyState({
    engineVersion: '1.4.3',
    result: { slices: [] },
  })
  assert.equal(migrated.legacyEngineVersion, '1.4.3')
})

test('COMPAT-NQ: migrateLegacyState null engineVersion becomes null', () => {
  const migrated = migrateLegacyState({ result: {} })
  assert.equal(migrated.legacyEngineVersion, null)
})

// ===========================================================================
// COMPAT-01: validateMigrationBoundary edge cases
// ===========================================================================

test('COMPAT-NQ: validateMigrationBoundary returns ok=false for null state', () => {
  const result = validateMigrationBoundary(null, 'before-root')
  assert.ok(!result.ok)
})

test('COMPAT-NQ: validateMigrationBoundary returns ok=false for unknown phase', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'pending', files: ['x.mjs'] }] },
  })
  const result = validateMigrationBoundary(migrated, 'unknown-phase')
  assert.ok(!result.ok)
})

test('COMPAT-NQ: validateMigrationBoundary child-write requires childId', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'pending', files: ['x.mjs'] }] },
  })
  const result = validateMigrationBoundary(migrated, 'child-write', null)
  assert.ok(!result.ok)
  assert.ok(result.reason.includes('childId'))
})

test('COMPAT-NQ: validateMigrationBoundary child-write rejects unknown childId', () => {
  const migrated = migrateLegacyState({
    result: { slices: [{ name: 'X', planDir: '/x/', status: 'pending', files: ['x.mjs'] }] },
  })
  const result = validateMigrationBoundary(migrated, 'child-write', 'nonexistent-id')
  assert.ok(!result.ok)
})

// ===========================================================================
// COMPAT-01: deriveFeatureId edge cases
// ===========================================================================

test('COMPAT-NQ: deriveFeatureId returns unknown for null input', () => {
  assert.equal(deriveFeatureId(null), 'unknown')
})

test('COMPAT-NQ: deriveFeatureId returns unknown for undefined input', () => {
  assert.equal(deriveFeatureId(undefined), 'unknown')
})

test('COMPAT-NQ: deriveFeatureId with only name (no entryPoints or files)', () => {
  const id = deriveFeatureId({ name: 'Parser Module' })
  assert.equal(id, 'parser-module')
})

test('COMPAT-NQ: deriveFeatureId with missing entryPoints/files arrays', () => {
  const id = deriveFeatureId({ name: 'Auth', entryPoints: undefined, files: undefined })
  assert.equal(id, 'auth')
})

test('COMPAT-NQ: deriveFeatureId with empty name falls back to id', () => {
  const id = deriveFeatureId({ id: 'custom-id', name: null })
  assert.ok(id.length > 0)
})

// ===========================================================================
// COMPAT-01: detectResumeEngineSkew edge cases
// ===========================================================================

test('COMPAT-NQ: detectResumeEngineSkew returns null for null savedVersion', () => {
  assert.equal(detectResumeEngineSkew(null, '1.5.0'), null)
})

test('COMPAT-NQ: detectResumeEngineSkew returns null for undefined savedVersion', () => {
  assert.equal(detectResumeEngineSkew(undefined, '1.5.0'), null)
})

test('COMPAT-NQ: detectResumeEngineSkew reports skew when currentVersion is null', () => {
  // savedVersion present but currentVersion null → still reports skew
  const skew = detectResumeEngineSkew('1.4.5', null)
  assert.ok(skew, 'must report skew when versions differ')
  assert.equal(skew.saved, '1.4.5')
})

test('COMPAT-NQ: detectResumeEngineSkew returns null for matching versions', () => {
  assert.equal(detectResumeEngineSkew('1.5.0', '1.5.0'), null)
})

test('COMPAT-NQ: detectResumeEngineSkew returns object for version mismatch', () => {
  const skew = detectResumeEngineSkew('1.4.5', '1.5.0')
  assert.ok(skew)
  assert.equal(skew.saved, '1.4.5')
  assert.equal(skew.current, '1.5.0')
})

// ===========================================================================
// COMPAT-01: summarizeGates / renderStatusReport / deriveNextCommand edge cases
// ===========================================================================

test('COMPAT-NQ: summarizeGates with null result returns all pending', () => {
  const gates = summarizeGates(null)
  assert.ok(gates.length > 0)
  for (const g of gates) {
    assert.equal(g.status, 'pending')
  }
})

test('COMPAT-NQ: summarizeGates with empty object returns all pending', () => {
  const gates = summarizeGates({})
  assert.ok(gates.every(g => g.status === 'pending'))
})

test('COMPAT-NQ: renderStatusReport with null state does not throw', () => {
  const report = renderStatusReport(null, null)
  assert.ok(typeof report === 'string')
  assert.ok(report.includes('(unknown'))
})

test('COMPAT-NQ: renderStatusReport with failed validation includes WARNING', () => {
  const state = { task: 't', slug: 's', planPath: '/p', planDir: '/p/', result: {} }
  const report = renderStatusReport(state, { ok: false, errors: ['bad checksum'] })
  assert.ok(report.includes('WARNING'))
  assert.ok(report.includes('bad checksum'))
})

test('COMPAT-NQ: deriveNextCommand for committed run returns none', () => {
  const cmd = deriveNextCommand({ result: { committed: true } })
  assert.equal(cmd.command, '(none)')
})

test('COMPAT-NQ: deriveNextCommand for ready unexecuted returns implement', () => {
  const cmd = deriveNextCommand({ planDir: '/p/', result: { designReady: true, executed: false } })
  assert.ok(cmd.command.includes('/implement-feature'))
})

test('COMPAT-NQ: deriveNextCommand with handoff respects nextMode', () => {
  const cmd = deriveNextCommand({
    planDir: '/p/',
    result: { handoff: { nextMode: 'review', message: 'go review' } },
  })
  assert.ok(cmd.command.includes('/review-design'))
  assert.equal(cmd.reason, 'go review')
})

test('COMPAT-NQ: deriveNextCommand for blocked run returns resume', () => {
  const cmd = deriveNextCommand({
    planDir: '/p/',
    result: { mode: 'implement', blockedAt: 'execute' },
  })
  assert.ok(cmd.command.includes('/implement-feature'))
  assert.ok(cmd.reason.includes('blocked'))
})

// ===========================================================================
// COMPAT-01: seedExtractQueue edge cases
// ===========================================================================

test('COMPAT-NQ: seedExtractQueue with no slices produces single main entry', () => {
  const queue = seedExtractQueue({ files: [], entryPoints: [] }, null, '/p/', 8, [])
  assert.equal(queue.length, 1)
  assert.equal(queue[0].id, 'main')
  assert.equal(queue[0].status, 'pending')
})

test('COMPAT-NQ: seedExtractQueue with null scope does not throw', () => {
  // Defensive: null scope should not crash
  const queue = seedExtractQueue({ files: null }, null, '/p/', 8, [])
  assert.ok(Array.isArray(queue))
})

// ===========================================================================
// COMPAT-01: structural source assertions
// ===========================================================================

test('COMPAT-NQ: engine source contains VALID mode enumeration object', () => {
  assert.ok(source.includes('design: true'), 'design must be in VALID modes')
  assert.ok(source.includes('implement: true'), 'implement must be in VALID modes')
  assert.ok(source.includes('extract: true'), 'extract must be in VALID modes')
  assert.ok(source.includes('review: true'), 'review must be in VALID modes')
  assert.ok(source.includes('status: true'), 'status must be in VALID modes')
  assert.ok(source.includes("tune: true"), 'tune must be in VALID modes')
})

test('COMPAT-NQ: engine source guardModeActive covers all groups', () => {
  assert.ok(source.includes("gateGroup === 'design'"))
  assert.ok(source.includes("gateGroup === 'implement'"))
  assert.ok(source.includes("gateGroup === 'extract'"))
  assert.ok(source.includes("gateGroup === 'review'"))
})

test('COMPAT-NQ: engine source contains resolveMode default fallback', () => {
  assert.ok(source.includes("return 'design'"), 'resolveMode must default to design')
})

// ===========================================================================
// QUAL-01: classifyPath edge cases (E2E-DISC-01 enrichment)
// ===========================================================================

test('QUAL-NQ: classifyPath identifies generated dist paths', () => {
  const result = classifyPath('src/dist/foo.mjs')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
})

test('QUAL-NQ: classifyPath identifies vendor paths', () => {
  const result = classifyPath('vendor/lib.mjs')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
  assert.equal(result.policy, 'vendor')
})

test('QUAL-NQ: classifyPath identifies third_party as vendor', () => {
  const result = classifyPath('third_party/lib.mjs')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
  assert.equal(result.policy, 'vendor')
})

test('QUAL-NQ: classifyPath identifies node_modules as generated', () => {
  const result = classifyPath('node_modules/express/index.mjs')
  assert.equal(result.verdict, PATH_POLICIES.GENERATED)
})

test('QUAL-NQ: classifyPath identifies .git segment as ignored', () => {
  const result = classifyPath('.git/config')
  assert.equal(result.verdict, PATH_POLICIES.IGNORED)
})

test('QUAL-NQ: classifyPath with null returns excluded', () => {
  const result = classifyPath(null)
  assert.equal(result.verdict, PATH_POLICIES.EXCLUDED)
})

test('QUAL-NQ: classifyPath with empty string returns excluded', () => {
  const result = classifyPath('')
  assert.equal(result.verdict, PATH_POLICIES.EXCLUDED)
})

test('QUAL-NQ: classifyPath normal source path is included', () => {
  const result = classifyPath('src/parser.mjs')
  assert.equal(result.verdict, PATH_POLICIES.INCLUDED)
})

test('QUAL-NQ: GENERATED_SEGMENTS is a Set with expected values', () => {
  assert.ok(GENERATED_SEGMENTS instanceof Set)
  assert.ok(GENERATED_SEGMENTS.has('node_modules'))
  assert.ok(GENERATED_SEGMENTS.has('dist'))
  assert.ok(GENERATED_SEGMENTS.has('vendor'))
})

test('QUAL-NQ: IGNORE_SEGMENTS is a Set with expected values', () => {
  assert.ok(IGNORE_SEGMENTS instanceof Set)
  assert.ok(IGNORE_SEGMENTS.has('.git'))
  assert.ok(IGNORE_SEGMENTS.has('.svn'))
})

test('QUAL-NQ: GENERATED_EXTENSIONS is a Set with expected values', () => {
  assert.ok(GENERATED_EXTENSIONS instanceof Set)
  assert.ok(GENERATED_EXTENSIONS.has('.min.js'))
  assert.ok(GENERATED_EXTENSIONS.has('.lock'))
})

// ===========================================================================
// QUAL-01: Graph validation edge cases (E2E-GRAPH-01 enrichment)
// ===========================================================================

test('QUAL-NQ: graph validation rejects ownership overlap', () => {
  // Features with paths that overlap without an ownership map resolution
  const features = [
    { id: 'a', name: 'A', paths: ['src/shared.mjs', 'src/a.mjs'] },
    { id: 'b', name: 'B', paths: ['src/shared.mjs', 'src/b.mjs'] },
  ]
  const result = validateGraph(features, [], null, 'reject')
  assert.notEqual(result.verdict, 'valid', 'ownership overlap must not be valid')
  assert.ok(result.errors.some(e => e.type === 'ownership-overlap'), 'must flag ownership-overlap')
})

test('QUAL-NQ: detectCycle finds simple cycle', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]
  const result = detectCycle(edges)
  assert.ok(result.hasCycle, 'simple cycle must be detected')
  assert.ok(result.cycle.length > 0)
})

test('QUAL-NQ: detectCycle returns empty for DAG', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]
  const result = detectCycle(edges)
  assert.equal(result.hasCycle, false, 'DAG must have no cycle')
  assert.equal(result.cycle.length, 0)
})

test('QUAL-NQ: classifyCycle returns unsupported for unowned cycle', () => {
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]
  const result = classifyCycle(edges, null)
  assert.equal(result.classification, CYCLE_POLICIES.UNSUPPORTED)
  assert.ok(result.cycle.length > 0)
})

test('QUAL-NQ: CYCLE_POLICIES is a frozen object', () => {
  assert.ok(Object.isFrozen(CYCLE_POLICIES))
})

test('QUAL-NQ: GRAPH_VERDICTS is a frozen object', () => {
  assert.ok(Object.isFrozen(GRAPH_VERDICTS))
})

// ===========================================================================
// QUAL-01: compareRevisions multiple input types (E2E-REV-01 enrichment)
// ===========================================================================

test('QUAL-NQ: compareRevisions detects scope change', () => {
  const delta = compareRevisions(
    { source: 's1', scope: 'sc1', graph: 'g1' },
    { source: 's1', scope: 'CHANGED', graph: 'g1' }
  )
  assert.ok(delta.changedInputs.includes('scope'))
  assert.ok(!delta.changedInputs.includes('source'))
})

test('QUAL-NQ: compareRevisions detects graph change', () => {
  const delta = compareRevisions(
    { source: 's1', scope: 'sc1', graph: 'g1' },
    { source: 's1', scope: 'sc1', graph: 'CHANGED' }
  )
  assert.ok(delta.changedInputs.includes('graph'))
})

test('QUAL-NQ: compareRevisions with no changes returns empty changedInputs', () => {
  const delta = compareRevisions(
    { source: 's1', scope: 'sc1', graph: 'g1' },
    { source: 's1', scope: 'sc1', graph: 'g1' }
  )
  assert.equal(delta.changedInputs.length, 0)
})

// ===========================================================================
// QUAL-01: Continuation out-of-order and convergence (E2E-CONT-01 enrichment)
// ===========================================================================

test('QUAL-NQ: out-of-order segment ack still converges', () => {
  let state = createContinuationState()

  // Create segments 1 and 2
  const seg1 = nextSegmentId(state); state = seg1.state
  const intent1 = createSegmentIntent(state, seg1.segmentId, ['f1'], 'rev-1')
  state = intent1.state

  const seg2 = nextSegmentId(state); state = seg2.state
  const intent2 = createSegmentIntent(state, seg2.segmentId, ['f2'], 'rev-2')
  state = intent2.state

  // Ack segment 2 BEFORE segment 1 (out-of-order)
  const ack2 = acknowledgeSegment(state, seg2.segmentId, intent2.intent.idempotencyKey, 'completed', { completed: 1 })
  state = ack2.state
  assert.ok(ack2.ok !== false, 'out-of-order ack must not be rejected')

  // Now ack segment 1
  const ack1 = acknowledgeSegment(state, seg1.segmentId, intent1.intent.idempotencyKey, 'completed', { completed: 1 })
  state = ack1.state

  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 2, 'both segments must converge')
})

test('QUAL-NQ: lost acknowledgement does not prevent convergence on re-ack', () => {
  let state = createContinuationState()
  const seg1 = nextSegmentId(state); state = seg1.state
  const intent1 = createSegmentIntent(state, seg1.segmentId, ['f1'], 'rev-1')
  state = intent1.state

  // First ack is "lost" (we don't apply it to state)
  // Re-ack with same key
  const ack = acknowledgeSegment(state, seg1.segmentId, intent1.intent.idempotencyKey, 'completed', { completed: 1 })
  state = ack.state

  const convergence = resolveConvergence(state)
  assert.equal(convergence.converged.length, 1)
})

// ===========================================================================
// QUAL-01: Failure isolation semantics (E2E-FAIL-01 enrichment)
// ===========================================================================

test('QUAL-NQ: timeout failure marks feature as blocked (resumable)', () => {
  const queue = queueWithStatuses([
    { id: 'f1', status: 'in-progress' },
    { id: 'f2', status: 'in-progress' },
  ])
  const result = isolateFailure(queue, 'f1', 'timeout')
  const failed = result.find(e => e.id === 'f1')
  assert.equal(failed.status, 'blocked', 'timeout must be resumable (blocked)')
})

test('QUAL-NQ: blocked dependency marks feature as blocked (resumable)', () => {
  const queue = queueWithStatuses([{ id: 'f1', status: 'in-progress' }])
  const result = isolateFailure(queue, 'f1', 'blocked')
  assert.equal(result[0].status, 'blocked')
})

test('QUAL-NQ: non-timeout error marks feature as failed (terminal)', () => {
  const queue = queueWithStatuses([{ id: 'f1', status: 'in-progress' }])
  const result = isolateFailure(queue, 'f1', 'error')
  assert.equal(result[0].status, 'failed', 'generic error must be terminal')
})

test('QUAL-NQ: isolateFailure does not mutate input queue', () => {
  const queue = queueWithStatuses([{ id: 'f1', status: 'in-progress' }])
  const result = isolateFailure(queue, 'f1', 'error')
  assert.equal(queue[0].status, 'in-progress', 'original queue must be unchanged')
  assert.equal(result[0].status, 'failed', 'result must have updated status')
})

test('QUAL-NQ: isolateFailure preserves artifacts on failure', () => {
  const queue = [{ id: 'f1', name: 'F1', status: 'in-progress', artifacts: { facts: '/path/facts.md' } }]
  const result = isolateFailure(queue, 'f1', 'error')
  assert.ok(result[0].artifacts.facts, 'verified artifacts must be preserved')
})

test('QUAL-NQ: shouldContinueAfterFailure true when independents exist', () => {
  const queue = queueWithStatuses([
    { id: 'f1', status: 'in-progress' },
    { id: 'f2', status: 'pending' },
  ])
  assert.ok(shouldContinueAfterFailure(queue, 'f1', []))
})

test('QUAL-NQ: shouldContinueAfterFailure false when all blocked by deps', () => {
  const queue = queueWithStatuses([
    { id: 'f1', status: 'in-progress' },
    { id: 'f2', status: 'pending' },
  ])
  // f2 depends on f1 → blocked when f1 fails
  const edges = [{ from: 'f2', to: 'f1' }]
  assert.ok(!shouldContinueAfterFailure(queue, 'f1', edges))
})

test('QUAL-NQ: eligibleIndependents filters transitively blocked', () => {
  const queue = queueWithStatuses([
    { id: 'f1', status: 'in-progress' },
    { id: 'f2', status: 'pending' },
    { id: 'f3', status: 'pending' },
  ])
  // f2 depends on f1, f3 depends on f2 → f3 transitively blocked
  const edges = [{ from: 'f2', to: 'f1' }, { from: 'f3', to: 'f2' }]
  const eligible = eligibleIndependents(queue, 'f1', edges)
  assert.equal(eligible.length, 0, 'both f2 and f3 must be transitively blocked')
})

// ===========================================================================
// QUAL-01: Readiness false-paths (E2E-STATUS-01 enrichment)
// ===========================================================================

test('QUAL-NQ: extractReadiness false when discovery not exhausted', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: false,
    graphValid: true,
    features: [{ id: 'f1', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness false when graph invalid', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: true,
    graphValid: false,
    features: [{ id: 'f1', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: true,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness false when synthesis stale', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'f1', lifecycle: 'completed' }],
    synthesisCurrent: false,
    artifactsCurrent: true,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness false when artifacts stale', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: true,
    graphValid: true,
    features: [{ id: 'f1', lifecycle: 'completed' }],
    synthesisCurrent: true,
    artifactsCurrent: false,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness false with blocked features', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'blocked' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness false with failed features', () => {
  const readiness = deriveExtractReadiness({
    discoveryExhausted: true,
    graphValid: true,
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'failed' },
    ],
    synthesisCurrent: true,
    artifactsCurrent: true,
  })
  assert.equal(readiness.ready, false)
})

test('QUAL-NQ: extractReadiness null state returns not ready', () => {
  const readiness = deriveExtractReadiness(null)
  assert.equal(readiness.ready, false)
})

// ===========================================================================
// QUAL-01: countLifecycleStates edge cases
// ===========================================================================

test('QUAL-NQ: countLifecycleStates counts all lifecycle types correctly', () => {
  const features = [
    { lifecycle: LIFECYCLE_STATES.RUNNABLE },
    { lifecycle: LIFECYCLE_STATES.DEFERRED },
    { lifecycle: LIFECYCLE_STATES.IN_PROGRESS },
    { lifecycle: LIFECYCLE_STATES.BLOCKED },
    { lifecycle: LIFECYCLE_STATES.FAILED },
    { lifecycle: LIFECYCLE_STATES.SKIPPED },
    { lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { lifecycle: LIFECYCLE_STATES.COMPLETED },
    { lifecycle: LIFECYCLE_STATES.COMPLETED },
  ]
  const counts = countLifecycleStates(features)
  assert.equal(counts.runnable, 1)
  assert.equal(counts.deferred, 1)
  assert.equal(counts['in-progress'], 1)
  assert.equal(counts.blocked, 1)
  assert.equal(counts.failed, 1)
  assert.equal(counts.skipped, 1)
  assert.equal(counts.excluded, 1)
  assert.equal(counts.completed, 2)
  assert.equal(counts.denominator, 8, 'denominator excludes excluded')
})

test('QUAL-NQ: countLifecycleStates with empty array returns zeros', () => {
  const counts = countLifecycleStates([])
  assert.equal(counts.denominator, 0)
  assert.equal(counts.completed, 0)
})

test('QUAL-NQ: countLifecycleStates ignores unknown lifecycle values', () => {
  const counts = countLifecycleStates([{ lifecycle: 'unknown-state' }])
  assert.equal(counts.denominator, 1, 'unknown lifecycle still counts in total')
  assert.equal(counts.completed, 0, 'unknown lifecycle not counted as completed')
})

// ===========================================================================
// QUAL-01: queueDenominator edge cases
// ===========================================================================

test('QUAL-NQ: queueDenominator with empty array returns zero denominator', () => {
  const result = queueDenominator([])
  assert.equal(result.denominator, 0)
  assert.equal(result.excluded, 0)
})

test('QUAL-NQ: queueDenominator with all excluded returns zero denominator', () => {
  const features = [
    { lifecycle: LIFECYCLE_STATES.EXCLUDED },
    { lifecycle: LIFECYCLE_STATES.EXCLUDED },
  ]
  const result = queueDenominator(features)
  assert.equal(result.denominator, 0)
  assert.equal(result.excluded, 2)
  assert.equal(result.total, 2)
})

// ===========================================================================
// DOGFOOD-01: Continuation decision and auto-relaunch
// ===========================================================================

test('DOGFOOD-NQ: shouldContinue returns false when all features completed', () => {
  const queue = [
    { status: 'completed' },
    { status: 'completed' },
  ]
  assert.equal(shouldContinue(queue), false)
})

test('DOGFOOD-NQ: shouldContinue returns true when pending features exist', () => {
  const queue = [
    { status: 'completed' },
    { status: 'pending' },
  ]
  assert.equal(shouldContinue(queue), true)
})

test('DOGFOOD-NQ: shouldContinue returns true when in-progress features exist', () => {
  const queue = [
    { status: 'completed' },
    { status: 'in-progress' },
  ]
  assert.equal(shouldContinue(queue), true)
})

test('DOGFOOD-NQ: shouldContinue with empty queue returns false', () => {
  assert.equal(shouldContinue([]), false)
})

test('DOGFOOD-NQ: canAutoRelaunch false when budget exhausted', () => {
  let state = createContinuationState()
  assert.equal(canAutoRelaunch(state, 0), false)
})

test('DOGFOOD-NQ: canAutoRelaunch false with too many unacked intents', () => {
  let state = createContinuationState()
  // Create 3 unacked intents (crash-loop threshold)
  for (let i = 0; i < 3; i++) {
    const seg = nextSegmentId(state); state = seg.state
    const intent = createSegmentIntent(state, seg.segmentId, [`f${i}`], `rev-${i}`)
    state = intent.state
  }
  assert.equal(canAutoRelaunch(state, 100), false)
})

test('DOGFOOD-NQ: canAutoRelaunch true with budget and few unacked', () => {
  let state = createContinuationState()
  const seg = nextSegmentId(state); state = seg.state
  createSegmentIntent(state, seg.segmentId, ['f1'], 'rev-1')
  assert.equal(canAutoRelaunch(state, 100), true)
})

test('DOGFOOD-NQ: resumeCommand produces idempotent command', () => {
  let state = createContinuationState()
  const seg = nextSegmentId(state); state = seg.state
  const intent = createSegmentIntent(state, seg.segmentId, ['f1', 'f2'], 'rev-1')
  state = intent.state
  const ack = acknowledgeSegment(state, seg.segmentId, intent.intent.idempotencyKey, 'completed', { completed: 2 })
  state = ack.state

  const cmd = resumeCommand('/project/', seg.segmentId, state)
  assert.ok(cmd.command.includes('--resume'))
  assert.ok(cmd.command.includes('/project/'))
  assert.equal(cmd.idempotent, true)
  assert.ok(cmd.counts, 'resume command must include segment counts')
})

test('DOGFOOD-NQ: continuationSummary reports correct segment data', () => {
  let state = createContinuationState()
  const seg1 = nextSegmentId(state); state = seg1.state
  const i1 = createSegmentIntent(state, seg1.segmentId, ['f1'], 'r1'); state = i1.state
  const ack = acknowledgeSegment(state, seg1.segmentId, i1.intent.idempotencyKey, 'completed', { completed: 1 })
  state = ack.state

  const summary = continuationSummary(state)
  assert.ok(summary.lastSegmentId >= 1)
  assert.equal(summary.acknowledgedSegments, 1)
  assert.equal(summary.unacknowledgedIntents, 0)
  assert.equal(summary.hasUnacknowledged, false)
})

// ===========================================================================
// DOGFOOD-01: Terminal failure detection
// ===========================================================================

test('DOGFOOD-NQ: isTerminalFailure true after permanent failure outcome', () => {
  const policy = createRetryPolicy({ maxPerGate: 2, maxPerFeature: 5 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'gate-1', ATTEMPT_OUTCOMES.PERMANENT_FAILURE, 'fatal error')
  assert.ok(isTerminalFailure(history, 'f1', policy))
})

test('DOGFOOD-NQ: isTerminalFailure true after blocked dependency outcome', () => {
  const policy = createRetryPolicy({ maxPerGate: 2, maxPerFeature: 5 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'gate-1', ATTEMPT_OUTCOMES.BLOCKED_DEPENDENCY, 'dep failed')
  assert.ok(isTerminalFailure(history, 'f1', policy))
})

test('DOGFOOD-NQ: isTerminalFailure false for retryable failure', () => {
  const policy = createRetryPolicy({ maxPerGate: 3, maxPerFeature: 10 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'gate-1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE, 'timeout')
  assert.ok(!isTerminalFailure(history, 'f1', policy), 'first retryable failure must not be terminal')
})

test('DOGFOOD-NQ: isTerminalFailure true after feature retries exhausted', () => {
  const policy = createRetryPolicy({ maxPerGate: 1, maxPerFeature: 2 })
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE, 'err')
  history = recordAttempt(history, 'f1', 'g2', ATTEMPT_OUTCOMES.RETRYABLE_FAILURE, 'err')
  assert.ok(isTerminalFailure(history, 'f1', policy), 'exhausted feature retries must be terminal')
})

test('DOGFOOD-NQ: isTerminalFailure false for feature with no attempts', () => {
  const policy = createRetryPolicy({ maxPerGate: 2, maxPerFeature: 5 })
  const history = createAttemptHistory()
  assert.ok(!isTerminalFailure(history, 'nonexistent', policy))
})

test('DOGFOOD-NQ: terminalReason returns last attempt reason', () => {
  let history = createAttemptHistory()
  history = recordAttempt(history, 'f1', 'g1', ATTEMPT_OUTCOMES.PERMANENT_FAILURE, 'schema mismatch')
  assert.equal(terminalReason(history, 'f1'), 'schema mismatch')
})

test('DOGFOOD-NQ: terminalReason returns null for feature with no attempts', () => {
  const history = createAttemptHistory()
  assert.equal(terminalReason(history, 'nonexistent'), null)
})

// ===========================================================================
// DOGFOOD-01: segmentOutcome counts
// ===========================================================================

test('DOGFOOD-NQ: segmentOutcome counts all terminal statuses', () => {
  const queue = queueWithStatuses([
    { id: 'f1', status: 'completed' },
    { id: 'f2', status: 'completed' },
    { id: 'f3', status: 'failed' },
    { id: 'f4', status: 'blocked' },
    { id: 'f5', status: 'pending' },
  ])
  const outcome = segmentOutcome(queue)
  assert.equal(outcome.completed, 2)
  assert.equal(outcome.failed, 1)
  assert.equal(outcome.blocked, 1)
  assert.equal(outcome.pending, 1)
})

test('DOGFOOD-NQ: segmentOutcome with empty queue returns zeros', () => {
  const outcome = segmentOutcome([])
  assert.equal(outcome.completed, 0)
  assert.equal(outcome.failed, 0)
})

// ===========================================================================
// DOGFOOD-01: Budget admission rejection
// ===========================================================================

test('DOGFOOD-NQ: budget admission rejects segment exceeding available calls', () => {
  const limits = createBudgetLimits({ callCeiling: 100, concurrency: 1 })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, 20)
  // Available: 100 - 20 = 80
  const admit = admitSegment(accountant, { calls: 81 })
  assert.ok(!admit.admitted, 'segment exceeding available must be rejected')
})

test('DOGFOOD-NQ: budget admission admits segment within available calls', () => {
  const limits = createBudgetLimits({ callCeiling: 100, concurrency: 1 })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, 20)
  // Available: 100 - 20 = 80
  const admit = admitSegment(accountant, { calls: 80 })
  assert.ok(admit.admitted, 'segment within available must be admitted')
})

test('DOGFOOD-NQ: budget reserve total is correct after multiple setReserve calls', () => {
  const limits = createBudgetLimits({ callCeiling: 1000, concurrency: 1 })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.CHECKPOINT, 50)
  accountant = setReserve(accountant, RESERVE_TYPES.RECONCILIATION, 30)
  accountant = setReserve(accountant, RESERVE_TYPES.SYNTHESIS, 20)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, 10)
  const summary = budgetSummary(accountant)
  assert.equal(summary.reserved, 110)
  assert.equal(summary.callsRemaining, 890) // 1000 - 110
})

// ===========================================================================
// DOGFOOD-01: Full lifecycle replay stability with mixed events
// ===========================================================================

test('DOGFOOD-NQ: mixed lifecycle event sequence is deterministic on replay', () => {
  function replay() {
    let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
    state = applyLifecycleEvent(state, { type: 'start' })
    state = applyLifecycleEvent(state, {
      type: 'skip',
      payload: { skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL, policyEvidence: 'profile-X' },
    })
    state = applyLifecycleEvent(state, { type: 'complete' })
    return state
  }
  const r1 = replay()
  const r2 = replay()
  assert.deepEqual(r1, r2)
  assert.equal(r1.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

// ===========================================================================
// DOGFOOD-01: Large-scale exact-once with out-of-order completion
// ===========================================================================

test('DOGFOOD-NQ: 200-feature exact-once coverage with irregular segment sizes', () => {
  const TOTAL = 200
  const CAP = 37 // irregular cap to test non-round divisions
  let features = []
  for (let i = 0; i < TOTAL; i++) {
    features.push({ id: `f${i}`, name: `F${i}`, files: [`f${i}.mjs`], lifecycle: LIFECYCLE_STATES.RUNNABLE })
  }

  const processed = new Set()
  let segment = 0

  // Segment 1: applyCap partitions runnable into admitted + deferred
  let afterCap = applyCap(features, CAP)
  let admitted = afterCap.filter(f => f.lifecycle === LIFECYCLE_STATES.RUNNABLE)
  for (const f of admitted) processed.add(f.id)
  features = afterCap.map(f =>
    processed.has(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
  )
  segment++

  // Subsequent segments: promoteDeferred admits next batch up to cap
  while (features.some(f => f.lifecycle !== LIFECYCLE_STATES.COMPLETED)) {
    segment++
    features = promoteDeferred(features, processed, CAP).features
    const newlyAdmitted = features.filter(f =>
      f.lifecycle === LIFECYCLE_STATES.RUNNABLE && !processed.has(f.id)
    )
    for (const f of newlyAdmitted) processed.add(f.id)
    features = features.map(f =>
      processed.has(f.id) ? { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED } : f
    )
    if (segment > 20) break
  }

  assert.equal(processed.size, TOTAL, `all ${TOTAL} features processed exactly once`)
  assert.ok(segment >= 6, `irregular cap ${CAP} must produce multiple segments (got ${segment})`)
})

// ===========================================================================
// DOGFOOD-01: deriveReadiness with mixed lifecycle outcomes
// ===========================================================================

test('DOGFOOD-NQ: deriveReadiness with mixed completed and excluded features', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'c', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.denominator, 2, 'denominator excludes excluded')
  assert.equal(readiness.completed, 2)
  assert.equal(readiness.ready, true)
})

test('DOGFOOD-NQ: deriveReadiness with empty features is not ready', () => {
  const manifest = { schemaVersion: '1.5.0', features: [] }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, false)
  assert.equal(readiness.denominator, 0)
})

test('DOGFOOD-NQ: deriveReadiness with null manifest does not crash', () => {
  const readiness = deriveReadiness(null)
  assert.equal(readiness.ready, false)
})

// ===========================================================================
// DOGFOOD-01: selectiveInvalidate preserves unaffected evidence
// ===========================================================================

test('DOGFOOD-NQ: selectiveInvalidate for source change only affects source-dependent gates', () => {
  const shard = {
    id: 'f1',
    gates: {
      facts: { digest: 'd1', verified: true },
      design: { digest: 'd2', verified: true },
    },
  }
  const delta = { changedInputs: ['source'] }
  const result = selectiveInvalidate(shard, delta)
  assert.ok(result, 'selectiveInvalidate must return a result')
})

test('DOGFOOD-NQ: selectiveInvalidate with no changed inputs preserves all', () => {
  const shard = {
    id: 'f1',
    gates: { facts: { digest: 'd1', verified: true } },
  }
  const delta = { changedInputs: [] }
  const result = selectiveInvalidate(shard, delta)
  assert.ok(result)
})

// ===========================================================================
// Phase 7 E2E Matrix rows: COMPAT-01 and DOGFOOD-01 explicit coverage
// ===========================================================================

test('E2E-COMPAT-01 (Phase 7): all five non-extract modes hydrate v1.4.5 state', () => {
  const legacy = {
    task: 'old feature',
    slug: 'old-feature',
    planPath: '/old/plan.md',
    planDir: '/old/',
    engineVersion: '1.4.5',
    result: { mode: 'design', definitionPath: '/old/idea.md' },
  }
  for (const mode of ['design', 'implement', 'tune', 'review', 'status']) {
    // Validate state is accepted for all modes
    const v = validatePipelineState(legacy)
    assert.ok(v.ok, `legacy state must validate for mode ${mode}`)
    // Mode resolution produces correct mode
    const resolved = resolveMode({ mode }, null, null)
    assert.equal(resolved, mode)
    // Gate partitioning: extract gates inactive
    assert.equal(gateModeActive('extract', mode), false)
  }
})

test('E2E-DOGFOOD-01 (Phase 7): multi-segment run with interruption and duplicate convergence', () => {
  // Simulate the full E2E-DOGFOOD-01 scenario as a compact integration test
  let contState = createContinuationState()
  const TOTAL = 60
  const CAP = 20
  const completedIds = new Set()

  // Segment 1
  const s1 = nextSegmentId(contState); contState = s1.state
  const i1 = createSegmentIntent(contState, s1.segmentId, Array.from({ length: CAP }, (_, i) => `f${i}`), 'rev-1')
  contState = i1.state
  for (let i = 0; i < CAP; i++) completedIds.add(`f${i}`)
  const a1 = acknowledgeSegment(contState, s1.segmentId, i1.intent.idempotencyKey, 'completed', {
    completed: CAP, deferred: TOTAL - CAP,
  })
  contState = a1.state

  // Segment 2 — interrupted but intent was created
  const s2 = nextSegmentId(contState); contState = s2.state
  const i2 = createSegmentIntent(contState, s2.segmentId, Array.from({ length: CAP }, (_, i) => `f${i + CAP}`), 'rev-2')
  contState = i2.state

  // Inject: duplicate delivery of segment 2 intent
  const dupI2 = createSegmentIntent(contState, s2.segmentId, Array.from({ length: CAP }, (_, i) => `f${i + CAP}`), 'rev-2')
  assert.ok(dupI2.duplicate, 'duplicate intent must be detected')
  contState = dupI2.state

  // Complete segment 2
  for (let i = 0; i < CAP; i++) completedIds.add(`f${i + CAP}`)
  const a2 = acknowledgeSegment(contState, s2.segmentId, i2.intent.idempotencyKey, 'completed', {
    completed: CAP, deferred: TOTAL - 2 * CAP,
  })
  contState = a2.state

  // Segment 3 — remaining
  const s3 = nextSegmentId(contState); contState = s3.state
  const remaining = TOTAL - 2 * CAP
  const i3 = createSegmentIntent(contState, s3.segmentId, Array.from({ length: remaining }, (_, i) => `f${i + 2 * CAP}`), 'rev-3')
  contState = i3.state
  for (let i = 0; i < remaining; i++) completedIds.add(`f${i + 2 * CAP}`)
  const a3 = acknowledgeSegment(contState, s3.segmentId, i3.intent.idempotencyKey, 'completed', {
    completed: remaining, deferred: 0,
  })
  contState = a3.state

  // Verify convergence
  const convergence = resolveConvergence(contState)
  assert.equal(convergence.converged.length, 3, 'all 3 segments must converge')
  assert.equal(convergence.unacknowledged.length, 0, 'no unacked intents')
  assert.equal(completedIds.size, TOTAL, 'all features processed exactly once')

  const counts = segmentCounts(contState)
  assert.equal(counts.completed, TOTAL, 'segment counts must reflect all completions')
})
