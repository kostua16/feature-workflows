// Nyquist validation gap-filling tests for Phase 10.
// Covers behavioral depth and edge cases not exercised by the original test suite.
// Dimensions: reserve enforcement, token tracking, boundary admission,
// loop independence completeness, compactList parameter verification,
// and dist wiring integrity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const {
  DESIGN_BUDGET_DEFAULTS, DESIGN_RESERVE_CALLS,
  createDesignBudget, spendDesignGate, gateCallsRemaining,
  canAdmitDesignGate, designBudgetSummary,
  createLoopBudgets, spendLoop, loopBudgetExhausted, loopBudgetSummary,
  ESCALATION_RETRIES_DEFAULT,
  callsRemaining, totalReserve, budgetSummary, RESERVE_TYPES,
} = engine

const distPath = new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url)
const distSource = readFileSync(distPath, 'utf8')

// ========== DBUDGET-01: reserve enforcement depth ==========

test('NYQ-DBUDGET: HANDOFF reserve reduces callsRemaining below ceiling', () => {
  const budget = createDesignBudget({ callPerRun: 100 })
  const avail = callsRemaining(budget.accountant)
  assert.equal(avail, 100 - DESIGN_RESERVE_CALLS, 'callsRemaining must subtract HANDOFF reserve')
})

test('NYQ-DBUDGET: reserve is visible in budgetSummary reserved field', () => {
  const budget = createDesignBudget({ callPerRun: 100 })
  const summary = budgetSummary(budget.accountant)
  assert.ok(summary.reserved >= DESIGN_RESERVE_CALLS)
  assert.equal(summary.reserveBreakdown[RESERVE_TYPES.HANDOFF], DESIGN_RESERVE_CALLS)
})

test('NYQ-DBUDGET: spending all available calls does not touch reserve', () => {
  const budget = createDesignBudget({ callPerRun: 50 })
  const avail = callsRemaining(budget.accountant)
  const spent = spendDesignGate(budget, 'Plan', avail, 0)
  // After spending ALL available calls, the reserve must still be intact
  const remaining = callsRemaining(spent.accountant)
  assert.equal(remaining, 0)
  assert.equal(totalReserve(spent.accountant), DESIGN_RESERVE_CALLS)
})

test('NYQ-DBUDGET: per-run cap denies admission before consuming reserve', () => {
  let budget = createDesignBudget({ callPerGate: 100, callPerRun: 20 })
  budget = spendDesignGate(budget, 'Plan', 5, 0) // 5 spent, 5 avail (20-10 reserve-5 spent)
  const result = canAdmitDesignGate(budget, 'Architecture', { calls: 6 })
  assert.equal(result.admitted, false)
  assert.equal(result.reason, 'per-run-cap')
})

test('NYQ-DBUDGET: boundary — exact fit at per-gate cap is admitted', () => {
  let budget = createDesignBudget({ callPerGate: 5, callPerRun: 100 })
  budget = spendDesignGate(budget, 'Plan', 3, 0) // 2 remaining for gate
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 2 })
  assert.equal(result.admitted, true, 'exact fit must be admitted')
})

test('NYQ-DBUDGET: boundary — one over per-gate cap is denied', () => {
  let budget = createDesignBudget({ callPerGate: 5, callPerRun: 100 })
  budget = spendDesignGate(budget, 'Plan', 3, 0) // 2 remaining
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 3 })
  assert.equal(result.admitted, false)
  assert.equal(result.reason, 'per-gate-cap')
})

test('NYQ-DBUDGET: gateCallsRemaining clamps to zero when over-spent', () => {
  let budget = createDesignBudget({ callPerGate: 3 })
  budget = spendDesignGate(budget, 'Plan', 10, 0) // over-spent
  assert.equal(gateCallsRemaining(budget, 'Plan'), 0, 'must not return negative')
})

