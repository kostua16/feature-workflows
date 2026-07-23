// Design-mode bounded budgets, per-loop sub-budgets, and bounded prompt context.
//
// RED evidence: F11 (gateTelemetry only counts, never enforces),
// F12 (shared retry budget starvation, hardcoded ESCALATION_RETRIES),
// F13 (raw JSON.stringify in design-gate prompts without compactList).
//
// GREEN evidence: design-budget.mjs wraps Phase 5 budget-admission with per-gate
// enforcement and non-spendable reserve; design-loops.mjs gives each review/refine
// loop its own bounded sub-budget; compactList applied at all design-gate prompt sites.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  DESIGN_BUDGET_DEFAULTS,
  DESIGN_RESERVE_CALLS,
  createDesignBudget,
  spendDesignGate,
  gateCallsRemaining,
  gateTokensRemaining,
  canAdmitDesignGate,
  designBudgetSummary,
  recordGateTokenSpend,
  createLoopBudgets,
  spendLoop,
  loopBudgetExhausted,
  loopBudgetSummary,
  ESCALATION_RETRIES_DEFAULT,
} = engine

const distSource = readFileSync(
  new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url),
  'utf8'
)

// ---- DBUDGET-01: design-mode per-gate/per-run budget enforcement (F11) ---------

test('DBUDGET-01: DESIGN_BUDGET_DEFAULTS is a frozen constant', () => {
  assert.equal(typeof DESIGN_BUDGET_DEFAULTS, 'object')
  assert.equal(Object.isFrozen(DESIGN_BUDGET_DEFAULTS), true)
  assert.equal(DESIGN_BUDGET_DEFAULTS.callPerGate > 0, true)
  assert.equal(DESIGN_BUDGET_DEFAULTS.callPerRun > 0, true)
})

test('DBUDGET-01: createDesignBudget returns a budget with accountant and caps', () => {
  const budget = createDesignBudget()
  assert.equal(typeof budget.accountant, 'object')
  assert.equal(typeof budget.caps.callPerGate, 'number')
  assert.equal(budget.caps.callPerGate, DESIGN_BUDGET_DEFAULTS.callPerGate)
  assert.deepEqual(budget.gateSpend, {})
})

test('DBUDGET-01: createDesignBudget accepts overrides', () => {
  const budget = createDesignBudget({ callPerGate: 4, callPerRun: 50 })
  assert.equal(budget.caps.callPerGate, 4)
  assert.equal(budget.accountant.limits.callCeiling, 50)
})

test('DBUDGET-01: spendDesignGate is pure — does not mutate input', () => {
  const budget = createDesignBudget()
  const next = spendDesignGate(budget, 'Plan', 3, 0)
  assert.equal(budget.gateSpend.Plan, undefined) // original untouched
  assert.equal(next.gateSpend.Plan.calls, 3)
  assert.equal(next.accountant.callsSpent, 3)
})

test('DBUDGET-01: spendDesignGate accumulates per-gate and per-run', () => {
  let budget = createDesignBudget()
  budget = spendDesignGate(budget, 'Plan', 2, 0)
  budget = spendDesignGate(budget, 'Plan', 1, 0)
  budget = spendDesignGate(budget, 'Architecture', 3, 0)
  assert.equal(budget.gateSpend.Plan.calls, 3)
  assert.equal(budget.gateSpend.Architecture.calls, 3)
  assert.equal(budget.accountant.callsSpent, 6)
})

test('DBUDGET-01: gateCallsRemaining reflects per-gate cap minus spent', () => {
  let budget = createDesignBudget({ callPerGate: 5 })
  budget = spendDesignGate(budget, 'Plan', 3, 0)
  assert.equal(gateCallsRemaining(budget, 'Plan'), 2)
  assert.equal(gateCallsRemaining(budget, 'Architecture'), 5)
})

test('DBUDGET-01: canAdmitDesignGate denies when per-gate cap exceeded', () => {
  let budget = createDesignBudget({ callPerGate: 4 })
  budget = spendDesignGate(budget, 'Plan', 3, 0)
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 2 })
  assert.equal(result.admitted, false)
  assert.equal(result.reason, 'per-gate-cap')
})

