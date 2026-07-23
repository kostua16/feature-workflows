// Phase 9 Nyquist Validation: gap-filling tests for DREADY-01, DHIST-01, DTERM-01,
// DQUEST-01, DCHUNK-01, DYAGNI-01.
//
// Retroactively audits Phase 9 for Nyquist validation gaps:
// - DREADY-01: deriveDesignReadiness edge cases (null/undefined/non-array guards,
//   type-coercion boundaries, determinism, degradation-entry shapes)
// - DHIST-01: recordDegradationEvent seq continuation, pre-existing log preservation,
//   non-object no-op, degradationLogSummary immutability and format
// - DTERM-01: dist wiring for commit-failure blocking, publish/persist verification
//   in both design and implement terminal paths
// - DQUEST-01: open-questions gate condition structure, escape hatch, blocker reason
// - DCHUNK-01: source + dist assertions for chunker degradation flagging and handoff
// - DYAGNI-01: YAGNI blocker context construction, regex filtering, reconcile independence
// - Continuous regression: no FS/shell, no Date.now/Math.random, dist exports
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  deriveDesignReadiness,
  DESIGN_READINESS_REASONS,
  recordDegradationEvent,
  degradationLogSummary,
} = engine

const dist = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)
const statusTruthSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/status-truth.mjs', import.meta.url),
  'utf8'
)
const agentCoreSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/agent-core.mjs', import.meta.url),
  'utf8'
)
const stagesIssuesSrc = readFileSync(
  new URL('../plugins/feature-workflows/workflows/src/stages-issues.mjs', import.meta.url),
  'utf8'
)

// Extract function bodies from dist for targeted source assertions.
function extractDistFunction(name) {
  const re = new RegExp(`function ${name}[\\s\\S]*?\\n\\}`)
  const m = dist.match(re)
  return m ? m[0] : ''
}

// =========================================================================
// DREADY-01: deriveDesignReadiness — edge-case and boundary gaps
// =========================================================================

test('DREADY-01: DESIGN_READINESS_REASONS has exactly 4 keys', () => {
  const keys = Object.keys(DESIGN_READINESS_REASONS)
  assert.equal(keys.length, 4)
  assert.ok(keys.includes('FAIL_FORWARD_REVIEW'))
  assert.ok(keys.includes('FORCE_ACCEPTED_BLOCKERS'))
  assert.ok(keys.includes('UNRESOLVED_RECONCILE'))
  assert.ok(keys.includes('ALL_CLEAR'))
})

test('DREADY-01: DESIGN_READINESS_REASONS values are unique', () => {
  const values = Object.values(DESIGN_READINESS_REASONS)
  assert.equal(new Set(values).size, values.length)
})

test('DREADY-01: forceAccepted true with carriedBlockers=null is ready', () => {
  const r = deriveDesignReadiness({ forceAccepted: true, carriedBlockers: null })
  assert.equal(r.ready, true)
})

test('DREADY-01: forceAccepted true with carriedBlockers=undefined is ready', () => {
  const r = deriveDesignReadiness({ forceAccepted: true })
  assert.equal(r.ready, true)
})

test('DREADY-01: forceAccepted true with carriedBlockers non-array truthy string does not crash', () => {
  // A non-array truthy carriedBlockers (e.g. string) has a .length property, so
  // the guard conservatively treats it as having blockers. This is safe — the
  // function does not crash and the degradation is recorded.
  const r = deriveDesignReadiness({ forceAccepted: true, carriedBlockers: 'some-blocker' })
  assert.equal(r.ready, false, 'non-array with .length > 0 conservatively blocks')
  assert.equal(r.degradation[0].count, 'some-blocker'.length, 'string length used as count')
})

test('DREADY-01: only carriedBlockers without forceAccepted is ready', () => {
  const r = deriveDesignReadiness({ carriedBlockers: ['defect-A'] })
  assert.equal(r.ready, true, 'blockers only count when forceAccepted is also true')
})