test('NYQ-DBUDGET: canAdmitDesignGate returns remaining structure with gate and run', () => {
  const budget = createDesignBudget({ callPerGate: 10, callPerRun: 100 })
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 3 })
  assert.equal(typeof result.remaining.gate, 'number')
  assert.equal(typeof result.remaining.run, 'number')
})

test('NYQ-DBUDGET: zero-cost admission always succeeds', () => {
  const budget = createDesignBudget({ callPerGate: 1, callPerRun: 1 })
  const result = canAdmitDesignGate(budget, 'Plan', { calls: 0 })
  assert.equal(result.admitted, true)
})

test('NYQ-DBUDGET: token spend accumulates in gateSpend and accountant', () => {
  let budget = createDesignBudget()
  budget = spendDesignGate(budget, 'Plan', 2, 500)
  budget = spendDesignGate(budget, 'Plan', 1, 300)
  assert.equal(budget.gateSpend.Plan.tokens, 800)
  assert.equal(budget.accountant.tokensSpent, 800)
})

test('NYQ-DBUDGET: spendDesignGate with zero calls and tokens is no-op', () => {
  const budget = createDesignBudget()
  const next = spendDesignGate(budget, 'Plan', 0, 0)
  assert.equal(next.accountant.callsSpent, 0)
  assert.equal(next.accountant.tokensSpent, 0)
})

test('NYQ-DBUDGET: designBudgetSummary returns isolated copy', () => {
  let budget = createDesignBudget()
  budget = spendDesignGate(budget, 'Plan', 2, 0)
  const summary = designBudgetSummary(budget)
  summary.gateSpend.Plan.calls = 999
  assert.equal(budget.gateSpend.Plan.calls, 2, 'mutating summary must not affect budget')
})

test('NYQ-DBUDGET: multiple gates accumulate in accountant callsSpent', () => {
  let budget = createDesignBudget({ callPerGate: 10, callPerRun: 50 })
  budget = spendDesignGate(budget, 'Plan', 3, 0)
  budget = spendDesignGate(budget, 'Architecture', 4, 0)
  budget = spendDesignGate(budget, 'TDD', 2, 0)
  assert.equal(budget.accountant.callsSpent, 9)
  assert.equal(Object.keys(budget.gateSpend).length, 3)
})

test('NYQ-DBUDGET: createDesignBudget with null opts uses all defaults', () => {
  const budget = createDesignBudget(null)
  assert.equal(budget.caps.callPerGate, DESIGN_BUDGET_DEFAULTS.callPerGate)
  assert.equal(budget.accountant.limits.callCeiling, DESIGN_BUDGET_DEFAULTS.callPerRun)
})

test('NYQ-DBUDGET: gateCallsRemaining for unknown gate returns full cap', () => {
  const budget = createDesignBudget({ callPerGate: 7 })
  assert.equal(gateCallsRemaining(budget, 'Nonexistent'), 7)
})

// ========== DLOOP-01: loop independence completeness ==========

test('NYQ-DLOOP: debug loop spend does not affect refine, reconcile, or escalation', () => {
  let budgets = createLoopBudgets()
  for (let i = 0; i < 5; i++) budgets = spendLoop(budgets, 'debug')
  assert.equal(budgets.debug.used, 5)
  assert.equal(budgets.refine.used, 0)
  assert.equal(budgets.reconcile.used, 0)
  assert.equal(budgets.escalation.used, 0)
})

test('NYQ-DLOOP: refine loop exhaustion stops refine but not escalation', () => {
  let budgets = createLoopBudgets({ refineCap: 3 })
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'refine')
  assert.equal(loopBudgetExhausted(budgets, 'refine'), true)
  assert.equal(loopBudgetExhausted(budgets, 'escalation'), false)
})

test('NYQ-DLOOP: reconcile loop exhaustion stops reconcile but not debug', () => {
  let budgets = createLoopBudgets({ reconcileCap: 2 })
  budgets = spendLoop(budgets, 'reconcile')
  budgets = spendLoop(budgets, 'reconcile')
  assert.equal(loopBudgetExhausted(budgets, 'reconcile'), true)
  assert.equal(loopBudgetExhausted(budgets, 'debug'), false)
})

