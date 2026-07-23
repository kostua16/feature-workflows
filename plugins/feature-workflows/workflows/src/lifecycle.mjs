// Pure lifecycle state contract: explicit feature lifecycle states, deterministic
// transition reducer, and readiness derivation. No I/O — all functions are pure
// and deterministic. Designed for property-based table tests.

// Canonical lifecycle states a feature may occupy. Exactly one is active per feature
// at any time. Excluded features are outside the coverage denominator; all others
// contribute to the readiness invariant.
const LIFECYCLE_STATES = Object.freeze({
  RUNNABLE: 'runnable',
  DEFERRED: 'deferred',
  IN_PROGRESS: 'in-progress',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  EXCLUDED: 'excluded',
  COMPLETED: 'completed',
})

// Three distinct skip classifications with different readiness implications.
// Feature-level skip means the feature itself was abandoned — remains incomplete.
// Policy-disabled optional skip may complete if policy evidence is recorded.
// Required-gate skip blocks completion permanently until resolved.
const SKIP_REASONS = Object.freeze({
  FEATURE_LEVEL: 'feature-level',
  POLICY_DISABLED_OPTIONAL: 'policy-disabled-optional',
  REQUIRED_GATE: 'required-gate',
})

// Legal transitions: maps current state to the set of event types that may fire.
// Any event not listed for the current state is illegal and throws.
const TRANSITION_TABLE = Object.freeze({
  runnable: ['start', 'defer', 'skip', 'exclude'],
  deferred: ['start', 'exclude'],
  'in-progress': ['block', 'fail', 'complete', 'skip'],
  blocked: ['start', 'fail', 'exclude'],
  failed: ['start', 'exclude'],
  skipped: ['start', 'complete', 'exclude'],
  excluded: [],
  completed: [],
})

// Pure transition reducer. Takes the current feature state and an event, returns a
// new state object. Throws on illegal transitions. Does NOT mutate the input.
//
// state: { lifecycle, skipReason?, policyEvidence? }
// event: { type: 'admit'|'start'|'block'|'fail'|'skip'|'exclude'|'complete', payload? }
function applyLifecycleEvent(state, event) {
  if (!state || typeof state !== 'object') {
    throw new Error('applyLifecycleEvent: state must be an object')
  }
  if (!event || typeof event !== 'object' || !event.type) {
    throw new Error('applyLifecycleEvent: event must have a type')
  }

  const current = state.lifecycle
  if (!current || !TRANSITION_TABLE[current]) {
    throw new Error(`applyLifecycleEvent: unknown lifecycle state '${current}'`)
  }

  const allowed = TRANSITION_TABLE[current]
  if (!allowed.includes(event.type)) {
    throw new Error(
      `applyLifecycleEvent: illegal transition '${current}' + '${event.type}' (allowed: ${allowed.join(', ') || 'none'})`
    )
  }

  // Build new state — never mutate the original
  const next = { ...state }

  switch (event.type) {
    case 'start':
      next.lifecycle = LIFECYCLE_STATES.IN_PROGRESS
      delete next.skipReason
      delete next.policyEvidence
      break
    case 'defer':
      next.lifecycle = LIFECYCLE_STATES.DEFERRED
      break
    case 'block':
      next.lifecycle = LIFECYCLE_STATES.BLOCKED
      break
    case 'fail':
      next.lifecycle = LIFECYCLE_STATES.FAILED
      break
    case 'skip': {
      const reason = event.payload && event.payload.skipReason
      if (!reason || !Object.values(SKIP_REASONS).includes(reason)) {
        throw new Error('applyLifecycleEvent: skip event requires valid payload.skipReason')
      }
      next.lifecycle = LIFECYCLE_STATES.SKIPPED
      next.skipReason = reason
      if (event.payload.policyEvidence) {
        next.policyEvidence = event.payload.policyEvidence
      }
      break
    }
    case 'exclude':
      next.lifecycle = LIFECYCLE_STATES.EXCLUDED
      if (event.payload && event.payload.rationale) {
        next.exclusionRationale = event.payload.rationale
      }
      break
    case 'complete':
      // A skipped feature can only complete under specific skip-reason rules
      if (current === LIFECYCLE_STATES.SKIPPED) {
        if (state.skipReason === SKIP_REASONS.REQUIRED_GATE) {
          throw new Error('applyLifecycleEvent: cannot complete — required gate was skipped')
        }
        if (state.skipReason === SKIP_REASONS.FEATURE_LEVEL) {
          throw new Error('applyLifecycleEvent: cannot complete — feature was skipped at feature level')
        }
        if (state.skipReason === SKIP_REASONS.POLICY_DISABLED_OPTIONAL) {
          if (!state.policyEvidence) {
            throw new Error('applyLifecycleEvent: cannot complete — policy-disabled skip requires policyEvidence')
          }
        }
      }
      next.lifecycle = LIFECYCLE_STATES.COMPLETED
      break
    default:
      throw new Error(`applyLifecycleEvent: unhandled event type '${event.type}'`)
  }

  return next
}

