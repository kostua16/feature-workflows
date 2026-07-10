// Tests for the IM/EN helpers added to the engine:
//   IM-4 detectTestCommand, IM-5 resolveProfile/PROFILES, IM-2 hydrateBudget,
//   EN-2 validatePipelineState, IM-1 stateChecksum, and writeChunkedFile chunking.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  detectTestCommand,
  resolveProfile,
  PROFILES,
  hydrateBudget,
  validatePipelineState,
  stateChecksum,
  writeChunkedFile,
  consolidate,
  retryState,
  decisionState,
} = engine

// ---- IM-4: detectTestCommand ------------------------------------------------

test('detectTestCommand: maps known frameworks with a target', () => {
  assert.equal(detectTestCommand('pytest', 'tests/test_x.py'), 'python -m pytest -v --tb=short tests/test_x.py')
  assert.equal(detectTestCommand('npm', 'foo'), 'npm test -- foo')
  assert.equal(detectTestCommand('go', './pkg'), 'go test ./pkg')
  assert.equal(detectTestCommand('cargo', ''), 'cargo test')
})

test('detectTestCommand: whole-suite defaults when no target', () => {
  assert.equal(detectTestCommand('pytest', ''), 'python -m pytest -v --tb=short')
  assert.equal(detectTestCommand('go', ''), 'go test ./...')
  assert.equal(detectTestCommand('vitest'), 'npx vitest run')
})

test('detectTestCommand: case-insensitive framework names', () => {
  assert.equal(detectTestCommand('PyTest', ''), 'python -m pytest -v --tb=short')
})

test('detectTestCommand: unknown/empty framework returns null (=> auto-detect)', () => {
  assert.equal(detectTestCommand('rspec', ''), null)
  assert.equal(detectTestCommand('', 'x'), null)
  assert.equal(detectTestCommand(null, 'x'), null)
})

// ---- IM-5: resolveProfile / PROFILES ---------------------------------------

test('resolveProfile: full is the all-on default (empty overrides)', () => {
  assert.deepEqual(resolveProfile('full'), {})
})

test('resolveProfile: unknown name falls back to full', () => {
  assert.deepEqual(resolveProfile('nope'), PROFILES.full)
  assert.deepEqual(resolveProfile(undefined), PROFILES.full)
})

test('resolveProfile: light drops the heavy opus loops', () => {
  const light = resolveProfile('light')
  assert.equal(light.useEnhancer, false)
  assert.equal(light.useQuickDecider, false)
  assert.equal(light.useArchDesign, false)
  assert.equal(light.useDetailedDesign, false)
  assert.equal(light.useReconcile, false)
})

test('resolveProfile: standard is between full and light', () => {
  const std = resolveProfile('standard')
  assert.equal(std.useE2eUsecase, false)
  assert.equal(std.useKnowledgeConsult, false)
  // standard keeps the review loops that light drops
  assert.equal(std.useEnhancer, undefined)
  assert.equal(std.useQuickDecider, undefined)
})

// ---- IM-2: hydrateBudget ----------------------------------------------------

test('hydrateBudget: carries persisted counters across resume', () => {
  assert.deepEqual(hydrateBudget({ retryUsed: 7, decisionUsed: 3 }, {}), { retryUsed: 7, decisionUsed: 3 })
})

test('hydrateBudget: --fresh-budget resets both to zero', () => {
  assert.deepEqual(hydrateBudget({ retryUsed: 7, decisionUsed: 3 }, { freshBudget: true }), { retryUsed: 0, decisionUsed: 0 })
})

test('hydrateBudget: missing/invalid counters default to zero, never negative', () => {
  assert.deepEqual(hydrateBudget({}, {}), { retryUsed: 0, decisionUsed: 0 })
  assert.deepEqual(hydrateBudget(null, {}), { retryUsed: 0, decisionUsed: 0 })
  assert.deepEqual(hydrateBudget({ retryUsed: -5, decisionUsed: NaN }, {}), { retryUsed: 0, decisionUsed: 0 })
})

// ---- IM-2: consolidate stamps BOTH budgets (review feedback) ---------------

test('consolidate: persists retryUsed AND decisionUsed from live counters', async () => {
  globalThis.agent = async () => ({ ok: true })
  retryState.used = 4
  decisionState.used = 7
  const result = { slug: 's', planPath: null, logLines: [] } // planPath null => skip flush, just stamp+ack
  await consolidate('s', result, {})
  assert.equal(result.retryUsed, 4)
  assert.equal(result.decisionUsed, 7, 'decisionUsed must round-trip even without a cap-exhaustion exit')
  retryState.used = 0
  decisionState.used = 0
})