test('NYQ-DLOOP: debug loop exhaustion stops debug but not refine', () => {
  let budgets = createLoopBudgets({ debugCap: 2 })
  budgets = spendLoop(budgets, 'debug')
  budgets = spendLoop(budgets, 'debug')
  assert.equal(loopBudgetExhausted(budgets, 'debug'), true)
  assert.equal(loopBudgetExhausted(budgets, 'refine'), false)
})

test('NYQ-DLOOP: all four loops track simultaneously without interference', () => {
  let budgets = createLoopBudgets({ refineCap: 10, reconcileCap: 5, debugCap: 20, escalationCap: 5 })
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'reconcile')
  budgets = spendLoop(budgets, 'debug')
  budgets = spendLoop(budgets, 'escalation')
  budgets = spendLoop(budgets, 'refine')
  assert.equal(budgets.refine.used, 2)
  assert.equal(budgets.reconcile.used, 1)
  assert.equal(budgets.debug.used, 1)
  assert.equal(budgets.escalation.used, 1)
})

test('NYQ-DLOOP: spendLoop on unknown loop name returns unchanged', () => {
  const original = createLoopBudgets()
  const next = spendLoop(original, 'nonexistent')
  assert.deepEqual(next, original)
})

test('NYQ-DLOOP: loopBudgetExhausted on unknown loop returns true', () => {
  const budgets = createLoopBudgets()
  assert.equal(loopBudgetExhausted(budgets, 'nonexistent'), true)
})

test('NYQ-DLOOP: debugCap override is respected', () => {
  const budgets = createLoopBudgets({ debugCap: 7 })
  assert.equal(budgets.debug.cap, 7)
})

test('NYQ-DLOOP: reconcileCap override is respected', () => {
  const budgets = createLoopBudgets({ reconcileCap: 3 })
  assert.equal(budgets.reconcile.cap, 3)
})

test('NYQ-DLOOP: default caps match known config values', () => {
  const budgets = createLoopBudgets()
  assert.equal(budgets.refine.cap, 10, 'REFINE_SUBCAP_DEFAULT')
  assert.equal(budgets.reconcile.cap, 5, 'RECONCILE_SUBCAP_DEFAULT')
  assert.equal(budgets.debug.cap, 20, 'DEBUG_SUBCAP_DEFAULT')
  assert.equal(budgets.escalation.cap, 5, 'ESCALATION_RETRIES_DEFAULT')
})

test('NYQ-DLOOP: loopBudgetSummary with null returns empty object', () => {
  assert.deepEqual(loopBudgetSummary(null), {})
})

test('NYQ-DLOOP: loopBudgetSummary remaining clamps to zero', () => {
  let budgets = createLoopBudgets({ refineCap: 2 })
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'refine')
  budgets = spendLoop(budgets, 'refine') // over-cap
  const summary = loopBudgetSummary(budgets)
  assert.equal(summary.refine.remaining, 0)
  assert.equal(summary.refine.used, 3)
})

test('NYQ-DLOOP: createLoopBudgets with null config uses all defaults', () => {
  const budgets = createLoopBudgets(null)
  assert.equal(budgets.refine.cap, 10)
  assert.equal(budgets.escalation.cap, ESCALATION_RETRIES_DEFAULT)
})

// ========== DPROMPT-01: compactList parameter verification ==========

test('NYQ- DPROMPT: compactList called with max=8 for reconcile conflicts', () => {
  const matches = distSource.match(/compactList\(result\.reconcile\.conflicts,\s*8\)/g)
  assert.ok(matches && matches.length >= 3, 'expected >=3 compactList(conflicts, 8) sites')
})

test('NYQ-DPROMPT: compactList called with max=8 for designFixes', () => {
  const matches = distSource.match(/compactList\(result\.reconcile\.designFixes[^)]*,\s*8\)/g)
  assert.ok(matches && matches.length >= 2, 'expected >=2 compactList(designFixes, 8) sites')
})

