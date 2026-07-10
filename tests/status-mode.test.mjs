// Tests for the status-mode helpers: summarizeGates (flag -> done/pending/blocked),
// deriveNextCommand (exact next-command ladder), renderStatusReport (full report),
// and resolveMode accepting 'status'. Fixtures cover both a pre-status-mode state
// shape (no telemetry/approval fields) and a current-shape blocked run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { summarizeGates, deriveNextCommand, renderStatusReport, resolveMode } = engine

// State persisted by an older engine mid-design: several fields missing entirely.
const legacyMidDesignState = {
  task: 'add retry layer to the parser',
  slug: 'add-retry-layer',
  planPath: 'docs/parser/feature/add-retry-layer/plan.md',
  planDir: 'docs/parser/feature/add-retry-layer/',
  lastGate: 'Architecture',
  result: {
    mode: 'design',
    definitionPath: 'docs/parser/feature/add-retry-layer/idea.md',
    requirementsPath: 'docs/parser/feature/add-retry-layer/requirements.md',
    archPath: null,
    designReady: false,
    blockedAt: null,
    retryUsed: 2,
  },
  config: { mode: 'design', retryBudget: 20, decisionCap: 50 },
}

// Current-shape implement run blocked at the issues handoff.
const blockedImplementState = {
  task: 'add retry layer to the parser',
  slug: 'add-retry-layer',
  planPath: 'docs/parser/feature/add-retry-layer/plan.md',
  planDir: 'docs/parser/feature/add-retry-layer/',
  lastGate: 'Goalkeeper',
  result: {
    mode: 'implement',
    definitionPath: 'x/idea.md',
    requirementsPath: 'x/requirements.md',
    archPath: 'x/architecture.md',
    designPath: 'x/detailed-design.md',
    planned: true,
    tddEnforced: true,
    reconcile: { consistent: true },
    designReady: true,
    executed: true,
    testsPassed: true,
    codeReview: { blockers: [], issues: 0 },
    blockedAt: 'issues-handoff',
    issuesPath: 'docs/parser/feature/add-retry-layer/issues-and-improvements.md',
    retryUsed: 5,
    decisionUsed: 3,
    stages: [
      { id: 'stage01', name: 'core retry', status: 'done', files: ['a.py', 'b.py'] },
      { id: 'stage02', name: 'wire config', status: 'done', files: ['c.py'] },
    ],
    gateTelemetry: { Execute: { calls: 4, retries: 1, escalations: 0, fallbacks: 0, models: { sonnet: 4 } } },
    handoff: {
      from: 'implement',
      message: 'Upstream defect found (2 upstream issue(s) written). Run: /tune-feature docs/parser/feature/add-retry-layer/',
      nextMode: 'tune',
      planDir: 'docs/parser/feature/add-retry-layer/',
    },
  },
  config: { mode: 'implement', retryBudget: 20, decisionCap: 50 },
}

// ---- resolveMode --------------------------------------------------------------

test('resolveMode: accepts status as an explicit mode', () => {
  assert.equal(resolveMode({ mode: 'status' }, {}, null), 'status')
})

// ---- summarizeGates -----------------------------------------------------------

test('summarizeGates: maps completion flags to done/pending', () => {
  const rows = summarizeGates(legacyMidDesignState.result)
  const byGate = Object.fromEntries(rows.map((r) => [r.gate, r.status]))
  assert.equal(byGate.define, 'done')
  assert.equal(byGate.requirements, 'done')
  assert.equal(byGate.architecture, 'pending')
  assert.equal(byGate.execute, 'pending')
})

test('summarizeGates: attributes blockedAt to the matching gate (substring tolerant)', () => {
  const rows = summarizeGates({ blockedAt: 'test' })
  const tests = rows.find((r) => r.gate === 'tests')
  assert.equal(tests.status, 'blocked')
})

test('summarizeGates: compound block reasons hit the owning gate row', () => {
  const design = summarizeGates({ blockedAt: 'detailed-design' }).find((r) => r.gate === 'design')
  assert.equal(design.status, 'blocked')
})

test('summarizeGates: tolerates an empty/undefined result', () => {
  assert.doesNotThrow(() => summarizeGates(undefined))
  assert.ok(summarizeGates({}).every((r) => r.status === 'pending'))
})

// ---- deriveNextCommand ----------------------------------------------------------

test('deriveNextCommand: handoff wins and yields the exact command', () => {
  const next = deriveNextCommand(blockedImplementState)
  assert.equal(next.command, '/tune-feature docs/parser/feature/add-retry-layer/')
})

test('deriveNextCommand: committed run needs nothing', () => {
  const next = deriveNextCommand({ planDir: 'x/', result: { committed: true, handoff: { nextMode: 'tune' } } })
  assert.equal(next.command, '(none)')
})

test('deriveNextCommand: designReady without execute suggests implement', () => {
  const next = deriveNextCommand({ planDir: 'x/', result: { designReady: true, executed: false } })
  assert.equal(next.command, '/implement-feature x/')
})

test('deriveNextCommand: mid-design default is a design resume', () => {
  const next = deriveNextCommand(legacyMidDesignState)
  assert.equal(next.command, '/design-feature --resume docs/parser/feature/add-retry-layer/')
})

test('deriveNextCommand: blocked run without handoff resumes its own mode', () => {
  const next = deriveNextCommand({ planDir: 'x/', result: { mode: 'implement', blockedAt: 'execute' }, config: { mode: 'implement' } })
  assert.equal(next.command, '/implement-feature x/')
  assert.match(next.reason, /blocked at execute/)
})

// ---- renderStatusReport ---------------------------------------------------------

test('renderStatusReport: renders gates, stages, budgets, telemetry, and next command', () => {
  const report = renderStatusReport(blockedImplementState, { ok: true, errors: [] })
  assert.match(report, /Pipeline status — docs\/parser\/feature\/add-retry-layer\//)
  assert.match(report, /Mode: implement/)
  assert.match(report, /blockedAt: issues-handoff/)
  assert.match(report, /\[x\] execute/)
  assert.match(report, /stage01 \[done\] core retry — 2 file\(s\)/)
  assert.match(report, /Budgets: retries 5\/20, decisions 3\/50/)
  assert.match(report, /Execute: calls=4/)
  assert.match(report, /Issues file:/)
  assert.match(report, /Next: \/tune-feature docs\/parser\/feature\/add-retry-layer\//)
})

test('renderStatusReport: legacy state shape renders without throwing', () => {
  const report = renderStatusReport(legacyMidDesignState, { ok: true, errors: [] })
  assert.match(report, /Mode: design/)
  assert.match(report, /Next: \/design-feature --resume/)
})

test('renderStatusReport: failed validation downgrades to a warning line', () => {
  const report = renderStatusReport(blockedImplementState, { ok: false, errors: ['checksum mismatch'] })
  assert.match(report, /WARNING: pipeline-state\.json failed validation \(checksum mismatch\)/)
})

test('renderStatusReport: fully empty state still renders a report', () => {
  assert.doesNotThrow(() => renderStatusReport({}, undefined))
  assert.match(renderStatusReport({}, undefined), /Next: /)
})
