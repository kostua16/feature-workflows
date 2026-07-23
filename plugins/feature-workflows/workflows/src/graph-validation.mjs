// Validated feature graph: canonical identities, ownership verification,
// dependency edge validation, and cycle detection.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Graph validation rejects unexplained ownership gaps/overlap, collisions,
// dangling edges, and unsupported cycles before extraction.

import { computeDigest } from './revision.mjs'

// Cycle policy classifications
const CYCLE_POLICIES = Object.freeze({
  SUPPORTED: 'supported',   // cycle allowed via explicit policy (e.g. priority override)
  UNSUPPORTED: 'unsupported', // cycle must not be scheduled — deadlock
  NONE: 'none',             // no cycle detected
})

// Graph validation result verdicts
const GRAPH_VERDICTS = Object.freeze({
  VALID: 'valid',
  INVALID: 'invalid',
})

// Canonicalize feature identities to be collision-free.
// If two features have the same derived ID, disambiguate using their paths.
//
// features: [{ id, paths: [...], ... }]
// Returns: { canonical: [{ id, originalId, paths, ... }], collisions: [...] }
function canonicalizeIdentity(features) {
  if (!Array.isArray(features)) {
    throw new Error('canonicalizeIdentity: features must be an array')
  }

  const idMap = new Map()
  for (const f of features) {
    const id = f.id || 'unknown'
    if (!idMap.has(id)) {
      idMap.set(id, [])
    }
    idMap.get(id).push(f)
  }

  const collisions = []
  const canonical = []

  for (const [id, group] of idMap) {
    if (group.length === 1) {
      canonical.push({ ...group[0], originalId: id })
    } else {
      // Collision: disambiguate by index suffix
      collisions.push({ id, count: group.length, paths: group.flatMap((f) => f.paths || []) })
      group.forEach((f, i) => {
        canonical.push({ ...f, originalId: id, id: `${id}-${i + 1}` })
      })
    }
  }

  return { canonical, collisions }
}

// Detect cycles in a dependency edge list using depth-first search.
// Returns the first cycle found (if any) as an array of feature IDs.
//
// edges: [{ from, to }] — from depends on to (to must complete first)
// Returns: { hasCycle, cycle: [...], allCycles: [...] }
function detectCycle(edges) {
  if (!Array.isArray(edges)) {
    return { hasCycle: false, cycle: [], allCycles: [] }
  }

  // Build adjacency list
  const adj = new Map()
  const nodes = new Set()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push(e.to)
    nodes.add(e.from)
    nodes.add(e.to)
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map()
  for (const n of nodes) color.set(n, WHITE)

  const allCycles = []

  function dfsVisit(node, path) {
    color.set(node, GRAY)
    path.push(node)

    const neighbors = adj.get(node) || []
    for (const next of neighbors) {
      if (!color.has(next)) {
        color.set(next, WHITE)
      }
      const c = color.get(next)
      if (c === GRAY) {
        // Found a cycle — extract it from the path
        const cycleStart = path.indexOf(next)
        const cycle = path.slice(cycleStart).concat([next])
        allCycles.push(cycle)
      } else if (c === WHITE) {
        dfsVisit(next, path)
      }
    }

    path.pop()
    color.set(node, BLACK)
  }

  for (const n of nodes) {
    if (color.get(n) === WHITE) {
      dfsVisit(n, [])
    }
  }

  // Deduplicate cycles (normalize rotation)
  const seen = new Set()
  const uniqueCycles = []
  for (const cycle of allCycles) {
    // Normalize: rotate so the smallest ID is first, then join as key
    const minIdx = cycle.indexOf(cycle.reduce((a, b) => (a < b ? a : b)))
    const normalized = [...cycle.slice(minIdx, -1), ...cycle.slice(0, minIdx)].join('->')
    if (!seen.has(normalized)) {
      seen.add(normalized)
      uniqueCycles.push(cycle)
    }
  }

  return {
    hasCycle: uniqueCycles.length > 0,
    cycle: uniqueCycles[0] || [],
    allCycles: uniqueCycles,
  }
}

// Classify a cycle as supported (policy override) or unsupported (deadlock).
//
// edges: [{ from, to }]
// cyclePolicy: optional map of { edgeKey: 'supported' | 'unsupported' }
// Returns: { classification: 'supported' | 'unsupported' | 'none', cycle: [...] }
function classifyCycle(edges, cyclePolicy) {
  const detection = detectCycle(edges)
  if (!detection.hasCycle) {
    return { classification: CYCLE_POLICIES.NONE, cycle: [] }
  }

  // Check if the cycle has explicit policy support
  const policy = cyclePolicy || {}
  const cycleEdges = detection.cycle
  let allSupported = true

  for (let i = 0; i < cycleEdges.length - 1; i++) {
    const key = `${cycleEdges[i]}->${cycleEdges[i + 1]}`
    if (policy[key] !== 'supported') {
      allSupported = false
      break
    }
  }

  return {
    classification: allSupported ? CYCLE_POLICIES.SUPPORTED : CYCLE_POLICIES.UNSUPPORTED,
    cycle: detection.cycle,
  }
}

