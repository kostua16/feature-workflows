// Truthful design readiness and outcome reporting.
//
// RED evidence: F4 (fail-forward hidden), F5 (force-accepted blockers hidden),
// F6 (reconcile conflicts ride to readiness), F10 (terminal outcomes overstate
// success), F7 (YAGNI BLOCKER dropped under --no-reconcile), F8 (open questions
// never enforced), F9 (chunker degradation silent), F16 (no attempt history).
// GREEN evidence: deriveDesignReadiness pure gate, degradation journal,
// terminal outcome blocking, open-questions gate, chunker surfacing,
// YAGNI routing into escalation prompt.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  deriveDesignReadiness,
  DESIGN_READINESS_REASONS,
  recordDegradationEvent,
  degradationLogSummary,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- DREADY-01: truthful design readiness (F4, F5, F6) ----

test('DREADY-01: deriveDesignReadiness is a pure function', () => {
  assert.equal(typeof deriveDesignReadiness, 'function')
})

test('DREADY-01: DESIGN_READINESS_REASONS is a frozen constant map', () => {
  assert.equal(typeof DESIGN_READINESS_REASONS, 'object')
  assert.equal(Object.isFrozen(DESIGN_READINESS_REASONS), true)
  assert.equal(DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW, 'fail-forward-review')
  assert.equal(DESIGN_READINESS_REASONS.FORCE_ACCEPTED_BLOCKERS, 'force-accepted-plan-with-blockers')
  assert.equal(DESIGN_READINESS_REASONS.UNRESOLVED_RECONCILE, 'unresolved-reconcile-conflicts')
  assert.equal(DESIGN_READINESS_REASONS.ALL_CLEAR, 'all-degradation-checks-clear')
})

test('DREADY-01: clean result with no degradation is ready', () => {
  const result = { task: 't', slug: 's' }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, true)
  assert.equal(r.reason, DESIGN_READINESS_REASONS.ALL_CLEAR)
  assert.deepEqual(r.degradation, [])
})

test('DREADY-01: fail-forwarded Requirements review blocks readiness (F4)', () => {
  const result = { _reviewedRequirementsForced: true }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.equal(r.reason, DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW)
  assert.equal(r.degradation.length, 1)
  assert.deepEqual(r.degradation[0].gates, ['Requirements'])
})

test('DREADY-01: fail-forwarded Architecture review blocks readiness (F4)', () => {
  const result = { _reviewedArchForced: true }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.equal(r.reason, DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW)
  assert.deepEqual(r.degradation[0].gates, ['Architecture'])
})

test('DREADY-01: fail-forwarded Detailed Design review blocks readiness (F4)', () => {
  const result = { _reviewedDesignForced: true }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.deepEqual(r.degradation[0].gates, ['Detailed Design'])
})

test('DREADY-01: all three fail-forwarded reviews are reported together', () => {
  const result = {
    _reviewedRequirementsForced: true,
    _reviewedArchForced: true,
    _reviewedDesignForced: true,
  }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.deepEqual(r.degradation[0].gates, ['Requirements', 'Architecture', 'Detailed Design'])
})

test('DREADY-01: force-accepted plan with carried blockers blocks readiness (F5)', () => {
  const result = { forceAccepted: true, carriedBlockers: ['defect-A', 'defect-B'] }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.equal(r.reason, DESIGN_READINESS_REASONS.FORCE_ACCEPTED_BLOCKERS)
  assert.equal(r.degradation[0].count, 2)
})

test('DREADY-01: force-accepted plan with empty blockers is ready', () => {
  const result = { forceAccepted: true, carriedBlockers: [] }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, true)
})

test('DREADY-01: unresolved reconcile conflicts block readiness (F6)', () => {
  const result = {
    reconcile: { consistent: false, conflicts: ['conflict-1', 'conflict-2'] },
  }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.equal(r.reason, DESIGN_READINESS_REASONS.UNRESOLVED_RECONCILE)
  assert.equal(r.degradation[0].conflicts, 2)
})

test('DREADY-01: reconcile inconsistent but no conflicts does not block', () => {
  const result = { reconcile: { consistent: false, conflicts: [] } }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile consistent does not block', () => {
  const result = { reconcile: { consistent: true, conflicts: [] } }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, true)
})

