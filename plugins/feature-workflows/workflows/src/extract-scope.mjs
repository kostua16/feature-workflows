import { FILE_ACK, SCOPE_VERDICT, AUDIT_VERDICT, ARTIFACT_CHECK, PENDING_RECORD, LOCATOR_ENTRY, HASH_SOURCES_VERDICT, IDENTITY_RECORD, REGISTRY_FILE, REGISTRY_ENTRY } from './schemas.mjs'
import { nsAgent, gm } from './config.mjs'
import { categorizeSlug } from './text-utils.mjs'
import { classifyAndRecordIssue } from './stages-issues.mjs'
import { safeAgent, flexibleAgent } from './agent-core.mjs'
import { plogFromResult } from './review-loop.mjs'
import { verifyAppendGrowth } from './decisions.mjs'
import { computeDigest } from './revision.mjs'
import { flushPipelineState } from './state.mjs'
import { main } from './main.mjs'


// ---- Extract mode (reverse design extraction) helpers ----------------------

// seedExtractQueue: build the resumable slice queue from the confirmed scope. PURE.
// Single coherent scope (or decomposition disabled) -> one entry whose planDir IS the
// parent planDir (artifacts land flat, no slices/ nesting). Wide scope -> one entry per
// slice under <parentPlanDir>slices/<slice-id>/. `selectedSlices` (--slices) filters by id;
// `maxSlices` caps the run — excess entries are kept with status 'skipped' so the index
// stays complete and a later run can resume them. Slices are ordered so dependencies
// (dependsOn) come first; on a cycle the given order is kept (stable).
function seedExtractQueue(scope, slices, parentPlanDir, maxSlices, selectedSlices) {
  const parent = String(parentPlanDir || '').replace(/\/$/, '') + '/'
  if (!slices || !slices.length) {
    return [{
      id: 'main',
      name: 'whole scope',
      planDir: parent,
      files: (scope && scope.files) || [],
      entryPoints: (scope && scope.entryPoints) || [],
      status: 'pending',
      artifacts: {},
    }]
  }
  // Stable dependency ordering: repeatedly take slices whose dependsOn are all placed.
  // A cycle (or dangling dependsOn) falls back to the given order for the remainder.
  const remaining = slices.slice()
  const ordered = []
  const placed = new Set()
  while (remaining.length) {
    const idx = remaining.findIndex((s) => (s.dependsOn || []).every((d) => placed.has(d) || !slices.some((o) => o.id === d)))
    const next = idx === -1 ? remaining.shift() : remaining.splice(idx, 1)[0]
    ordered.push(next)
    placed.add(next.id)
  }
  const selected = new Set((selectedSlices || []).map(String))
  const cap = Number.isFinite(maxSlices) && maxSlices > 0 ? maxSlices : ordered.length
  let active = 0
  return ordered.map((s) => {
    const id = categorizeSlug(s.id || s.name) || 'slice'
    const deselected = selected.size > 0 && !selected.has(s.id) && !selected.has(id)
    const overCap = active >= cap
    const status = deselected || overCap ? 'skipped' : 'pending'
    if (status === 'pending') active++
    return {
      id,
      name: s.name || id,
      planDir: `${parent}slices/${id}/`,
      files: s.files || [],
      entryPoints: s.entryPoints || [],
      status,
      artifacts: {},
    }
  })
}

// nextPendingSlice: first queue entry still pending. PURE.
function nextPendingSlice(queue) {
  return (queue || []).find((s) => s.status === 'pending') || null
}

// resolveScope (extract Gate X0): code-explorer resolves the hybrid input (free text /
// paths / globs / entry points) into a concrete scope manifest. Blocking — no scope means
// nothing to extract. Ambiguities are recorded to open-questions.md, not blocked on.
async function resolveScope({ task, planDir, result }) {
  const scopePath = planDir + 'scope-manifest.md'
  return flexibleAgent(
    `You are the code-explorer agent. Resolve the extraction input below into a CONCRETE code scope
and write a scope manifest to ${scopePath}. The input may be free text describing a feature/subsystem,
explicit paths/globs, entry points (API routes, CLI commands, exported functions), or any mix.
Use Serena tools (activate the project, list_dir, find_symbol, find_referencing_symbols,
search_for_pattern) to locate the code — do NOT guess paths.

IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT available.
Record anything needing user judgment in the ambiguities array instead of asking.

Extraction input:
${task}

Write to the manifest (and return in the verdict):
- files: every concrete file path in scope (resolved, existing files only)
- entryPoints: observable entry points into this code (routes, commands, handlers, exports)
- symbols: the key classes/functions anchoring the scope
- confidence: high|medium|low that this scope matches the input's intent
- wide: true ONLY if the scope spans multiple coherent subsystems that deserve separate design
  docs (e.g. a whole repo or a large multi-module directory); a single feature = wide:false
- suggestedSlices: when wide, candidate subsystem slices ({id, name, files, entryPoints, reason})
- ambiguities: unclear boundaries or intent questions (recorded, not blocking)

Do NOT modify any code. Do NOT commit. Return scopePath set to ${scopePath}.`,
    { label: 'code-explorer(scope)', phase: 'Extract Scope', schema: SCOPE_VERDICT, model: gm('scopeResolver') },
    result
  )
}

