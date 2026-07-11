// Tests for the extract mode (reverse design extraction): mode plumbing, the pure
// slice-queue helpers (seedExtractQueue/nextPendingSlice), the new verdict schemas,
// and structural source assertions for the extract branch invariants (pause-and-resume
// scope confirmation with no agent call, per-slice state flush, extract planDir segment).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  resolveMode,
  gateModeActive,
  seedExtractQueue,
  nextPendingSlice,
  repairResumeArtifactFlags,
  SCOPE_VERDICT,
  DECOMPOSE_VERDICT,
  AUDIT_VERDICT,
  OVERVIEW_VERDICT,
  PROFILES,
  MODEL_DEFAULTS,
} = engine

const source = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- mode plumbing ----------------------------------------------------------

test('resolveMode: extract is a valid mode at every precedence level', () => {
  assert.equal(resolveMode({ mode: 'extract' }, { mode: 'design' }, null), 'extract')
  assert.equal(resolveMode({}, { mode: 'extract' }, null), 'extract')
  assert.equal(resolveMode({}, {}, { result: { mode: 'extract' } }), 'extract')
})

test('gateModeActive: extract gates run in extract only', () => {
  assert.equal(gateModeActive('extract', 'extract'), true)
  assert.equal(gateModeActive('extract', 'design'), false)
  assert.equal(gateModeActive('extract', 'tune'), false)
  assert.equal(gateModeActive('extract', 'implement'), false)
})

test('gateModeActive: design/implement gates stay off in extract mode', () => {
  assert.equal(gateModeActive('design', 'extract'), false)
  assert.equal(gateModeActive('implement', 'extract'), false)
  assert.equal(gateModeActive('shared', 'extract'), true)
})

// ---- seedExtractQueue -------------------------------------------------------

const scope = { files: ['src/a.js', 'src/b.js'], entryPoints: ['cli:run'] }

test('seedExtractQueue: no slices -> single entry using the parent planDir (flat layout)', () => {
  const queue = seedExtractQueue(scope, null, 'docs/x/extract/leaf/', 8, [])
  assert.equal(queue.length, 1)
  assert.equal(queue[0].planDir, 'docs/x/extract/leaf/')
  assert.equal(queue[0].status, 'pending')
  assert.deepEqual(queue[0].files, scope.files)
  assert.deepEqual(queue[0].artifacts, {})
})

test('seedExtractQueue: slices land under slices/<id>/ with kebab-case ids', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'Auth Flow', name: 'Auth Flow', files: ['src/auth.js'] },
    { id: 'parser', name: 'Parser', files: ['src/parse.js'] },
  ], 'docs/x/extract/leaf', 8, [])
  assert.equal(queue.length, 2)
  assert.equal(queue[0].planDir, 'docs/x/extract/leaf/slices/auth-flow/')
  assert.equal(queue[1].planDir, 'docs/x/extract/leaf/slices/parser/')
  assert.ok(queue.every((s) => s.status === 'pending'))
})

test('seedExtractQueue: dependsOn ordering puts dependencies first', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'ui', name: 'UI', files: [], dependsOn: ['core'] },
    { id: 'core', name: 'Core', files: [] },
  ], 'docs/x/', 8, [])
  assert.deepEqual(queue.map((s) => s.id), ['core', 'ui'])
})

test('seedExtractQueue: dependency cycle falls back to the given order', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'a', name: 'A', files: [], dependsOn: ['b'] },
    { id: 'b', name: 'B', files: [], dependsOn: ['a'] },
  ], 'docs/x/', 8, [])
  assert.deepEqual(queue.map((s) => s.id), ['a', 'b'])
})

test('seedExtractQueue: dangling dependsOn does not deadlock the ordering', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'a', name: 'A', files: [], dependsOn: ['ghost'] },
    { id: 'b', name: 'B', files: [] },
  ], 'docs/x/', 8, [])
  assert.equal(queue.length, 2)
})

test('seedExtractQueue: --slices selection marks unselected entries skipped', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'a', name: 'A', files: [] },
    { id: 'b', name: 'B', files: [] },
    { id: 'c', name: 'C', files: [] },
  ], 'docs/x/', 8, ['b'])
  assert.deepEqual(queue.map((s) => s.status), ['skipped', 'pending', 'skipped'])
})

test('seedExtractQueue: maxSlices caps pending entries, excess kept as skipped', () => {
  const queue = seedExtractQueue(scope, [
    { id: 'a', name: 'A', files: [] },
    { id: 'b', name: 'B', files: [] },
    { id: 'c', name: 'C', files: [] },
  ], 'docs/x/', 2, [])
  assert.equal(queue.filter((s) => s.status === 'pending').length, 2)
  assert.equal(queue.filter((s) => s.status === 'skipped').length, 1)
  assert.equal(queue.length, 3) // index stays complete for later resume
})

// ---- nextPendingSlice -------------------------------------------------------

test('nextPendingSlice: first pending entry, skipping done/skipped/blocked', () => {
  const queue = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'skipped' },
    { id: 'c', status: 'blocked' },
    { id: 'd', status: 'pending' },
  ]
  assert.equal(nextPendingSlice(queue).id, 'd')
  assert.equal(nextPendingSlice([{ id: 'a', status: 'done' }]), null)
  assert.equal(nextPendingSlice([]), null)
  assert.equal(nextPendingSlice(null), null)
})

// ---- new verdict schemas ----------------------------------------------------

test('extract verdict schemas are well-formed (strict, required ⊆ properties)', () => {
  for (const [name, schema] of Object.entries({ SCOPE_VERDICT, DECOMPOSE_VERDICT, AUDIT_VERDICT, OVERVIEW_VERDICT })) {
    assert.equal(schema.type, 'object', `${name}.type`)
    assert.equal(schema.additionalProperties, false, `${name}.additionalProperties`)
    for (const key of schema.required) {
      assert.ok(schema.properties[key], `${name}: required key "${key}" missing from properties`)
    }
  }
})

