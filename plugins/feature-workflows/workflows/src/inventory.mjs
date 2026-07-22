// Deterministic repository inventory: path classification, inventory construction,
// digest computation, and oversized-area refinement.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Every discovered path is accounted for as included or explicitly excluded,
// with the applicable policy (generated, vendor, ignore) recorded as evidence.

import { computeDigest } from './revision.mjs'

// Path classification policies. Each policy has a test predicate and a verdict.
const PATH_POLICIES = Object.freeze({
  INCLUDED: 'included',
  EXCLUDED: 'excluded',
  GENERATED: 'generated',
  VENDOR: 'vendor',
  IGNORED: 'ignored',
})

// Common generated/vendor/ignore directory patterns. A path matches if any
// segment equals one of these names. Deterministic: same path → same verdict.
const GENERATED_SEGMENTS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out', 'target',
  '__pycache__', '.pytest_cache', 'coverage', '.nyc_output',
  'vendor', '.vendor', 'third_party', 'third-party',
])
const IGNORE_SEGMENTS = new Set([
  '.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db',
])

// Common generated file extensions that indicate non-source paths.
const GENERATED_EXTENSIONS = new Set([
  '.min.js', '.min.css', '.map', '.lock', '.pyc', '.pyo',
  '.class', '.o', '.so', '.dylib', '.dll', '.exe',
])

// Classify a single path against the policy set.
// Returns { path, verdict, policy, evidence } — deterministic.
//
// policies: optional override { generatedSegments?, ignoreSegments?, generatedExtensions?, includePatterns?, excludePatterns? }
function classifyPath(path, policies) {
  const opts = policies || {}
  const genSegs = opts.generatedSegments || GENERATED_SEGMENTS
  const ignSegs = opts.ignoreSegments || IGNORE_SEGMENTS
  const genExts = opts.generatedExtensions || GENERATED_EXTENSIONS
  const includePats = opts.includePatterns || []
  const excludePats = opts.excludePatterns || []

  if (!path || typeof path !== 'string') {
    return { path: String(path || ''), verdict: PATH_POLICIES.EXCLUDED, policy: 'invalid', evidence: 'path is not a string' }
  }

  const segments = path.split('/')
  const basename = segments[segments.length - 1] || ''
  const ext = basename.substring(basename.lastIndexOf('.'))

  // Check ignore patterns first (highest precedence)
  for (const seg of segments) {
    if (ignSegs.has(seg)) {
      return { path, verdict: PATH_POLICIES.IGNORED, policy: 'ignore', evidence: `segment '${seg}' matches ignore list` }
    }
  }
  for (const pat of excludePats) {
    if (path.includes(pat)) {
      return { path, verdict: PATH_POLICIES.EXCLUDED, policy: 'exclude-pattern', evidence: `matches exclude pattern '${pat}'` }
    }
  }

  // Check generated/vendor
  for (const seg of segments) {
    if (genSegs.has(seg)) {
      const isVendor = seg === 'vendor' || seg === '.vendor' || seg === 'third_party' || seg === 'third-party'
      return {
        path,
        verdict: PATH_POLICIES.GENERATED,
        policy: isVendor ? 'vendor' : 'generated',
        evidence: `segment '${seg}' classified as ${isVendor ? 'vendor' : 'generated'}`,
      }
    }
  }

  // Check generated extensions
  for (const gExt of genExts) {
    if (basename.endsWith(gExt)) {
      return { path, verdict: PATH_POLICIES.GENERATED, policy: 'generated', evidence: `extension '${gExt}' is generated` }
    }
  }

  // Check explicit include patterns
  for (const pat of includePats) {
    if (path.includes(pat)) {
      return { path, verdict: PATH_POLICIES.INCLUDED, policy: 'include-pattern', evidence: `matches include pattern '${pat}'` }
    }
  }

  // Default: included
  return { path, verdict: PATH_POLICIES.INCLUDED, policy: 'default', evidence: 'no exclusion policy matched' }
}

// Build a deterministic inventory from a list of paths.
// Sorts paths canonically (by UTF-16 code unit order) so the same input
// always produces the same output regardless of traversal order.
//
// paths: string[]
// policies: optional override (see classifyPath)
// Returns: { entries: [...], digest, counts }
function buildInventory(paths, policies) {
  if (!Array.isArray(paths)) {
    throw new Error('buildInventory: paths must be an array')
  }

  // Canonical sort ensures deterministic ordering regardless of traversal order
  const sorted = [...paths].sort()

  const entries = sorted.map((p) => classifyPath(p, policies))

  const counts = {
    included: 0,
    excluded: 0,
    generated: 0,
    vendor: 0,
    ignored: 0,
  }

  for (const e of entries) {
    if (e.verdict === PATH_POLICIES.INCLUDED) counts.included++
    else if (e.verdict === PATH_POLICIES.EXCLUDED) counts.excluded++
    else if (e.verdict === PATH_POLICIES.GENERATED) {
      if (e.policy === 'vendor') counts.vendor++
      else counts.generated++
    } else if (e.verdict === PATH_POLICIES.IGNORED) counts.ignored++
  }

  return {
    entries,
    digest: inventoryDigest({ entries }),
    counts,
  }
}

// Compute a deterministic digest over an inventory's entries.
// Only the path and verdict of each entry contribute to the digest,
// so reclassification of evidence text does not change the fingerprint.
function inventoryDigest(inventory) {
  const entries = (inventory && inventory.entries) || []
  const fingerprint = entries.map((e) => `${e.path}|${e.verdict}`).join('\n')
  return computeDigest(fingerprint)
}

// Recursively refine an oversized area into bounded pages.
// If the area has more paths than maxPathsPerPage, split it in half
// recursively until each page is within the bound.
//
// area: { name, paths: string[] }
// maxPathsPerPage: number (must be > 0)
// Returns: pages — array of { name, paths, depth }
function refineOversizedArea(area, maxPathsPerPage) {
  if (!area || !Array.isArray(area.paths)) {
    throw new Error('refineOversizedArea: area must have a paths array')
  }
  if (!Number.isFinite(maxPathsPerPage) || maxPathsPerPage <= 0) {
    throw new Error('refineOversizedArea: maxPathsPerPage must be a positive number')
  }

  const pages = []

  function splitRecursive(name, paths, depth) {
    if (paths.length <= maxPathsPerPage) {
      pages.push({ name, paths: [...paths].sort(), depth })
      return
    }

    // Sort paths for deterministic splitting
    const sorted = [...paths].sort()
    const mid = Math.ceil(sorted.length / 2)

    // Derive sub-area names from the path prefix at the split point
    const firstHalf = sorted.slice(0, mid)
    const secondHalf = sorted.slice(mid)

    // Use common directory prefix for naming sub-areas
    const firstName = `${name}-a`
    const secondName = `${name}-b`

    splitRecursive(firstName, firstHalf, depth + 1)
    splitRecursive(secondName, secondHalf, depth + 1)
  }

  splitRecursive(area.name || 'area', area.paths, 0)
  return pages
}

export { PATH_POLICIES, GENERATED_SEGMENTS, IGNORE_SEGMENTS, GENERATED_EXTENSIONS, classifyPath, buildInventory, inventoryDigest, refineOversizedArea }