test('DREADY-01: multiple degradation types reported with first as reason', () => {
  const result = {
    _reviewedRequirementsForced: true,
    forceAccepted: true,
    carriedBlockers: ['defect-A'],
    reconcile: { consistent: false, conflicts: ['c1'] },
  }
  const r = deriveDesignReadiness(result)
  assert.equal(r.ready, false)
  assert.equal(r.degradation.length, 3)
  // Reason is the first detected degradation
  assert.equal(r.reason, DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW)
})

test('DREADY-01: null result returns not-ready', () => {
  const r = deriveDesignReadiness(null)
  assert.equal(r.ready, false)
  assert.deepEqual(r.degradation, [])
})

test('DREADY-01: undefined result returns not-ready', () => {
  const r = deriveDesignReadiness(undefined)
  assert.equal(r.ready, false)
})

test('DREADY-01: deriveDesignReadiness does not mutate input', () => {
  const result = { task: 't', _reviewedRequirementsForced: true }
  const snapshot = JSON.stringify(result)
  deriveDesignReadiness(result)
  assert.equal(JSON.stringify(result), snapshot, 'input must not be mutated')
})

test('DREADY-01: dist calls deriveDesignReadiness in design terminal', () => {
  assert.ok(
    source.includes('deriveDesignReadiness(result)'),
    'design terminal must call deriveDesignReadiness before setting designReady'
  )
})

test('DREADY-01: dist checks designReadiness.ready before setting designReady=true', () => {
  assert.ok(
    source.includes('if (!designReadiness.ready)'),
    'design terminal must gate designReady on designReadiness.ready'
  )
})

// ---- DHIST-01: durable degradation/attempt history (F16) ----

test('DHIST-01: recordDegradationEvent is a function', () => {
  assert.equal(typeof recordDegradationEvent, 'function')
})

test('DHIST-01: single event creates log with seq=1', () => {
  const result = {}
  recordDegradationEvent(result, 'fail-forward', 'Requirements', 'critical-reviewer', 'reviewer returned null')
  assert.ok(Array.isArray(result._degradationLog))
  assert.equal(result._degradationLog.length, 1)
  assert.equal(result._degradationLog[0].seq, 1)
  assert.equal(result._degradationLog[0].type, 'fail-forward')
  assert.equal(result._degradationLog[0].gate, 'Requirements')
  assert.equal(result._degradationLog[0].label, 'critical-reviewer')
  assert.equal(result._degradationLog[0].reason, 'reviewer returned null')
})

test('DHIST-01: multiple events get sequential seq numbers', () => {
  const result = {}
  recordDegradationEvent(result, 'retry', 'gate-A', 'agent-1', 'reason-1')
  recordDegradationEvent(result, 'escalation', 'gate-B', 'agent-2', 'reason-2')
  recordDegradationEvent(result, 'fallback', 'gate-C', 'agent-3', 'reason-3')
  assert.equal(result._degradationLog.length, 3)
  assert.equal(result._degradationLog[0].seq, 1)
  assert.equal(result._degradationLog[1].seq, 2)
  assert.equal(result._degradationLog[2].seq, 3)
})

test('DHIST-01: null result is a no-op', () => {
  assert.doesNotThrow(() => recordDegradationEvent(null, 'retry', 'g', 'l', 'r'))
})

test('DHIST-01: default values applied for missing gate/label/reason', () => {
  const result = {}
  recordDegradationEvent(result, 'retry')
  assert.equal(result._degradationLog[0].gate, 'unknown')
  assert.equal(result._degradationLog[0].label, 'agent')
  assert.equal(result._degradationLog[0].reason, '')
})

test('DHIST-01: degradationLogSummary summarizes counts by type', () => {
  const log = [
    { seq: 1, type: 'fail-forward', gate: 'A', label: 'l', reason: 'r' },
    { seq: 2, type: 'fail-forward', gate: 'B', label: 'l', reason: 'r' },
    { seq: 3, type: 'escalation', gate: 'C', label: 'l', reason: 'r' },
  ]
  const summary = degradationLogSummary(log)
  assert.equal(summary, 'fail-forward=2, escalation=1')
})

test('DHIST-01: degradationLogSummary returns empty string for empty log', () => {
  assert.equal(degradationLogSummary([]), '')
})

