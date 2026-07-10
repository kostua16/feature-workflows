import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const enginePath = new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url)
const source = readFileSync(enginePath, 'utf8')

function extractFunction(name) {
  const marker = `function ${name}`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing function ${name}`)
  const bodyStart = source.indexOf('{', start)
  assert.notEqual(bodyStart, -1, `missing body for ${name}`)
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  let regex = false
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (regex) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '/') {
        regex = false
      }
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '/') {
      const previous = source.slice(bodyStart, index).trimEnd().at(-1)
      if (!previous || '=(:,[!&|?{'.includes(previous)) {
        regex = true
        continue
      }
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated function ${name}`)
}

function loadFunction(name) {
  const functionNames = [
    'detectNonEnglish',
    'normalizeVerdict',
    'normalizeEnum',
    'verdictContradiction',
    'countItems',
    'reasoningSaysStop',
    'fallbackForAgent',
    'recordAgentFailure',
    'agentCircuitOpen',
    'agentFailureKey',
    'outputLanguageViolation',
    'hardenForModel',
    'schemaExample',
    'recordAgentWatchdog',
    'parseJsonCandidate',
    'jsonCandidates',
    'braceCandidates',
    'repairJsonText',
    'stripTrailingCommasOutsideStrings',
    'replacePythonLiteralsOutsideStrings',
    'quoteBareKeysOutsideStrings',
    'normalizeSingleQuotedStrings',
    'rewriteOutsideStrings',
    name,
  ]
  const body = [...new Set(functionNames)].map(extractFunction).join('\n')
  const prelude = `
const IDENTICAL_FAILURE_LIMIT = 3;
const GATE_FALLBACKS = {
  'quick-decider': { decision: 'stop', reasoning: 'fallback after unavailable verdict' },
  'complex-decision-analyst': { decision: 'commit', targetPhase: 'none', reasoning: 'fallback after unavailable verdict', trueDefects: [] },
  'pytest-runner': { passed: false, summary: 'fallback after unavailable test verdict' },
  'prompt-enhancer': null,
};
`
  return Function(`${prelude}\n${body}; return ${name};`)()
}

test('invalidateStages resets all non-preserved done stages when touched scope is unknown', () => {
  const invalidateStages = loadFunction('invalidateStages')
  const result = {
    stages: [
      { id: 'stage01', status: 'done', files: ['src/a.ts'] },
      { id: 'stage02', status: 'done', files: ['src/b.ts'] },
      { id: 'stage03', status: 'in-progress', files: ['src/c.ts'] },
    ],
  }

  const reset = invalidateStages(result, ['stage02'], [])

  assert.equal(reset, 1)
  assert.equal(result.stages[0].status, 'pending')
  assert.equal(result.stages[1].status, 'done')
  assert.equal(result.stages[2].status, 'in-progress')
})

test('invalidateStages uses file intersection when touched scope is known', () => {
  const invalidateStages = loadFunction('invalidateStages')
  const result = {
    stages: [
      { id: 'stage01', status: 'done', files: ['src/a.ts'] },
      { id: 'stage02', status: 'done', files: ['src/b.ts'] },
    ],
  }

  const reset = invalidateStages(result, [], ['src/b.ts'])

  assert.equal(reset, 1)
  assert.equal(result.stages[0].status, 'done')
  assert.equal(result.stages[1].status, 'pending')
})

test('gateModeActive keeps design and implement gates separated by mode', () => {
  const gateModeActive = loadFunction('gateModeActive')

  assert.equal(gateModeActive('design', 'design'), true)
  assert.equal(gateModeActive('design', 'tune'), true)
  assert.equal(gateModeActive('design', 'implement'), false)
  assert.equal(gateModeActive('implement', 'implement'), true)
  assert.equal(gateModeActive('implement', 'design'), false)
})