test('AUDIT_VERDICT finding gate enum matches the tune-consumable gate set', () => {
  const gateEnum = AUDIT_VERDICT.properties.findings.items.properties.gate.enum
  assert.deepEqual(gateEnum, ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'])
})

// ---- profiles + model tiers -------------------------------------------------

test('profiles: light disables the optional extract gates, standard only the review', () => {
  assert.equal(PROFILES.light.useExtractReview, false)
  assert.equal(PROFILES.light.useExtractRequirements, false)
  assert.equal(PROFILES.light.useAudit, false)
  assert.equal(PROFILES.standard.useExtractReview, false)
  assert.equal(PROFILES.standard.useExtractRequirements, undefined)
  assert.equal(PROFILES.full.useExtractReview, undefined)
})

test('model defaults exist for every new extract gate', () => {
  for (const key of ['scopeResolver', 'decomposer', 'audit', 'overview']) {
    assert.ok(MODEL_DEFAULTS[key], `MODEL_DEFAULTS.${key}`)
  }
})

// ---- resume repair: phantom plan.md must not kill persistence ----------------

// States whose Plan gate never ran (extract parents, extract slice-local design-shaped
// states, design runs blocked before Plan) carry a planPath that is planDir math only.
// The repair must not verify — and null — that path: consolidate() gates every state/log
// flush on result.planPath, so nulling it silently disables persistence for the run.
const missingArtifactStub = async () => ({ exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'missing' })

test('repairResumeArtifactFlags: skips the Plan check when no plan was written (planned falsy)', async () => {
  globalThis.agent = missingArtifactStub
  for (const state of [
    { mode: 'extract', planPath: 'docs/x/extract/leaf/plan.md', designReady: false, logLines: [] },
    { mode: 'design', planPath: 'docs/x/extract/leaf/slices/auth/plan.md', designReady: true, logLines: [] }, // slice-local shape
    { mode: 'design', planPath: 'docs/x/feature/leaf/plan.md', planned: false, designReady: false, logLines: [] }, // blocked pre-Plan
  ]) {
    const repairs = await repairResumeArtifactFlags(state)
    assert.deepEqual(repairs, [], `unexpected repairs for mode=${state.mode}`)
    assert.ok(state.planPath, 'planPath must survive (consolidate flushes depend on it)')
  }
})

test('repairResumeArtifactFlags: still repairs a WRITTEN plan whose file went missing', async () => {
  globalThis.agent = missingArtifactStub
  const state = { mode: 'design', planPath: 'docs/x/feature/leaf/plan.md', planned: true, designReady: true, logLines: [] }
  const repairs = await repairResumeArtifactFlags(state)
  assert.ok(repairs.some((r) => r.includes('planPath')), 'missing written plan must be repaired')
  assert.equal(state.planPath, null)
  assert.equal(state.designReady, false)
})

// ---- structural source assertions -------------------------------------------

test('extract mode re-derives core extraction gates with profile-independent defaults', () => {
  // Profiles tune the FORWARD flow; without this override a light-profile extract run
  // would emit only codebase-facts.md (arch/detailed-design/e2e silently dropped).
  const block = source.slice(source.indexOf("if (config.mode === 'extract') {"))
  const overrides = block.slice(0, block.indexOf('}'))
  assert.match(overrides, /config\.useArchDesign = cfgFlag\(args && args\.useArchDesign, persistedConfig\.useArchDesign, true\)/)
  assert.match(overrides, /config\.useDetailedDesign = cfgFlag\(args && args\.useDetailedDesign, persistedConfig\.useDetailedDesign, true\)/)
  assert.match(overrides, /config\.useE2eUsecase = cfgFlag\(args && args\.useE2eUsecase, persistedConfig\.useE2eUsecase, true\)/)
})

test('extract branch is guarded by isExtractMode and returns before Phase E4', () => {
  const branch = source.indexOf('if (isExtractMode) {')
  const e4 = source.indexOf('// ===== Phase E4: state-machine loop')
  assert.ok(branch > 0, 'extract branch present')
  assert.ok(branch < e4, 'extract branch sits before the E4 loop')
})

test('planDir derivation uses the extract path segment in extract mode', () => {
  assert.match(source, /const kindSeg = isExtractMode \? 'extract' : 'feature'/)
})

test('scope confirmation is a pause-and-resume checkpoint with NO agent call', () => {
  // The checkpoint section spans from the cancel leg to the decompose gate; a safeAgent/
  // flexibleAgent call in between would mean a subagent is asked to confirm — subagents
  // cannot AskUserQuestion inside the workflow, so the section must stay agent-free.
  const start = source.indexOf("args && args.scopeConfirmed === false")
  const end = source.indexOf('// Gate X1: decompose')
  assert.ok(start > 0 && end > start, 'checkpoint section located')
  const section = source.slice(start, end)
  assert.doesNotMatch(section, /safeAgent\(|flexibleAgent\(/)
  assert.match(section, /status: 'awaiting-scope-confirm'/)
})

test('slice loop flushes parent state after each slice (mid-queue resume substrate)', () => {
  const loop = source.slice(source.indexOf('while ((slice = nextPendingSlice(result.extractQueue)))'))
  const body = loop.slice(0, loop.indexOf('// Gate X8'))
  assert.match(body, /await flushPipelineState\(planDir, result, config\)/)
  assert.match(body, /await flushPipelineState\(slice\.planDir, sliceState/)
})

test('multi-slice runs never claim parent designReady', () => {
  assert.match(source, /if \(!multiSlice\) result\.designReady = true/)
})
