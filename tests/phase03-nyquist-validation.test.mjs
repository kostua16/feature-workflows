// Phase 3 Nyquist Validation: Gap-filling tests for DIST-01.
//
// Closes validation gaps identified by the gsd-validate-phase audit:
// - DIST-01 extractSliceMain: behavioral coverage for arg parsing, missing-slice
//   early returns, lifecycle initialization/preservation, blocked-gate return shape,
//   default config wiring, JSON-string coercion
// - DIST-01 leaf meta source: phase count, dev placeholder version, name, description
// - DIST-01 build script invariants: leaf = top-level - main.mjs + extract-slice-entry.mjs,
//   per-entry tail/banner, equal module count
// - DIST-01 version validator: N-surface coverage, exit-1 path, entry count
// - DIST-01 phase subset: leaf phases are a subset of top-level phases
// - DIST-01 entry independence: distinct names, tails, banners
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const pluginRoot = join(root, 'plugins', 'feature-workflows')
const wfSrcDir = join(pluginRoot, 'workflows', 'src')
const wfDistDir = join(pluginRoot, 'workflows')
const readSrc = (f) => readFileSync(join(wfSrcDir, f), 'utf8')
const readDist = (f) => readFileSync(join(wfDistDir, f), 'utf8')
const readScript = (f) => readFileSync(join(root, 'scripts', f), 'utf8')

// -- dynamic import of extractSliceMain (needs sandbox globals) --
// The entry function reads `args` from the sandbox global scope; we provide it
// via globalThis before each test. agent/phase/pipeline are inert stubs so the
// transitive extractSlice call proceeds without spawning real agents.
function setupSandboxGlobals (argsValue) {
  globalThis.log = () => {}
  globalThis.Workflow = () => {}
  globalThis.args = argsValue
  globalThis.agent = async () => ({})
  globalThis.phase = () => {}
  globalThis.stateCheckpoint = () => {}
  globalThis.pipeline = async (cfg) => {
    const stages = cfg.stages || []
    const out = []
    for (const s of stages) {
      if (s.agent) out.push({ label: s.label || '', result: await s.agent({}) })
    }
    return out
  }
  globalThis.parallel = globalThis.pipeline
}

// Extract the modules-array contents for a given entry from the build script source.
// Uses a non-greedy cross-line match to capture everything between modules: [ and ].
function extractModuleList (buildSrc, entryOutName) {
  const marker = "out: '" + entryOutName + "'"
  const markerIdx = buildSrc.indexOf(marker)
  assert.ok(markerIdx !== -1, `entry ${entryOutName} not found in build script`)
  const afterMarker = buildSrc.slice(markerIdx)
  const modulesIdx = afterMarker.indexOf('modules: [')
  assert.ok(modulesIdx !== -1, `modules array not found for ${entryOutName}`)
  const closeIdx = afterMarker.indexOf(']', modulesIdx)
  return afterMarker.slice(modulesIdx + 10, closeIdx)
}

const ENTRY_MODULE = '../plugins/feature-workflows/workflows/src/extract-slice-entry.mjs'

// ===========================================================================
// DIST-01: extractSliceMain — behavioral coverage (arg parsing + early returns)
// ===========================================================================

test('extractSliceMain: null args returns blocked missing-slice', async () => {
  setupSandboxGlobals(null)
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
  assert.equal(r.mode, 'extract-slice')
})

test('extractSliceMain: undefined args (coerced to {}) returns blocked missing-slice', async () => {
  setupSandboxGlobals(undefined)
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
})

test('extractSliceMain: empty object args returns blocked missing-slice', async () => {
  setupSandboxGlobals({})
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
})

test('extractSliceMain: slice missing id returns blocked missing-slice', async () => {
  setupSandboxGlobals({ slice: { planDir: '/tmp/p' } })
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
})

test('extractSliceMain: slice missing planDir returns blocked missing-slice', async () => {
  setupSandboxGlobals({ slice: { id: 'f1' } })
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
})

test('extractSliceMain: JSON string args parsed and valid slice proceeds', async () => {
  const json = JSON.stringify({ slice: { id: 'feat-json', name: 'test', planDir: '/tmp/json' } })
  setupSandboxGlobals(json)
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  // JSON parsed successfully — not a missing-slice block.
  assert.notEqual(r.blockedAt, 'missing-slice', 'must not be missing-slice when JSON has valid slice')
  assert.equal(r.sliceId, 'feat-json')
})

test('extractSliceMain: invalid JSON string args coerced to empty object', async () => {
  setupSandboxGlobals('not-json')
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedAt, 'missing-slice')
})

// ===========================================================================
// DIST-01: extractSliceMain — lifecycle + return shape
// ===========================================================================

test('extractSliceMain: default lifecycle initialized to in-progress', async () => {
  setupSandboxGlobals({ slice: { id: 'f1', name: 't', planDir: '/tmp/p' } })
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.lifecycle, 'in-progress')
  assert.equal(r.sliceState.lifecycle, 'in-progress')
})

