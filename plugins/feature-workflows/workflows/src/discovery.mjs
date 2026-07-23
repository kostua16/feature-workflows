// Durable paginated discovery: cursors, page advancement, interruption recovery.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Oversized areas refine recursively into bounded durable pages; interrupted
// discovery resumes without gaps or duplicates through stable cursor positions.

import { buildInventory, inventoryDigest, refineOversizedArea } from './inventory.mjs'
import { computeDigest } from './revision.mjs'

// Create a pagination cursor over an inventory.
// The cursor tracks position so interrupted discovery can resume exactly.
//
// inventory: { entries: [...], digest, counts } from buildInventory
// pageSize: number of entries per page (must be > 0)
// Returns: { includedEntries, pageSize, offset, exhausted, digest, pagesEmitted }
function createCursor(inventory, pageSize) {
  if (!inventory || !Array.isArray(inventory.entries)) {
    throw new Error('createCursor: inventory must have an entries array')
  }
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error('createCursor: pageSize must be a positive number')
  }

  // Only included entries are paginated; excluded/generated/ignored are
  // accounted for but not paged
  const included = inventory.entries.filter((e) => e.verdict === 'included')

  return {
    includedEntries: included,
    pageSize,
    offset: 0,
    exhausted: included.length === 0,
    digest: inventory.digest,
    pagesEmitted: 0,
    totalIncluded: included.length,
  }
}

// Advance the cursor by one page. Returns the page entries and an updated cursor.
// The page includes entries [offset, offset+pageSize). The updated cursor's
// offset advances past the page.
//
// cursor: from createCursor
// Returns: { page: [...], cursor: updatedCursor } or { page: [], cursor: same } if exhausted
function nextPage(cursor) {
  if (!cursor || cursor.exhausted || cursor.offset >= cursor.includedEntries.length) {
    return { page: [], cursor: { ...cursor, exhausted: true } }
  }

  const start = cursor.offset
  const end = Math.min(start + cursor.pageSize, cursor.includedEntries.length)
  const page = cursor.includedEntries.slice(start, end)

  const newOffset = end
  const exhausted = newOffset >= cursor.includedEntries.length

  return {
    page,
    cursor: {
      ...cursor,
      offset: newOffset,
      exhausted,
      pagesEmitted: cursor.pagesEmitted + 1,
    },
  }
}

// Resume discovery from an interrupted cursor position.
// Returns the same result as nextPage but validates that the cursor's
// digest matches the expected inventory — if the inventory changed,
// the cursor is marked stale.
//
// cursor: interrupted cursor
// expectedDigest: digest of the current inventory
// Returns: { page, cursor, stale } — stale=true if inventory changed
function resumeDiscovery(cursor, expectedDigest) {
  if (!cursor) {
    throw new Error('resumeDiscovery: cursor is required')
  }

  const stale = expectedDigest && cursor.digest !== expectedDigest
  if (stale) {
    // Cursor is stale — discovery must restart
    return { page: [], cursor: { ...cursor, exhausted: false, offset: 0, pagesEmitted: 0, digest: expectedDigest }, stale: true }
  }

  const result = nextPage(cursor)
  return { ...result, stale: false }
}

// Check if a cursor has covered all included entries.
function exhausted(cursor) {
  if (!cursor) return true
  return cursor.exhausted || cursor.offset >= (cursor.totalIncluded || 0)
}

// Collect all pages from an inventory at once (for testing/small inventories).
// Returns an array of page arrays.
function allPages(inventory, pageSize) {
  const cursor = createCursor(inventory, pageSize)
  const pages = []
  let c = cursor
  while (!exhausted(c)) {
    const result = nextPage(c)
    if (result.page.length === 0) break
    pages.push(result.page)
    c = result.cursor
  }
  return pages
}

// Compute a deterministic page digest from a single page's entries.
function pageDigest(pageEntries) {
  const fingerprint = (pageEntries || [])
    .map((e) => `${e.path}|${e.verdict}`)
    .join('\n')
  return computeDigest(fingerprint)
}

// Discovery result: pages + canonical feature identity extraction.
// Takes the full set of included pages and extracts canonical feature identities
// using path-based grouping. Each unique directory prefix becomes a candidate feature.
//
// pages: array of page arrays (from allPages or accumulated nextPage calls)
// Returns: { features: [{ id, paths, digest }], totalFeatures, coverageDigest }
function extractFeaturesFromPages(pages) {
  if (!Array.isArray(pages)) {
    throw new Error('extractFeaturesFromPages: pages must be an array')
  }

  // Flatten all pages into a single entry list
  const allEntries = pages.flat()

  // Group by directory prefix for feature extraction
  const dirMap = new Map()
  for (const entry of allEntries) {
    const segs = entry.path.split('/')
    // Use parent directory as feature identity (or root for top-level files)
    const dir = segs.length > 1 ? segs.slice(0, -1).join('/') : '(root)'
    if (!dirMap.has(dir)) {
      dirMap.set(dir, [])
    }
    dirMap.get(dir).push(entry.path)
  }

  const features = []
  for (const [dir, paths] of dirMap) {
    // Canonicalize the directory into a feature ID
    const id = dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root'
    features.push({
      id,
      paths: paths.sort(),
      digest: computeDigest(paths.sort().join('\n')),
    })
  }

  // Sort features by ID for deterministic ordering
  features.sort((a, b) => a.id.localeCompare(b.id))

  return {
    features,
    totalFeatures: features.length,
    coverageDigest: computeDigest(features.map((f) => f.id).sort().join('\n')),
  }
}

export { createCursor, nextPage, resumeDiscovery, exhausted, allPages, pageDigest, extractFeaturesFromPages }