test('DREADY-01: reconcile=null is ready', () => {
  const r = deriveDesignReadiness({ reconcile: null })
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile=undefined is ready', () => {
  const r = deriveDesignReadiness({})
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile empty object without consistent field is ready', () => {
  const r = deriveDesignReadiness({ reconcile: {} })
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile.consistent=undefined does not block (only === false blocks)', () => {
  const r = deriveDesignReadiness({ reconcile: { consistent: undefined, conflicts: ['c1'] } })
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile.consistent=null does not block', () => {
  const r = deriveDesignReadiness({ reconcile: { consistent: null, conflicts: ['c1'] } })
  assert.equal(r.ready, true)
})

test('DREADY-01: reconcile.conflicts non-array truthy does not crash (conservatively blocks)', () => {
  // A non-array truthy conflicts value (e.g. string) has a .length property, so
  // the guard (conflicts || []).length > 0 treats it as having conflicts. This
  // is conservative/safe — something is present, so readiness is blocked.
  const r = deriveDesignReadiness({ reconcile: { consistent: false, conflicts: 'not-an-array' } })
  assert.equal(r.ready, false, 'non-array conflicts with .length > 0 conservatively blocks')
  assert.equal(r.degradation[0].conflicts, 'not-an-array'.length, 'string length is used as conflict count')
})

test('DREADY-01: reconcile.consistent=true with conflicts does not block', () => {
  const r = deriveDesignReadiness({ reconcile: { consistent: true, conflicts: ['c1', 'c2'] } })
  assert.equal(r.ready, true)
})

test('DREADY-01: non-object result (number) returns not-ready', () => {
  assert.equal(deriveDesignReadiness(42).ready, false)
})

test('DREADY-01: non-object result (string) returns not-ready', () => {
  assert.equal(deriveDesignReadiness('hello').ready, false)
})

test('DREADY-01: non-object result (boolean) returns not-ready', () => {
  assert.equal(deriveDesignReadiness(true).ready, false)
})

test('DREADY-01: degradation entries have correct shape for fail-forward', () => {
  const r = deriveDesignReadiness({ _reviewedRequirementsForced: true })
  assert.ok(r.degradation[0].type)
  assert.ok(Array.isArray(r.degradation[0].gates))
})

test('DREADY-01: degradation entries have correct shape for force-accepted', () => {
  const r = deriveDesignReadiness({ forceAccepted: true, carriedBlockers: ['b1'] })
  assert.ok(r.degradation[0].type)
  assert.equal(typeof r.degradation[0].count, 'number')
})

test('DREADY-01: degradation entries have correct shape for reconcile', () => {
  const r = deriveDesignReadiness({ reconcile: { consistent: false, conflicts: ['c1'] } })
  assert.ok(r.degradation[0].type)
  assert.equal(typeof r.degradation[0].conflicts, 'number')
})

test('DREADY-01: result is deterministic — same input produces same output', () => {
  const input = { _reviewedArchForced: true, forceAccepted: true, carriedBlockers: ['x'] }
  const r1 = deriveDesignReadiness(input)
  const r2 = deriveDesignReadiness(input)
  assert.deepEqual(r1, r2)
})

test('DREADY-01: fail-forward review flag with truthy non-boolean blocks readiness', () => {
  // A truthy value (1, 'yes') on _reviewedRequirementsForced should also block
  const r = deriveDesignReadiness({ _reviewedRequirementsForced: 1 })
  assert.equal(r.ready, false)
})

test('DREADY-01: empty object returns ready with empty degradation', () => {
  const r = deriveDesignReadiness({})
  assert.equal(r.ready, true)
  assert.deepEqual(r.degradation, [])
})

test('DREADY-01: source module exports deriveDesignReadiness and DESIGN_READINESS_REASONS', () => {
  assert.ok(statusTruthSrc.includes('function deriveDesignReadiness'))
  assert.ok(statusTruthSrc.includes('DESIGN_READINESS_REASONS'))
  assert.ok(statusTruthSrc.includes('export') && statusTruthSrc.includes('deriveDesignReadiness'))
})

test('DREADY-01: dist calls deriveDesignReadiness and checks .ready before designReady=true', () => {
  assert.ok(dist.includes('var designReadiness = deriveDesignReadiness(result)'))
  assert.ok(dist.includes('if (!designReadiness.ready)'))
  assert.ok(dist.includes('result.designReady = true'))
})