test('extractSliceMain: explicit lifecycle preserved when blocked', async () => {
  setupSandboxGlobals({
    slice: { id: 'f1', name: 't', planDir: '/tmp/p' },
    sliceState: { lifecycle: 'completed' },
  })
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.lifecycle, 'completed')
})

test('extractSliceMain: return shape on blocked gate is well-formed', async () => {
  setupSandboxGlobals({ slice: { id: 'f1', name: 't', planDir: '/tmp/p' } })
  const { extractSliceMain } = await import(ENTRY_MODULE)
  const r = await extractSliceMain()
  assert.equal(r.mode, 'extract-slice')
  assert.equal(r.sliceId, 'f1')
  assert.equal(r.status, 'blocked')
  assert.ok(r.gate, 'must report which gate blocked')
  assert.ok(Array.isArray(r.logLines), 'logLines must be array')
  assert.ok(typeof r.sliceState === 'object', 'sliceState must be object')
  assert.ok(typeof r.gateCheckpoints === 'object', 'gateCheckpoints must be object')
})

test('extractSliceMain source: default config values wired', () => {
  const src = readSrc('extract-slice-entry.mjs')
  assert.ok(src.includes('RETRY_BUDGET_DEFAULT'), 'must import RETRY_BUDGET_DEFAULT')
  assert.ok(src.includes('REFINE_SUBCAP_DEFAULT'), 'must import REFINE_SUBCAP_DEFAULT')
  assert.ok(src.includes('DECISION_CAP_DEFAULT'), 'must import DECISION_CAP_DEFAULT')
  assert.ok(src.includes('retryBudget: args.retryBudget || RETRY_BUDGET_DEFAULT'), 'must wire retryBudget fallback')
})

// ===========================================================================
// DIST-01: extractSliceMain — source-level assertions (done to complete path)
// ===========================================================================

test('extractSliceMain source: done status transitions lifecycle to complete', () => {
  const src = readSrc('extract-slice-entry.mjs')
  assert.ok(src.includes("outcome.status === 'done'"), 'must check done status')
  assert.ok(src.includes("{ type: 'complete' }"), 'must transition to complete')
})

test('extractSliceMain source: illegal transition caught and logged', () => {
  const src = readSrc('extract-slice-entry.mjs')
  assert.ok(src.includes('try {'), 'must have try block around transition')
  assert.ok(src.includes('catch'), 'must catch illegal transitions')
  assert.ok(src.includes('lifecycle transition to complete failed'), 'must log failure')
})

test('extractSliceMain source: imports from extract-slice, lifecycle, config', () => {
  const src = readSrc('extract-slice-entry.mjs')
  assert.ok(src.includes("from './extract-slice.mjs'"), 'must import extractSlice')
  assert.ok(src.includes("from './lifecycle.mjs'"), 'must import lifecycle reducer')
  assert.ok(src.includes("from './config.mjs'"), 'must import config defaults')
  assert.ok(src.includes('applyLifecycleEvent'), 'must use shared lifecycle reducer')
  assert.ok(src.includes('LIFECYCLE_STATES'), 'must reference LIFECYCLE_STATES')
})

// ===========================================================================
// DIST-01: Leaf meta source verification
// ===========================================================================

