// Phase 4 Nyquist Validation: Gap-filling tests for ORCH-01, CHECKPOINT-01.
//
// Closes validation gaps identified by the gsd-validate-phase audit:
// - CHECKPOINT-01: behavioral resume (gate-skip-on-resume), per-gate blocked
//   return values, audit gate checkpoint, artifact key mapping completeness,
//   checkpoint seq monotonicity across gates, checkpoint state survival on resume
// - ORCH-01: leaf composes no child Workflow, leaf has no readiness/scheduling
//   authority, Workflow spawn guard conditions, leaf return shape
// - E2E-LEAF-01: resume at first incomplete gate (behavioral), evidence preserved
// - E2E-LEAF-02: duplicate completion terminal, blocked/failed → resume convergence
// - E2E-SKIP-01: skip semantics in multi-feature extract manifest context
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  checkpointSlice,
  extractSlice,
  applyLifecycleEvent,
  deriveReadiness,
  LIFECYCLE_STATES,
  SKIP_REASONS,
  isTerminal,
  isIncomplete,
} = engine

const topDist = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)
const leafDist = readFileSync(
  new URL('../plugins/feature-workflows/workflows/fp-extract-slice.js', import.meta.url),
  'utf8'
)
const leafSource = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-slice.mjs', import.meta.url),
  'utf8'
)
const entrySource = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/extract-slice-entry.mjs', import.meta.url),
  'utf8'
)
const mainSource = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/main.mjs', import.meta.url),
  'utf8'
)

// Setup helper: provide sandbox globals that extractSlice needs at runtime.
function setupSandbox() {
  globalThis.phase = () => {}
  globalThis.log = () => {}
}

// =========================================================================
// CHECKPOINT-01: Behavioral resume — gate-skip-on-resume
// =========================================================================

test('CHECKPOINT-01 resume: all gates pre-completed → extractSlice returns done without agent calls', async () => {
  setupSandbox()
  let agentCalls = 0
  globalThis.agent = async () => { agentCalls++; return { ok: true } }

  const slice = { id: 'feat-r1', name: 'Resume Test', planDir: '/tmp/r1/' }
  const sliceState = {
    factsPath: '/tmp/r1/codebase-facts.md',
    useCasePath: '/tmp/r1/e2e-use-cases.md',
    designPath: '/tmp/r1/detailed-design.md',
    archPath: '/tmp/r1/architecture.md',
    requirementsPath: '/tmp/r1/requirements.md',
    auditPath: '/tmp/r1/audit.md',
    _reviewedDesign: true,
    _reviewedArch: true,
  }
  const config = {
    useE2eUsecase: true,
    useDetailedDesign: true,
    useArchDesign: true,
    useExtractReview: true,
    useExtractRequirements: true,
    useAudit: true,
  }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.equal(outcome.status, 'done')
  assert.equal(agentCalls, 0, 'agent should not be called when all gates are pre-completed')
})

test('CHECKPOINT-01 resume: facts completed → facts gate skipped, agent called for next gate', async () => {
  setupSandbox()
  const calledGates = []
  globalThis.agent = async (prompt) => {
    if (prompt.includes('code-explorer')) calledGates.push('facts')
    if (prompt.includes('e2e-usecase-extractor')) calledGates.push('e2e')
    return { ok: true }
  }

  const slice = { id: 'feat-r2', name: 'Partial Resume', planDir: '/tmp/r2/' }
  const sliceState = {
    factsPath: '/tmp/r2/codebase-facts.md',
  }
  const config = {
    useE2eUsecase: true,
    useDetailedDesign: false,
    useArchDesign: false,
    useExtractReview: false,
    useExtractRequirements: false,
    useAudit: false,
  }
  const result = { logLines: [] }
  await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.ok(!calledGates.includes('facts'), 'facts gate should be skipped (already completed)')
})

// =========================================================================
// CHECKPOINT-01: Per-gate blocked return values
// =========================================================================