// auditExtractedDesign (extract Gate X7): critical-reviewer as an AS-IS design auditor.
// It audits the EXTRACTED docs (and the code they describe) for design debt, gaps, and
// doc<->code inconsistencies — it does NOT reject the docs. Findings append to
// <sliceDir>/issues-and-improvements.md in the exact section format the tune planner
// consumes (mirrors classifyAndRecordIssue), so /tune-feature <sliceDir> becomes the FIX
// flow for audit findings. Non-blocking.
async function auditExtractedDesign({ slicePlanDir, sliceState, task, result }) {
  const auditPath = slicePlanDir + 'design-audit.md'
  const docs = [
    sliceState.designPath ? `detailed design: ${sliceState.designPath}` : null,
    sliceState.archPath ? `architecture: ${sliceState.archPath}` : null,
    sliceState.useCasePath ? `e2e use cases: ${sliceState.useCasePath}` : null,
    sliceState.requirementsPath ? `requirements: ${sliceState.requirementsPath}` : null,
    sliceState.factsPath ? `codebase facts: ${sliceState.factsPath}` : null,
  ].filter(Boolean).join('\n')
  const verdict = await safeAgent(
    `You are the critical-reviewer agent acting as an AS-IS DESIGN AUDITOR. The design docs below were
EXTRACTED from existing code — they describe what the code does today. Do NOT reject or rewrite them.
Instead, audit the design they reveal for:
- design debt (wrong boundaries, leaky abstractions, tangled dependencies, missing seams)
- gaps (unhandled errors/edge cases, missing validation, absent tests for critical paths)
- cross-artifact inconsistencies (docs contradicting each other or the code)
Cite file:line evidence from the CODE for every finding. Write the audit report to ${auditPath}.

Extracted docs:
${docs}

Task context: ${task}

For each finding set: severity (blocker|high|medium|low), gate = the design doc that would have to
change to fix it (requirements|architecture|design|plan|tests|none), the finding phrased for a
design-doc author, a concrete suggestedFix, and evidence. Do NOT modify code or docs. Do NOT commit.`,
    { label: 'critical-reviewer(audit)', phase: 'Design Audit', schema: AUDIT_VERDICT, model: gm('audit') },
    result
  )
  if (!verdict || !verdict.auditPath) {
    plogFromResult(result, 'Design Audit: auditor returned no report (non-blocking) — skipping')
    return null
  }
  sliceState.auditPath = verdict.auditPath
  const upstream = (verdict.findings || []).filter((f) => f.gate && f.gate !== 'none')
  if (upstream.length) {
    const issuesPath = slicePlanDir.replace(/\/$/, '') + '/issues-and-improvements.md'
    const sections = upstream.map((f) => [
      `## Upstream issue — gate: ${f.gate}`,
      '',
      `**Severity:** ${f.severity || '(unspecified)'}`,
      `**Finding:** ${f.finding || '(unspecified)'}`,
      `**Suggested fix:** ${f.suggestedFix || '(none)'}`,
      '',
      '---',
      '',
    ].join('\n')).join('\n')
    try {
      const ack = await safeAgent(
        `You are a file-writer agent. APPEND the markdown sections below to ${issuesPath}.
If the file does not exist, create it with a "# Issues & Improvements" header first, then the sections.
Do NOT overwrite existing content — append only. Return ok=true and totalBytes = the file's total
size in bytes AFTER appending.

${sections}`,
        { label: 'file-writer(audit-issues)', phase: 'Design Audit', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
        result
      )
      sliceState.issuesPath = issuesPath
      const growth = verifyAppendGrowth(result, issuesPath, ack)
      if (growth && growth.ok === false) plogFromResult(result, `Design Audit: issues-and-improvements.md DID NOT grow (possible overwrite): ${issuesPath} ${growth.prev}->${growth.now}`)
      plogFromResult(result, `Design Audit: ${upstream.length} finding(s) recorded to ${issuesPath} (tune-consumable)`)
    } catch (e) {
      plogFromResult(result, `Design Audit: issues append failed (non-blocking): ${String(e)}`)
    }
  }
  plogFromResult(result, `Design Audit: report at ${verdict.auditPath}; findings=${(verdict.findings || []).length} (${upstream.length} upstream)`)
  return verdict
}

// ---- Pending-confirmation protocol (extract D0) ----------------------------

// Durable paths for the pending checkpoint and permanent locator.
const PENDING_DIR = 'docs/extract/.pending/'
const PENDING_LOCATOR_PATH = 'docs/extract/.pending-locator.json'

// File-reader result schemas (local — not exported).
const PENDING_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['record'],
  properties: {
    record: { type: ['object', 'null'], description: 'Parsed pending record, or null if the file does not exist' },
  },
}

const LOCATOR_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: { type: 'array', items: { type: 'object' }, description: 'Locator entries (empty if file does not exist)' },
  },
}

// generatePendingId: deterministic 16-hex pending id from task text + timestamp.
// Uses djb2 hash — sandbox-safe (no RNG or wall-clock dependency). PURE.
function generatePendingId(task, timestamp) {
  var raw = String(task || '') + '|' + String(timestamp || '')
  return computeDigest(raw).padStart(16, '0').slice(0, 16)
}

// buildPendingRecord: construct the PENDING-shaped record from preflight parts. PURE.
function buildPendingRecord(pendingId, task, verdict, createdAt) {
  return {
    pendingId: pendingId,
    task: String(task || ''),
    verdict: verdict,
    state: 'PENDING',
    createdAt: String(createdAt || ''),
  }
}

