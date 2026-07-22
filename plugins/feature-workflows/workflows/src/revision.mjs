// Selective revision invalidation: deterministic digest computation, revision
// comparison, and gate-level selective invalidation. All functions are pure —
// no I/O, no side effects.
//
// When source files, scope, graph inputs, dependency summaries, or artifacts
// change, the engine compares durable revisions/digests and selectively
// invalidates only affected feature gates and derived project views while
// retaining independently valid evidence.

// Reuse the proven djb2 hash from state.mjs (same algorithm, already tested).
// Defined independently here to avoid import issues in the concatenated dist.
function computeDigest(input) {
  let str
  if (typeof input === 'string') {
    str = input
  } else if (input == null) {
    str = String(input)
  } else {
    str = JSON.stringify(sortKeys(input))
  }
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

// Deterministic JSON stringify with sorted keys for stable serialization.
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortKeys)
  const sorted = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key])
  }
  return sorted
}

// Stable digest for arbitrary JSON-serializable content.
function computeContentDigest(content) {
  return computeDigest(JSON.stringify(sortKeys(content)))
}

// Revision input types that drive selective invalidation.
// Each type maps to the gates it affects.
const REVISION_INPUTS = Object.freeze({
  SOURCE: 'source',       // affects: codeFacts, arch
  SCOPE: 'scope',         // affects: codeFacts
  GRAPH: 'graph',         // affects: arch
  DEPS: 'deps',           // affects: arch
  ARTIFACT: 'artifact',   // affects: only the gate that owns the artifact
})

// Gate-dependency map: which revision inputs affect which gates.
// This is the contract for selective invalidation — only listed gates
// are invalidated when their input revision changes.
const GATE_DEPENDENCY_MAP = Object.freeze({
  codeFacts: ['source', 'scope'],
  arch: ['source', 'graph', 'deps'],
  design: ['artifact'],
  plan: ['artifact'],
  tests: ['artifact'],
  requirements: ['artifact'],
  useCases: ['artifact'],
})

// Compare old and new revision sets and identify affected features and gates.
//
// oldRevisions: { source?: digest, scope?: digest, graph?: digest, deps?: digest,
//                 artifacts?: { gateName: digest } }
// newRevisions: same shape
// featureId: (optional) the feature these revisions belong to
//
// Returns: { affectedGates: [...], changedInputs: [...] }
function compareRevisions(oldRevisions, newRevisions, featureId) {
  const oldR = oldRevisions || {}
  const newR = newRevisions || {}
  const changedInputs = []
  const affectedGates = new Set()

  // Check top-level revision inputs
  for (const inputType of ['source', 'scope', 'graph', 'deps']) {
    if (oldR[inputType] !== newR[inputType]) {
      changedInputs.push(inputType)
      // Find gates affected by this input type
      for (const [gate, inputs] of Object.entries(GATE_DEPENDENCY_MAP)) {
        if (inputs.includes(inputType)) {
          affectedGates.add(gate)
        }
      }
    }
  }

  // Check artifact-level revisions
  const oldArtifacts = oldR.artifacts || {}
  const newArtifacts = newR.artifacts || {}
  for (const gateName of Object.keys({ ...oldArtifacts, ...newArtifacts })) {
    if (oldArtifacts[gateName] !== newArtifacts[gateName]) {
      changedInputs.push('artifact')
      affectedGates.add(gateName)
    }
  }

  return {
    affectedGates: Array.from(affectedGates).sort(),
    changedInputs: Array.from(changedInputs).sort(),
  }
}

// Selectively invalidate only affected gates in a feature shard.
//
// featureShard: { gates: { gateName: { digest, valid, ... }, ... } }
// revisionDelta: { affectedGates: [...], changedInputs: [...] } from compareRevisions
//
// Returns: new shard with only affected gates marked invalid. Independent
// gates retain their valid status. Does NOT mutate input.
function selectiveInvalidate(featureShard, revisionDelta) {
  if (!featureShard || typeof featureShard !== 'object') {
    throw new Error('selectiveInvalidate: featureShard must be an object')
  }
  const gates = featureShard.gates || {}
  const affectedGates = (revisionDelta && revisionDelta.affectedGates) || []

  // Build new gates object — only mark affected gates as invalid
  const newGates = {}
  for (const [gateName, gateState] of Object.entries(gates)) {
    if (affectedGates.includes(gateName)) {
      // Invalidate this gate
      newGates[gateName] = { ...gateState, valid: false, invalidReason: 'revision-changed' }
    } else {
      // Retain independent evidence — gate is still valid
      newGates[gateName] = { ...gateState }
    }
  }

  return { ...featureShard, gates: newGates }
}

// Filter a feature shard to only independently valid evidence.
// Returns a shard containing only gates whose inputs have not changed
// (i.e., gates that are still valid after selective invalidation).
function retainValidEvidence(featureShard) {
  if (!featureShard || typeof featureShard !== 'object') {
    return { gates: {} }
  }
  const gates = featureShard.gates || {}
  const validGates = {}

  for (const [gateName, gateState] of Object.entries(gates)) {
    if (gateState && gateState.valid !== false) {
      validGates[gateName] = { ...gateState }
    }
  }

  return { ...featureShard, gates: validGates }
}

export { REVISION_INPUTS, GATE_DEPENDENCY_MAP, computeDigest, computeContentDigest, compareRevisions, selectiveInvalidate, retainValidEvidence }