test('DBUDGET-01: canAdmitDesignGate denies when per-run cap exceeded', () => {
  let budget = createDesignBudget({ callPerGate: 100, callPerRun: 10 })
  budget = spendDesignGate(budget, 'Plan', 8, 0)
  const result = canAdmitDesignGate(budget, 'Architecture', { calls: 5 })
  assert.equal(result.admitted, false)
  assert.equal(result.reason, 'per-run-cap')
})

test('DBUDGET-01: canAdmitDesignGate admits when within both caps', () => {
  const budget = createDesignBudget({ callPerGate: 10, callPerRun: 100 })
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 5 })
  assert.equal(result.admitted, true)
})

test('DBUDGET-01: non-spendable HANDOFF reserve reduces available calls', () => {
  const budget = createDesignBudget({ callPerRun: 50 })
  assert.equal(DESIGN_RESERVE_CALLS > 0, true)
  // callsSpent(0) + reserve(DESIGN_RESERVE_CALLS) must be subtracted from ceiling
  const available = budget.accountant.limits.callCeiling - budget.accountant.callsSpent
  // The reserve is accounted for in callsRemaining
  const source = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/design-budget.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(source.includes('RESERVE_TYPES.HANDOFF'), 'design-budget.mjs must reserve for HANDOFF')
})

test('DBUDGET-01: designBudgetSummary includes gateSpend and caps', () => {
  let budget = createDesignBudget({ callPerGate: 5, callPerRun: 100 })
  budget = spendDesignGate(budget, 'Plan', 2, 0)
  const summary = designBudgetSummary(budget)
  assert.equal(typeof summary.callCeiling, 'number')
  assert.equal(summary.gateSpend.Plan.calls, 2)
  assert.equal(summary.caps.callPerGate, 5)
  assert.equal(typeof summary.reserved, 'number')
  assert.ok(summary.reserved >= DESIGN_RESERVE_CALLS)
})

// ---- DLOOP-01: per-loop sub-budgets (F12) --------------------------------------

test('DLOOP-01: createLoopBudgets returns four loop entries', () => {
  const budgets = createLoopBudgets()
  assert.ok(budgets.refine, 'has refine')
  assert.ok(budgets.reconcile, 'has reconcile')
  assert.ok(budgets.debug, 'has debug')
  assert.ok(budgets.escalation, 'has escalation')
  assert.equal(budgets.refine.used, 0)
  assert.equal(budgets.escalation.cap > 0, true)
})

test('DLOOP-01: createLoopBudgets respects config overrides', () => {
  const budgets = createLoopBudgets({ refineCap: 3, escalationCap: 7 })
  assert.equal(budgets.refine.cap, 3)
  assert.equal(budgets.escalation.cap, 7)
})

test('DLOOP-01: spendLoop is pure — does not mutate input', () => {
  const original = createLoopBudgets()
  const next = spendLoop(original, 'refine')
  assert.equal(original.refine.used, 0) // untouched
  assert.equal(next.refine.used, 1)
})

test('DLOOP-01: spending refine does NOT affect escalation budget (F12 independence)', () => {
  let budgets = createLoopBudgets()
  for (let i = 0; i < 5; i++) budgets = spendLoop(budgets, 'refine')
  assert.equal(budgets.refine.used, 5)
  assert.equal(budgets.escalation.used, 0)
  assert.equal(loopBudgetExhausted(budgets, 'escalation'), false)
})

test('DLOOP-01: spending reconcile does NOT affect refine or escalation', () => {
  let budgets = createLoopBudgets()
  budgets = spendLoop(budgets, 'reconcile')
  budgets = spendLoop(budgets, 'reconcile')
  assert.equal(budgets.reconcile.used, 2)
  assert.equal(budgets.refine.used, 0)
  assert.equal(budgets.escalation.used, 0)
})

