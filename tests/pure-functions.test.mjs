// EN-1: unit tests for the engine's pure logic. These functions carry no I/O and
// are deterministic, so a stubbed agent()/args is enough. Covers resolveMode,
// invalidateStages, clearGateAndDownstream, detectNonEnglish, categorizeSlug,
// extractJson, taskSlug, jiraIdFromTask, gateModeActive.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const {
  resolveMode,
  gateModeActive,
  categorizeSlug,
  taskSlug,
  jiraIdFromTask,
  detectNonEnglish,
  invalidateStages,
  extractJson,
  clearGateAndDownstream,
  LOOPBACK_FLAG_MAP,
} = engine

test('resolveMode: explicit arg wins over persisted and resumed', () => {
  assert.equal(resolveMode({ mode: 'implement' }, { mode: 'design' }, { result: { mode: 'tune' } }), 'implement')
})

test('resolveMode: persisted config used when no explicit arg', () => {
  assert.equal(resolveMode({}, { mode: 'tune' }, null), 'tune')
})

test('resolveMode: resumed result mode used when no arg/config', () => {
  assert.equal(resolveMode({}, {}, { result: { mode: 'implement' } }), 'implement')
})

test('resolveMode: defaults to design', () => {
  assert.equal(resolveMode({}, {}, null), 'design')
  assert.equal(resolveMode(null, null, null), 'design')
})

test('resolveMode: invalid mode values are ignored', () => {
  assert.equal(resolveMode({ mode: 'bogus' }, { mode: 'tune' }, null), 'tune')
  assert.equal(resolveMode({ mode: 'bogus' }, {}, null), 'design')
})

test('gateModeActive: design gates run in design and tune only', () => {
  assert.equal(gateModeActive('design', 'design'), true)
  assert.equal(gateModeActive('design', 'tune'), true)
  assert.equal(gateModeActive('design', 'implement'), false)
})

test('gateModeActive: implement gates run in implement only', () => {
  assert.equal(gateModeActive('implement', 'implement'), true)
  assert.equal(gateModeActive('implement', 'design'), false)
  assert.equal(gateModeActive('implement', 'tune'), false)
})

test('gateModeActive: shared gates always active', () => {
  assert.equal(gateModeActive('shared', 'design'), true)
  assert.equal(gateModeActive('shared', 'implement'), true)
})

test('categorizeSlug: kebab-cases, caps words and chars', () => {
  assert.equal(categorizeSlug('Add Retry Layer To Parser'), 'add-retry-layer')
  assert.equal(categorizeSlug('  Spaces & Symbols!! '), 'spaces-symbols')
  assert.equal(categorizeSlug(''), 'misc')
  assert.equal(categorizeSlug(null), 'misc')
})

test('categorizeSlug: char cap does not leave a trailing hyphen', () => {
  const out = categorizeSlug('aaa bbb ccc', 3, 8)
  assert.ok(!out.endsWith('-'), `unexpected trailing hyphen: "${out}"`)
  assert.ok(out.length <= 8)
})

test('taskSlug: normalizes and bounds to 40 chars', () => {
  assert.equal(taskSlug('Fix the Bug!'), 'fix-the-bug')
  assert.equal(taskSlug(''), 'feature-pipeline-task')
  assert.ok(taskSlug('x'.repeat(100)).length <= 40)
})

test('jiraIdFromTask: extracts ticket id or null', () => {
  assert.equal(jiraIdFromTask('Implement PROJ-123 retry logic'), 'PROJ-123')
  assert.equal(jiraIdFromTask('no ticket here'), null)
})

test('detectNonEnglish: ASCII is English, CJK is not', () => {
  assert.equal(detectNonEnglish('Add a retry layer to the parser').isEnglish, true)
  assert.equal(detectNonEnglish('パーサーに再試行レイヤーを追加する').isEnglish, false)
  assert.equal(detectNonEnglish('').isEnglish, true)
})

test('detectNonEnglish: accented English stays English under threshold', () => {
  assert.equal(detectNonEnglish('Café menu update for the parser feature').isEnglish, true)
})