// Derive readiness from a project manifest. Pure: no side effects.
// Returns whether the project is ready plus exact counts.
//
// manifest: {
//   schemaVersion: string,
//   features: [{ id, lifecycle, skipReason?, policyEvidence? }]
// }
function deriveReadiness(manifest) {
  const features = (manifest && manifest.features) || []
  const counts = {
    runnable: 0, deferred: 0, inProgress: 0, blocked: 0,
    failed: 0, skipped: 0, excluded: 0, completed: 0,
  }

  for (const f of features) {
    const lc = f.lifecycle
    if (lc === LIFECYCLE_STATES.RUNNABLE) counts.runnable++
    else if (lc === LIFECYCLE_STATES.DEFERRED) counts.deferred++
    else if (lc === LIFECYCLE_STATES.IN_PROGRESS) counts.inProgress++
    else if (lc === LIFECYCLE_STATES.BLOCKED) counts.blocked++
    else if (lc === LIFECYCLE_STATES.FAILED) counts.failed++
    else if (lc === LIFECYCLE_STATES.SKIPPED) counts.skipped++
    else if (lc === LIFECYCLE_STATES.EXCLUDED) counts.excluded++
    else if (lc === LIFECYCLE_STATES.COMPLETED) counts.completed++
  }

  // Denominator excludes 'excluded' features
  const denominator = features.length - counts.excluded
  const incomplete = counts.runnable + counts.deferred + counts.inProgress + counts.blocked + counts.failed

  // Skipped features need special handling: only policy-disabled-optional with evidence counts as complete
  let effectiveSkippedIncomplete = 0
  for (const f of features) {
    if (f.lifecycle === LIFECYCLE_STATES.SKIPPED) {
      if (f.skipReason === SKIP_REASONS.POLICY_DISABLED_OPTIONAL && f.policyEvidence) {
        counts.completed++ // counts as completed for readiness
      } else {
        effectiveSkippedIncomplete++
      }
    }
  }
  // Adjust: skipped that can complete are already counted in completed above;
  // the rest are incomplete
  const totalIncomplete = incomplete + effectiveSkippedIncomplete

  return {
    ready: denominator > 0 && totalIncomplete === 0 && counts.completed >= denominator,
    denominator,
    completed: counts.completed,
    remaining: counts.runnable + counts.deferred + counts.inProgress,
    blocked: counts.blocked,
    failed: counts.failed,
    skipped: effectiveSkippedIncomplete,
    excluded: counts.excluded,
  }
}

// Terminal states: once reached, the feature does not transition further
function isTerminal(lifecycleState) {
  return lifecycleState === LIFECYCLE_STATES.COMPLETED ||
    lifecycleState === LIFECYCLE_STATES.FAILED ||
    lifecycleState === LIFECYCLE_STATES.EXCLUDED
}

// Incomplete states: features that still need work before the project can be ready.
// Feature-level skipped is incomplete. Policy-disabled-optional with evidence is NOT.
function isIncomplete(lifecycleState, skipReason) {
  if (lifecycleState === LIFECYCLE_STATES.DEFERRED ||
    lifecycleState === LIFECYCLE_STATES.BLOCKED ||
    lifecycleState === LIFECYCLE_STATES.IN_PROGRESS ||
    lifecycleState === LIFECYCLE_STATES.RUNNABLE) {
    return true
  }
  if (lifecycleState === LIFECYCLE_STATES.SKIPPED) {
    return skipReason !== SKIP_REASONS.POLICY_DISABLED_OPTIONAL
  }
  return false
}

export { LIFECYCLE_STATES, SKIP_REASONS, TRANSITION_TABLE, applyLifecycleEvent, deriveReadiness, isTerminal, isIncomplete }