test('CHECKPOINT-01 blocked: null agent response on facts gate returns blocked with gate name', async () => {
  setupSandbox()
  globalThis.agent = async () => null

  const slice = { id: 'feat-b1', name: 'Blocked Facts', planDir: '/tmp/b1/' }
  const sliceState = {}
  const config = { useE2eUsecase: false, useDetailedDesign: false, useArchDesign: false, useExtractReview: false, useExtractRequirements: false, useAudit: false }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.equal(outcome.status, 'blocked')
  assert.equal(outcome.gate, 'extract-facts')
})

test('CHECKPOINT-01 blocked: null agent response on e2e gate returns blocked with gate name', async () => {
  setupSandbox()
  globalThis.agent = async (prompt) => {
    if (prompt.includes('code-explorer')) return { factsPath: '/tmp/b2/facts.md' }
    return null
  }

  const slice = { id: 'feat-b2', name: 'Blocked E2E', planDir: '/tmp/b2/' }
  const sliceState = {}
  const config = { useE2eUsecase: true, useDetailedDesign: false, useArchDesign: false, useExtractReview: false, useExtractRequirements: false, useAudit: false }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.equal(outcome.status, 'blocked')
  assert.equal(outcome.gate, 'extract-e2e')
})

test('CHECKPOINT-01 blocked: null agent response on design gate returns blocked with gate name', async () => {
  setupSandbox()
  globalThis.agent = async (prompt) => {
    if (prompt.includes('code-explorer')) return { factsPath: '/tmp/b3/facts.md' }
    if (prompt.includes('e2e-usecase-extractor')) return { useCasePath: '/tmp/b3/e2e.md' }
    return null
  }

  const slice = { id: 'feat-b3', name: 'Blocked Design', planDir: '/tmp/b3/' }
  const sliceState = {}
  const config = { useE2eUsecase: true, useDetailedDesign: true, useArchDesign: false, useExtractReview: false, useExtractRequirements: false, useAudit: false }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.equal(outcome.status, 'blocked')
  assert.equal(outcome.gate, 'extract-design')
})

test('CHECKPOINT-01 blocked: null agent response on arch gate returns blocked with gate name', async () => {
  setupSandbox()
  globalThis.agent = async (prompt) => {
    if (prompt.includes('code-explorer')) return { factsPath: '/tmp/b4/facts.md' }
    if (prompt.includes('e2e-usecase-extractor')) return { useCasePath: '/tmp/b4/e2e.md' }
    if (prompt.includes('detailed-design-architect')) return { designPath: '/tmp/b4/design.md' }
    return null
  }

  const slice = { id: 'feat-b4', name: 'Blocked Arch', planDir: '/tmp/b4/' }
  const sliceState = {}
  const config = { useE2eUsecase: true, useDetailedDesign: true, useArchDesign: true, useExtractReview: false, useExtractRequirements: false, useAudit: false }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  assert.equal(outcome.status, 'blocked')
  assert.equal(outcome.gate, 'extract-arch')
})

// =========================================================================
// CHECKPOINT-01: Audit gate checkpoint and artifact key mapping
// =========================================================================

test('CHECKPOINT-01: audit gate checkpoint records auditPath', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const slice = { id: 'feat-a1', name: 'Audit Gate', planDir: '/tmp/a1/' }
    const sliceState = { auditPath: '/tmp/a1/audit.md' }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-audit', result)
    assert.ok(sliceState._gateCheckpoints['extract-audit'])
    assert.equal(sliceState._gateCheckpoints['extract-audit'].artifactPath, '/tmp/a1/audit.md')
    assert.equal(sliceState._gateCheckpoints['extract-audit'].acknowledged, true)
  } finally {
    globalThis.agent = origAgent
  }
})

