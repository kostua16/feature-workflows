// Truthful readiness derivation and status projection: the command handoff
// and read-only status surface report the same immutable projection for
// denominator, lifecycle outcomes, revisions, budgets, failures, readiness
// proof, and continuation command. extractReady is true only when every
// condition is genuinely met. All functions are pure — no I/O, no side effects.

// Readiness failure reasons — each maps to a specific unmet condition.
const READINESS_REASONS = Object.freeze({
  DISCOVERY_INCOMPLETE: 'discovery-not-exhausted',
  GRAPH_INVALID: 'graph-invalid',
  FEATURES_INCOMPLETE: 'features-incomplete',
  SYNTHESIS_STALE: 'synthesis-stale',
  ARTIFACTS_STALE: 'artifacts-stale',
  ALL_MET: 'all-conditions-met',
})

// Derive truthful extract readiness from a comprehensive project state.
//
// projectState: {
//   discoveryExhausted: boolean,
//   graphValid: boolean,
//   features: [{ id, lifecycle, skipReason?, policyEvidence? }],
//   synthesisCurrent: boolean,
//   artifactsCurrent: boolean,
// }
//
// Returns: { ready, reason, checks, counts }
// ready is true ONLY when ALL conditions are met.
function deriveExtractReadiness(projectState) {
  if (!projectState || typeof projectState !== 'object') {
    return {
      ready: false,
      reason: READINESS_REASONS.FEATURES_INCOMPLETE,
      checks: { discoveryExhausted: false, graphValid: false, featuresComplete: false, synthesisCurrent: false, artifactsCurrent: false },
      counts: null,
    }
  }

  var features = projectState.features || []
  var counts = countLifecycleStates(features)
  var incompleteStates = ['runnable', 'deferred', 'in-progress', 'blocked', 'failed']
  var incompleteCount = 0
  var skippedIncomplete = 0

  for (var i = 0; i < features.length; i++) {
    var f = features[i]
    if (incompleteStates.indexOf(f.lifecycle) !== -1) {
      incompleteCount++
    }
    if (f.lifecycle === 'skipped') {
      // Only policy-disabled-optional with evidence may count as complete
      if (f.skipReason !== 'policy-disabled-optional' || !f.policyEvidence) {
        skippedIncomplete++
      }
    }
  }

  var discoveryOk = !!projectState.discoveryExhausted
  var graphOk = !!projectState.graphValid
  var featuresOk = incompleteCount === 0 && skippedIncomplete === 0
  var synthesisOk = !!projectState.synthesisCurrent
  var artifactsOk = !!projectState.artifactsCurrent

  var checks = {
    discoveryExhausted: discoveryOk,
    graphValid: graphOk,
    featuresComplete: featuresOk,
    synthesisCurrent: synthesisOk,
    artifactsCurrent: artifactsOk,
  }

  var ready = discoveryOk && graphOk && featuresOk && synthesisOk && artifactsOk

  var reason = READINESS_REASONS.ALL_MET
  if (!discoveryOk) reason = READINESS_REASONS.DISCOVERY_INCOMPLETE
  else if (!graphOk) reason = READINESS_REASONS.GRAPH_INVALID
  else if (!featuresOk) reason = READINESS_REASONS.FEATURES_INCOMPLETE
  else if (!synthesisOk) reason = READINESS_REASONS.SYNTHESIS_STALE
  else if (!artifactsOk) reason = READINESS_REASONS.ARTIFACTS_STALE

  return {
    ready: ready,
    reason: reason,
    checks: checks,
    counts: counts,
    incompleteCount: incompleteCount + skippedIncomplete,
  }
}

// Count features by lifecycle state. Pure helper.
function countLifecycleStates(features) {
  var counts = {
    runnable: 0,
    deferred: 0,
    'in-progress': 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    completed: 0,
  }
  for (var i = 0; i < features.length; i++) {
    var lc = features[i].lifecycle
    if (counts[lc] !== undefined) counts[lc]++
  }
  counts.denominator = features.length - counts.excluded
  return counts
}