test('extractJson repairs common weak-model JSON formats', () => {
  const extractJson = loadFunction('extractJson')

  assert.deepEqual(extractJson('bad\n```json\n{"accepted":true,}\n```'), { accepted: true })
  assert.deepEqual(extractJson("Result: {'passed': True, 'count': '2'}"), { passed: true, count: '2' })
  assert.deepEqual(extractJson('first {broken,} second {"ok": false}'), { ok: false })
  assert.deepEqual(extractJson('{"items": [1, 2]'), { items: [1, 2] })
})

test('normalizeVerdict coerces weak-model enum and field shapes', () => {
  const normalizeVerdict = loadFunction('normalizeVerdict')
  const schema = {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['retry', 'stop', 'accepted'] },
      severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
      fixed: { type: 'boolean' },
      stepsDone: { type: 'integer' },
      gaps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } },
    },
  }

  assert.deepEqual(normalizeVerdict(schema, {
    decision: 'Retry',
    severity: 'Critical',
    fixed: 'true',
    stepsDone: '3',
    gaps: ['missing tests'],
  }), {
    decision: 'retry',
    severity: 'blocker',
    fixed: true,
    stepsDone: 3,
    gaps: [{ text: 'missing tests' }],
  })
})

test('hardenForModel appends output contract only for weaker model tiers', () => {
  const hardenForModel = loadFunction('hardenForModel')
  const schema = {
    type: 'object',
    properties: {
      accepted: { type: 'boolean' },
      decision: { type: 'string', enum: ['retry', 'stop'] },
      blockers: { type: 'array', items: { type: 'string' } },
    },
  }

  const weakPrompt = hardenForModel('Review the plan.', schema, 'haiku')
  const strongPrompt = hardenForModel('Review the plan.', schema, 'opus')

  assert.match(weakPrompt, /WEAK-MODEL OUTPUT CONTRACT/)
  assert.match(weakPrompt, /"accepted": false/)
  assert.match(weakPrompt, /"decision": "retry"/)
  assert.equal(strongPrompt, 'Review the plan.')
})

test('verdictContradiction rejects internally inconsistent verdicts', () => {
  const verdictContradiction = loadFunction('verdictContradiction')

  assert.equal(verdictContradiction({ accepted: true, blockers: ['missing'] }), 'accepted=true with blockers/gaps')
  assert.equal(verdictContradiction({ completed: true, stepsDone: 0, files: [] }), 'completed=true with no stepsDone and no files')
  assert.equal(verdictContradiction({ completed: true, stepsDone: 1, files: [], summary: 'nothing to change' }), 'completed=true while summary says no work was done')
  assert.equal(verdictContradiction({ passed: true, summary: '3 failed, exit 1' }), 'passed=true while test summary/command reports failure')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: 'we should stop now' }), 'decision=retry while reasoning says stop')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: 'do not stop; retry is still useful' }), '')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: "will not stop while retries remain" }), '')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: "can't stop because recovery is possible" }), '')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: 'do not ever stop before retrying' }), '')
  assert.equal(verdictContradiction({ decision: 'retry', reasoning: 'do not stop, halt now instead' }), 'decision=retry while reasoning says stop')
  assert.equal(verdictContradiction({ accepted: true, blockers: [] }), '')
})

test('implement-mode guard is wired into the full design gate path', () => {
  assert.match(source, /} else if \(gateModeActive\('design', mode\)\) \{/)
})

test('gsd-quick prompt uses persisted definition path instead of a nullable local definition', () => {
  assert.match(source, /Definition doc: \$\{result\.definitionPath \|\| definitionPath\}/)
  assert.doesNotMatch(source, /Definition doc: \$\{definition\.definitionPath\}/)
})

test('implicit execute stage is persisted back to result.stages', () => {
  assert.match(source, /if \(!result\.stages \|\| !result\.stages\.length\) result\.stages = stages/)
})