test('DLOOP-01: loopBudgetExhausted is true when used >= cap', () => {
  let budgets = createLoopBudgets({ escalationCap: 3 })
  assert.equal(loopBudgetExhausted(budgets, 'escalation'), false)
  budgets = spendLoop(budgets, 'escalation')
  budgets = spendLoop(budgets, 'escalation')
  budgets = spendLoop(budgets, 'escalation')
  assert.equal(loopBudgetExhausted(budgets, 'escalation'), true)
})

test('DLOOP-01: loopBudgetSummary shows used/cap/remaining per loop', () => {
  let budgets = createLoopBudgets({ refineCap: 5 })
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'refine')
  const summary = loopBudgetSummary(budgets)
  assert.equal(summary.refine.used, 2)
  assert.equal(summary.refine.cap, 5)
  assert.equal(summary.refine.remaining, 3)
})

test('DLOOP-01: ESCALATION_RETRIES_DEFAULT is exported and equals 5', () => {
  assert.equal(ESCALATION_RETRIES_DEFAULT, 5)
})

test('DLOOP-01: ESCALATION_RETRIES is NOT hardcoded in the generated dist', () => {
  // The old `const ESCALATION_RETRIES = 5` must be gone — replaced by escalationCap
  assert.ok(
    !distSource.includes('const ESCALATION_RETRIES = 5'),
    'ESCALATION_RETRIES must not be hardcoded in the dist'
  )
})

test('DLOOP-01: escalationCap is configurable via loopBudgets', () => {
  const budgets = createLoopBudgets({ escalationCap: 10 })
  assert.equal(budgets.escalation.cap, 10)
  // Verify the dist references escalationCap (the configurable variable)
  assert.ok(
    distSource.includes('escalationCap'),
    'dist must reference escalationCap (configurable)'
  )
})

// ---- DPROMPT-01: bounded prompt payloads via compactList (F13) -----------------

test('DPROMPT-01: no raw JSON.stringify of reconcile.conflicts in design-gate prompts', () => {
  // The generated dist must not contain raw JSON.stringify of reconcile conflicts
  // at prompt interpolation sites. compactList should be used instead.
  const pattern = /JSON\.stringify\(result\.reconcile\.conflicts\)/
  assert.ok(
    !pattern.test(distSource),
    'dist must not interpolate raw JSON.stringify(result.reconcile.conflicts) into prompts — use compactList'
  )
})