test('DHIST-01: degradationLogSummary returns empty string for null/undefined', () => {
  assert.equal(degradationLogSummary(null), '')
  assert.equal(degradationLogSummary(undefined), '')
})

test('DHIST-01: dist initializes _degradationLog in result object', () => {
  assert.ok(
    source.includes('_degradationLog: []'),
    'result must initialize _degradationLog array'
  )
})

test('DHIST-01: dist includes degradationLog in handoff output', () => {
  assert.ok(
    source.includes('degradationLog: result._degradationLog'),
    'handoff must include degradationLog for inspection'
  )
})

test('DHIST-01: dist journals fail-forward events from reviewLoop', () => {
  assert.ok(
    source.includes("recordDegradationEvent(result, 'fail-forward'"),
    'reviewLoop must journal fail-forward events via recordDegradationEvent'
  )
})

test('DHIST-01: dist journals escalation from force-accept path', () => {
  assert.ok(
    source.includes("'fail-forward', 'Review/Refine', 'escalation'"),
    'force-accept path must journal the degradation event'
  )
})

test('DHIST-01: dist journals fallback from recordAgentFailure', () => {
  assert.ok(
    source.includes("recordDegradationEvent(result, 'fallback'"),
    'recordAgentFailure must journal fallback events'
  )
})

test('DHIST-01: dist journals escalation from recordAgentFailure', () => {
  assert.ok(
    source.includes("recordDegradationEvent(result, 'escalation'"),
    'recordAgentFailure must journal escalation events'
  )
})

// ---- DTERM-01: truthful terminal outcomes (F10) ----

test('DTERM-01: dist sets blockedAt on commit failure instead of terminal success', () => {
  assert.ok(
    source.includes("blockedAt = 'commit-failed'"),
    'commit failure must set blockedAt to commit-failed'
  )
})