test('DREADY-01: DESIGN_READINESS_REASONS values do not overlap with READINESS_REASONS values', () => {
  // The two readiness systems must produce distinct reason strings so handoff
  // messages are unambiguous about which readiness gate blocked.
  const designValues = new Set(Object.values(DESIGN_READINESS_REASONS))
  const extractValues = new Set([
    'discovery-not-exhausted', 'graph-invalid', 'features-incomplete',
    'synthesis-stale', 'artifacts-stale', 'all-conditions-met',
  ])
  for (const dv of designValues) {
    assert.ok(!extractValues.has(dv), `design reason "${dv}" must not overlap with extract reasons`)
  }
})

// =========================================================================
// DHIST-01: recordDegradationEvent — seq continuation and edge cases
// =========================================================================

test('DHIST-01: seq continues correctly from pre-existing log', () => {
  const result = {
    _degradationLog: [
      { seq: 1, type: 'retry', gate: 'A', label: 'l', reason: 'r' },
      { seq: 2, type: 'retry', gate: 'B', label: 'l', reason: 'r' },
      { seq: 3, type: 'escalation', gate: 'C', label: 'l', reason: 'r' },
    ],
  }
  recordDegradationEvent(result, 'fallback', 'D', 'l', 'r')
  assert.equal(result._degradationLog.length, 4)
  assert.equal(result._degradationLog[3].seq, 4)
})

test('DHIST-01: pre-existing log entries are preserved when new event added', () => {
  const result = {
    _degradationLog: [
      { seq: 1, type: 'retry', gate: 'A', label: 'l', reason: 'r' },
    ],
  }
  recordDegradationEvent(result, 'escalation', 'B', 'l2', 'r2')
  assert.equal(result._degradationLog[0].gate, 'A')
  assert.equal(result._degradationLog[1].gate, 'B')
})

test('DHIST-01: non-object result (number) is no-op', () => {
  assert.doesNotThrow(() => recordDegradationEvent(42, 'retry', 'g', 'l', 'r'))
})

test('DHIST-01: non-object result (string) is no-op', () => {
  assert.doesNotThrow(() => recordDegradationEvent('hello', 'retry', 'g', 'l', 'r'))
})

test('DHIST-01: empty-string type is recorded', () => {
  const result = {}
  recordDegradationEvent(result, '', 'g', 'l', 'r')
  assert.equal(result._degradationLog[0].type, '')
})

test('DHIST-01: seq numbers are strictly monotonically increasing across calls', () => {
  const result = {}
  for (let i = 0; i < 10; i++) {
    recordDegradationEvent(result, 'retry', 'g', 'l', 'r')
  }
  for (let i = 0; i < 10; i++) {
    assert.equal(result._degradationLog[i].seq, i + 1)
  }
})

test('DHIST-01: recordDegradationEvent only creates _degradationLog (no other result fields)', () => {
  const result = { existingField: 'preserved' }
  recordDegradationEvent(result, 'retry', 'g', 'l', 'r')
  assert.equal(result.existingField, 'preserved')
  assert.deepEqual(Object.keys(result).sort(), ['_degradationLog', 'existingField'])
})

test('DHIST-01: degradationLogSummary does not mutate input log', () => {
  const log = [
    { seq: 1, type: 'retry', gate: 'A', label: 'l', reason: 'r' },
    { seq: 2, type: 'escalation', gate: 'B', label: 'l', reason: 'r' },
  ]
  const snapshot = JSON.stringify(log)
  degradationLogSummary(log)
  assert.equal(JSON.stringify(log), snapshot)
})

test('DHIST-01: degradationLogSummary formats all 4 event types', () => {
  const log = [
    { seq: 1, type: 'fail-forward', gate: 'A', label: 'l', reason: 'r' },
    { seq: 2, type: 'retry', gate: 'B', label: 'l', reason: 'r' },
    { seq: 3, type: 'escalation', gate: 'C', label: 'l', reason: 'r' },
    { seq: 4, type: 'fallback', gate: 'D', label: 'l', reason: 'r' },
  ]
  const summary = degradationLogSummary(log)
  assert.ok(summary.includes('fail-forward=1'))
  assert.ok(summary.includes('retry=1'))
  assert.ok(summary.includes('escalation=1'))
  assert.ok(summary.includes('fallback=1'))
})

