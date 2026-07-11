// Tests for the review mode (standalone design-docset audit): mode plumbing, the pure
// helpers (severity filter, lens selection, artifact inventory, issue-section format,
// report composition), the new verdict schemas, and structural source assertions for the
// review branch invariants (non-mutating, pre-planDir block on missing resume, exact
// tune-consumable section format shared with the classifier/audit writers).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  resolveMode,
  gateModeActive,
  REVIEW_FINDINGS_VERDICT,
  REVIEW_MERGE_VERDICT,
  REVIEW_VERIFY_VERDICT,
  REVIEW_LENSES,
  SEVERITY_RANK,
  meetsMinSeverity,
  resolveMinSeverity,
  resolveReviewLenses,
  collectReviewDocs,
  reviewIssueSection,
  buildReviewReport,
  MODEL_DEFAULTS,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- mode plumbing ----------------------------------------------------------

test('resolveMode: review is a valid mode at every precedence level', () => {
  assert.equal(resolveMode({ mode: 'review' }, { mode: 'design' }, null), 'review')
  assert.equal(resolveMode({}, { mode: 'review' }, null), 'review')
  assert.equal(resolveMode({}, {}, { result: { mode: 'review' } }), 'review')
})

test('gateModeActive: review gates run in review only; other groups stay off', () => {
  assert.equal(gateModeActive('review', 'review'), true)
  for (const mode of ['design', 'implement', 'tune', 'extract']) {
    assert.equal(gateModeActive('review', mode), false)
  }
  for (const group of ['design', 'implement', 'extract']) {
    assert.equal(gateModeActive(group, 'review'), false)
  }
  assert.equal(gateModeActive('shared', 'review'), true)
})

test('model tiers: review gates have defaults (lens/verify deep, merge mechanical)', () => {
  assert.equal(MODEL_DEFAULTS.reviewLens, 'opus')
  assert.equal(MODEL_DEFAULTS.reviewMerge, 'sonnet')
  assert.equal(MODEL_DEFAULTS.reviewVerify, 'opus')
})

// ---- severity helpers -------------------------------------------------------

test('meetsMinSeverity: respects the blocker>high>medium>low order', () => {
  assert.equal(meetsMinSeverity('blocker', 'high'), true)
  assert.equal(meetsMinSeverity('high', 'high'), true)
  assert.equal(meetsMinSeverity('medium', 'high'), false)
  assert.equal(meetsMinSeverity('low', 'low'), true)
})

test('meetsMinSeverity: unknown severity ranks lowest; unknown floor records everything', () => {
  assert.equal(meetsMinSeverity('bogus', 'high'), false)
  assert.equal(meetsMinSeverity('bogus', 'low'), true) // unknown sev (0) >= low (0)
  assert.equal(meetsMinSeverity('blocker', 'bogus'), true)
})

test('resolveMinSeverity: passes valid values, falls back to low', () => {
  for (const s of Object.keys(SEVERITY_RANK)) assert.equal(resolveMinSeverity(s), s)
  assert.equal(resolveMinSeverity('critical'), 'low')
  assert.equal(resolveMinSeverity(undefined), 'low')
})

// ---- lens selection ---------------------------------------------------------

test('resolveReviewLenses: empty/invalid selection falls back to all lenses', () => {
  assert.equal(resolveReviewLenses([]).length, REVIEW_LENSES.length)
  assert.equal(resolveReviewLenses(['nope']).length, REVIEW_LENSES.length)
  assert.equal(resolveReviewLenses(undefined).length, REVIEW_LENSES.length)
})

test('resolveReviewLenses: valid subset is honored, unknown keys dropped', () => {
  const picked = resolveReviewLenses(['consistency', 'nope', 'scope'])
  assert.deepEqual(picked.map((l) => l.key), ['consistency', 'scope'])
})

test('REVIEW_LENSES: the five documented dimensions, each with a focus prompt', () => {
  assert.deepEqual(
    REVIEW_LENSES.map((l) => l.key),
    ['consistency', 'completeness', 'feasibility', 'testability', 'scope']
  )
  for (const l of REVIEW_LENSES) assert.ok(l.focus && l.focus.length > 20)
})

// ---- artifact inventory -----------------------------------------------------

test('collectReviewDocs: gathers only recorded artifacts + stage files', () => {
  const result = {
    definitionPath: 'd/idea.md',
    archPath: 'd/architecture.md',
    designPath: null,
    planned: true,
    stages: [{ id: 'stage01', file: 'd/stage01.md' }, { id: 'stage02' }],
  }
  const docs = collectReviewDocs(result, 'd/plan.md')
  const paths = docs.map((d) => d.path)
  assert.ok(paths.includes('d/idea.md'))
  assert.ok(paths.includes('d/architecture.md'))
  assert.ok(paths.includes('d/plan.md'))
  assert.ok(paths.includes('d/stage01.md'))
  assert.equal(paths.length, 4) // null designPath and file-less stage02 excluded
})

test('collectReviewDocs: phantom plan excluded until actually written (extract baselines)', () => {
  const docs = collectReviewDocs({ archPath: 'd/architecture.md', planned: false }, 'd/plan.md')
  assert.deepEqual(docs.map((d) => d.path), ['d/architecture.md'])
  const accepted = collectReviewDocs({ planAccepted: true }, 'd/plan.md')
  assert.deepEqual(accepted.map((d) => d.path), ['d/plan.md'])
})

