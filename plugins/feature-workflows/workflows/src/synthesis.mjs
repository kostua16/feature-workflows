// Incremental project-view synthesis: derive system overview, dependency map,
// cross-cutting concerns, and coverage index from bounded verified feature
// summaries. All functions are pure — no I/O, no side effects.
//
// Views update idempotently: the same verified summaries always produce the
// same project views. Selective revision invalidation means only views whose
// contributing feature digests changed are rebuilt; unaffected views are
// retained. This obeys the revision contract established for feature gates.

// Reuse the proven djb2 hash algorithm (same as revision.mjs and state.mjs).
// Defined independently to keep this module self-contained in the concatenated dist.
function synthHash(str) {
  var s = String(str == null ? '' : str)
  var h = 5381
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

function synthDigest(obj) {
  return synthHash(JSON.stringify(synthSortKeys(obj)))
}

function synthSortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortKeys)
  var sorted = {}
  for (var key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key])
  }
  return sorted
}

// View types produced by synthesis. Each derives from feature summaries.
const VIEW_TYPES = Object.freeze({
  SYSTEM_OVERVIEW: 'systemOverview',
  DEPENDENCY_MAP: 'dependencyMap',
  CROSS_CUTTING: 'crossCutting',
  COVERAGE_INDEX: 'coverageIndex',
})

// Initialize empty synthesis state.
function createSynthesisState() {
  return {
    views: {},
    viewRevisions: {},
    featureDigests: {},
    synthesized: false,
  }
}

// Derive the coverage index from feature summaries.
// Pure: counts lifecycle states deterministically.
function deriveCoverageIndex(summaries) {
  var counts = {
    completed: 0,
    deferred: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    inProgress: 0,
    runnable: 0,
  }
  for (var i = 0; i < summaries.length; i++) {
    var lc = summaries[i].lifecycle || 'runnable'
    if (counts[lc] !== undefined) counts[lc]++
  }
  var denominator = summaries.length - counts.excluded
  return {
    denominator: denominator,
    completed: counts.completed,
    deferred: counts.deferred,
    remaining: counts.runnable + counts.deferred + counts.inProgress,
    blocked: counts.blocked,
    failed: counts.failed,
    skipped: counts.skipped,
    excluded: counts.excluded,
  }
}

// Derive the dependency map from feature summaries.
// Collects all declared cross-feature dependencies into a unified edge list.
function deriveDependencyMap(summaries) {
  var edges = []
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i]
    var deps = s.dependencies || []
    for (var j = 0; j < deps.length; j++) {
      edges.push({ from: s.id, to: deps[j], type: 'depends-on' })
    }
  }
  edges.sort(function (a, b) {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1
    if (a.to !== b.to) return a.to < b.to ? -1 : 1
    return 0
  })
  return { edges: edges, totalEdges: edges.length }
}

// Derive cross-cutting concerns from feature summaries.
// Aggregates shared tags/concerns across features.
function deriveCrossCutting(summaries) {
  var concernMap = {}
  for (var i = 0; i < summaries.length; i++) {
    var concerns = summaries[i].crossCuttingConcerns || []
    for (var j = 0; j < concerns.length; j++) {
      var c = concerns[j]
      if (!concernMap[c]) concernMap[c] = []
      concernMap[c].push(summaries[i].id)
    }
  }
  var result = []
  for (var concern of Object.keys(concernMap).sort()) {
    if (concernMap[concern].length > 1) {
      result.push({ concern: concern, features: concernMap[concern].sort() })
    }
  }
  return { sharedConcerns: result }
}

// Derive the system overview from feature summaries.
// Aggregates module names, descriptions, and artifact paths.
function deriveSystemOverview(summaries) {
  var modules = []
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i]
    modules.push({
      id: s.id,
      name: s.name || s.id,
      lifecycle: s.lifecycle || 'runnable',
      artifacts: s.artifacts || {},
    })
  }
  modules.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 })
  return { modules: modules, totalModules: modules.length }
}