test('DHIST-01: degradationLogSummary with single entry', () => {
  const summary = degradationLogSummary([
    { seq: 1, type: 'retry', gate: 'A', label: 'l', reason: 'r' },
  ])
  assert.equal(summary, 'retry=1')
})

test('DHIST-01: degradationLogSummary counts multiple entries of same type', () => {
  const log = [
    { seq: 1, type: 'retry', gate: 'A', label: 'l', reason: 'r' },
    { seq: 2, type: 'retry', gate: 'B', label: 'l', reason: 'r' },
    { seq: 3, type: 'retry', gate: 'C', label: 'l', reason: 'r' },
  ]
  assert.equal(degradationLogSummary(log), 'retry=3')
})

test('DHIST-01: dist initializes _degradationLog as empty array', () => {
  assert.ok(dist.includes('_degradationLog: []'))
})

test('DHIST-01: dist includes degradationLog in both ready and not-ready handoff', () => {
  // Ready handoff
  assert.ok(dist.includes("degradationLog: result._degradationLog || []"))
  // Count occurrences — at least 2 (ready + not-ready handoff objects)
  const matches = dist.match(/degradationLog: result\._degradationLog/g) || []
  assert.ok(matches.length >= 2, 'degradationLog must appear in at least 2 handoff objects')
})

test('DHIST-01: dist journals fail-forward from reviewLoop', () => {
  assert.ok(
    dist.includes("recordDegradationEvent(result, 'fail-forward'") ||
    dist.includes("recordDegradationEvent(result, 'fail-forward'"),
    'fail-forward events must be journaled via recordDegradationEvent'
  )
})

test('DHIST-01: dist journals fallback and escalation from recordAgentFailure', () => {
  assert.ok(dist.includes("recordDegradationEvent(result, 'fallback'"))
  assert.ok(dist.includes("recordDegradationEvent(result, 'escalation'"))
})

test('DHIST-01: dist journals retry events from retryTransientError', () => {
  assert.ok(dist.includes("recordDegradationEvent(result, 'retry'"))
})

test('DHIST-01: dist journals commit-failure degradation event', () => {
  assert.ok(
    dist.includes("recordDegradationEvent(result, 'fail-forward', 'Commit'"),
    'commit failure must journal a fail-forward degradation event'
  )
})

test('DHIST-01: source module exports recordDegradationEvent and degradationLogSummary', () => {
  assert.ok(agentCoreSrc.includes('function recordDegradationEvent'))
  assert.ok(agentCoreSrc.includes('function degradationLogSummary'))
  assert.ok(agentCoreSrc.includes('recordDegradationEvent') && agentCoreSrc.includes('degradationLogSummary'))
})

// =========================================================================
// DTERM-01: terminal outcome blocking — dist wiring and structure gaps
// =========================================================================