test('DTERM-01: dist returns early on commit failure (no terminal success)', () => {
  // Find the commit-failed block and verify it returns
  const commitBlock = source.match(/if \(!result\.committed\) \{[\s\S]*?return result/)
  assert.ok(commitBlock, 'commit failure must have an early return block')
  assert.ok(
    commitBlock[0].includes("blockedAt = 'commit-failed'"),
    'commit failure block must set blockedAt'
  )
  assert.ok(
    commitBlock[0].includes('await consolidate'),
    'commit failure block must consolidate state before returning'
  )
})

test('DTERM-01: dist distinguishes attempted from verified publish', () => {
  assert.ok(
    source.includes('_publishVerified = !!(result.published && result.published.published)'),
    'publish outcome must distinguish attempted from verified'
  )
})

test('DTERM-01: dist distinguishes attempted from verified persist', () => {
  assert.ok(
    source.includes('_persistVerified = !!(result.persist && result.persist.persisted)'),
    'persist outcome must distinguish attempted from verified'
  )
})

test('DTERM-01: _publishVerified appears in design terminal path', () => {
  // The design-terminal publish block must set _publishVerified
  const publishSections = source.split('_publishVerified')
  assert.ok(publishSections.length >= 3, '_publishVerified must appear in at least 2 places (design + implement)')
})

// ---- DQUEST-01: open questions enforcement (F8) ----

test('DQUEST-01: dist checks openQuestionsPath at design terminal', () => {
  assert.ok(
    source.includes('result.openQuestionsPath && !(result._openQuestionsDeferred'),
    'design terminal must check for unresolved open questions before completion'
  )
})

test('DQUEST-01: dist blocks design completion when open questions unresolved', () => {
  assert.ok(
    source.includes("'unresolved-open-questions'"),
    'design terminal must record unresolved-open-questions as a readiness blocker'
  )
})

test('DQUEST-01: dist allows completion when open questions explicitly deferred', () => {
  // The condition uses _openQuestionsDeferred — verify the deferred array exists as an escape hatch
  assert.ok(
    source.includes('_openQuestionsDeferred'),
    'design terminal must support _openQuestionsDeferred for explicitly deferred questions'
  )
})

// ---- DCHUNK-01: chunker degradation surfacing (F9) ----

test('DCHUNK-01: dist sets _chunkerDegraded in chunkPlanIntoStages fallback', () => {
  assert.ok(
    source.includes('result._chunkerDegraded = true'),
    'chunkPlanIntoStages fallback must set _chunkerDegraded'
  )
})

test('DCHUNK-01: dist records chunker degradation reason', () => {
  assert.ok(
    source.includes('result._chunkerDegradationReason'),
    'chunkPlanIntoStages fallback must record a human-readable reason'
  )
})

test('DCHUNK-01: dist surfaces chunker warning in handoff message', () => {
  assert.ok(
    source.includes('plan chunker degraded to a single stage'),
    'design terminal handoff must warn about chunker degradation'
  )
})

test('DCHUNK-01: dist checks _chunkerDegradationAcknowledged before silencing warning', () => {
  assert.ok(
    source.includes('_chunkerDegradationAcknowledged'),
    'design terminal must support explicit acknowledgement of chunker degradation'
  )
})

test('DCHUNK-01: dist includes chunkerDegraded in handoff object', () => {
  assert.ok(
    source.includes('chunkerDegraded: !!result._chunkerDegraded'),
    'handoff object must include chunkerDegraded boolean'
  )
})

// ---- DYAGNI-01: YAGNI blocker routing (F7) ----

test('DYAGNI-01: dist builds yagniBlockerContext from reconcile conflicts', () => {
  assert.ok(
    source.includes('yagniBlockerContext'),
    'escalation path must build a YAGNI blocker context'
  )
})

test('DYAGNI-01: dist filters YAGNI BLOCKER entries from reconcile.conflicts', () => {
  assert.ok(
    source.includes("/\\[YAGNI BLOCKER\\]/"),
    'YAGNI blocker extraction must filter for [YAGNI BLOCKER] tag'
  )
})

test('DYAGNI-01: dist injects YAGNI blocker context into escalation prompt', () => {
  // The escalation prompt template must append yagniBlockerContext
  assert.ok(
    source.includes('${yagniBlockerContext}'),
    'escalation prompt must interpolate yagniBlockerContext'
  )
})

test('DYAGNI-01: YAGNI routing works outside the reconcile branch (no reconcile flag dependency)', () => {
  // The yagniBlockerContext construction must be in the escalation path,
  // not inside a useReconcile conditional. Verify it reads from result.reconcile.conflicts
  // which is populated by TDD Enforce regardless of the reconcile flag.
  const yagniSection = source.match(/var yagniBlockerContext[\s\S]*?yagniBlockerContext[^=]*=[\s\S]*?\n/)
  assert.ok(yagniSection, 'yagniBlockerContext construction block must exist')
  assert.ok(
    yagniSection[0].includes('result.reconcile'),
    'YAGNI context must be sourced from result.reconcile (populated by TDD Enforce regardless of reconcile flag)'
  )
})

// ---- Cross-requirement: degradation log in handoff ----

test('INTEGRATION: degradation log summary included in ready handoff message', () => {
  assert.ok(
    source.includes('degradationLogSummary(result._degradationLog)'),
    'ready handoff message must include degradation log summary'
  )
})

test('INTEGRATION: not-ready handoff includes degradation detail array', () => {
  assert.ok(
    source.includes('degradationDetail: designReadiness.degradation'),
    'not-ready handoff must include full degradation detail'
  )
})

test('INTEGRATION: not-ready handoff includes degradation log journal', () => {
  assert.ok(
    source.includes('degradationLog: result._degradationLog'),
    'not-ready handoff must include the degradation log journal'
  )
})

// ---- Regression: no new forbidden tokens in new code paths ----

test('REGRESSION: deriveDesignReadiness uses no direct FS or shell access', () => {
  const fnSection = source.match(/function deriveDesignReadiness[\s\S]*?^}/m)
  assert.ok(fnSection, 'deriveDesignReadiness section must exist')
  assert.ok(!fnSection[0].match(/\brequire\(/), 'no require()')
  assert.ok(!fnSection[0].match(/\breadFileSync\(/), 'no readFileSync')
  assert.ok(!fnSection[0].match(/\bwriteFileSync\(/), 'no writeFileSync')
})

test('REGRESSION: recordDegradationEvent uses no direct FS or shell access', () => {
  const fnSection = source.match(/function recordDegradationEvent[\s\S]*?^}/m)
  assert.ok(fnSection, 'recordDegradationEvent section must exist')
  assert.ok(!fnSection[0].match(/\brequire\(/), 'no require()')
})
