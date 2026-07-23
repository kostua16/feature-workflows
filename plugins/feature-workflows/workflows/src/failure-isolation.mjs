// Failure isolation: one feature failure does not lose or poison independent work.
// Updates only the failed feature's shard; eligible independent features continue.
// Verified artifacts are preserved on failure.
// All functions are pure and deterministic — no I/O, no side effects.

// Isolate a feature failure: update only the failed feature's lifecycle,
// preserving all other features' state and verified artifacts.
// Pure: returns a new queue array, does NOT mutate the input.
// Timeout and blocked failures are resumable (status='blocked'); other
// failure types are terminal (status='failed').
function isolateFailure(queue, failedId, failureType) {
  var resumable = failureType === 'timeout' || failureType === 'blocked'
  return queue.map(function (entry) {
    if (entry.id !== failedId) {
      return Object.assign({}, entry)
    }
    // Failed feature: preserve verified artifacts, update status
    return Object.assign({}, entry, {
      status: resumable ? 'blocked' : 'failed',
      failureType: failureType || 'unknown',
      // Artifacts are PRESERVED — failure does not lose verified work
      artifacts: entry.artifacts || {},
    })
  })
}

// Given a failed feature, determine which other features are eligible to
// continue independently (not blocked by the failure through dependencies).
// Uses transitive closure: any feature whose dependency chain reaches the
// failed feature is blocked.
function eligibleIndependents(queue, failedId, edges) {
  var transitivelyBlocked = {}
  transitivelyBlocked[failedId] = true

  // Propagate: any feature whose dependency is blocked is itself blocked
  var changed = true
  while (changed) {
    changed = false
    for (var i = 0; i < (edges || []).length; i++) {
      var e = edges[i]
      if (transitivelyBlocked[e.to] && !transitivelyBlocked[e.from]) {
        transitivelyBlocked[e.from] = true
        changed = true
      }
    }
  }

  // Eligible: not transitively blocked, and still has work to do
  return queue.filter(function (entry) {
    if (transitivelyBlocked[entry.id]) return false
    return entry.status === 'pending' || entry.status === 'in-progress'
  })
}

// Preserve verified artifacts from a failed feature slice.
// Returns only the artifacts that were actually produced (truthy paths).
function preserveVerifiedArtifacts(slice) {
  var artifacts = slice.artifacts || {}
  var verified = {}
  for (var key in artifacts) {
    if (artifacts[key]) verified[key] = artifacts[key]
  }
  return verified
}

// Determine if a segment should continue after a feature failure.
// True if at least one eligible independent feature remains.
function shouldContinueAfterFailure(queue, failedId, edges) {
  return eligibleIndependents(queue, failedId, edges).length > 0
}

// Count features by terminal status within a segment.
// Maps both 'done' and 'completed' to the completed bucket since the
// extract queue uses 'done' while the lifecycle reducer uses 'completed'.
function segmentOutcome(queue) {
  var counts = {
    completed: 0,
    blocked: 0,
    failed: 0,
    deferred: 0,
    skipped: 0,
    pending: 0,
  }
  for (var i = 0; i < queue.length; i++) {
    var status = queue[i].status
    if (status === 'done' || status === 'completed') counts.completed++
    else if (status in counts) counts[status]++
    else counts.pending++
  }
  return counts
}

export { isolateFailure, eligibleIndependents, preserveVerifiedArtifacts, shouldContinueAfterFailure, segmentOutcome }