test('CHECKPOINT-01: artifact key mapping covers all 7 material gates', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const slice = { id: 'feat-m1', name: 'All Gates', planDir: '/tmp/m1/' }
    const sliceState = {
      factsPath: '/tmp/m1/facts.md',
      useCasePath: '/tmp/m1/e2e.md',
      designPath: '/tmp/m1/design.md',
      archPath: '/tmp/m1/arch.md',
      requirementsPath: '/tmp/m1/reqs.md',
      auditPath: '/tmp/m1/audit.md',
      _reviewedDesign: true,
      _reviewedArch: true,
    }
    const result = { logLines: [] }
    const gateNames = ['extract-facts', 'extract-e2e', 'extract-design', 'extract-arch', 'extract-review', 'extract-requirements', 'extract-audit']
    for (const gate of gateNames) {
      await checkpointSlice(slice, sliceState, gate, result)
    }
    for (const gate of gateNames) {
      assert.ok(sliceState._gateCheckpoints[gate], `checkpoint for ${gate} should exist`)
      assert.equal(sliceState._gateCheckpoints[gate].acknowledged, true, `${gate} should be acknowledged`)
    }
    // Verify artifact paths for path-bearing gates
    assert.equal(sliceState._gateCheckpoints['extract-facts'].artifactPath, '/tmp/m1/facts.md')
    assert.equal(sliceState._gateCheckpoints['extract-e2e'].artifactPath, '/tmp/m1/e2e.md')
    assert.equal(sliceState._gateCheckpoints['extract-design'].artifactPath, '/tmp/m1/design.md')
    assert.equal(sliceState._gateCheckpoints['extract-arch'].artifactPath, '/tmp/m1/arch.md')
    assert.equal(sliceState._gateCheckpoints['extract-requirements'].artifactPath, '/tmp/m1/reqs.md')
    assert.equal(sliceState._gateCheckpoints['extract-audit'].artifactPath, '/tmp/m1/audit.md')
    // Review gate has no artifact path (flag-only)
    assert.equal(sliceState._gateCheckpoints['extract-review'].artifactPath, null)
  } finally {
    globalThis.agent = origAgent
  }
})

// =========================================================================
// CHECKPOINT-01: Checkpoint seq monotonicity and state survival
// =========================================================================

test('CHECKPOINT-01: seq increases monotonically across different gates', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const slice = { id: 'feat-s1', name: 'Seq Test', planDir: '/tmp/s1/' }
    const sliceState = {
      factsPath: '/tmp/s1/facts.md',
      designPath: '/tmp/s1/design.md',
      archPath: '/tmp/s1/arch.md',
    }
    const result = { logLines: [] }
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    const seq1 = sliceState._gateCheckpoints['extract-facts'].seq
    await checkpointSlice(slice, sliceState, 'extract-design', result)
    const seq2 = sliceState._gateCheckpoints['extract-design'].seq
    await checkpointSlice(slice, sliceState, 'extract-arch', result)
    const seq3 = sliceState._gateCheckpoints['extract-arch'].seq
    assert.ok(seq2 > seq1, 'design seq should be greater than facts seq')
    assert.ok(seq3 > seq2, 'arch seq should be greater than design seq')
  } finally {
    globalThis.agent = origAgent
  }
})

test('CHECKPOINT-01: _gateCheckpoints from prior run preserved on resume', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    // Simulate state from a prior interrupted run
    const priorCheckpoints = {
      'extract-facts': { seq: 1, acknowledged: true, artifactPath: '/tmp/p1/facts.md' },
      'extract-e2e': { seq: 2, acknowledged: true, artifactPath: '/tmp/p1/e2e.md' },
    }
    const slice = { id: 'feat-p1', name: 'Prior State', planDir: '/tmp/p1/' }
    const sliceState = {
      factsPath: '/tmp/p1/facts.md',
      useCasePath: '/tmp/p1/e2e.md',
      designPath: '/tmp/p1/design.md',
      _gateCheckpoints: { ...priorCheckpoints },
    }
    const result = { logLines: [] }
    // Resume by checkpointing the design gate
    await checkpointSlice(slice, sliceState, 'extract-design', result)
    // Prior checkpoints must be preserved
    assert.ok(sliceState._gateCheckpoints['extract-facts'], 'prior facts checkpoint preserved')
    assert.ok(sliceState._gateCheckpoints['extract-e2e'], 'prior e2e checkpoint preserved')
    assert.equal(sliceState._gateCheckpoints['extract-facts'].artifactPath, '/tmp/p1/facts.md')
    // New checkpoint added
    assert.ok(sliceState._gateCheckpoints['extract-design'], 'new design checkpoint added')
  } finally {
    globalThis.agent = origAgent
  }
})