// ---- IM-1: stateChecksum ----------------------------------------------------

test('stateChecksum: deterministic and content-sensitive', () => {
  const a = stateChecksum('{"x":1}')
  assert.equal(a, stateChecksum('{"x":1}'))
  assert.notEqual(a, stateChecksum('{"x":2}'))
  assert.equal(typeof a, 'string')
})

test('stateChecksum: handles null/undefined without throwing', () => {
  assert.equal(typeof stateChecksum(null), 'string')
  assert.equal(typeof stateChecksum(undefined), 'string')
})

// ---- EN-2: validatePipelineState -------------------------------------------

const goodState = () => ({
  task: 'do a thing',
  slug: 'do-a-thing',
  planPath: 'docs/x/plan.md',
  planDir: 'docs/x/',
  result: { task: 'do a thing' },
  config: { mode: 'design' },
})

test('validatePipelineState: accepts a well-formed state', () => {
  assert.deepEqual(validatePipelineState(goodState()), { ok: true, errors: [] })
})

test('validatePipelineState: rejects non-object', () => {
  assert.equal(validatePipelineState(null).ok, false)
  assert.equal(validatePipelineState('nope').ok, false)
})

test('validatePipelineState: flags missing required string fields', () => {
  const s = goodState()
  delete s.slug
  const v = validatePipelineState(s)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('slug')))
})

test('validatePipelineState: flags missing result object', () => {
  const s = goodState()
  delete s.result
  assert.equal(validatePipelineState(s).ok, false)
})

test('validatePipelineState: config present but not an object is rejected', () => {
  const s = goodState()
  s.config = 'oops'
  assert.equal(validatePipelineState(s).ok, false)
})

test('validatePipelineState: verifies checksum when present', () => {
  const s = goodState()
  s.checksum = stateChecksum(JSON.stringify(s.result))
  assert.equal(validatePipelineState(s).ok, true)
  s.result.tampered = true // result changed but checksum did not -> truncation/corruption signal
  const v = validatePipelineState(s)
  assert.equal(v.ok, false)
  assert.ok(v.errors.some((e) => e.includes('checksum')))
})

test('validatePipelineState: absent checksum still passes (backward-compat)', () => {
  const s = goodState()
  assert.equal(s.checksum, undefined)
  assert.equal(validatePipelineState(s).ok, true)
})

// ---- writeChunkedFile chunking ---------------------------------------------

test('writeChunkedFile: single small body writes one overwrite chunk', async () => {
  const calls = []
  globalThis.agent = async (prompt, opts) => { calls.push({ prompt, label: opts.label }); return { ok: true } }
  const result = { logLines: [] }
  await writeChunkedFile('/tmp/x.log', 'hello world', 'file-writer:test', result)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].label.includes('(1/1)'))
  assert.ok(/Write \(create\/overwrite\)/.test(calls[0].prompt))
})

test('writeChunkedFile: large body splits into overwrite + append chunks', async () => {
  const calls = []
  globalThis.agent = async (prompt, opts) => { calls.push({ prompt, label: opts.label }); return { ok: true } }
  const result = { logLines: [] }
  // ~30k chars of line-separated content forces multiple 12k chunks.
  const body = Array.from({ length: 3000 }, (_, i) => `line-${i}-padded-out`).join('\n')
  await writeChunkedFile('/tmp/big.log', body, 'file-writer:test', result)
  assert.ok(calls.length >= 2, `expected multiple chunks, got ${calls.length}`)
  assert.ok(/Write \(create\/overwrite\)/.test(calls[0].prompt), 'first chunk overwrites')
  assert.ok(/APPEND/.test(calls[1].prompt), 'subsequent chunks append')
})

test('writeChunkedFile: a throwing chunk degrades gracefully and logs a warning', async () => {
  // On main, writeChunkedFile routes through the hardened safeAgent path, which converts a
  // thrown agent error into null + a logged warning rather than propagating. The write must
  // complete without throwing, and the failure must be surfaced in result.logLines.
  let n = 0
  globalThis.agent = async () => { n++; if (n === 2) throw new Error('boom'); return { ok: true } }
  const result = { logLines: [] }
  const body = Array.from({ length: 3000 }, (_, i) => `line-${i}-padded-out`).join('\n')
  const out = await writeChunkedFile('/tmp/fail.log', body, 'file-writer:test', result)
  assert.equal(out, '/tmp/fail.log') // returns without throwing
  assert.ok(
    result.logLines.some((l) => /boom|threw|write failed|WARNING/i.test(l)),
    `a warning should be logged; got: ${JSON.stringify(result.logLines)}`
  )
})
