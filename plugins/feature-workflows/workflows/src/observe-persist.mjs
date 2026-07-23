// Attempted-vs-durable persistence tracking: distinguish writes that were
// attempted from writes that are durably verified. Retry-safe: retrying a
// failed write cannot produce duplicate index, synthesis, or continuation
// state. All functions are pure — no I/O, no side effects.

// Three terminal persistence states for each write unit.
const PERSISTENCE_STATES = Object.freeze({
  ATTEMPTED: 'attempted',
  DURABLY_VERIFIED: 'durably-verified',
  FAILED: 'failed',
})

// Write-unit types that are tracked for retry-safe persistence.
const PERSIST_UNIT_TYPES = Object.freeze({
  FEATURE_SHARD: 'feature-shard',
  PROJECT_INDEX: 'project-index',
  SYNTHESIS_VIEW: 'synthesis-view',
  CONTINUATION_ACK: 'continuation-ack',
})

// Initialize empty persistence tracker.
function createPersistenceTracker() {
  return {
    writes: {},
    history: [],
  }
}

// Record an attempted write. Idempotent: recording the same key twice does
// not duplicate state — it updates the timestamp of the existing attempt.
// A durably verified write cannot be demoted back to attempted.
function recordAttemptedWrite(tracker, key, unitType) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('recordAttemptedWrite: tracker must be an object')
  }
  if (!key) throw new Error('recordAttemptedWrite: key is required')

  var existing = tracker.writes[key]
  if (existing && existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Durably verified writes are never demoted — retry safety.
    return tracker
  }

  var entry = {
    key: key,
    unitType: unitType || (existing ? existing.unitType : PERSIST_UNIT_TYPES.FEATURE_SHARD),
    state: PERSISTENCE_STATES.ATTEMPTED,
    attempts: existing ? existing.attempts + 1 : 1,
  }

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'attempted',
    attemptNumber: entry.attempts,
  }])

  return { writes: writes, history: history }
}

// Verify a write as durably completed. Once verified, the write is permanent —
// retrying cannot change its state (no duplicate state on retry).
function verifyDurableWrite(tracker, key) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('verifyDurableWrite: tracker must be an object')
  }
  if (!key) throw new Error('verifyDurableWrite: key is required')

  var existing = tracker.writes[key]
  if (!existing) {
    throw new Error('verifyDurableWrite: no attempted write for key ' + key)
  }
  if (existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Already verified — idempotent, no state change
    return tracker
  }

  var entry = Object.assign({}, existing, {
    state: PERSISTENCE_STATES.DURABLY_VERIFIED,
  })

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'verified',
    attemptNumber: existing.attempts,
  }])

  return { writes: writes, history: history }
}

// Mark a write as failed. The write remains in the tracker so retry logic
// can inspect its attempt count and reason. Failed writes can be retried.
function failWrite(tracker, key, reason) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('failWrite: tracker must be an object')
  }
  if (!key) throw new Error('failWrite: key is required')

  var existing = tracker.writes[key]
  if (existing && existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Durably verified writes cannot be failed — they are permanent
    return tracker
  }

  var attempts = existing ? existing.attempts : 0
  var entry = {
    key: key,
    unitType: existing ? existing.unitType : PERSIST_UNIT_TYPES.FEATURE_SHARD,
    state: PERSISTENCE_STATES.FAILED,
    attempts: attempts,
    failReason: reason || 'unknown',
  }

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'failed',
    attemptNumber: attempts,
    reason: reason || 'unknown',
  }])

  return { writes: writes, history: history }
}

// Check if retrying a write is safe — it is safe only if the write is NOT
// already durably verified (which would risk duplicating state on retry).
function isRetrySafe(tracker, key) {
  if (!tracker || !tracker.writes[key]) return true
  return tracker.writes[key].state !== PERSISTENCE_STATES.DURABLY_VERIFIED
}

// Check if a specific write is durably verified.
function isDurablyVerified(tracker, key) {
  if (!tracker || !tracker.writes[key]) return false
  return tracker.writes[key].state === PERSISTENCE_STATES.DURABLY_VERIFIED
}

// Generate a report of persistence status for handoff and status surfaces.
// Distinguishes attempted from durably verified, counts failures, and
// exposes per-unit-type breakdowns.
function persistenceReport(tracker) {
  if (!tracker) {
    return { attempted: 0, verified: 0, failed: 0, total: 0, byType: {} }
  }

  var writes = tracker.writes || {}
  var report = {
    attempted: 0,
    verified: 0,
    failed: 0,
    total: 0,
    byType: {},
  }

  for (var key of Object.keys(writes)) {
    var w = writes[key]
    report.total++
    var typeBucket = w.unitType || 'unknown'
    if (!report.byType[typeBucket]) report.byType[typeBucket] = { attempted: 0, verified: 0, failed: 0 }
    report.byType[typeBucket].total = (report.byType[typeBucket].total || 0) + 1

    if (w.state === PERSISTENCE_STATES.ATTEMPTED) {
      report.attempted++
      report.byType[typeBucket].attempted++
    } else if (w.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
      report.verified++
      report.byType[typeBucket].verified++
    } else if (w.state === PERSISTENCE_STATES.FAILED) {
      report.failed++
      report.byType[typeBucket].failed++
    }
  }

  return report
}

export { PERSISTENCE_STATES, PERSIST_UNIT_TYPES, createPersistenceTracker, recordAttemptedWrite, verifyDurableWrite, failWrite, isRetrySafe, isDurablyVerified, persistenceReport }
