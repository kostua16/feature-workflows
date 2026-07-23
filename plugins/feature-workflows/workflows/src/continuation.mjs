// Transactional automatic continuation: monotonic segment identifiers,
// idempotency keys, and convergence of duplicate/lost/out-of-order launches.
// One command launches the next segment while progress is possible; every
// stop emits an exact idempotent manual resume command.
// All functions are pure and deterministic — no I/O, no side effects.

// Create a continuation state tracker.
function createContinuationState() {
  return {
    lastSegmentId: 0,
    intents: [],
    acknowledgements: [],
  }
}

// Allocate the next monotonic segment identifier. Pure: returns new state + id.
function nextSegmentId(state) {
  var segmentId = state.lastSegmentId + 1
  return {
    state: Object.assign({}, state, { lastSegmentId: segmentId }),
    segmentId: segmentId,
  }
}

// Generate an idempotency key for a segment. Deterministic: same features + revision
// produce the same key, so duplicate launches converge to one outcome.
function idempotencyKey(segmentId, featureIds, revision) {
  var ids = featureIds.slice().sort().join(',')
  return 'seg-' + segmentId + '-' + ids + '-' + (revision || 'none')
}

// Create a segment intent: the orchestrator declares it is about to launch
// a segment. This is the write-intent phase before actual work begins.
// Duplicate intents for the same segment converge (idempotent).
function createSegmentIntent(state, segmentId, featureIds, revision) {
  var key = idempotencyKey(segmentId, featureIds, revision)
  // Check if this exact intent already exists (duplicate launch)
  for (var i = 0; i < state.intents.length; i++) {
    if (state.intents[i].segmentId === segmentId && state.intents[i].idempotencyKey === key) {
      return { state: state, duplicate: true, intent: state.intents[i] }
    }
  }
  var intent = {
    segmentId: segmentId,
    idempotencyKey: key,
    features: featureIds.slice().sort(),
    revision: revision || null,
    acknowledged: false,
  }
  return {
    state: Object.assign({}, state, { intents: state.intents.concat([intent]) }),
    duplicate: false,
    intent: intent,
  }
}

// Acknowledge a segment completion: the commit phase.
// Idempotent: acknowledging the same segment twice converges to one outcome.
function acknowledgeSegment(state, segmentId, key, outcome, counts) {
  // Check if already acknowledged (duplicate acknowledgement)
  for (var i = 0; i < state.acknowledgements.length; i++) {
    if (state.acknowledgements[i].segmentId === segmentId) {
      return { state: state, duplicate: true, acknowledgement: state.acknowledgements[i] }
    }
  }

  var acknowledgement = {
    segmentId: segmentId,
    idempotencyKey: key,
    outcome: outcome || 'partial',
    counts: counts || {},
  }

  // Mark intent as acknowledged
  var intents = state.intents.map(function (i) {
    if (i.segmentId === segmentId) return Object.assign({}, i, { acknowledged: true })
    return i
  })

  return {
    state: Object.assign({}, state, {
      intents: intents,
      acknowledgements: state.acknowledgements.concat([acknowledgement]),
    }),
    duplicate: false,
    acknowledgement: acknowledgement,
  }
}

// Resolve convergence of duplicate, lost, resumed, or out-of-order launches.
// Produces the canonical durable outcome — one outcome per segment, no skipped
// or double-applied work. First acknowledgement for each segment wins.
function resolveConvergence(state) {
  var seen = {} // segmentId -> canonical ack

  for (var i = 0; i < state.acknowledgements.length; i++) {
    var ack = state.acknowledgements[i]
    if (!seen[ack.segmentId]) {
      seen[ack.segmentId] = ack
    }
    // Duplicate: first acknowledgement wins (idempotent)
  }

  var converged = Object.keys(seen).map(function (k) { return seen[k] })
  converged.sort(function (a, b) { return a.segmentId - b.segmentId })

  // Check for unacknowledged intents (lost acknowledgements / crashes)
  var unacknowledged = state.intents.filter(function (intent) {
    return !seen[intent.segmentId]
  })

  return {
    converged: converged,
    unacknowledged: unacknowledged,
    pendingRetry: unacknowledged.map(function (i) {
      return {
        segmentId: i.segmentId,
        idempotencyKey: i.idempotencyKey,
        features: i.features,
      }
    }),
  }
}

// Determine if progress is still possible (continuation decision).
// True if there are pending or in-progress features.
function shouldContinue(queue) {
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].status === 'pending' || queue[i].status === 'in-progress') {
      return true
    }
  }
  return false
}

// Count features by outcome across all acknowledged segments.
function segmentCounts(state) {
  var counts = { completed: 0, deferred: 0, blocked: 0, failed: 0, skipped: 0 }
  for (var i = 0; i < state.acknowledgements.length; i++) {
    var c = state.acknowledgements[i].counts || {}
    counts.completed += c.completed || 0
    counts.deferred += c.deferred || 0
    counts.blocked += c.blocked || 0
    counts.failed += c.failed || 0
    counts.skipped += c.skipped || 0
  }
  return counts
}

// Generate the exact idempotent manual resume command for a stopped segment.
// This command reproduces the same state transition when run manually.
function resumeCommand(planDir, segmentId, state) {
  var convergence = resolveConvergence(state)
  var hasUnack = convergence.unacknowledged.length > 0
  return {
    command: '/feature-workflows:extract-design --resume ' + planDir,
    segmentId: segmentId,
    reason: hasUnack ? 'unacknowledged-intent' : 'no-progress-or-ceiling',
    counts: segmentCounts(state),
    idempotent: true,
  }
}

// Detect out-of-order delivery: an acknowledgement for segment N+1 arriving
// before segment N's acknowledgement. Out-of-order acks converge correctly.
function isOutOfOrder(state, segmentId) {
  var ackedIds = {}
  for (var i = 0; i < state.acknowledgements.length; i++) {
    ackedIds[state.acknowledgements[i].segmentId] = true
  }
  // Out-of-order if a lower segment has an intent but no ack
  for (var j = 0; j < state.intents.length; j++) {
    if (state.intents[j].segmentId < segmentId && !ackedIds[state.intents[j].segmentId]) {
      return true
    }
  }
  return false
}

// Check if automatic relaunch is possible (not refused).
// Returns false when the budget is exhausted or too many unacknowledged
// intents exist (potential crash loop).
function canAutoRelaunch(state, budgetCallsRemaining) {
  if (budgetCallsRemaining <= 0) return false
  var convergence = resolveConvergence(state)
  return convergence.unacknowledged.length < 3
}

// Full continuation summary for handoff/status reporting.
function continuationSummary(state) {
  var convergence = resolveConvergence(state)
  return {
    lastSegmentId: state.lastSegmentId,
    acknowledgedSegments: convergence.converged.length,
    unacknowledgedIntents: convergence.unacknowledged.length,
    totalCounts: segmentCounts(state),
    hasUnacknowledged: convergence.unacknowledged.length > 0,
  }
}

export { createContinuationState, nextSegmentId, idempotencyKey, createSegmentIntent, acknowledgeSegment, resolveConvergence, shouldContinue, resumeCommand, segmentCounts, isOutOfOrder, canAutoRelaunch, continuationSummary }
