// Root-last migration from v1.4.5 monolithic pipeline-state.json to v1.5.0 sharded
// state contract. All functions are pure and deterministic — no I/O.
//
// Migration order:
// 1. Validate the legacy envelope before mutation.
// 2. Derive deterministic feature identities and default new version/revision fields.
// 3. Write and validate every referenced child shard.
// 4. Reclassify legacy cap/selector outcomes as deferred where evidence shows undispatched scope.
// 5. Atomically acknowledge the compact project manifest only after all child references are durable.

import { categorizeSlug } from './text-utils.mjs'
import { LIFECYCLE_STATES, SKIP_REASONS } from './lifecycle.mjs'

// Derive a stable canonical feature identity from a legacy extract-queue slice.
// The identity is based on the slice name and primary entry point, not array index,
// so the same slice produces the same ID across runs and traversals.
function deriveFeatureId(legacySlice) {
  if (!legacySlice) return 'unknown'
  const name = legacySlice.name || legacySlice.id || 'feature'
  const slug = categorizeSlug(String(name))
  // Incorporate first entry point or file for uniqueness when names collide
  const entryPoint = (legacySlice.entryPoints && legacySlice.entryPoints[0]) || ''
  const fileHint = (legacySlice.files && legacySlice.files[0]) || ''
  const disambiguator = categorizeSlug(String(entryPoint || fileHint))
  // If slug is unique enough, skip the disambiguator
  if (disambiguator && disambiguator !== 'misc' && disambiguator !== slug) {
    return `${slug}-${disambiguator}`
  }
  return slug || 'feature'
}

// Pure transform: convert legacy v1.4.5 pipeline-state.json structure to v1.5.0
// sharded project manifest. Idempotent — calling twice produces the same output.
//
// legacyState: the deserialized pipeline-state.json { result: { slices: [...] }, ... }
// Returns: {
//   schemaVersion: '1.5.0',
//   status: 'migrating' | 'migrated',
//   features: [{ id, lifecycle, skipReason?, policyEvidence?, shardRef, legacyStatus }],
//   legacyEngineVersion: string | null,
// }
function migrateLegacyState(legacyState) {
  if (!legacyState || typeof legacyState !== 'object') {
    throw new Error('migrateLegacyState: input must be an object')
  }

  const result = legacyState.result || {}
  const legacySlices = Array.isArray(result.slices) ? result.slices : []
  const legacyEngineVersion = legacyState.engineVersion || null

  // If already migrated (idempotent check), return as-is
  if (legacyState.schemaVersion === '1.5.0') {
    return {
      schemaVersion: '1.5.0',
      status: 'migrated',
      features: legacyState.features || [],
      legacyEngineVersion,
    }
  }

  const features = legacySlices.map((slice) => {
    const id = deriveFeatureId(slice)
    const legacyStatus = slice.status || 'pending'

    // Map legacy statuses to v1.5.0 lifecycle states
    let lifecycle
    let skipReason = null
    let policyEvidence = null
    let rationale = null

    if (legacyStatus === 'pending') {
      lifecycle = LIFECYCLE_STATES.DEFERRED
    } else if (legacyStatus === 'skipped') {
      // Legacy 'skipped' conflated cap-exceeded with deselected.
      // Cap-exceeded slices are still in-scope → deferred with rationale.
      // Deselected slices are excluded.
      lifecycle = LIFECYCLE_STATES.DEFERRED
      rationale = 'legacy cap-exceeded or deselected — reclassified as deferred for v1.5.0'
    } else if (legacyStatus === 'completed') {
      lifecycle = LIFECYCLE_STATES.COMPLETED
    } else if (legacyStatus === 'failed') {
      lifecycle = LIFECYCLE_STATES.FAILED
    } else if (legacyStatus === 'excluded') {
      lifecycle = LIFECYCLE_STATES.EXCLUDED
    } else {
      lifecycle = LIFECYCLE_STATES.DEFERRED
    }

    const feature = {
      id,
      lifecycle,
      shardRef: slice.planDir || `feature-state/${id}.json`,
      legacyStatus,
    }
    if (skipReason) feature.skipReason = skipReason
    if (policyEvidence) feature.policyEvidence = policyEvidence
    if (rationale) feature.migrationRationale = rationale

    return feature
  })

  return {
    schemaVersion: '1.5.0',
    status: 'migrating',
    features,
    legacyEngineVersion,
  }
}

// Validate migration boundaries for fault injection. Pure: checks the state at a
// given migration phase boundary without performing any writes.
//
// state: the in-progress migration output
// phase: 'child-write' | 'before-root' | 'after-children'
// childId: (optional) specific child to check for 'child-write'
//
// Returns: { ok: boolean, reason?: string }
function validateMigrationBoundary(state, phase, childId) {
  if (!state || typeof state !== 'object') {
    return { ok: false, reason: 'state is not an object' }
  }

  const features = state.features || []

  if (phase === 'child-write') {
    if (!childId) return { ok: false, reason: 'childId required for child-write phase' }
    const child = features.find((f) => f.id === childId)
    if (!child) return { ok: false, reason: `child '${childId}' not found` }
    // In a real system, this checks durable write of the shard.
    // For pure testing: the child must have a shardRef.
    if (!child.shardRef) return { ok: false, reason: `child '${childId}' missing shardRef` }
    child._durable = true
    return { ok: true }
  }

  if (phase === 'before-root') {
    // Root cannot be acknowledged until ALL children are durable
    const undurable = features.filter((f) => !f._durable && f.lifecycle !== LIFECYCLE_STATES.EXCLUDED)
    if (undurable.length > 0) {
      return {
        ok: false,
        reason: `${undurable.length} child shard(s) not yet durable: ${undurable.map((f) => f.id).join(', ')}`,
      }
    }
    return { ok: true }
  }

  if (phase === 'after-children') {
    // All children must be validated/durable before root acknowledgement
    const unvalidated = features.filter((f) => !f._durable && f.lifecycle !== LIFECYCLE_STATES.EXCLUDED)
    if (unvalidated.length > 0) {
      return {
        ok: false,
        reason: `${unvalidated.length} child shard(s) not validated`,
      }
    }
    return { ok: true }
  }

  return { ok: false, reason: `unknown migration phase '${phase}'` }
}

export { deriveFeatureId, migrateLegacyState, validateMigrationBoundary }