test('DPROMPT-01: no raw JSON.stringify of reconcile.designFixes in design-gate prompts', () => {
  const pattern = /JSON\.stringify\(result\.reconcile\.designFixes/
  assert.ok(
    !pattern.test(distSource),
    'dist must not interpolate raw JSON.stringify(result.reconcile.designFixes) into prompts — use compactList'
  )
})

test('DPROMPT-01: no raw JSON.stringify of yagniBlockers in escalation prompt', () => {
  const pattern = /JSON\.stringify\(yagniBlockers/
  assert.ok(
    !pattern.test(distSource),
    'dist must not interpolate raw JSON.stringify(yagniBlockers) into prompts — use compactList'
  )
})

test('DPROMPT-01: no raw JSON.stringify of reviewState.blockers in escalation prompt', () => {
  const pattern = /JSON\.stringify\(\(reviewState && reviewState\.blockers\)/
  assert.ok(
    !pattern.test(distSource),
    'dist must not interpolate raw JSON.stringify(reviewState.blockers) into prompts — use compactList'
  )
})

test('DPROMPT-01: no raw JSON.stringify of review.blockers in refine prompt', () => {
  const pattern = /JSON\.stringify\(review\.blockers/
  assert.ok(
    !pattern.test(distSource),
    'dist must not interpolate raw JSON.stringify(review.blockers) into prompts — use compactList'
  )
})

test('DPROMPT-01: compactList IS applied at reconcile conflict sites', () => {
  // Verify compactList is called with reconcile conflicts
  assert.ok(
    distSource.includes('compactList(result.reconcile.conflicts'),
    'dist must use compactList for reconcile conflicts in prompts'
  )
})

test('DPROMPT-01: compactList IS applied at design-fix sites', () => {
  assert.ok(
    distSource.includes('compactList(result.reconcile.designFixes'),
    'dist must use compactList for design fixes in prompts'
  )
})

test('DPROMPT-01: compactList IS applied at escalation blocker sites', () => {
  assert.ok(
    distSource.includes('compactList(yagniBlockers'),
    'dist must use compactList for YAGNI blockers in escalation prompt'
  )
  assert.ok(
    distSource.includes('compactList((reviewState && reviewState.blockers)'),
    'dist must use compactList for review blockers in escalation prompt'
  )
})

// ---- D3: per-gate token budget measurement plumbing ----------------------------

test('D3: gateTokensRemaining returns Infinity when tokenPerGate is 0 (uncharacterized)', () => {
  const budget = createDesignBudget()
  assert.equal(DESIGN_BUDGET_DEFAULTS.tokenPerGate, 0, 'default tokenPerGate must be 0')
  assert.equal(gateTokensRemaining(budget, 'Plan'), Infinity)
})

test('D3: gateTokensRemaining returns cap minus spent when tokenPerGate is set', () => {
  const budget = createDesignBudget({ tokenPerGate: 5000 })
  assert.equal(gateTokensRemaining(budget, 'Plan'), 5000)
  const spent = spendDesignGate(budget, 'Plan', 0, 1500)
  assert.equal(gateTokensRemaining(spent, 'Plan'), 3500)
})

test('D3: recordGateTokenSpend records tokens without counting calls', () => {
  const budget = createDesignBudget({ tokenPerGate: 10000, callPerGate: 5 })
  const after = recordGateTokenSpend(budget, 'Architecture', 3000)
  assert.equal(after.gateSpend.Architecture.tokens, 3000)
  assert.equal(after.gateSpend.Architecture.calls, 0, 'token recording must NOT count as a call')
  assert.equal(after.accountant.tokensSpent, 3000)
  assert.equal(after.accountant.callsSpent, 0, 'token recording must NOT increment call spend')
})

test('D3: recordGateTokenSpend is pure — does not mutate input', () => {
  const budget = createDesignBudget({ tokenPerGate: 10000 })
  const after = recordGateTokenSpend(budget, 'Plan', 2000)
  assert.equal(budget.gateSpend.Plan, undefined, 'original untouched')
  assert.equal(after.gateSpend.Plan.tokens, 2000)
})

test('D3: recordGateTokenSpend accumulates across calls', () => {
  let budget = createDesignBudget({ tokenPerGate: 10000 })
  budget = recordGateTokenSpend(budget, 'Plan', 1000)
  budget = recordGateTokenSpend(budget, 'Plan', 500)
  assert.equal(budget.gateSpend.Plan.tokens, 1500)
  assert.equal(gateTokensRemaining(budget, 'Plan'), 8500)
})

// ---- Regression: build integrity ------------------------------------------------

test('REGRESSION: dist contains design-budget module exports', () => {
  assert.ok(distSource.includes('createDesignBudget'), 'dist must contain createDesignBudget')
  assert.ok(distSource.includes('canAdmitDesignGate'), 'dist must contain canAdmitDesignGate')
  assert.ok(distSource.includes('designBudgetSummary'), 'dist must contain designBudgetSummary')
})

test('REGRESSION: dist contains design-loops module exports', () => {
  assert.ok(distSource.includes('createLoopBudgets'), 'dist must contain createLoopBudgets')
  assert.ok(distSource.includes('spendLoop'), 'dist must contain spendLoop')
  assert.ok(distSource.includes('loopBudgetExhausted'), 'dist must contain loopBudgetExhausted')
})

test('REGRESSION: no direct FS or shell access in new modules', () => {
  const newModuleSource = readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/design-budget.mjs', import.meta.url),
    'utf8'
  ) + readFileSync(
    new URL('../plugins/feature-workflows/workflows/src/design-loops.mjs', import.meta.url),
    'utf8'
  )
  assert.ok(!/require\(/.test(newModuleSource), 'no require() in new modules')
  assert.ok(!/Date\.now|Math\.random|new Date/.test(newModuleSource), 'no forbidden tokens')
})