test('CHECKPOINT-01: checkpointSlice initializes _gateCheckpoints on empty sliceState', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const slice = { id: 'feat-e1', name: 'Empty State', planDir: '/tmp/e1/' }
    const sliceState = { factsPath: '/tmp/e1/facts.md' }
    const result = { logLines: [] }
    assert.equal(sliceState._gateCheckpoints, undefined)
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
    assert.ok(sliceState._gateCheckpoints, '_gateCheckpoints should be initialized')
    assert.ok(sliceState._gateCheckpoints['extract-facts'])
  } finally {
    globalThis.agent = origAgent
  }
})

test('CHECKPOINT-01: checkpointSlice handles null result gracefully', async () => {
  const origAgent = globalThis.agent
  globalThis.agent = async () => ({ ok: true })
  try {
    const slice = { id: 'feat-n1', name: 'Null Result', planDir: '/tmp/n1/' }
    const sliceState = { factsPath: '/tmp/n1/facts.md' }
    await checkpointSlice(slice, sliceState, 'extract-facts', null)
    assert.ok(sliceState._gateCheckpoints['extract-facts'])
    assert.equal(sliceState._gateCheckpoints['extract-facts'].acknowledged, true)
  } finally {
    globalThis.agent = origAgent
  }
})

// =========================================================================
// ORCH-01: Leaf composes no child workflow
// =========================================================================