test('leaf meta source: declares exactly 2 phases', () => {
  const src = readSrc('meta/fp-extract-slice.meta.mjs')
  const titles = [...src.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(titles.sort(), ['Design Audit', 'Extract Slice'])
})

test('leaf meta source: version is dev placeholder (proves build injection)', () => {
  const src = readSrc('meta/fp-extract-slice.meta.mjs')
  assert.ok(src.includes("'0.0.0-dev'"), 'source meta version must be dev placeholder')
  assert.ok(src.includes('injected from plugin.json'), 'must document injection')
})

test('leaf meta source: name is fp-extract-slice', () => {
  const src = readSrc('meta/fp-extract-slice.meta.mjs')
  assert.ok(src.includes("name: 'fp-extract-slice'"))
})

test('leaf meta source: description mentions leaf/per-feature scope', () => {
  const src = readSrc('meta/fp-extract-slice.meta.mjs')
  assert.ok(src.toLowerCase().includes('leaf'), 'description must mention leaf scope')
  assert.ok(src.toLowerCase().includes('one'), 'description must mention single-feature scope')
})

// ===========================================================================
// DIST-01: Build script structural invariants
// ===========================================================================

test('build script: leaf modules = top-level - main.mjs + extract-slice-entry.mjs', () => {
  const src = readScript('build-workflows.mjs')
  const topList = extractModuleList(src, 'feature-pipeline.js')
  const leafList = extractModuleList(src, 'fp-extract-slice.js')
  const topMods = [...topList.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const leafMods = [...leafList.matchAll(/'([^']+)'/g)].map((m) => m[1])
  const expectedLeaf = topMods.filter((m) => m !== 'main.mjs').concat(['extract-slice-entry.mjs'])
  assert.deepEqual(leafMods, expectedLeaf, 'leaf module set must be top-level minus main plus entry')
})

test('build script: both entries have equal module count', () => {
  const src = readScript('build-workflows.mjs')
  const topMods = [...extractModuleList(src, 'feature-pipeline.js').matchAll(/'([^']+)'/g)]
  const leafMods = [...extractModuleList(src, 'fp-extract-slice.js').matchAll(/'([^']+)'/g)]
  assert.equal(topMods.length, leafMods.length, 'module counts must match')
})

test('build script: top-level includes main.mjs, leaf excludes it', () => {
  const src = readScript('build-workflows.mjs')
  assert.ok(extractModuleList(src, 'feature-pipeline.js').includes("'main.mjs'"), 'top must include main.mjs')
  assert.ok(!extractModuleList(src, 'fp-extract-slice.js').includes("'main.mjs'"), 'leaf must exclude main.mjs')
})

test('build script: leaf includes extract-slice-entry.mjs', () => {
  const src = readScript('build-workflows.mjs')
  assert.ok(extractModuleList(src, 'fp-extract-slice.js').includes("'extract-slice-entry.mjs'"))
})

test('build script: both entries have per-entry tail config', () => {
  const src = readScript('build-workflows.mjs')
  assert.ok(src.includes('const final = await main()'), 'top-level tail calls main()')
  assert.ok(src.includes('const final = await extractSliceMain()'), 'leaf tail calls extractSliceMain()')
})

test('build script: both entries have per-entry banner with entry-specific name', () => {
  const src = readScript('build-workflows.mjs')
  assert.ok(src.includes("'// feature-pipeline.js'"), 'top-level banner has its name')
  assert.ok(src.includes("'// fp-extract-slice.js'"), 'leaf banner has its name')
})

// ===========================================================================
// DIST-01: Version lockstep validator
// ===========================================================================

test('version validator: source checks N surfaces (plugin.json + headers + meta.version)', () => {
  const src = readScript('validate-plugin-versions.mjs')
  assert.ok(src.includes("versions['plugin.json version']"), 'checks plugin.json')
  assert.ok(src.includes('engine-version header'), 'checks dist headers')
  assert.ok(src.includes('meta.version'), 'checks meta.version')
  assert.ok(src.includes("const ENTRIES = ['feature-pipeline.js', 'fp-extract-slice.js']"), 'iterates both entries')
})

test('version validator: exit 1 on failure (mismatch or missing)', () => {
  const src = readScript('validate-plugin-versions.mjs')
  assert.ok(src.includes('process.exit(1)'), 'must exit 1 on failure')
  assert.ok(src.includes('VERSION MISMATCH'), 'must report mismatches')
  assert.ok(src.includes('MISSING:'), 'must report missing surfaces')
})

test('version validator: success reports entry count', () => {
  const src = readScript('validate-plugin-versions.mjs')
  assert.ok(src.includes('ENTRIES.length'), 'success message includes entry count')
  assert.ok(src.includes('version lockstep OK'), 'success message format')
})

// ===========================================================================
// DIST-01: Phase subset invariant (leaf subset of top-level)
// ===========================================================================

test('leaf phases are a subset of top-level phases', () => {
  const topSrc = readDist('feature-pipeline.js')
  const leafSrc = readDist('fp-extract-slice.js')
  const topMeta = topSrc.match(/^export const meta = \{[\s\S]*?^\}/m)?.[0] || ''
  const leafMeta = leafSrc.match(/^export const meta = \{[\s\S]*?^\}/m)?.[0] || ''
  const topTitles = new Set([...topMeta.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]))
  const leafTitles = [...leafMeta.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
  for (const t of leafTitles) {
    assert.ok(topTitles.has(t), `leaf phase '${t}' must exist in top-level meta`)
  }
})

// ===========================================================================
// DIST-01: Entry independence (distinct names, tails, banners)
// ===========================================================================

test('both entries have distinct meta names', () => {
  const topSrc = readDist('feature-pipeline.js')
  const leafSrc = readDist('fp-extract-slice.js')
  const topName = topSrc.match(/^  name:\s*'([^']+)'/m)?.[1]
  const leafName = leafSrc.match(/^  name:\s*'([^']+)'/m)?.[1]
  assert.notEqual(topName, leafName, 'entries must have distinct names')
  assert.equal(topName, 'feature-pipeline')
  assert.equal(leafName, 'fp-extract-slice')
})

test('both entries have distinct tails (main vs extractSliceMain)', () => {
  const topSrc = readDist('feature-pipeline.js')
  const leafSrc = readDist('fp-extract-slice.js')
  assert.ok(topSrc.includes('await main()') && !topSrc.includes('await extractSliceMain()'), 'top-level tail is main()')
  assert.ok(leafSrc.includes('await extractSliceMain()') && !leafSrc.includes('await main()'), 'leaf tail is extractSliceMain()')
})

test('both entries have distinct descriptions', () => {
  const topSrc = readDist('feature-pipeline.js')
  const leafSrc = readDist('fp-extract-slice.js')
  const topDesc = topSrc.match(/^  description:\s*'([^']+)'/m)?.[1] || ''
  const leafDesc = leafSrc.match(/^  description:\s*'([^']+)'/m)?.[1] || ''
  assert.notEqual(topDesc, leafDesc, 'entries must have distinct descriptions')
  assert.ok(leafDesc.toLowerCase().includes('leaf'), 'leaf description must mention leaf')
})