test('schema-gated calls use the hardened agent path outside flexibleAgent internals', () => {
  const rawCalls = [...source.matchAll(/(?<![A-Za-z0-9_$])agent\(/g)]
    .map((match) => match.index)
    .filter((index) => !source.slice(source.lastIndexOf('\n', index) + 1, index).trimStart().startsWith('//'))

  assert.equal(rawCalls.length, 1)
  for (const index of rawCalls) {
    const before = source.slice(0, index)
    const functionStart = before.lastIndexOf('async function callAgentWithWatchdog')
    const nextFunction = source.indexOf('\nfunction ', functionStart + 1)
    assert.ok(functionStart >= 0 && (nextFunction === -1 || index < nextFunction))
  }

  assert.match(loadFunction('safeAgent').toString(), /return flexibleAgent\(prompt, opts, result\)/)
})

test('recordAgentWatchdog tracks timeout and oversized output telemetry', () => {
  const recordAgentWatchdog = loadFunction('recordAgentWatchdog')
  const result = { logLines: [] }

  recordAgentWatchdog(result, 'timeouts', { label: 'slow' }, 'timed out')
  recordAgentWatchdog(result, 'oversized', { label: 'verbose' }, 'returned too much')

  assert.deepEqual(result.agentWatchdog, { timeouts: 1, oversized: 1 })
  assert.equal(result.logLines.length, 2)
})

test('fallbackForAgent centralizes known gate fallback defaults', () => {
  const fallbackForAgent = loadFunction('fallbackForAgent')

  assert.deepEqual(fallbackForAgent({ label: 'quick-decider' }), {
    decision: 'stop',
    reasoning: 'fallback after unavailable verdict',
  })
  assert.equal(fallbackForAgent({ label: 'unknown' }), null)
})

test('recordAgentFailure opens circuit and updates degradation telemetry', () => {
  const recordAgentFailure = loadFunction('recordAgentFailure')
  const agentCircuitOpen = loadFunction('agentCircuitOpen')
  const result = { logLines: [] }
  const opts = { phase: 'Review', label: 'critical-reviewer' }

  recordAgentFailure(result, opts, 'same malformed verdict')
  recordAgentFailure(result, opts, 'same malformed verdict')
  recordAgentFailure(result, opts, 'same malformed verdict')

  assert.equal(result.agentFailures['Review:critical-reviewer'].circuitOpen, true)
  assert.equal(agentCircuitOpen(opts, result), true)
  assert.equal(result.degradationTelemetry.fallbacks, 3)
  assert.equal(result.degradationTelemetry.escalations, 1)
  assert.equal(result.degradationTelemetry.circuitBreakers, 1)
})

test('outputLanguageViolation flags mostly non-English verdict text', () => {
  const outputLanguageViolation = loadFunction('outputLanguageViolation')

  assert.equal(outputLanguageViolation({ summary: 'ошибка не исправлена, нужно остановиться' }), true)
  assert.equal(outputLanguageViolation({ summary: 'error not fixed, stop safely' }), false)
})

test('repairJsonText does not quote keys or literals inside JSON string values', () => {
  const extractJson = loadFunction('extractJson')

  assert.deepEqual(extractJson('{summary: "keep retry: True and status: open", fixed: False,}'), {
    summary: 'keep retry: True and status: open',
    fixed: false,
  })
})

test('repairJsonText preserves single-quoted escape sequences', () => {
  const extractJson = loadFunction('extractJson')

  assert.deepEqual(extractJson("{summary: 'line1\\nline2', tabbed: 'a\\tb', unicode: '\\u2713'}"), {
    summary: 'line1\\nline2',
    tabbed: 'a\\tb',
    unicode: '\\u2713',
  })
})

test('repairJsonText unescapes quotes inside single-quoted strings', () => {
  const extractJson = loadFunction('extractJson')

  assert.deepEqual(extractJson("{summary: 'don\\'t stop', quote: 'say \\\"retry\\\"'}"), {
    summary: "don't stop",
    quote: 'say "retry"',
  })
})
