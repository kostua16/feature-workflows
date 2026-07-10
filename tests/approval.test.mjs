// Tests for applyApprovalDecision — the pure half of the human design-approval
// checkpoint (the /design-feature command asks the user; the engine applies the
// decision on re-invoke).
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { applyApprovalDecision } = engine

test('applyApprovalDecision: approve records the sign-off and clears the pending flag', () => {
  const result = { approvalPending: true, designApproved: null, _state: { seq: 7 } }
  assert.equal(applyApprovalDecision(result, { approve: true }), 'approved')
  assert.equal(result.designApproved.approved, true)
  assert.equal(result.designApproved.by, 'user')
  assert.equal(result.designApproved.seq, 7)
  assert.equal(result.approvalPending, false)
})

test('applyApprovalDecision: approve is idempotent', () => {
  const result = { approvalPending: false, designApproved: { approved: true, by: 'user', seq: 3 } }
  assert.equal(applyApprovalDecision(result, { approve: true }), 'approved')
  assert.equal(result.designApproved.approved, true)
  assert.equal(result.approvalPending, false)
})

test('applyApprovalDecision: rejectToPlan clears approval for a re-plan', () => {
  const result = { approvalPending: true, designApproved: null }
  assert.equal(applyApprovalDecision(result, { rejectToPlan: true }), 'rerun-plan')
  assert.equal(result.designApproved, null)
  assert.equal(result.approvalPending, false)
})

test('applyApprovalDecision: stageEdits requests a re-chunk', () => {
  const result = { approvalPending: true }
  assert.equal(applyApprovalDecision(result, { stageEdits: 'merge stage02 into stage01' }), 'edit-stages')
  assert.equal(result.approvalPending, false)
})

test('applyApprovalDecision: no decision returns null and mutates nothing', () => {
  const result = { approvalPending: true, designApproved: null }
  assert.equal(applyApprovalDecision(result, {}), null)
  assert.equal(applyApprovalDecision(result, { approve: false, rejectToPlan: false, stageEdits: '' }), null)
  assert.equal(result.approvalPending, true)
})

test('applyApprovalDecision: tolerates a result hydrated from older state (fields absent)', () => {
  const result = { executed: false }
  assert.equal(applyApprovalDecision(result, { approve: true }), 'approved')
  assert.equal(result.designApproved.approved, true)
  assert.equal(result.designApproved.seq, 0)
})

test('applyApprovalDecision: null result or decision is a no-op', () => {
  assert.equal(applyApprovalDecision(null, { approve: true }), null)
  assert.equal(applyApprovalDecision({ approvalPending: true }, null), null)
})

test('applyApprovalDecision: approve wins when multiple decision fields are set', () => {
  const result = {}
  assert.equal(applyApprovalDecision(result, { approve: true, rejectToPlan: true }), 'approved')
  assert.equal(result.designApproved.approved, true)
})