// isPendingExpired: check whether a pending record's bulky payload is past the TTL.
// Elapsed-time comparison via Date.parse; the caller supplies the current timestamp. PURE.
function isPendingExpired(record, maxAgeDays, nowTimestamp) {
  if (!record || !record.createdAt) return true
  if (record.state === 'EXPIRED') return true
  var createdMs = Date.parse(record.createdAt)
  var nowMs = Date.parse(nowTimestamp)
  if (isNaN(createdMs) || isNaN(nowMs)) return false
  var ageMs = nowMs - createdMs
  var maxMs = (maxAgeDays || 30) * 24 * 60 * 60 * 1000
  return ageMs > maxMs
}

// resolveLocatorEntry: pure lookup in a locator array. Returns the entry or null.
function resolveLocatorEntry(locator, pendingId) {
  if (!Array.isArray(locator)) return null
  for (var i = 0; i < locator.length; i++) {
    if (locator[i] && locator[i].pendingId === pendingId) return locator[i]
  }
  return null
}

// ---- Deterministic identity + hashing (Phase 13 / D1.1) --------------------

// normalizeToPosix: convert a path to repo-relative POSIX form.
// Replaces backslashes, strips leading ./ and /. PURE.
function normalizeToPosix(path) {
  var p = String(path || '').replace(/\\/g, '/')
  // strip leading ./ repeatedly (e.g. ././src -> src)
  while (p.startsWith('./')) p = p.slice(2)
  // strip a single leading /
  if (p.startsWith('/')) p = p.slice(1)
  return p
}

// validateHashes: fail-closed validation of per-file contentSha256 + scopeDigest.
// Returns { valid: true } only when every hash is 64-lowercase-hex and the arrays
// are well-formed; otherwise { valid: false, reason }. PURE.
var HEX64 = /^[0-9a-f]{64}$/
function validateHashes(fileHashes, scopeDigest) {
  if (!Array.isArray(fileHashes) || fileHashes.length === 0) {
    return { valid: false, reason: 'fileHashes is empty or not an array' }
  }
  for (var i = 0; i < fileHashes.length; i++) {
    var fh = fileHashes[i]
    if (!fh || typeof fh !== 'object') {
      return { valid: false, reason: 'fileHashes[' + i + '] is not an object' }
    }
    if (typeof fh.path !== 'string' || !fh.path) {
      return { valid: false, reason: 'fileHashes[' + i + '].path missing' }
    }
    if (typeof fh.contentSha256 !== 'string' || !HEX64.test(fh.contentSha256)) {
      return { valid: false, reason: 'fileHashes[' + i + '].contentSha256 is not 64-lowercase-hex' }
    }
  }
  if (typeof scopeDigest !== 'string' || !HEX64.test(scopeDigest)) {
    return { valid: false, reason: 'scopeDigest is not 64-lowercase-hex' }
  }
  return { valid: true }
}

// deriveFeatureFolder: deterministic folder derivation from file hashes + scopeDigest.
// No agent calls, no LLM. Returns { area, primarySlug, scopeId16, featureId, planDir, anchorPath }.
// PURE.
function deriveFeatureFolder(arg) {
  var fileHashes = arg && arg.fileHashes
  var scopeDigest = arg && arg.scopeDigest
  var entryPoints = (arg && arg.entryPoints) || []
  var entrySet = new Set(entryPoints.map(normalizeToPosix))
  // Normalize all paths to POSIX for deterministic sorting.
  var allPaths = (fileHashes || []).map(function (fh) {
    return normalizeToPosix(fh.path)
  })
  // Exclude entry points from anchor candidates; fallback to full set if all are entries.
  var candidates = allPaths.filter(function (p) { return !entrySet.has(p) })
  if (!candidates.length) candidates = allPaths.slice()
  candidates.sort()
  var anchorPath = candidates[0] || ''
  var segments = anchorPath.split('/').filter(Boolean)
  var area = segments.length >= 2 ? segments[0] + '/' + segments[1] : 'uncategorized'
  var basename = segments.length > 0 ? segments[segments.length - 1] : 'feature'
  var primarySlug = categorizeSlug(basename)
  var scopeId16 = String(scopeDigest || '').slice(0, 16)
  var featureId = primarySlug + '-' + scopeId16
  var planDir = 'docs/extract/' + area + '/' + featureId + '/'
  return { area: area, primarySlug: primarySlug, scopeId16: scopeId16, featureId: featureId, planDir: planDir, anchorPath: anchorPath }
}

// hashSources: agent-mediated SHA-256 computation. The engine NEVER computes SHA-256.
// The agent reads each file, computes per-file contentSha256 using Node's crypto,
// then frames sorted [path, hash] pairs as JSON and SHA-256s that to produce scopeDigest.
async function hashSources(arg) {
  var files = arg && arg.files
  var result = arg && arg.result
  if (!files || !files.length) return null
  var fileList = files.map(normalizeToPosix).join('\n')
  return safeAgent(
    'You are a hash-sources agent. For each file path listed below, READ the file content and\n' +
    'compute its SHA-256 hash using Node.js crypto (available to you via shell or scripts).\n' +
    'Then compute a combined scopeDigest:\n' +
    '1. Sort all (path, contentSha256) pairs by path ascending (lexicographic).\n' +
    '2. Frame as a JSON array of [path, contentSha256] pairs: e.g. [["src/a.ts","abc..."],["src/b.ts","def..."]]\n' +
    '3. Compute SHA-256 of JSON.stringify(that array) — this is scopeDigest.\n\n' +
    'All hashes must be 64 lowercase hex characters. Return the per-file hashes and scopeDigest.\n\n' +
    'Files to hash:\n' + fileList + '\n\n' +
    'Do NOT modify any files. Do NOT commit.',
    { label: 'hash-sources', phase: 'Hash Sources', schema: HASH_SOURCES_VERDICT, model: gm('todo') },
    result
  )
}

