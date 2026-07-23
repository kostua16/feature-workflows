// Phase 1 CONTRACT-01: Pure lifecycle reducer table tests.
// These functions are pure, deterministic, and carry no I/O.
// Tests: applyLifecycleEvent, deriveReadiness, isTerminal, isIncomplete.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  LIFECYCLE_STATES,
  SKIP_REASONS,
  applyLifecycleEvent,
  deriveReadiness,
  isTerminal,
  isIncomplete,
} = engine

// ---- LIFECYCLE_STATES and SKIP_REASONS enums ----

test('LIFECYCLE_STATES: has exactly 8 canonical states', () => {
  const values = Object.values(LIFECYCLE_STATES)
  assert.equal(values.length, 8)
  assert.ok(values.includes('runnable'))
  assert.ok(values.includes('deferred'))
  assert.ok(values.includes('in-progress'))
  assert.ok(values.includes('blocked'))
  assert.ok(values.includes('failed'))
  assert.ok(values.includes('skipped'))
  assert.ok(values.includes('excluded'))
  assert.ok(values.includes('completed'))
})

test('SKIP_REASONS: has exactly 3 distinct skip classifications', () => {
  const values = Object.values(SKIP_REASONS)
  assert.equal(values.length, 3)
  assert.ok(values.includes('feature-level'))
  assert.ok(values.includes('policy-disabled-optional'))
  assert.ok(values.includes('required-gate'))
})

// ---- Illegal transition rejection ----

test('applyLifecycleEvent: illegal transition completed -> start throws', () => {
  const state = { lifecycle: LIFECYCLE_STATES.COMPLETED }
  assert.throws(() => applyLifecycleEvent(state, { type: 'start' }), /illegal transition/)
})

test('applyLifecycleEvent: illegal transition excluded -> start throws', () => {
  const state = { lifecycle: LIFECYCLE_STATES.EXCLUDED }
  assert.throws(() => applyLifecycleEvent(state, { type: 'start' }), /illegal transition/)
})

test('applyLifecycleEvent: legal transition runnable -> start succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.RUNNABLE }
  const next = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
})

test('applyLifecycleEvent: legal transition deferred -> start succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.DEFERRED }
  const next = applyLifecycleEvent(state, { type: 'start' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.IN_PROGRESS)
})

test('applyLifecycleEvent: in-progress -> complete succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  const next = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

test('applyLifecycleEvent: in-progress -> fail succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  const next = applyLifecycleEvent(state, { type: 'fail' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.FAILED)
})

// ---- No input mutation ----

test('applyLifecycleEvent: does NOT mutate input state', () => {
  const original = { lifecycle: LIFECYCLE_STATES.RUNNABLE, custom: 'data' }
  const snapshot = JSON.parse(JSON.stringify(original))
  applyLifecycleEvent(original, { type: 'start' })
  assert.deepEqual(original, snapshot, 'input state must not be mutated')
})

// ---- Byte-stable replay ----

test('applyLifecycleEvent: replaying same events produces identical state', () => {
  const events = [
    { type: 'start' },
    { type: 'block' },
    { type: 'start' },
    { type: 'complete' },
  ]
  const run1 = events.reduce((s, e) => applyLifecycleEvent(s, e), { lifecycle: LIFECYCLE_STATES.RUNNABLE })
  const run2 = events.reduce((s, e) => applyLifecycleEvent(s, e), { lifecycle: LIFECYCLE_STATES.RUNNABLE })
  assert.deepEqual(run1, run2, 'replay must produce byte-stable result')
  assert.equal(run1.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

// ---- Skip semantics ----

test('applyLifecycleEvent: skip with feature-level reason succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  const next = applyLifecycleEvent(state, {
    type: 'skip',
    payload: { skipReason: SKIP_REASONS.FEATURE_LEVEL },
  })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.SKIPPED)
  assert.equal(next.skipReason, SKIP_REASONS.FEATURE_LEVEL)
})

test('applyLifecycleEvent: skip with policy-disabled-optional and evidence succeeds', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  const next = applyLifecycleEvent(state, {
    type: 'skip',
    payload: {
      skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL,
      policyEvidence: { policy: 'test-disabled', gate: 'design-review' },
    },
  })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.SKIPPED)
  assert.equal(next.skipReason, SKIP_REASONS.POLICY_DISABLED_OPTIONAL)
  assert.ok(next.policyEvidence)
})

test('applyLifecycleEvent: skip without reason throws', () => {
  const state = { lifecycle: LIFECYCLE_STATES.IN_PROGRESS }
  assert.throws(
    () => applyLifecycleEvent(state, { type: 'skip', payload: {} }),
    /valid payload.skipReason/
  )
})

// ---- Completion rules for skipped features ----

test('applyLifecycleEvent: feature-level skipped cannot complete', () => {
  const state = { lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.FEATURE_LEVEL }
  assert.throws(() => applyLifecycleEvent(state, { type: 'complete' }), /feature was skipped/)
})

test('applyLifecycleEvent: required-gate skipped cannot complete', () => {
  const state = { lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.REQUIRED_GATE }
  assert.throws(() => applyLifecycleEvent(state, { type: 'complete' }), /required gate was skipped/)
})