// Validate the full feature graph.
//
// features: [{ id, paths: [...] }]
// edges: [{ from, to }] — dependency edges
// ownershipMap: optional { path: featureId } — explicit ownership assignment
// cyclePolicy: optional map for supported cycles
//
// Returns: {
//   verdict: 'valid' | 'invalid',
//   errors: [{ type, detail }],
//   warnings: [{ type, detail }],
// }
function validateGraph(features, edges, ownershipMap, cyclePolicy) {
  const errors = []
  const warnings = []

  // 1. Check for identity collisions
  const idSet = new Set()
  const idCounts = new Map()
  for (const f of features || []) {
    const id = f.id || 'unknown'
    idCounts.set(id, (idCounts.get(id) || 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ type: 'identity-collision', detail: `Feature ID '${id}' appears ${count} times` })
    }
  }

  // 2. Check ownership gaps (explicit ownership map references unknown features)
  if (ownershipMap) {
    const featureIds = new Set((features || []).map((f) => f.id))

    for (const [path, ownerId] of Object.entries(ownershipMap)) {
      if (!featureIds.has(ownerId)) {
        errors.push({ type: 'ownership-gap', detail: `Path '${path}' owned by unknown feature '${ownerId}'` })
      }
    }
  }

  // 2b. Check for path overlaps between features.
  // Two features claiming the same path is an ownership overlap; if an
  // ownershipMap resolves the path to one of the claimants, the overlap is
  // explained (warning), otherwise it is unexplained (error).
  const pathClaims = new Map()
  for (const f of features || []) {
    for (const p of (f.paths || [])) {
      if (!pathClaims.has(p)) {
        pathClaims.set(p, [])
      }
      pathClaims.get(p).push(f.id)
    }
  }
  for (const [path, claimants] of pathClaims) {
    if (claimants.length > 1) {
      const uniqueClaimants = [...new Set(claimants)]
      if (uniqueClaimants.length > 1) {
        const resolvedBy = ownershipMap ? ownershipMap[path] : undefined
        if (resolvedBy && uniqueClaimants.includes(resolvedBy)) {
          warnings.push({
            type: 'ownership-overlap-explained',
            detail: `Path '${path}' claimed by ${uniqueClaimants.join(', ')}; resolved to '${resolvedBy}'`,
          })
        } else {
          errors.push({
            type: 'ownership-overlap',
            detail: `Path '${path}' claimed by multiple features: ${uniqueClaimants.join(', ')}`,
          })
        }
      }
    }
  }

  // 2c. Warn about feature paths not covered by the ownership map
  if (ownershipMap) {
    const allFeaturePaths = new Set((features || []).flatMap((f) => f.paths || []))
    for (const p of allFeaturePaths) {
      if (!(p in ownershipMap)) {
        warnings.push({ type: 'ownership-unassigned', detail: `Path '${p}' not in ownership map` })
      }
    }
  }

  // 3. Check for dangling edges (references to non-existent features)
  const featureIdSet = new Set((features || []).map((f) => f.id))
  for (const e of edges || []) {
    if (!featureIdSet.has(e.from)) {
      errors.push({ type: 'dangling-edge', detail: `Edge from unknown feature '${e.from}'` })
    }
    if (!featureIdSet.has(e.to)) {
      errors.push({ type: 'dangling-edge', detail: `Edge to unknown feature '${e.to}'` })
    }
  }

  // 4. Check for cycles
  if (edges && edges.length > 0) {
    const cycleResult = classifyCycle(edges, cyclePolicy)
    if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
      errors.push({
        type: 'unsupported-cycle',
        detail: `Unsupported dependency cycle: ${cycleResult.cycle.join(' -> ')}`,
      })
    } else if (cycleResult.classification === CYCLE_POLICIES.SUPPORTED) {
      warnings.push({
        type: 'supported-cycle',
        detail: `Supported dependency cycle: ${cycleResult.cycle.join(' -> ')}`,
      })
    }
  }

  return {
    verdict: errors.length === 0 ? GRAPH_VERDICTS.VALID : GRAPH_VERDICTS.INVALID,
    errors,
    warnings,
  }
}

// Compute a deterministic digest of the feature graph.
// Includes feature IDs (sorted), paths, and edges (sorted).
function graphDigest(features, edges) {
  const fPart = (features || [])
    .map((f) => `${f.id}:${(f.paths || []).sort().join(',')}`)
    .sort()
    .join('\n')
  const ePart = (edges || [])
    .map((e) => `${e.from}->${e.to}`)
    .sort()
    .join('\n')
  return computeDigest(`${fPart}\n---\n${ePart}`)
}

export { CYCLE_POLICIES, GRAPH_VERDICTS, canonicalizeIdentity, detectCycle, classifyCycle, validateGraph, graphDigest }