// resolveScopePreflight: resolve the extraction scope WITHOUT writing any files.
// Wraps the code-explorer agent call — captures the verdict in-memory for the
// pending checkpoint. Returns { pendingId, task, verdict, state:'PENDING', createdAt }
// or null if scope resolution fails. WRITES NOTHING TO DISK.
async function resolveScopePreflight(arg) {
  var task = arg && arg.task
  var result = arg && arg.result
  var timestamp = arg && arg.timestamp
  var pendingId = generatePendingId(task, timestamp)
  var verdict = await flexibleAgent(
    'You are the code-explorer agent. Resolve the extraction input below into a CONCRETE code scope.\n' +
    'DO NOT WRITE ANY FILES — just resolve the scope and return the verdict fields.\n' +
    'Use Serena tools (activate the project, list_dir, find_symbol, find_referencing_symbols,\n' +
    'search_for_pattern) to locate the code — do NOT guess paths.\n\n' +
    'IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT available.\n' +
    'Record anything needing user judgment in the ambiguities array instead of asking.\n\n' +
    'Extraction input:\n' + (task || '') + '\n\n' +
    'Return in the verdict:\n' +
    '- files: every concrete file path in scope (resolved, existing files only)\n' +
    '- entryPoints: observable entry points into this code (routes, commands, handlers, exports)\n' +
    '- symbols: the key classes/functions anchoring the scope\n' +
    '- confidence: high|medium|low\n' +
    '- wide: true ONLY if the scope spans multiple coherent subsystems\n' +
    '- suggestedSlices: when wide, candidate subsystem slices\n' +
    '- ambiguities: unclear boundaries or intent questions (recorded, not blocking)\n' +
    '- scopePath: set to "pending" (the manifest is written later after confirmation)\n' +
    '- summary: one-line scope summary\n\n' +
    'Do NOT modify any code. Do NOT commit. Do NOT write any files.',
    { label: 'code-explorer(scope-preflight)', phase: 'Pending Confirm', schema: SCOPE_VERDICT, model: gm('scopeResolver') },
    result
  )
  if (!verdict || !verdict.files || !verdict.files.length) return null

  // Phase 13: hash sources + validate + derive deterministic folder.
  // The engine NEVER computes SHA-256 — hashSources delegates to an agent.
  var hashResult = await hashSources({ files: verdict.files, result: result })
  if (!hashResult || !hashResult.files || !hashResult.scopeDigest) {
    // Blocked: can't hash — return null so the caller writes a blocked handoff.
    return null
  }
  var validation = validateHashes(hashResult.files, hashResult.scopeDigest)
  if (!validation.valid) {
    // Fail-closed: return a blocked preflight with the hash error reason.
    return {
      pendingId: pendingId,
      task: String(task || ''),
      verdict: verdict,
      state: 'PENDING',
      createdAt: String(timestamp || ''),
      hashError: validation.reason,
    }
  }
  // Derive the deterministic folder from validated hashes.
  var entryPoints = (verdict.entryPoints || []).map(normalizeToPosix)
  var folder = deriveFeatureFolder({
    fileHashes: hashResult.files,
    scopeDigest: hashResult.scopeDigest,
    entryPoints: entryPoints,
  })
  return {
    pendingId: pendingId,
    task: String(task || ''),
    verdict: verdict,
    state: 'PENDING',
    createdAt: String(timestamp || ''),
    fileHashes: hashResult.files,
    scopeDigest: hashResult.scopeDigest,
    featureId: folder.featureId,
    derivedPlanDir: folder.planDir,
    area: folder.area,
    scopeId16: folder.scopeId16,
    primarySlug: folder.primarySlug,
    anchorPath: folder.anchorPath,
  }
}

