// Schedulability plan: prerequisite waves, cycle/no-progress classification,
// and bounded dependency context. All functions are pure and deterministic.
//
// The schedulability plan produces deterministic prerequisite waves, explicit
// cycle/no-progress outcomes, and bounded verified dependency summaries.

import { detectCycle, classifyCycle, CYCLE_POLICIES } from './graph-validation.mjs'
import { LIFECYCLE_STATES } from './lifecycle.mjs'

// Schedulability verdicts
const SCHEDULABILITY_VERDICTS = Object.freeze({
  SCHEDULABLE: 'schedulable',
  NO_PROGRESS: 'no-progress',
  UNSUPPORTED_CYCLE: 'unsupported-cycle',
})

// Compute deterministic prerequisite waves from features and dependency edges.
// Features with no unmet dependencies form wave 1; features whose dependencies
// are all in earlier waves form subsequent waves. Within a wave, cap limits
// how many features can be admitted.
//
// features: [{ id, ... }]
// edges: [{ from, to }] — from depends on to (to must complete first)
// cap: max features per wave (0 = unlimited)
// Returns: { waves: [[featureId, ...], ...], unscheduled: [...], verdict: 'schedulable'|'no-progress'|'unsupported-cycle' }
function computeWaves(features, edges, cap, cyclePolicy) {
  if (!Array.isArray(features)) {
    throw new Error('computeWaves: features must be an array')
  }

  const featureIds = new Set(features.map((f) => f.id))

  // Build reverse adjacency: for each feature, what does it depend on?
  const dependencies = new Map()
  for (const id of featureIds) {
    dependencies.set(id, new Set())
  }
  for (const e of (edges || [])) {
    if (featureIds.has(e.from) && featureIds.has(e.to)) {
      dependencies.get(e.from).add(e.to)
    }
  }

  // Check for unsupported cycles (respecting policy)
  const cycleCheck = detectCycle(edges || [])
  if (cycleCheck.hasCycle) {
    const cycleResult = classifyCycle(edges, cyclePolicy || {})
    if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
      return {
        waves: [],
        unscheduled: [...featureIds],
        verdict: SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE,
        cycle: cycleCheck.cycle,
      }
    }
  }

  // Topological wave assignment (Kahn's algorithm with wave tracking)
  // Cap is per-wave: limits how many features each wave admits, not total budget
  const waves = []
  const scheduled = new Set()

  while (scheduled.size < featureIds.size) {
    // Find features whose dependencies are all scheduled
    const ready = []
    for (const id of featureIds) {
      if (scheduled.has(id)) continue
      const deps = dependencies.get(id)
      let allMet = true
      for (const d of deps) {
        if (!scheduled.has(d)) {
          allMet = false
          break
        }
      }
      if (allMet) {
        ready.push(id)
      }
    }

    if (ready.length === 0) {
      // No progress — remaining features have unresolvable dependencies
      break
    }

    ready.sort() // deterministic ordering
    // Per-wave cap: limits features admitted per wave, not total budget.
    // Overflow features stay eligible for the next wave.
    const waveCap = (Number.isFinite(cap) && cap > 0) ? cap : ready.length
    const wave = ready.slice(0, waveCap)

    for (const id of wave) {
      scheduled.add(id)
    }
    waves.push(wave)
  }

  const unscheduled = [...featureIds].filter((id) => !scheduled.has(id)).sort()

  return {
    waves,
    unscheduled,
    verdict: unscheduled.length > 0
      ? SCHEDULABILITY_VERDICTS.NO_PROGRESS
      : SCHEDULABILITY_VERDICTS.SCHEDULABLE,
  }
}

// Compute bounded dependency context for a single feature.
// Traverses the dependency graph up to maxDepth hops, collecting verified
// summaries of each dependency. The context is bounded to prevent
// unbounded prompt growth.
//
// featureId: the feature to compute context for
// features: [{ id, paths, digest, ... }]
// edges: [{ from, to }]
// maxDepth: maximum traversal depth (default 3)
// Returns: { featureId, context: [{ id, depth, paths, digest }], bounded: boolean }
function boundedDependencyContext(featureId, features, edges, maxDepth) {
  if (!featureId) {
    throw new Error('boundedDependencyContext: featureId is required')
  }

  const depth = Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 3

  // Build feature lookup
  const featureMap = new Map()
  for (const f of features || []) {
    featureMap.set(f.id, f)
  }

  // Build reverse dependency lookup: what does each feature depend on?
  const depsOf = new Map()
  for (const e of edges || []) {
    if (!depsOf.has(e.from)) depsOf.set(e.from, [])
    depsOf.get(e.from).push(e.to)
  }

  const context = []
  const visited = new Set([featureId])
  const queue = [{ id: featureId, currentDepth: 0 }]

  while (queue.length > 0) {
    const { id, currentDepth } = queue.shift()

    if (currentDepth >= depth) continue

    const deps = depsOf.get(id) || []
    for (const depId of deps.sort()) {
      if (visited.has(depId)) continue
      visited.add(depId)

      const depFeature = featureMap.get(depId)
      context.push({
        id: depId,
        depth: currentDepth + 1,
        paths: (depFeature && depFeature.paths) || [],
        digest: (depFeature && depFeature.digest) || null,
      })

      queue.push({ id: depId, currentDepth: currentDepth + 1 })
    }
  }

  return {
    featureId,
    context,
    bounded: visited.size > depth * 5, // heuristic: if we visited many nodes, context was bounded
  }
}

// Overall schedulability decision for the full feature set.
// Combines cycle detection, wave computation, and no-progress detection.
//
// features: [{ id, ... }]
// edges: [{ from, to }]
// cap: optional per-wave cap
// cyclePolicy: optional map of supported cycle edges
// Returns: { verdict, waves, unscheduled, cycleDetected, details }
function schedulabilityDecision(features, edges, cap, cyclePolicy) {
  const cycleResult = classifyCycle(edges || [], cyclePolicy || {})

  if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
    return {
      verdict: SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE,
      waves: [],
      unscheduled: (features || []).map((f) => f.id).sort(),
      cycleDetected: true,
      cycle: cycleResult.cycle,
      details: `Unsupported dependency cycle prevents scheduling: ${cycleResult.cycle.join(' -> ')}`,
    }
  }

  const waveResult = computeWaves(features, edges, cap, cyclePolicy)

  return {
    verdict: waveResult.verdict,
    waves: waveResult.waves,
    unscheduled: waveResult.unscheduled,
    cycleDetected: cycleResult.classification === CYCLE_POLICIES.SUPPORTED,
    cycle: cycleResult.classification === CYCLE_POLICIES.SUPPORTED ? cycleResult.cycle : [],
    details: waveResult.verdict === SCHEDULABILITY_VERDICTS.SCHEDULABLE
      ? `All ${waveResult.waves.reduce((s, w) => s + w.length, 0)} features scheduled across ${waveResult.waves.length} wave(s)`
      : `${waveResult.unscheduled.length} feature(s) cannot be scheduled (no progress)`,
  }
}

export { SCHEDULABILITY_VERDICTS, computeWaves, boundedDependencyContext, schedulabilityDecision }