// Produce an immutable status projection from the full project state.
// This is the SINGLE source of truth shared by command handoff and
// read-only status — they MUST report identical data.
//
// projectState: {
//   discoveryExhausted, graphValid, features, synthesisCurrent,
//   artifactsCurrent, revisions, budget, failures, continuation,
//   planDir, scopeManifestPath,
// }
function projectStatusProjection(projectState) {
  if (!projectState || typeof projectState !== 'object') {
    return projectEmptyProjection()
  }

  var readiness = deriveExtractReadiness(projectState)
  var features = projectState.features || []
  var counts = readiness.counts || countLifecycleStates(features)

  // Immutable projection — frozen so handoff and status share the exact same object
  var projection = {
    planDir: projectState.planDir || null,
    scopeManifestPath: projectState.scopeManifestPath || null,
    ready: readiness.ready,
    readyReason: readiness.reason,
    checks: readiness.checks,
    denominator: counts.denominator || 0,
    lifecycleOutcomes: {
      completed: counts.completed || 0,
      deferred: counts.deferred || 0,
      blocked: counts.blocked || 0,
      failed: counts.failed || 0,
      skipped: counts.skipped || 0,
      excluded: counts.excluded || 0,
      'in-progress': counts['in-progress'] || 0,
      runnable: counts.runnable || 0,
    },
    revisions: projectState.revisions || null,
    budget: projectState.budget || null,
    failures: projectState.failures || [],
    continuation: projectState.continuation || null,
    incompleteCount: readiness.incompleteCount || 0,
  }

  return Object.freeze(projection)
}

// Empty projection for null/invalid state.
function projectEmptyProjection() {
  return Object.freeze({
    planDir: null,
    scopeManifestPath: null,
    ready: false,
    readyReason: READINESS_REASONS.FEATURES_INCOMPLETE,
    checks: {
      discoveryExhausted: false,
      graphValid: false,
      featuresComplete: false,
      synthesisCurrent: false,
      artifactsCurrent: false,
    },
    denominator: 0,
    lifecycleOutcomes: {
      completed: 0, deferred: 0, blocked: 0, failed: 0,
      skipped: 0, excluded: 0, 'in-progress': 0, runnable: 0,
    },
    revisions: null,
    budget: null,
    failures: [],
    continuation: null,
    incompleteCount: 0,
  })
}

// Design readiness failure reasons — each maps to a specific hidden degradation.
const DESIGN_READINESS_REASONS = Object.freeze({
  FAIL_FORWARD_REVIEW: 'fail-forward-review',
  FORCE_ACCEPTED_BLOCKERS: 'force-accepted-plan-with-blockers',
  UNRESOLVED_RECONCILE: 'unresolved-reconcile-conflicts',
  ALL_CLEAR: 'all-degradation-checks-clear',
})

// Derive truthful design readiness from design-mode result state.
// designReady must be true ONLY when no review was fail-forwarded,
// no plan carries force-accepted blockers, and reconcile conflicts are resolved.
// Pure: no I/O, no side effects.
function deriveDesignReadiness(result) {
  if (!result || typeof result !== 'object') {
    return { ready: false, reason: DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW, degradation: [] }
  }
  var degradation = []
  // Check fail-forward review flags (F4)
  var forcedReviews = []
  if (result._reviewedRequirementsForced) forcedReviews.push('Requirements')
  if (result._reviewedArchForced) forcedReviews.push('Architecture')
  if (result._reviewedDesignForced) forcedReviews.push('Detailed Design')
  if (forcedReviews.length) {
    degradation.push({ type: DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW, gates: forcedReviews })
  }
  // Check force-accepted plan with carried blockers (F5)
  if (result.forceAccepted && result.carriedBlockers && result.carriedBlockers.length) {
    degradation.push({ type: DESIGN_READINESS_REASONS.FORCE_ACCEPTED_BLOCKERS, count: result.carriedBlockers.length })
  }
  // Check unresolved reconcile conflicts (F6)
  if (result.reconcile && result.reconcile.consistent === false && (result.reconcile.conflicts || []).length > 0) {
    degradation.push({ type: DESIGN_READINESS_REASONS.UNRESOLVED_RECONCILE, conflicts: result.reconcile.conflicts.length })
  }
  var ready = degradation.length === 0
  var reason = ready ? DESIGN_READINESS_REASONS.ALL_CLEAR : degradation[0].type
  return { ready: ready, reason: reason, degradation: degradation }
}

// Verify two projections are identical. Used to enforce the invariant that
// handoff and status report the same data.
function projectionsMatch(a, b) {
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

// Human-readable readiness summary for status reporting.
function readinessSummary(projection) {
  if (!projection) return 'No projection available.'
  var lines = []
  lines.push('Readiness: ' + (projection.ready ? 'READY' : 'NOT READY') + ' (' + projection.readyReason + ')')
  lines.push('Denominator: ' + projection.denominator)
  lines.push('Completed: ' + projection.lifecycleOutcomes.completed)
  if (projection.incompleteCount > 0) {
    lines.push('Incomplete: ' + projection.incompleteCount)
  }
  var checks = projection.checks || {}
  lines.push('Checks:')
  for (var key of Object.keys(checks)) {
    lines.push('  ' + (checks[key] ? '[x]' : '[ ]') + ' ' + key)
  }
  return lines.join('\n')
}

export { READINESS_REASONS, deriveExtractReadiness, projectStatusProjection, projectionsMatch, readinessSummary, countLifecycleStates, DESIGN_READINESS_REASONS, deriveDesignReadiness }