// writePendingRecord: persist the pending record JSON to <pendingDir><pendingId>.json
// via a file-writer agent (temp-then-rename pattern).
async function writePendingRecord(pendingDir, record, result) {
  var filePath = pendingDir + record.pendingId + '.json'
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + filePath + ' using a\n' +
    'temp-then-rename pattern (write to a .tmp file first, then rename to the target).\n' +
    'Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + filePath + '.\n\nJSON:\n' + JSON.stringify(record, null, 2),
    { label: 'file-writer(pending-record)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// readPendingRecord: read + parse a pending record via a file-reader agent.
// Returns the record object or null if the file does not exist.
async function readPendingRecord(pendingDir, pendingId, result) {
  var filePath = pendingDir + pendingId + '.json'
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + filePath + ' and return its full JSON content parsed\n' +
    'as an object in the "record" field. If the file does not exist, return record=null.',
    { label: 'file-reader(pending-record)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: PENDING_READ_RESULT, model: gm('todo') },
    result
  )
  return loaded
}

// appendLocatorEntry: append a permanent locator entry to the locator JSON file.
// Reads the existing array (or starts fresh), appends, writes atomically.
async function appendLocatorEntry(locatorPath, entry, result) {
  var existing = await safeAgent(
    'You are a file-reader agent. Read ' + locatorPath + ' and return its JSON content as an\n' +
    'array in the "entries" field. If the file does not exist, return entries=[].',
    { label: 'file-reader(locator)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: LOCATOR_READ_RESULT, model: gm('todo') },
    result
  )
  var entries = (existing && Array.isArray(existing.entries)) ? existing.entries : []
  entries.push(entry)
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON array to ' + locatorPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + locatorPath + '.\n\nJSON:\n' + JSON.stringify(entries, null, 2),
    { label: 'file-writer(locator)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// resolveLocator: look up a pendingId in the locator file via a file-reader agent.
// Returns { featureId, planDir, promotedAt } or null.
async function resolveLocator(locatorPath, pendingId, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + locatorPath + ' and return its JSON content as an\n' +
    'array in the "entries" field. If the file does not exist, return entries=[].',
    { label: 'file-reader(locator-lookup)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: LOCATOR_READ_RESULT, model: gm('todo') },
    result
  )
  var entries = (loaded && Array.isArray(loaded.entries)) ? loaded.entries : []
  return resolveLocatorEntry(entries, pendingId)
}

// writeScopeManifestFromVerdict: serialize a scope verdict to scope-manifest.md
// and write via a file-writer agent (temp-then-rename).
async function writeScopeManifestFromVerdict(scopeManifestPath, verdict, result) {
  var files = (verdict && verdict.files) || []
  var entryPoints = (verdict && verdict.entryPoints) || []
  var symbols = (verdict && verdict.symbols) || []
  var confidence = (verdict && verdict.confidence) || 'unspecified'
  var ambiguities = (verdict && verdict.ambiguities) || []
  var summary = (verdict && verdict.summary) || ''
  var lines = ['# Scope Manifest', '', '**Confidence:** ' + confidence, '', '## Files in scope']
  for (var i = 0; i < files.length; i++) lines.push('- ' + files[i])
  if (entryPoints.length) { lines.push('', '## Entry points'); for (var j = 0; j < entryPoints.length; j++) lines.push('- ' + entryPoints[j]) }
  if (symbols.length) { lines.push('', '## Key symbols'); for (var k = 0; k < symbols.length; k++) lines.push('- ' + symbols[k]) }
  if (summary) lines.push('', '## Summary', '', summary)
  if (ambiguities.length) { lines.push('', '## Ambiguities'); for (var m = 0; m < ambiguities.length; m++) lines.push('- ' + ambiguities[m]) }
  var md = lines.join('\n') + '\n'
  return safeAgent(
    'You are a file-writer agent. Write the following markdown to ' + scopeManifestPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + scopeManifestPath + '.\n\nContent:\n' + md,
    { label: 'file-writer(scope-manifest)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
}

// writeIdentityStub: write the D0 .identity.json placeholder. Ownership digest
// is null — Phase 13 fills it in with the real deterministic hash.
async function writeIdentity(arg) {
  var identityPath = arg.identityPath
  var featureId = arg.featureId
  var planDir = arg.planDir
  var scopeDigest = arg.scopeDigest
  var area = arg.area
  var scopeId16 = arg.scopeId16
  var createdAt = String(arg.createdAt || '')
  var result = arg.result
  var identity = {
    featureId: featureId,
    planDir: planDir,
    ownershipScopeDigest: scopeDigest,
    area: area,
    scopeId16: scopeId16,
    createdAt: createdAt,
  }
  return safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + identityPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + identityPath + '.\n\nJSON:\n' + JSON.stringify(identity, null, 2),
    { label: 'file-writer(identity)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
}

// promotePendingRecord: atomically promote a PENDING record to PROMOTED.
// NEW-feature branch: create folder + scope-manifest.md + .identity.json stub,
//   then root-last pipeline-state.json via flushPipelineState.
// EXISTING-feature branch: update scope-manifest.md only (do NOT overwrite identity).
// Both branches: update pending record state + append permanent locator entry.
async function promotePendingRecord(arg) {
  var pendingDir = arg && arg.pendingDir
  var record = arg && arg.record
  var planDir = arg && arg.planDir
  var result = arg && arg.result
  var config = arg && arg.config
  var timestamp = arg && arg.timestamp
  var identityFields = arg && arg.identityFields
  var identityPath = planDir + '.identity.json'
  var scopeManifestPath = planDir + 'scope-manifest.md'

  // Check if pipeline-state.json already exists at planDir (EXISTING vs NEW).
  var existingCheck = await safeAgent(
    'You are a file-reader agent. Check if ' + planDir + 'pipeline-state.json exists.\n' +
    'Return exists=true and sizeBytes if it exists; exists=false if not.',
    { label: 'file-reader(promotion-check)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: ARTIFACT_CHECK, model: gm('todo') },
    result
  )
  var isExisting = existingCheck && existingCheck.exists === true

  if (!isExisting) {
    // NEW feature — create scope-manifest.md + .identity.json (root-last: state after)
    await writeScopeManifestFromVerdict(scopeManifestPath, record.verdict, result)
    // Write real identity with the actual ownershipScopeDigest (not null stub).
    await writeIdentity({
      identityPath: identityPath,
      featureId: (identityFields && identityFields.featureId) || (planDir.split('/').filter(Boolean).pop() || planDir),
      planDir: planDir,
      scopeDigest: (identityFields && identityFields.scopeDigest) || '',
      area: (identityFields && identityFields.area) || 'uncategorized',
      scopeId16: (identityFields && identityFields.scopeId16) || '',
      createdAt: String(timestamp || ''),
      result: result,
    })
    // Root-last: pipeline-state.json only after identity + manifest exist
    await flushPipelineState(planDir, result, config)
  } else {
    // EXISTING feature — revision, NOT a new identity.
    // Do NOT create folder, do NOT overwrite .identity.json.
    // Update scope-manifest.md with the new scope verdict.
    await writeScopeManifestFromVerdict(scopeManifestPath, record.verdict, result)
    // pipeline-state.json already exists — preserved; updated later by the extract flow
  }

  // Update pending record to PROMOTED (durable — survives crash on replay)
  var promotedRecord = Object.assign({}, record, {
    state: 'PROMOTED',
    promotedAt: String(timestamp || ''),
    planDir: planDir,
  })
  await writePendingRecord(pendingDir, promotedRecord, result)

  // Append permanent compact locator entry (retained indefinitely)
  await appendLocatorEntry(PENDING_LOCATOR_PATH, {
    pendingId: record.pendingId,
    featureId: (identityFields && identityFields.featureId) || (planDir.split('/').filter(Boolean).pop() || planDir),
    planDir: planDir,
    promotedAt: String(timestamp || ''),
  }, result)

  if (result && Array.isArray(result.logLines)) {
    result.logLines.push('Promote: ' + record.pendingId + ' → ' + planDir + ' (' + (isExisting ? 'EXISTING' : 'NEW') + ')')
  }
  return { promoted: true, record: promotedRecord, isNew: !isExisting }
}

// ---- Feature-identity registry (Phase 14 / D1.2-D1.4) -----------------------

// Registry path — the single JSON index of all extracted features.
const REGISTRY_PATH = 'docs/extract/.registry.json'

// File-reader result schemas for registry + sidecar reads (local — not exported).
var REGISTRY_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['registry'],
  properties: {
    registry: { type: ['object', 'null'], description: 'Parsed registry object, or null if the file does not exist or is corrupt' },
  },
}

var IDENTITY_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['identity'],
  properties: {
    identity: { type: ['object', 'null'], description: 'Parsed identity record, or null if the file does not exist' },
  },
}

var PIPELINE_STATE_FOR_RECOVERY = {
  type: 'object',
  additionalProperties: false,
  required: ['state'],
  properties: {
    state: { type: ['object', 'null'], description: 'Parsed pipeline-state.json, or null if missing' },
  },
}

// findFeature: rename-resilient feature lookup. PURE — no agent calls, no I/O.
// Determines whether a current scope reuses an existing feature folder, creates a
// new one, or is ambiguous/blocked. A file matches by path OR contentSha256
// (survives full rename). Strong = anchor match OR majority of min(counts).
function findFeature(arg) {
  var currentFiles = (arg && arg.currentFiles) || []
  var currentAnchor = (arg && arg.currentAnchor) || ''
  var registryFeatures = (arg && arg.registryFeatures) || []

  // Empty input — nothing to match against.
  if (!currentFiles.length) {
    return { decision: 'blocked', reason: 'empty-current-files' }
  }

  // Build current path and hash lookup sets.
  var currentPathSet = new Set()
  var currentHashSet = new Set()
  for (var i = 0; i < currentFiles.length; i++) {
    var cf = currentFiles[i]
    if (cf && cf.path) currentPathSet.add(cf.path)
    if (cf && cf.contentSha256) currentHashSet.add(cf.contentSha256)
  }

  var strongCandidates = []
  var weakMatches = []

  for (var j = 0; j < registryFeatures.length; j++) {
    var feat = registryFeatures[j]
    if (!feat || !feat.files) continue

    var featPathSet = new Set()
    var featHashSet = new Set()
    for (var k = 0; k < feat.files.length; k++) {
      var ff = feat.files[k]
      if (ff && ff.path) featPathSet.add(ff.path)
      if (ff && ff.contentSha256) featHashSet.add(ff.contentSha256)
    }

    // Count current files matching by path OR hash (dedup: a file matching both counts once).
    var totalMatches = 0
    for (var m = 0; m < currentFiles.length; m++) {
      var cur = currentFiles[m]
      var matchByPath = cur && cur.path && featPathSet.has(cur.path)
      var matchByHash = cur && cur.contentSha256 && featHashSet.has(cur.contentSha256)
      if (matchByPath || matchByHash) totalMatches++
    }

    var anchorMatch = currentAnchor && feat.anchorPath && currentAnchor === feat.anchorPath
    var minCount = Math.min(currentFiles.length, feat.files.length)
    var majority = Math.floor(minCount / 2) + 1
    var isStrong = anchorMatch || totalMatches >= majority

    if (isStrong) {
      strongCandidates.push({
        featureId: feat.featureId,
        matchCount: totalMatches,
        anchorMatch: !!anchorMatch,
      })
    } else if (totalMatches > 0) {
      weakMatches.push({ featureId: feat.featureId, matchCount: totalMatches })
    }
  }

  // Decision logic:
  // Zero strong → new (if no weak) or blocked weak-only (if some overlap).
  // One strong → reuse (trivially strictly-highest).
  // Two+ strong → find strictly-highest; tie at top → blocked ambiguous.
  if (!strongCandidates.length) {
    if (weakMatches.length) {
      return { decision: 'blocked', reason: 'weak-only-match', weakMatches: weakMatches }
    }
    return { decision: 'new' }
  }

  if (strongCandidates.length === 1) {
    return {
      decision: 'reuse',
      featureId: strongCandidates[0].featureId,
      matchCount: strongCandidates[0].matchCount,
    }
  }

  // Two+ strong candidates — find the strictly-highest match count.
  strongCandidates.sort(function (a, b) { return b.matchCount - a.matchCount })
  var topCount = strongCandidates[0].matchCount
  var tied = strongCandidates.filter(function (c) { return c.matchCount === topCount })

  if (tied.length === 1) {
    return {
      decision: 'reuse',
      featureId: tied[0].featureId,
      matchCount: tied[0].matchCount,
    }
  }

  return {
    decision: 'blocked',
    reason: 'ambiguous-match',
    candidates: tied.map(function (c) { return { featureId: c.featureId, matchCount: c.matchCount } }),
  }
}

// upsertRegistryEntry: insert or replace a feature entry in the registry. PURE —
// does NOT mutate the input registry; returns a shallow copy with the entry set.
function upsertRegistryEntry(registry, entry) {
  var base = registry && registry.features ? registry : { features: {} }
  var updated = { features: Object.assign({}, base.features) }
  updated.features[entry.featureId] = entry
  return updated
}

// readRegistry: load the registry JSON via a file-reader agent.
// Returns { features: {} } if the file does not exist; null if corrupt JSON.
async function readRegistry(registryPath, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + registryPath + ' and return its full JSON content parsed\\n' +
    'as an object in the "registry" field. If the file does not exist, return registry=null.\\n' +
    'If the file exists but contains invalid JSON, return registry=null.',
    { label: 'file-reader(registry)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: REGISTRY_READ_RESULT, model: gm('todo') },
    result
  )
  if (!loaded || loaded.registry === null || loaded.registry === undefined) {
    // Distinguish "file not found" from "corrupt" — safeAgent returns the parsed
    // object. null registry means either not-found or corrupt; caller treats both
    // as "no valid registry" and falls through to empty or recovery.
    return null
  }
  return loaded.registry
}

// writeRegistry: atomically persist the registry JSON via temp-then-rename.
async function writeRegistry(registryPath, registry, result) {
  var json = JSON.stringify(registry, null, 2)
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + registryPath + ' using a\\n' +
    'temp-then-rename pattern (write to a .tmp file first, then rename to the target).\\n' +
    'Create the directory if it does not exist.\\n\\n' +
    'Return ok=true and path=' + registryPath + '.\\n\\nJSON:\\n' + json,
    { label: 'file-writer(registry)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// readIdentitySidecar: load <planDir>/.identity.json via a file-reader agent.
// Returns the identity object or null if the file does not exist.
async function readIdentitySidecar(identityPath, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + identityPath + ' and return its full JSON content\\n' +
    'parsed as an object in the "identity" field. If the file does not exist, return identity=null.',
    { label: 'file-reader(identity-sidecar)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: IDENTITY_READ_RESULT, model: gm('todo') },
    result
  )
  if (!loaded) return null
  return loaded.identity
}

// checkFolderCollision: guard against overwriting another feature's folder on
// NEW-feature creation. Compares the requester's full ownershipScopeDigest
// against the existing .identity.json at the target planDir.
async function checkFolderCollision(arg) {
  var planDir = arg && arg.planDir
  var requesterDigest = arg && arg.requesterDigest
  var result = arg && arg.result
  var identityPath = planDir + '.identity.json'

  var identity = await readIdentitySidecar(identityPath, result)
  if (!identity) {
    // No existing identity — safe to create.
    return { collision: false }
  }

  // Compare FULL 64-hex ownership digest (not truncated featureId).
  if (identity.ownershipScopeDigest === requesterDigest) {
    return { collision: false, idempotent: true }
  }

  return {
    collision: true,
    existingFeatureId: identity.featureId || '(unknown)',
  }
}

// recoverRegistry: startup recovery — reconcile 'extracting' entries from
// current pipeline-state + sidecars. Immutable ownership fields always come from
// .identity.json sidecars (never from the potentially-stale registry). Mutable
// fields (files, status) are rebuilt from current pipeline-state. Fail-closed
// if evidence is missing.
async function recoverRegistry(arg) {
  var registryPath = arg && arg.registryPath
  var result = arg && arg.result

  var registry = await readRegistry(registryPath, result)

  // Corrupt or missing registry — try to rebuild from sidecars.
  if (!registry) {
    // Scan for .identity.json sidecars under docs/extract/ to rebuild.
    var scanResult = await safeAgent(
      'You are a file-reader agent. Search for all .identity.json files under docs/extract/\\n' +
      '(excluding docs/extract/.pending/ and docs/extract/slices/). For each found, read and\\n' +
      'return its JSON content. Return an array of identity objects in the "identities" field.\\n' +
      'If none found, return identities=[].',
      { label: 'file-reader(registry-rebuild)', phase: 'Registry Recovery', agentType: nsAgent('file-writer'), schema: { type: 'object', additionalProperties: false, required: ['identities'], properties: { identities: { type: 'array', items: { type: 'object' } } } }, model: gm('todo') },
      result
    )
    var identities = (scanResult && scanResult.identities) || []
    if (!identities.length) {
      // No sidecars — nothing to rebuild; return empty registry.
      return { recovered: 0, failed: 0, registry: { features: {} }, failClosed: true }
    }
    // Rebuild registry from sidecar identities. Mutable fields are unknown
    // without pipeline-state — mark all as 'stale' (fail-closed).
    var rebuilt = { features: {} }
    for (var ri = 0; ri < identities.length; ri++) {
      var id = identities[ri]
      if (!id || !id.featureId) continue
      rebuilt.features[id.featureId] = {
        featureId: id.featureId,
        planDir: id.planDir,
        ownershipScopeDigest: id.ownershipScopeDigest,
        scopeId16: id.scopeId16 || '',
        files: [],
        anchorPath: '',
        status: 'stale',
        updatedAt: '',
        recoveryError: 'corrupt-registry-rebuild',
      }
    }
    await writeRegistry(registryPath, rebuilt, result)
    return { recovered: 0, failed: identities.length, registry: rebuilt }
  }

  // Registry exists — reconcile each 'extracting' entry.
  var features = (registry && registry.features) || {}
  var featureIds = Object.keys(features)
  if (!featureIds.length) {
    return { recovered: 0, failed: 0, registry: registry }
  }

  var recovered = 0
  var failed = 0
  var updatedRegistry = { features: Object.assign({}, features) }

  for (var fi = 0; fi < featureIds.length; fi++) {
    var fid = featureIds[fi]
    var entry = features[fid]
    if (!entry) continue

    // Verify .identity.json still exists (immutable ownership source).
    var identityPath = entry.planDir + '.identity.json'
    var identity = await readIdentitySidecar(identityPath, result)

    if (!identity) {
      // Missing identity — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'missing-identity',
      })
      failed++
      continue
    }

    // Always source immutable fields from the sidecar (not the stale registry).
    entry.featureId = identity.featureId
    entry.planDir = identity.planDir
    entry.ownershipScopeDigest = identity.ownershipScopeDigest
    entry.scopeId16 = identity.scopeId16 || entry.scopeId16

    if (entry.status !== 'extracting') {
      // Non-extracting entries keep their status; immutable fields refreshed.
      updatedRegistry.features[fid] = entry
      continue
    }

    // Extracting entry — rebuild mutable fields from current pipeline-state.
    var statePath = entry.planDir + 'pipeline-state.json'
    var stateResult = await safeAgent(
      'You are a file-reader agent. Read ' + statePath + ' and return its JSON content\\n' +
      'parsed as an object in the "state" field. If the file does not exist, return state=null.',
      { label: 'file-reader(recovery-state)', phase: 'Registry Recovery', agentType: nsAgent('file-writer'), schema: PIPELINE_STATE_FOR_RECOVERY, model: gm('todo') },
      result
    )
    var pipelineState = (stateResult && stateResult.state) || null

    if (!pipelineState) {
      // Missing pipeline-state — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'missing-pipeline-state',
      })
      failed++
      continue
    }

    // Check for durable extraction evidence (gate checkpoints or extractReady).
    var hasEvidence = (pipelineState.result && (
      (pipelineState.result._gateCheckpoints && Object.keys(pipelineState.result._gateCheckpoints).length > 0) ||
      pipelineState.result.extractReady === true
    ))

    if (!hasEvidence) {
      // Incomplete extraction — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'incomplete-pipeline-state',
      })
      failed++
      continue
    }

    // Rebuild mutable files from pipeline-state if available.
    var rebuiltFiles = []
    if (pipelineState.result && pipelineState.result._sourceDigest && pipelineState.result._sourceDigest.files) {
      rebuiltFiles = pipelineState.result._sourceDigest.files
    } else if (pipelineState.result && pipelineState.result.extractScope && pipelineState.result.extractScope.files) {
      // Fallback: derive file list from the scope verdict (paths only — no hashes).
      var scopeFiles = pipelineState.result.extractScope.files || []
      rebuiltFiles = scopeFiles.map(function (p) {
        return { path: normalizeToPosix(p), contentSha256: '' }
      })
    }

    updatedRegistry.features[fid] = Object.assign({}, entry, {
      files: rebuiltFiles,
      status: pipelineState.result.extractReady ? 'current' : 'stale',
      recoveryError: pipelineState.result.extractReady ? undefined : 'extraction-incomplete',
    })

    if (pipelineState.result.extractReady) {
      recovered++
    } else {
      failed++
    }
  }

  // Write recovered registry atomically.
  await writeRegistry(registryPath, updatedRegistry, result)
  return { recovered: recovered, failed: failed, registry: updatedRegistry }
}

export { seedExtractQueue, nextPendingSlice, resolveScope, auditExtractedDesign, generatePendingId, buildPendingRecord, isPendingExpired, resolveLocatorEntry, resolveScopePreflight, writePendingRecord, readPendingRecord, appendLocatorEntry, resolveLocator, promotePendingRecord, PENDING_DIR, PENDING_LOCATOR_PATH, normalizeToPosix, validateHashes, deriveFeatureFolder, hashSources, writeIdentity, findFeature, upsertRegistryEntry, readRegistry, writeRegistry, readIdentitySidecar, checkFolderCollision, recoverRegistry, REGISTRY_PATH, REGISTRY_ENTRY, REGISTRY_FILE }