test('ORCH-01: leaf source (extract-slice.mjs) has no Workflow() spawn calls', () => {
  // The leaf must not compose child workflows — only the top-level orchestrator spawns
  const workflowSpawn = leafSource.match(/Workflow\s*\(\s*\{/g) || []
  assert.equal(workflowSpawn.length, 0,
    'leaf source must not contain Workflow({ spawn calls')
})

test('ORCH-01: leaf entry source has no Workflow() spawn calls', () => {
  const workflowSpawn = entrySource.match(/Workflow\s*\(\s*\{/g) || []
  assert.equal(workflowSpawn.length, 0,
    'leaf entry must not contain Workflow({ spawn calls')
})

test('ORCH-01: leaf dist has no Workflow spawn (only comment reference)', () => {
  // The leaf dist may contain a comment referencing Workflow, but no actual spawn
  const lines = leafDist.split('\n')
  const spawnLines = lines.filter((l) => /Workflow\s*\(\s*\{/.test(l) && !l.trim().startsWith('//'))
  assert.equal(spawnLines.length, 0,
    'leaf dist must not contain Workflow spawn calls outside comments')
})

test('ORCH-01: top-level dist contains Workflow spawn (contrast with leaf)', () => {
  // Use full-string match (not line-by-line) since Workflow({ and name: span lines
  assert.match(topDist, /Workflow\s*\(\s*\{\s*name:\s*[\x27"]fp-extract-slice/,
    'top-level dist must contain Workflow spawn for fp-extract-slice')
})

// =========================================================================
// ORCH-01: Leaf has no readiness/scheduling authority
// =========================================================================

test('ORCH-01: leaf source has no readiness derivation calls', () => {
  assert.doesNotMatch(leafSource, /deriveReadiness|deriveExtractReadiness/,
    'leaf must not call readiness derivation — that is top-level authority')
  assert.doesNotMatch(entrySource, /deriveReadiness|deriveExtractReadiness/,
    'leaf entry must not call readiness derivation')
})

test('ORCH-01: leaf source has no scheduling or queue calls', () => {
  assert.doesNotMatch(leafSource, /seedExtractQueue|nextPendingSlice|computeWaves|promoteDeferred|applyCap\b/,
    'leaf must not call scheduling/queue functions — that is top-level authority')
  assert.doesNotMatch(entrySource, /seedExtractQueue|nextPendingSlice|computeWaves|promoteDeferred|applyCap\b/,
    'leaf entry must not call scheduling/queue functions')
})

test('ORCH-01: leaf source extractSlice body has no synthesis calls', () => {
  // writeSystemOverview IS defined in extract-slice.mjs but only called by the
  // top-level orchestrator (main.mjs), never by extractSlice itself. Verify
  // extractSlice does not CALL writeSystemOverview (await pattern) or synthesizeProjectViews.
  const extractFn = leafSource.slice(
    leafSource.indexOf('async function extractSlice('),
    leafSource.indexOf('// writeSystemOverview')
  )
  // Match call patterns (await writeSystemOverview(...)), not comments or definitions
  const overviewCall = extractFn.match(/await\s+writeSystemOverview\s*\(/g) || []
  assert.equal(overviewCall.length, 0,
    'extractSlice must not call writeSystemOverview — that is top-level orchestrator authority')
  const synthCall = extractFn.match(/synthesizeProjectViews\s*\(/g) || []
  assert.equal(synthCall.length, 0,
    'extractSlice must not call synthesizeProjectViews — synthesis is top-level authority')
})

// =========================================================================
// ORCH-01: Workflow spawn guard conditions
// =========================================================================

test('ORCH-01: top-level Workflow spawn guard checks typeof Workflow === function', () => {
  assert.match(mainSource, /typeof Workflow === 'function'/,
    'spawn guard must check Workflow is a function')
})

test('ORCH-01: top-level Workflow spawn guard checks !single (single-slice fallback)', () => {
  assert.match(mainSource, /!single/,
    'spawn guard must check !single for single-slice fallback')
})

test('ORCH-01: top-level Workflow spawn guard checks Workflow.name !== empty string', () => {
  assert.match(mainSource, /Workflow\.name !== [\x27"]{2}/,
    'spawn guard must check Workflow.name is non-empty (real function, not inert stub)')
})

test('ORCH-01: top-level has fallback to direct extractSlice call when Workflow unavailable', () => {
  assert.match(mainSource, /outcome = await extractSlice\(\{ slice, task, result, sliceState, config/,
    'must have direct extractSlice fallback when Workflow is unavailable')
})

// =========================================================================
// ORCH-01: Leaf state initialization in main.mjs
// =========================================================================

test('ORCH-01: sliceState initialization includes lifecycle: in-progress', () => {
  assert.match(mainSource, /lifecycle:\s*[\x27"]in-progress[\x27"]/,
    "main.mjs must initialize sliceState.lifecycle to 'in-progress'")
})

test('ORCH-01: sliceState initialization includes empty _gateCheckpoints', () => {
  assert.match(mainSource, /_gateCheckpoints:\s*\{\}/,
    'main.mjs must initialize _gateCheckpoints as empty object')
})

// =========================================================================
// E2E-LEAF-01: Evidence preservation on resume
// =========================================================================

test('E2E-LEAF-01: checkpointed artifact paths survive into sliceState when blocked', async () => {
  setupSandbox()
  globalThis.agent = async (prompt) => {
    if (prompt.includes('code-explorer')) return { factsPath: '/tmp/e2e-1/facts.md' }
    return null
  }

  const slice = { id: 'feat-e2e', name: 'Evidence', planDir: '/tmp/e2e-1/' }
  const sliceState = {}
  const config = { useE2eUsecase: true, useDetailedDesign: false, useArchDesign: false, useExtractReview: false, useExtractRequirements: false, useAudit: false }
  const result = { logLines: [] }
  const outcome = await extractSlice({ slice, task: '', result, sliceState, config, retryBudget: 3, refineSubcap: 1, decisionCap: 3 })
  // Facts gate ran and set the path
  assert.equal(sliceState.factsPath, '/tmp/e2e-1/facts.md')
  // Checkpoint was recorded for facts
  assert.ok(sliceState._gateCheckpoints?.['extract-facts'], 'facts checkpoint should be recorded')
  // E2E gate was blocked (agent returned null for non-facts prompt)
  assert.equal(outcome.status, 'blocked')
  assert.equal(outcome.gate, 'extract-e2e')
})

// =========================================================================
// E2E-LEAF-02: Duplicate completion, convergence, invalid output
// =========================================================================

test('E2E-LEAF-02: duplicate complete lifecycle event throws (terminal state)', () => {
  let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  state = applyLifecycleEvent(state, { type: 'start' })
  state = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.COMPLETED)
  // Second complete from COMPLETED is illegal — terminal
  assert.throws(
    () => applyLifecycleEvent(state, { type: 'complete' }),
    /illegal transition.*completed.*complete/
  )
})

test('E2E-LEAF-02: blocked → start → complete converges to completed', () => {
  let state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  state = applyLifecycleEvent(state, { type: 'start' })
  state = applyLifecycleEvent(state, { type: 'block' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.BLOCKED)
  // Resume from blocked
  state = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
  state = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('E2E-LEAF-02: failed → start → complete converges to completed', () => {
  let state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  state = applyLifecycleEvent(state, { type: 'fail' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.FAILED)
  // Resume from failed
  state = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
  state = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(state.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('E2E-LEAF-02: completed and failed are terminal states', () => {
  assert.ok(isTerminal(LIFECYCLE_STATES.COMPLETED), 'completed is terminal')
  assert.ok(isTerminal(LIFECYCLE_STATES.FAILED), 'failed is terminal')
  assert.ok(isTerminal(LIFECYCLE_STATES.EXCLUDED), 'excluded is terminal')
  assert.ok(!isTerminal(LIFECYCLE_STATES.BLOCKED), 'blocked is NOT terminal (resumable)')
  assert.ok(!isTerminal(LIFECYCLE_STATES.IN_PROGRESS), 'in-progress is NOT terminal')
})

// =========================================================================
// E2E-SKIP-01: Skip semantics in multi-feature extract manifest context
// =========================================================================

test('E2E-SKIP-01: multi-feature manifest — feature-level skip blocks readiness', () => {
  const manifest = {
    schemaVersion: '1.0',
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'completed' },
      { id: 'f3', lifecycle: 'completed' },
      { id: 'f4', lifecycle: 'skipped', skipReason: 'feature-level' },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, false, 'feature-level skip should block readiness')
  assert.equal(readiness.denominator, 4)
  assert.equal(readiness.completed, 3)
  assert.ok(readiness.skipped > 0, 'feature-level skip should count as incomplete')
})

test('E2E-SKIP-01: multi-feature manifest — policy-disabled skip with evidence allows readiness', () => {
  const manifest = {
    schemaVersion: '1.0',
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'completed' },
      {
        id: 'f3',
        lifecycle: 'skipped',
        skipReason: 'policy-disabled-optional',
        policyEvidence: { gate: 'audit', policy: 'disabled' },
      },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, true, 'all completed or policy-skipped with evidence')
  assert.equal(readiness.denominator, 3)
  assert.equal(readiness.completed, 3)
  assert.equal(readiness.skipped, 0, 'policy-disabled skip with evidence is not incomplete')
})

test('E2E-SKIP-01: multi-feature manifest — mix of completed, blocked, and feature-skip', () => {
  const manifest = {
    schemaVersion: '1.0',
    features: [
      { id: 'f1', lifecycle: 'completed' },
      { id: 'f2', lifecycle: 'blocked' },
      { id: 'f3', lifecycle: 'skipped', skipReason: 'feature-level' },
      { id: 'f4', lifecycle: 'completed' },
    ],
  }
  const readiness = deriveReadiness(manifest)
  assert.equal(readiness.ready, false, 'blocked + skipped should block readiness')
  assert.equal(readiness.denominator, 4)
  assert.equal(readiness.completed, 2)
  assert.equal(readiness.blocked, 1)
  assert.ok(readiness.skipped > 0)
})

test('E2E-SKIP-01: isIncomplete correctly classifies each lifecycle state', () => {
  assert.ok(isIncomplete(LIFECYCLE_STATES.RUNNABLE), 'runnable is incomplete')
  assert.ok(isIncomplete(LIFECYCLE_STATES.DEFERRED), 'deferred is incomplete')
  assert.ok(isIncomplete(LIFECYCLE_STATES.IN_PROGRESS), 'in-progress is incomplete')
  assert.ok(isIncomplete(LIFECYCLE_STATES.BLOCKED), 'blocked is incomplete')
  assert.ok(!isIncomplete(LIFECYCLE_STATES.COMPLETED), 'completed is NOT incomplete')
  assert.ok(!isIncomplete(LIFECYCLE_STATES.FAILED), 'failed is NOT incomplete (terminal)')
  assert.ok(!isIncomplete(LIFECYCLE_STATES.EXCLUDED), 'excluded is NOT incomplete')
  // Skipped depends on reason
  assert.ok(isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.FEATURE_LEVEL), 'feature-level skip is incomplete')
  assert.ok(isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.REQUIRED_GATE), 'required-gate skip is incomplete')
  assert.ok(!isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.POLICY_DISABLED_OPTIONAL), 'policy-disabled skip is NOT incomplete by default')
})

// =========================================================================
// ORCH-01: Leaf return shape from extractSliceMain (source assertions)
// =========================================================================

test('ORCH-01: extractSliceMain return includes mode, sliceId, status fields', () => {
  assert.match(entrySource, /mode:\s*[\x27"]extract-slice[\x27"]/,
    'return must include mode field')
  assert.match(entrySource, /sliceId:\s*slice\.id/,
    'return must include sliceId field')
  assert.match(entrySource, /status:\s*outcome\.status/,
    'return must include status field')
})

test('ORCH-01: extractSliceMain return includes lifecycle and gateCheckpoints', () => {
  assert.match(entrySource, /lifecycle:\s*sliceState\.lifecycle/,
    'return must include lifecycle field')
  assert.match(entrySource, /gateCheckpoints:\s*sliceState\._gateCheckpoints/,
    'return must include gateCheckpoints field')
})

test('ORCH-01: extractSliceMain return includes sliceState for top-level merge', () => {
  assert.match(entrySource, /sliceState,/,
    'return must include sliceState so top-level can merge leaf results')
})

test('ORCH-01: extractSliceMain initializes lifecycle to in-progress when unset', () => {
  assert.match(entrySource, /if\s*\(!sliceState\.lifecycle\)/,
    'must check if lifecycle is already set')
  assert.match(entrySource, /sliceState\.lifecycle\s*=\s*LIFECYCLE_STATES\.IN_PROGRESS/,
    'must initialize lifecycle to IN_PROGRESS')
})

test('ORCH-01: extractSliceMain transitions to completed on done status', () => {
  assert.match(entrySource, /outcome\.status === [\x27"]done[\x27"]/,
    'must check for done status')
  assert.match(entrySource, /type:\s*[\x27"]complete[\x27"]/,
    'must transition to complete on done')
})

test('ORCH-01: extractSliceMain handles lifecycle transition failure gracefully', () => {
  assert.match(entrySource, /catch/,
    'must have try/catch around lifecycle transition')
  assert.match(entrySource, /lifecycle transition to complete failed/,
    'must log transition failure without crashing')
})

// =========================================================================
// ORCH-01: Leaf processes exactly one feature (no iteration)
// =========================================================================

test('ORCH-01: extractSlice function takes exactly one slice parameter', () => {
  assert.match(leafSource, /async function extractSlice\(\{ slice,/,
    'extractSlice must accept exactly one slice')
  assert.doesNotMatch(leafSource, /for\s*\(\s*(?:const|let)?\s*slices\b/,
    'extractSlice must not iterate over multiple slices')
  assert.doesNotMatch(leafSource, /for\s*\(\s*(?:const|let)?\s*(?:queue|features)\b/,
    'extractSlice must not iterate over queue or features')
})

test('ORCH-01: extractSliceMain validates slice has id and planDir', () => {
  assert.match(entrySource, /slice\.id/,
    'must validate slice.id exists')
  assert.match(entrySource, /slice\.planDir/,
    'must validate slice.planDir exists')
  assert.match(entrySource, /missing-slice/,
    'must return blocked missing-slice when validation fails')
})

// =========================================================================
// CHECKPOINT-01: Structural completeness in dist
// =========================================================================

test('CHECKPOINT-01: leaf dist contains checkpointSlice function', () => {
  assert.match(leafDist, /async function checkpointSlice\(/,
    'leaf dist must contain checkpointSlice function definition')
})

test('CHECKPOINT-01: leaf dist contains _gateCheckpoints tracking', () => {
  assert.match(leafDist, /_gateCheckpoints/,
    'leaf dist must reference _gateCheckpoints')
})

test('CHECKPOINT-01: top-level dist initializes _gateCheckpoints in sliceState', () => {
  assert.match(topDist, /_gateCheckpoints:\s*\{\}/,
    'top-level dist must initialize _gateCheckpoints in sliceState setup')
})