test('invalidateStages: resets done stages whose files were touched', () => {
  const result = {
    stages: [
      { id: 'stage01', status: 'done', files: ['a.py'] },
      { id: 'stage02', status: 'done', files: ['b.py'] },
      { id: 'stage03', status: 'pending', files: ['c.py'] },
    ],
  }
  const reset = invalidateStages(result, [], ['b.py'])
  assert.equal(reset, 1)
  assert.equal(result.stages[0].status, 'done')
  assert.equal(result.stages[1].status, 'pending')
  assert.equal(result.stages[2].status, 'pending')
})

test('invalidateStages: preserved stages are never reset', () => {
  const result = { stages: [{ id: 'stage01', status: 'done', files: ['a.py'] }] }
  const reset = invalidateStages(result, ['stage01'], ['a.py'])
  assert.equal(reset, 0)
  assert.equal(result.stages[0].status, 'done')
})

test('invalidateStages: unknown touched set resets all non-preserved done stages (BF-1 fixed)', () => {
  // BF-1 (fixed on main): when the touched set is unknown/empty, conservatively invalidate
  // every non-preserved done stage rather than no-op'ing (which left tune unable to re-execute).
  const result = { stages: [{ id: 'stage01', status: 'done', files: ['a.py'] }] }
  assert.equal(invalidateStages(result, [], []), 1)
  assert.equal(result.stages[0].status, 'pending')
})

test('invalidateStages: unknown touched set still honors preserveStages', () => {
  const result = {
    stages: [
      { id: 'stage01', status: 'done', files: ['a.py'] },
      { id: 'stage02', status: 'done', files: ['b.py'] },
    ],
  }
  const reset = invalidateStages(result, ['stage01'], [])
  assert.equal(reset, 1)
  assert.equal(result.stages[0].status, 'done')    // preserved
  assert.equal(result.stages[1].status, 'pending') // reset
})

test('invalidateStages: no stages returns 0', () => {
  assert.equal(invalidateStages({}, [], ['a.py']), 0)
  assert.equal(invalidateStages({ stages: [] }, [], ['a.py']), 0)
})

test('extractJson: parses raw, fenced, and embedded JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('prose before {"a":1} prose after'), { a: 1 })
  assert.deepEqual(extractJson({ a: 1 }), { a: 1 })
})

test('extractJson: returns null on unparseable input', () => {
  assert.equal(extractJson('not json at all'), null)
  assert.equal(extractJson(null), null)
  assert.equal(extractJson(42), null)
})

test('clearGateAndDownstream: clears the target gate and everything downstream', () => {
  const result = {
    planned: true,
    _plan: {},
    planAccepted: true,
    executed: true,
    testsPassed: true,
    ready: true,
    codeReview: {},
    carriedBlockers: ['x'],
  }
  clearGateAndDownstream(result, 'plan')
  assert.equal(result.planned, null)
  assert.equal(result.planAccepted, null)
  assert.equal(result.executed, null)
  assert.equal(result.testsPassed, false)
  assert.equal(result.ready, false)
  assert.deepEqual(result.carriedBlockers, [])
})

test('clearGateAndDownstream: tests target leaves upstream design flags intact', () => {
  const result = { planned: true, testsPassed: true, ready: true, codeReview: {} }
  clearGateAndDownstream(result, 'tests')
  assert.equal(result.planned, true) // upstream, untouched
  assert.equal(result.testsPassed, false)
  assert.equal(result.codeReview, null)
})

test('LOOPBACK_FLAG_MAP: each earlier phase is a superset of later phases', () => {
  const { requirements, architecture, design, plan, tests } = LOOPBACK_FLAG_MAP
  for (const flag of tests) assert.ok(plan.includes(flag), `plan missing ${flag}`)
  for (const flag of plan) assert.ok(design.includes(flag), `design missing ${flag}`)
  for (const flag of design) assert.ok(architecture.includes(flag), `architecture missing ${flag}`)
  for (const flag of architecture) assert.ok(requirements.includes(flag), `requirements missing ${flag}`)
})