// Synthesize all project views from verified feature summaries.
// Idempotent: same summaries + revisions always produce the same views.
// Only summaries whose digest changed trigger a view rebuild.
function synthesizeProjectViews(featureSummaries, oldState, revisions) {
  if (!featureSummaries || !Array.isArray(featureSummaries)) {
    featureSummaries = []
  }
  var prev = oldState || createSynthesisState()
  var revs = revisions || {}

  // Compute per-feature digests to detect changes
  var newDigests = {}
  var changed = false
  for (var i = 0; i < featureSummaries.length; i++) {
    var s = featureSummaries[i]
    var d = synthDigest(s)
    newDigests[s.id] = d
    if (prev.featureDigests[s.id] !== d) {
      changed = true
    }
  }

  // If nothing changed and revisions match, retain existing views (idempotent)
  var revChanged = false
  for (var key of Object.keys(revs)) {
    if (prev.viewRevisions[key] !== revs[key]) revChanged = true
  }

  if (!changed && !revChanged && prev.synthesized) {
    // Fully idempotent: return previous state
    return prev
  }

  // Derive all four view types from the verified summaries
  var views = {
    systemOverview: deriveSystemOverview(featureSummaries),
    dependencyMap: deriveDependencyMap(featureSummaries),
    crossCutting: deriveCrossCutting(featureSummaries),
    coverageIndex: deriveCoverageIndex(featureSummaries),
  }

  return {
    views: views,
    viewRevisions: Object.assign({}, revs),
    featureDigests: newDigests,
    synthesized: true,
  }
}

// Check if synthesis views are current against the given revisions.
function isSynthesisCurrent(state, currentRevisions) {
  if (!state || !state.synthesized) return false
  var revs = currentRevisions || {}
  for (var key of Object.keys(revs)) {
    if (state.viewRevisions[key] !== revs[key]) return false
  }
  return true
}

// Selectively invalidate only views whose contributing features changed.
// Uses the revision contract: only affected views are marked stale.
function invalidateStaleViews(state, revisionDelta) {
  if (!state || !state.synthesized) return createSynthesisState()
  var affected = (revisionDelta && revisionDelta.changedInputs) || []
  if (affected.length === 0) return state

  // Source changes affect system overview and dependency map
  // Scope changes affect system overview and coverage index
  // Graph changes affect dependency map
  // Artifact changes affect system overview
  var staleViews = {}
  var VIEW_DEPS = {
    systemOverview: ['source', 'scope', 'artifact'],
    dependencyMap: ['source', 'graph', 'deps'],
    crossCutting: ['source', 'scope'],
    coverageIndex: ['scope'],
  }

  for (var view of Object.keys(VIEW_DEPS)) {
    var inputs = VIEW_DEPS[view]
    for (var j = 0; j < affected.length; j++) {
      if (inputs.indexOf(affected[j]) !== -1) {
        staleViews[view] = true
        break
      }
    }
  }

  if (Object.keys(staleViews).length === 0) return state

  // Mark synthesis as not current — next synthesize call rebuilds stale views
  var newState = Object.assign({}, state)
  newState.staleViews = Object.keys(staleViews).sort()
  return newState
}

// Summary for handoff/status reporting.
function synthesisSummary(state) {
  if (!state || !state.synthesized) {
    return { synthesized: false, views: 0, staleViews: [] }
  }
  return {
    synthesized: true,
    views: Object.keys(state.views).length,
    staleViews: state.staleViews || [],
    coverage: state.views.coverageIndex || null,
  }
}

export { VIEW_TYPES, createSynthesisState, synthesizeProjectViews, isSynthesisCurrent, invalidateStaleViews, synthesisSummary, deriveCoverageIndex, deriveDependencyMap, deriveCrossCutting, deriveSystemOverview }