test('NYQ-DPROMPT: compactList called with max=8 for yagniBlockers', () => {
  assert.ok(
    /compactList\(yagniBlockers,\s*8\)/.test(distSource),
    'yagniBlockers must use compactList with max=8'
  )
})

test('NYQ-DPROMPT: compactList called with max=8 for reviewState.blockers', () => {
  assert.ok(
    /compactList\(\(reviewState && reviewState\.blockers\)[^)]*,\s*8\)/.test(distSource),
    'reviewState.blockers must use compactList with max=8'
  )
})

test('NYQ-DPROMPT: no .slice(0, 800) on design-gate payloads', () => {
  // slice(0, 800) may only appear on test-summary strings, not design payloads
  const designFixSlice = /JSON\.stringify\(result\.reconcile[^)]*\)\.slice/.test(distSource)
  assert.equal(designFixSlice, false, 'no raw JSON.stringify + slice on design payloads')
})

test('NYQ-DPROMPT: compactList applied for review.blockers in refine context', () => {
  assert.ok(
    /compactList\(review\.blockers[^)]*,\s*8\)/.test(distSource),
    'review.blockers in refine must use compactList'
  )
})

test('NYQ-DPROMPT: compactList applied for review.gaps', () => {
  assert.ok(
    /compactList\(review\.gaps[^)]*,\s*8\)/.test(distSource),
    'review.gaps must use compactList'
  )
})

// ========== Integration: dist wiring verification ==========

test('NYQ-WIRE: dist imports createDesignBudget from design-budget', () => {
  assert.ok(distSource.includes('createDesignBudget'), 'dist must contain createDesignBudget')
})

test('NYQ-WIRE: dist imports createLoopBudgets from design-loops', () => {
  assert.ok(distSource.includes('createLoopBudgets'), 'dist must contain createLoopBudgets')
})