test('applyLifecycleEvent: policy-disabled skipped without evidence cannot complete', () => {
  const state = { lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL }
  assert.throws(() => applyLifecycleEvent(state, { type: 'complete' }), /policyEvidence/)
})

test('applyLifecycleEvent: policy-disabled skipped WITH evidence can complete', () => {
  const state = {
    lifecycle: LIFECYCLE_STATES.SKIPPED,
    skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL,
    policyEvidence: { policy: 'test-disabled' },
  }
  const next = applyLifecycleEvent(state, { type: 'complete' })
  assert.equal(next.lifecycle, LIFECYCLE_STATES.COMPLETED)
})

// ---- deriveReadiness ----

test('deriveReadiness: all completed = ready', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.COMPLETED },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, true)
  assert.equal(r.denominator, 2)
  assert.equal(r.completed, 2)
  assert.equal(r.remaining, 0)
})

test('deriveReadiness: incomplete coverage = NOT ready', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.DEFERRED },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, false)
  assert.equal(r.denominator, 2)
  assert.equal(r.remaining, 1)
})

test('deriveReadiness: blocked feature = NOT ready', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [{ id: 'a', lifecycle: LIFECYCLE_STATES.BLOCKED }],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, false)
  assert.equal(r.blocked, 1)
})

test('deriveReadiness: feature-level skipped = NOT ready (incomplete)', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.FEATURE_LEVEL },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, false)
  assert.equal(r.skipped, 1)
})

test('deriveReadiness: policy-disabled-optional with evidence = may complete', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      {
        id: 'b',
        lifecycle: LIFECYCLE_STATES.SKIPPED,
        skipReason: SKIP_REASONS.POLICY_DISABLED_OPTIONAL,
        policyEvidence: { policy: 'disabled' },
      },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, true, 'policy-disabled skip with evidence should count as completed')
  assert.equal(r.skipped, 0)
})

test('deriveReadiness: required-gate skipped = NOT ready', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.SKIPPED, skipReason: SKIP_REASONS.REQUIRED_GATE },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, false)
  assert.equal(r.skipped, 1)
})

test('deriveReadiness: excluded features outside denominator', () => {
  const manifest = {
    schemaVersion: '1.5.0',
    features: [
      { id: 'a', lifecycle: LIFECYCLE_STATES.COMPLETED },
      { id: 'b', lifecycle: LIFECYCLE_STATES.EXCLUDED },
    ],
  }
  const r = deriveReadiness(manifest)
  assert.equal(r.ready, true)
  assert.equal(r.denominator, 1, 'excluded is outside denominator')
  assert.equal(r.excluded, 1)
})

test('deriveReadiness: empty manifest = NOT ready (nothing completed)', () => {
  const r = deriveReadiness({ schemaVersion: '1.5.0', features: [] })
  assert.equal(r.ready, false)
  assert.equal(r.denominator, 0)
})

// ---- isTerminal ----

test('isTerminal: completed, failed, excluded are terminal', () => {
  assert.equal(isTerminal(LIFECYCLE_STATES.COMPLETED), true)
  assert.equal(isTerminal(LIFECYCLE_STATES.FAILED), true)
  assert.equal(isTerminal(LIFECYCLE_STATES.EXCLUDED), true)
})

test('isTerminal: non-terminal states return false', () => {
  assert.equal(isTerminal(LIFECYCLE_STATES.RUNNABLE), false)
  assert.equal(isTerminal(LIFECYCLE_STATES.DEFERRED), false)
  assert.equal(isTerminal(LIFECYCLE_STATES.IN_PROGRESS), false)
  assert.equal(isTerminal(LIFECYCLE_STATES.BLOCKED), false)
  assert.equal(isTerminal(LIFECYCLE_STATES.SKIPPED), false)
})

// ---- isIncomplete ----

test('isIncomplete: deferred, blocked, in-progress, runnable are incomplete', () => {
  assert.equal(isIncomplete(LIFECYCLE_STATES.DEFERRED), true)
  assert.equal(isIncomplete(LIFECYCLE_STATES.BLOCKED), true)
  assert.equal(isIncomplete(LIFECYCLE_STATES.IN_PROGRESS), true)
  assert.equal(isIncomplete(LIFECYCLE_STATES.RUNNABLE), true)
})

test('isIncomplete: feature-level skipped is incomplete', () => {
  assert.equal(isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.FEATURE_LEVEL), true)
  assert.equal(isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.REQUIRED_GATE), true)
})

test('isIncomplete: policy-disabled-optional is NOT incomplete (may complete with evidence)', () => {
  assert.equal(isIncomplete(LIFECYCLE_STATES.SKIPPED, SKIP_REASONS.POLICY_DISABLED_OPTIONAL), false)
})

test('isIncomplete: completed, failed, excluded are NOT incomplete', () => {
  assert.equal(isIncomplete(LIFECYCLE_STATES.COMPLETED), false)
  assert.equal(isIncomplete(LIFECYCLE_STATES.FAILED), false)
  assert.equal(isIncomplete(LIFECYCLE_STATES.EXCLUDED), false)
})