test('collectReviewDocs: empty state yields an empty inventory (review-no-artifacts)', () => {
  assert.deepEqual(collectReviewDocs({}, undefined), [])
})

// ---- tune-consumable section format ----------------------------------------

test('reviewIssueSection: byte-compatible with the classifier/audit section format', () => {
  const section = reviewIssueSection({
    gate: 'design',
    severity: 'high',
    finding: 'X contradicts Y',
    suggestedFix: 'align X',
  })
  assert.ok(section.startsWith('## Upstream issue — gate: design\n'))
  assert.ok(section.includes('**Severity:** high'))
  assert.ok(section.includes('**Finding:** X contradicts Y'))
  assert.ok(section.includes('**Suggested fix:** align X'))
  assert.ok(section.includes('\n---\n'))
})

test('reviewIssueSection: missing optional fields degrade to placeholders', () => {
  const section = reviewIssueSection({ gate: 'plan' })
  assert.ok(section.includes('**Severity:** (unspecified)'))
  assert.ok(section.includes('**Suggested fix:** (none)'))
})

// The engine must contain exactly THREE writers of this section header (classifier, audit,
// review) — all sharing the same format string so the tune planner parses them uniformly.
test('source: the upstream-issue section header format is shared by all three writers', () => {
  const matches = source.match(/## Upstream issue — gate:/g) || []
  assert.equal(matches.length, 3)
})

// ---- report composition -----------------------------------------------------

test('buildReviewReport: deterministic report with counts, docs, and findings', () => {
  const body = buildReviewReport({
    task: 'add retry layer',
    docs: [{ kind: 'plan', path: 'd/plan.md' }],
    lenses: REVIEW_LENSES.slice(0, 2),
    findings: [
      { severity: 'blocker', gate: 'design', finding: 'boom', suggestedFix: 'fix', evidence: 'd/x.md:3', lenses: ['consistency'], verification: 'holds' },
      { severity: 'low', gate: 'none', finding: 'nit' },
    ],
    recordedCount: 1,
    droppedDuplicates: 2,
    refutedCount: 1,
    minSeverity: 'low',
  })
  assert.ok(body.startsWith('# Design Review'))
  assert.ok(body.includes('**Task:** add retry layer'))
  assert.ok(body.includes('blocker=1'))
  assert.ok(body.includes('1 refuted by verification'))
  assert.ok(body.includes('2 duplicate(s) merged'))
  assert.ok(body.includes('## [blocker] gate: design (lens: consistency)'))
  assert.ok(body.includes('**Verification:** holds'))
  assert.ok(body.includes('## [low] gate: none'))
})

// ---- schemas ----------------------------------------------------------------

test('review schemas: finding shape mirrors the classifier/audit contract', () => {
  const item = REVIEW_FINDINGS_VERDICT.properties.findings.items
  assert.deepEqual(item.required, ['severity', 'gate', 'finding'])
  assert.deepEqual(item.properties.gate.enum, ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'])
  assert.deepEqual(item.properties.severity.enum, ['blocker', 'high', 'medium', 'low'])
  const mergedItem = REVIEW_MERGE_VERDICT.properties.findings.items
  assert.deepEqual(mergedItem.required, ['severity', 'gate', 'finding'])
  assert.ok(mergedItem.properties.lenses)
  assert.deepEqual(REVIEW_VERIFY_VERDICT.required, ['confirmed', 'reasoning'])
})

// ---- structural source assertions -------------------------------------------

test('source: review without a resumable state blocks BEFORE planDir derivation', () => {
  // The guard must sit before the categorizer/planPath math — review has no fresh-run
  // planDir path, so reaching it without resume would throw on undefined planPath.
  const guardIdx = source.indexOf("isReviewMode && !resumed")
  const planDirIdx = source.indexOf('// Dynamic planDir (Phase B1)')
  assert.ok(guardIdx > 0 && planDirIdx > 0 && guardIdx < planDirIdx)
  assert.ok(source.includes("'review-requires-plandir'"))
})

test('source: review branch never mutates the docset readiness or stages', () => {
  const branch = source.slice(
    source.indexOf('if (isReviewMode) {'),
    source.indexOf("// Gate -1: Prompt Translator")
  )
  assert.ok(branch.length > 100)
  assert.ok(!branch.includes('designReady ='), 'review must not set designReady')
  assert.ok(!branch.includes('invalidateStages'), 'review must not reset stages')
})

test('source: review issues append is growth-verified and append-only', () => {
  const fn = source.slice(
    source.indexOf('async function recordReviewIssues'),
    source.indexOf('// extractSlice:')
  )
  assert.ok(fn.includes('verifyAppendGrowth'))
  assert.ok(fn.includes('APPEND'))
  assert.ok(fn.includes('append only'))
})

test('source: review lens fan-out is a parallel barrier feeding the merge gate', () => {
  const fn = source.slice(
    source.indexOf('async function runReviewLenses'),
    source.indexOf('async function mergeReviewFindings')
  )
  assert.ok(fn.includes('parallel('))
  assert.ok(fn.includes("phase: 'Design Review'"))
})

test('source: Design Review phase is declared in meta.phases', () => {
  const metaBlock = source.slice(source.indexOf('phases: ['), source.indexOf('// ---- Schemas'))
  assert.ok(metaBlock.includes("{ title: 'Design Review' }"))
})
