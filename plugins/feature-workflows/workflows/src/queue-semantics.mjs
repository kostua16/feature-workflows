// Truthful queue semantics: exactly-one-state guarantee, cap enforcement,
// selector application, deferred promotion, and coverage denominator.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Caps and selectors retain unprocessed in-scope features as resumable deferred
// work rather than completion. Excluded paths remain outside the denominator
// with recorded rationale.

import { LIFECYCLE_STATES } from './lifecycle.mjs'

// Apply a segment cap to a list of features. Features beyond the cap are
// marked deferred (NOT excluded or completed). Previously runnable features
// within the cap remain runnable. Idempotent: reapplying the same cap produces
// the same result.
//
// features: [{ id, lifecycle, ... }]
// cap: max number of features in non-deferred processing state
// Returns: new features array with cap applied (does NOT mutate input)
function applyCap(features, cap) {
  if (!Array.isArray(features)) {
    throw new Error('applyCap: features must be an array')
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('applyCap: cap must be a positive number')
  }

  let processingCount = 0
  return features.map((f) => {
    // Only consider in-scope features (not excluded)
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // Count features already in a processing state (in-progress, runnable that
    // have been admitted, completed, failed, blocked, skipped)
    const isProcessing = f.lifecycle !== LIFECYCLE_STATES.DEFERRED &&
      f.lifecycle !== LIFECYCLE_STATES.EXCLUDED

    if (isProcessing || f.lifecycle === LIFECYCLE_STATES.RUNNABLE) {
      if (processingCount < cap) {
        processingCount++
        return { ...f }
      }
      // Over cap — defer with rationale
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'cap-exceeded',
      }
    }

    // Already deferred or other state — leave as-is
    return { ...f }
  })
}

// Apply a selector to filter which features are admitted. Non-selected
// in-scope features are marked deferred (NOT excluded). Idempotent.
//
// features: [{ id, lifecycle, ... }]
// selector: { includeIds: [...] } or { excludeIds: [...] }
// Returns: new features array with selector applied
function applySelector(features, selector) {
  if (!Array.isArray(features)) {
    throw new Error('applySelector: features must be an array')
  }
  if (!selector) {
    return features.map((f) => ({ ...f }))
  }

  const includeSet = new Set(selector.includeIds || [])
  const excludeSet = new Set(selector.excludeIds || [])

  return features.map((f) => {
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // If includeIds is specified, non-matching features are deferred
    if (includeSet.size > 0 && !includeSet.has(f.id)) {
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'selector-excluded',
      }
    }

    // If excludeIds is specified, matching features are deferred
    if (excludeSet.size > 0 && excludeSet.has(f.id)) {
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'selector-excluded',
      }
    }

    return { ...f }
  })
}

// Promote deferred features up to cap after some features have completed.
// Each feature is promoted from deferred exactly once. Returns updated features.
//
// features: [{ id, lifecycle, ... }]
// completedIds: Set or array of feature IDs that have completed
// cap: max processing features
// Returns: { features: updated, promoted: [...], remainingDeferred: number }
function promoteDeferred(features, completedIds, cap) {
  if (!Array.isArray(features)) {
    throw new Error('promoteDeferred: features must be an array')
  }

  const completedSet = completedIds instanceof Set ? completedIds : new Set(completedIds || [])
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('promoteDeferred: cap must be a positive number')
  }

  // Count only actively processing features (runnable, in-progress, blocked)
  // against the cap — completed and failed features do NOT consume cap slots
  let processingCount = 0
  const promoted = []

  const updated = features.map((f) => {
    // Completed features stay completed — they free their cap slot
    if (completedSet.has(f.id) || f.lifecycle === LIFECYCLE_STATES.COMPLETED) {
      return { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED }
    }

    // Excluded features stay excluded
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // Failed features do not consume cap slots
    if (f.lifecycle === LIFECYCLE_STATES.FAILED) {
      return { ...f }
    }

    // Actively processing features (runnable, in-progress, blocked) consume cap
    if (f.lifecycle !== LIFECYCLE_STATES.DEFERRED && f.lifecycle !== LIFECYCLE_STATES.SKIPPED) {
      processingCount++
      return { ...f }
    }

    // Deferred feature — promote if under cap
    if (processingCount < cap) {
      processingCount++
      promoted.push(f.id)
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.RUNNABLE,
        promotedAt: (f.promotedAt || 0) + 1,
      }
    }

    // Still deferred — over cap
    return { ...f }
  })

  const remainingDeferred = updated.filter(
    (f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED
  ).length

  return { features: updated, promoted, remainingDeferred }
}

// Compute the coverage denominator: total in-scope features excluding
// those explicitly excluded. This is the truth source for readiness.
//
// features: [{ id, lifecycle, ... }]
// Returns: { denominator, excluded, total, breakdown: { ... } }
function queueDenominator(features) {
  if (!Array.isArray(features)) {
    throw new Error('queueDenominator: features must be an array')
  }

  const breakdown = {}
  let excluded = 0
  let total = features.length

  for (const f of features) {
    const lc = f.lifecycle || 'unknown'
    breakdown[lc] = (breakdown[lc] || 0) + 1
    if (lc === LIFECYCLE_STATES.EXCLUDED) {
      excluded++
    }
  }

  return {
    denominator: total - excluded,
    excluded,
    total,
    breakdown,
  }
}

// Compute exact completed/deferred counts for a cap-constrained segment.
// This is the core computation for the 23-feature/cap-8 progression:
// segment 1: 8 processed / 15 deferred
// segment 2: 16 processed / 7 deferred
// segment 3: 23 processed / 0 deferred
//
// totalFeatures: number of in-scope features
// cap: per-segment processing cap
// segment: 1-based segment number
// Returns: { processed, deferred, complete }
function segmentProgression(totalFeatures, cap, segment) {
  if (!Number.isFinite(totalFeatures) || totalFeatures < 0) {
    throw new Error('segmentProgression: totalFeatures must be non-negative')
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('segmentProgression: cap must be positive')
  }
  if (!Number.isFinite(segment) || segment < 1) {
    throw new Error('segmentProgression: segment must be >= 1')
  }

  const processed = Math.min(totalFeatures, cap * segment)
  const deferred = Math.max(0, totalFeatures - processed)
  const complete = processed >= totalFeatures

  return { processed, deferred, complete }
}

export { applyCap, applySelector, promoteDeferred, queueDenominator, segmentProgression }