test('NYQ-WIRE: dist uses loopBudgetExhausted in reconcile loop condition', () => {
  assert.ok(
    /loopBudgetExhausted\(loopBudgets,\s*['"]reconcize['"]|loopBudgetExhausted\(loopBudgets,\s*['"]reconcile['"]/.test(distSource),
    'dist must use loopBudgetExhausted for reconcile loop'
  )
})

test('NYQ-WIRE: dist uses loopBudgetExhausted in refine loop condition', () => {
  assert.ok(
    /loopBudgetExhausted\(loopBudgets,\s*['"]refine['"]/.test(distSource),
    'dist must use loopBudgetExhausted for refine loop'
  )
})

test('NYQ-WIRE: dist uses spendLoop for reconcile tracking', () => {
  assert.ok(
    /spendLoop\(loopBudgets,\s*['"]reconcile['"]/.test(distSource),
    'dist must call spendLoop for reconcile'
  )
})

test('NYQ-WIRE: dist uses spendLoop for refine tracking', () => {
  assert.ok(
    /spendLoop\(loopBudgets,\s*['"]refine['"]/.test(distSource),
    'dist must call spendLoop for refine'
  )
})

test('NYQ-WIRE: dist uses spendLoop for escalation tracking', () => {
  assert.ok(
    /spendLoop\(loopBudgets,\s*['"]escalation['"]/.test(distSource),
    'dist must call spendLoop for escalation'
  )
})

test('NYQ-WIRE: dist sets result._designBudget at handoff', () => {
  assert.ok(
    /result\._designBudget\s*=/.test(distSource),
    'dist must set result._designBudget for handoff'
  )
})

test('NYQ-WIRE: dist sets result._loopBudgets at handoff', () => {
  assert.ok(
    /result\._loopBudgets\s*=/.test(distSource),
    'dist must set result._loopBudgets for handoff'
  )
})

test('NYQ-WIRE: dist uses escalationCap in escalation for-loop', () => {
  assert.ok(
    /attempt\s*<=\s*escalationCap/.test(distSource),
    'dist must use escalationCap in escalation loop bound'
  )
})

test('NYQ-WIRE: dist imports ESCALATION_RETRIES_DEFAULT from config', () => {
  assert.ok(distSource.includes('ESCALATION_RETRIES_DEFAULT'), 'dist must reference ESCALATION_RETRIES_DEFAULT')
})

test('NYQ-WIRE: dist does not contain hardcoded ESCALATION_RETRIES constant', () => {
  assert.ok(
    !/const\s+ESCALATION_RETRIES\s*=\s*\d/.test(distSource),
    'dist must not hardcode ESCALATION_RETRIES'
  )
})

test('NYQ-WIRE: dist references designBudgetSummary function', () => {
  assert.ok(distSource.includes('designBudgetSummary'), 'dist must call designBudgetSummary')
})

test('NYQ-WIRE: dist references loopBudgetSummary function', () => {
  assert.ok(distSource.includes('loopBudgetSummary'), 'dist must call loopBudgetSummary')
})

// ========== DBUDGET-01 enforcement wiring (designBudgetGate) ==========

test('NYQ-ENFORCE: dist defines designBudgetGate helper function', () => {
  assert.ok(
    /async\s+function\s+designBudgetGate\s*\(/.test(distSource),
    'dist must define the designBudgetGate async helper'
  )
})

test('NYQ-ENFORCE: designBudgetGate calls canAdmitDesignGate (admission check)', () => {
  assert.ok(
    distSource.includes('canAdmitDesignGate(designBudget'),
    'designBudgetGate must call canAdmitDesignGate to check per-gate/per-run admission'
  )
})

test('NYQ-ENFORCE: designBudgetGate calls spendDesignGate (spend recording)', () => {
  assert.ok(
    distSource.includes('spendDesignGate(designBudget'),
    'designBudgetGate must call spendDesignGate to record actual gate spend'
  )
})

test('NYQ-ENFORCE: dist calls designBudgetGate before Define gate agent', () => {
  assert.ok(
    /designBudgetGate\(result,\s*['"]Define['"]\)/.test(distSource),
    'dist must check design budget before Define gate'
  )
})

test('NYQ-ENFORCE: dist calls designBudgetGate before Plan gate agent', () => {
  assert.ok(
    /designBudgetGate\(result,\s*['"]Plan['"]\)/.test(distSource),
    'dist must check design budget before Plan gate'
  )
})

test('NYQ-ENFORCE: dist calls designBudgetGate before Architecture gate agent', () => {
  assert.ok(
    /designBudgetGate\(result,\s*['"]Architecture['"]\)/.test(distSource),
    'dist must check design budget before Architecture gate'
  )
})

test('NYQ-ENFORCE: dist calls designBudgetGate before Review/Refine gate agent', () => {
  assert.ok(
    /designBudgetGate\(result,\s*['"]Review\/Refine['"]\)/.test(distSource),
    'dist must check design budget before Review/Refine gate'
  )
})

test('NYQ-ENFORCE: dist calls designBudgetGate before Reconcile gate agent', () => {
  assert.ok(
    /designBudgetGate\(result,\s*['"]Reconcile['"]\)/.test(distSource),
    'dist must check design budget before Reconcile gate'
  )
})

test('NYQ-ENFORCE: dist blocks with design-budget-exhausted on denial', () => {
  assert.ok(
    distSource.includes("design-budget-exhausted"),
    'designBudgetGate must set blockedAt to design-budget-exhausted on denial'
  )
})

test('NYQ-ENFORCE: designBudgetGate is called at 12+ design gates', () => {
  const matches = distSource.match(/designBudgetGate\(result,\s*['"][^'"]+['"]\)/g)
  assert.ok(matches && matches.length >= 12,
    `dist must call designBudgetGate at >= 12 design gates (found ${matches ? matches.length : 0})`)
})