test('DTERM-01: blockedAt commit-failed is set before early return', () => {
  const commitBlock = dist.match(/if \(!result\.committed\) \{[\s\S]*?return result/)
  assert.ok(commitBlock, 'commit-failure block must exist')
  assert.ok(commitBlock[0].includes("blockedAt = 'commit-failed'"))
  assert.ok(commitBlock[0].includes('return result'), 'commit-failure must early-return')
})

test('DTERM-01: commit-failure block consolidates state before returning', () => {
  const commitBlock = dist.match(/if \(!result\.committed\) \{[\s\S]*?return result/)
  assert.ok(commitBlock[0].includes('await consolidate'))
})

test('DTERM-01: commit-failure block records degradation event', () => {
  const commitBlock = dist.match(/if \(!result\.committed\) \{[\s\S]*?return result/)
  assert.ok(
    commitBlock[0].includes('recordDegradationEvent'),
    'commit-failure must journal via recordDegradationEvent'
  )
})

test('DTERM-01: _publishVerified set in design terminal path', () => {
  assert.ok(
    dist.includes("result._publishVerified = !!(result.published && result.published.published)"),
    '_publishVerified must distinguish attempted from verified publish in design path'
  )
})

test('DTERM-01: _publishVerified also set in implement terminal path', () => {
  // The implement path also needs to verify publish outcome
  const matches = dist.match(/_publishVerified = !!\(result\.published && result\.published\.published\)/g) || []
  assert.ok(matches.length >= 2, '_publishVerified must appear in both design and implement paths')
})

test('DTERM-01: _persistVerified set in design terminal path', () => {
  assert.ok(
    dist.includes("result._persistVerified = !!(result.persist && result.persist.persisted)"),
    '_persistVerified must distinguish attempted from verified persist'
  )
})

test('DTERM-01: blockedAt commit-failed string appears exactly once', () => {
  // Ensure the blocker reason is unique and not accidentally reused
  const matches = dist.match(/blockedAt = 'commit-failed'/g) || []
  assert.equal(matches.length, 1, 'commit-failed should be set in exactly one location')
})

test('DTERM-01: commit gate only runs when autoCommit is true', () => {
  // The commit block must be inside an autoCommit conditional
  const commitSection = dist.indexOf("blockedAt = 'commit-failed'")
  assert.ok(commitSection > 0)
  // Walk backward to find the enclosing autoCommit check
  const beforeCommit = dist.slice(0, commitSection)
  assert.ok(
    beforeCommit.includes('autoCommit') || beforeCommit.includes('useCommit'),
    'commit gate must be guarded by an autoCommit/useCommit flag'
  )
})

// =========================================================================
// DQUEST-01: open questions enforcement — condition structure gaps
// =========================================================================

test('DQUEST-01: open-questions check condition is well-formed', () => {
  // The condition must check both openQuestionsPath AND _openQuestionsDeferred
  assert.ok(
    dist.includes('result.openQuestionsPath && !(result._openQuestionsDeferred'),
    'open-questions gate must check path existence AND deferred array'
  )
})

test('DQUEST-01: unresolved-open-questions reason is unique blocker string', () => {
  const matches = dist.match(/'unresolved-open-questions'/g) || []
  assert.ok(matches.length >= 1, 'unresolved-open-questions must be a recognized blocker reason')
  // It should appear in the degradation concat, not elsewhere as a casual string
  assert.ok(dist.includes("type: 'unresolved-open-questions'"))
})

test('DQUEST-01: open-questions gate appends to existing degradation array', () => {
  // The DQUEST check must concat onto designReadiness.degradation, not replace it
  assert.ok(
    dist.includes('designReadiness.degradation || []).concat'),
    'open-questions degradation must be appended to existing designReadiness degradation'
  )
})

test('DQUEST-01: _openQuestionsDeferred is checked as an array length', () => {
  assert.ok(
    dist.includes('(result._openQuestionsDeferred || []).length'),
    'deferred questions must be checked via array length, not truthiness'
  )
})

test('DQUEST-01: open-questions gate sets reason and degradation on designReadiness', () => {
  // Verify the full block reassigns designReadiness with ready=false
  const questBlock = dist.match(/if \(result\.openQuestionsPath[\s\S]*?\}/)
  assert.ok(questBlock)
  assert.ok(questBlock[0].includes('ready: false'))
  assert.ok(questBlock[0].includes("reason: 'unresolved-open-questions'"))
})

// =========================================================================
// DCHUNK-01: chunker degradation surfacing — source + dist gaps
// =========================================================================

test('DCHUNK-01: source stages-issues.mjs sets _chunkerDegraded in fallback', () => {
  assert.ok(
    stagesIssuesSrc.includes('result._chunkerDegraded = true'),
    'chunkPlanIntoStages fallback must set _chunkerDegraded in source'
  )
})

test('DCHUNK-01: source stages-issues.mjs records degradation reason', () => {
  assert.ok(
    stagesIssuesSrc.includes('result._chunkerDegradationReason'),
    'chunkPlanIntoStages must record a human-readable reason'
  )
})

test('DCHUNK-01: dist sets _chunkerDegraded in chunkPlanIntoStages fallback', () => {
  assert.ok(dist.includes('result._chunkerDegraded = true'))
})

test('DCHUNK-01: dist records _chunkerDegradationReason', () => {
  assert.ok(dist.includes('result._chunkerDegradationReason'))
})

test('DCHUNK-01: dist surfaces chunker warning in ready handoff message', () => {
  assert.ok(
    dist.includes('plan chunker degraded to a single stage'),
    'ready handoff must warn about chunker degradation'
  )
})

test('DCHUNK-01: dist warning mentions implement-mode consequences', () => {
  assert.ok(
    dist.includes('stage-level parallelism and resumability are lost'),
    'chunker warning must mention implement-mode consequences'
  )
})

test('DCHUNK-01: dist checks _chunkerDegradationAcknowledged before warning', () => {
  assert.ok(
    dist.includes('result._chunkerDegradationAcknowledged'),
    'design terminal must support explicit acknowledgement'
  )
})

test('DCHUNK-01: dist includes chunkerDegraded boolean in handoff object', () => {
  assert.ok(
    dist.includes('chunkerDegraded: !!result._chunkerDegraded'),
    'handoff must include chunkerDegraded as coerced boolean'
  )
})

test('DCHUNK-01: dist uses boolean coercion for chunkerDegraded in handoff', () => {
  // !! coercion ensures undefined → false, not undefined
  const match = dist.match(/chunkerDegraded:\s*!!result\._chunkerDegraded/)
  assert.ok(match, 'chunkerDegraded must use !! boolean coercion')
})

// =========================================================================
// DYAGNI-01: YAGNI blocker routing — construction and independence gaps
// =========================================================================

test('DYAGNI-01: dist declares yagniBlockerContext variable', () => {
  assert.ok(
    dist.includes('var yagniBlockerContext'),
    'escalation path must declare yagniBlockerContext'
  )
})

test('DYAGNI-01: dist initializes yagniBlockerContext as empty string', () => {
  const match = dist.match(/var yagniBlockerContext = ''/)
  assert.ok(match, 'yagniBlockerContext must start as empty string (no blockers = no context)')
})

test('DYAGNI-01: dist filters conflicts with [YAGNI BLOCKER] regex', () => {
  assert.ok(
    dist.includes('/\\[YAGNI BLOCKER\\]/'),
    'YAGNI blocker extraction must use [YAGNI BLOCKER] regex filter'
  )
})

test('DYAGNI-01: dist sources yagniBlockerContext from result.reconcile.conflicts', () => {
  // The construction block reads from result.reconcile.conflicts — populated by
  // TDD Enforce regardless of the reconcile flag.
  const yagniSection = dist.match(/var yagniBlockerContext[\s\S]*?yagniBlockerContext[^=]*=[\s\S]*?\n/)
  assert.ok(yagniSection)
  assert.ok(
    yagniSection[0].includes('result.reconcile'),
    'YAGNI context must be sourced from result.reconcile (populated regardless of reconcile flag)'
  )
})

test('DYAGNI-01: dist checks reconcile.conflicts existence before filtering', () => {
  assert.ok(
    dist.includes('result.reconcile && result.reconcile.conflicts'),
    'YAGNI extraction must guard against missing reconcile or conflicts'
  )
})

test('DYAGNI-01: dist interpolates yagniBlockerContext into escalation prompt', () => {
  assert.ok(
    dist.includes('${yagniBlockerContext}'),
    'escalation prompt must interpolate yagniBlockerContext'
  )
})

test('DYAGNI-01: dist uses compactList for YAGNI blocker formatting', () => {
  assert.ok(
    dist.includes('compactList(yagniBlockers'),
    'YAGNI blockers must be bounded via compactList before prompt interpolation'
  )
})

test('DYAGNI-01: dist YAGNI section is before the escalation prompt template', () => {
  const yagniPos = dist.indexOf('var yagniBlockerContext')
  const escalatePos = dist.indexOf('escalatePrompt')
  assert.ok(yagniPos > 0 && escalatePos > 0)
  assert.ok(yagniPos < escalatePos, 'YAGNI context must be built before the escalation prompt uses it')
})

// =========================================================================
// Regression: no forbidden tokens in Phase 9 functions
// =========================================================================

test('REGRESSION: deriveDesignReadiness has no Date.now or Math.random', () => {
  const fnBody = extractDistFunction('deriveDesignReadiness')
  assert.ok(fnBody, 'deriveDesignReadiness must exist in dist')
  assert.ok(!fnBody.includes('Date.now'), 'no Date.now')
  assert.ok(!fnBody.includes('Math.random'), 'no Math.random')
})

test('REGRESSION: recordDegradationEvent has no Date.now or Math.random', () => {
  const fnBody = extractDistFunction('recordDegradationEvent')
  assert.ok(fnBody)
  assert.ok(!fnBody.includes('Date.now'), 'no Date.now')
  assert.ok(!fnBody.includes('Math.random'), 'no Math.random')
})

test('REGRESSION: degradationLogSummary has no Date.now or Math.random', () => {
  const fnBody = extractDistFunction('degradationLogSummary')
  assert.ok(fnBody)
  assert.ok(!fnBody.includes('Date.now'), 'no Date.now')
  assert.ok(!fnBody.includes('Math.random'), 'no Math.random')
})

test('REGRESSION: degradationLogSummary has no require or FS calls', () => {
  const fnBody = extractDistFunction('degradationLogSummary')
  assert.ok(fnBody)
  assert.ok(!fnBody.includes('require('), 'no require()')
  assert.ok(!fnBody.includes('readFileSync'), 'no readFileSync')
  assert.ok(!fnBody.includes('writeFileSync'), 'no writeFileSync')
})

test('REGRESSION: deriveDesignReadiness has no FS or shell access', () => {
  const fnBody = extractDistFunction('deriveDesignReadiness')
  assert.ok(fnBody)
  assert.ok(!fnBody.includes('require('), 'no require()')
  assert.ok(!fnBody.includes('readFileSync'), 'no readFileSync')
  assert.ok(!fnBody.includes('writeFileSync'), 'no writeFileSync')
})

test('REGRESSION: dist exports deriveDesignReadiness', () => {
  assert.ok(
    dist.includes('function deriveDesignReadiness'),
    'dist must contain deriveDesignReadiness function'
  )
})

test('REGRESSION: dist exports DESIGN_READINESS_REASONS', () => {
  assert.ok(
    dist.includes('DESIGN_READINESS_REASONS'),
    'dist must contain DESIGN_READINESS_REASONS constant'
  )
})

test('REGRESSION: dist exports recordDegradationEvent', () => {
  assert.ok(
    dist.includes('function recordDegradationEvent'),
    'dist must contain recordDegradationEvent function'
  )
})

test('REGRESSION: dist exports degradationLogSummary', () => {
  assert.ok(
    dist.includes('function degradationLogSummary'),
    'dist must contain degradationLogSummary function'
  )
})

// =========================================================================
// Cross-requirement: integration of degradation signals
// =========================================================================

test('INTEGRATION: not-ready handoff includes degradationDetail from designReadiness', () => {
  assert.ok(
    dist.includes('degradationDetail: designReadiness.degradation'),
    'not-ready handoff must include the full degradation detail array'
  )
})

test('INTEGRATION: ready handoff includes degradationLogSummary call', () => {
  assert.ok(
    dist.includes('degradationLogSummary(result._degradationLog)'),
    'ready handoff must summarize the degradation log'
  )
})

test('INTEGRATION: not-ready handoff sets designReadinessBlocker', () => {
  assert.ok(
    dist.includes('result.designReadinessBlocker = designReadiness.reason'),
    'not-ready path must persist the readiness blocker reason for inspection'
  )
})

test('INTEGRATION: not-ready handoff sets designReadinessDegradation', () => {
  assert.ok(
    dist.includes('result.designReadinessDegradation = designReadiness.degradation'),
    'not-ready path must persist the full degradation array for inspection'
  )
})

test('INTEGRATION: ready handoff includes chunkerDegraded and degradationLog', () => {
  // The ready handoff object must contain both chunkerDegraded and degradationLog
  // Search the ready-handoff section (after designReady=true, before the implement guard)
  const readyIdx = dist.indexOf("result.designReady = true")
  const implementGuardIdx = dist.indexOf("isImplementMode && !result.designReady", readyIdx)
  assert.ok(readyIdx > 0 && implementGuardIdx > 0, 'design ready section must exist in dist')
  const readySection = dist.slice(readyIdx, implementGuardIdx)
  assert.ok(readySection.includes('chunkerDegraded'), 'ready handoff must include chunkerDegraded')
  assert.ok(readySection.includes('degradationLog'), 'ready handoff must include degradationLog')
})
