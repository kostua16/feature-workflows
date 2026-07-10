// Tests for the issues-handoff helpers shared by the goalkeeper loop-back and the
// code-review blocker path: selectBlockingFindings (severity gate) and
// buildIssuesHandoff (the /tune-feature directive).
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { selectBlockingFindings, buildIssuesHandoff } = engine

// ---- selectBlockingFindings ----------------------------------------------------

test('selectBlockingFindings: keeps blocker and high severity only', () => {
  const blockers = [
    { severity: 'blocker', finding: 'a' },
    { severity: 'high', finding: 'b' },
    { severity: 'medium', finding: 'c' },
    { severity: 'low', finding: 'd' },
  ]
  const blocking = selectBlockingFindings(blockers)
  assert.deepEqual(blocking.map((b) => b.finding), ['a', 'b'])
})

test('selectBlockingFindings: drops entries without a blocking severity', () => {
  assert.deepEqual(selectBlockingFindings([{ finding: 'no severity' }, null, 'a string']), [])
})

test('selectBlockingFindings: tolerates non-array input', () => {
  assert.deepEqual(selectBlockingFindings(undefined), [])
  assert.deepEqual(selectBlockingFindings(null), [])
  assert.deepEqual(selectBlockingFindings('oops'), [])
})

// ---- buildIssuesHandoff ---------------------------------------------------------

test('buildIssuesHandoff: upstream findings direct the user to /tune-feature', () => {
  const handoff = buildIssuesHandoff('docs/x/feature/y/', 2, 'code-review')
  assert.equal(handoff.nextMode, 'tune')
  assert.equal(handoff.planDir, 'docs/x/feature/y/')
  assert.equal(handoff.upstreamCount, 2)
  assert.match(handoff.message, /Run: \/tune-feature docs\/x\/feature\/y\//)
  assert.match(handoff.message, /code-review/)
})

test('buildIssuesHandoff: zero upstream keeps the review-and-rerun message', () => {
  const handoff = buildIssuesHandoff('docs/x/feature/y/', 0, 'goalkeeper')
  assert.equal(handoff.upstreamCount, 0)
  assert.match(handoff.message, /re-run \/implement-feature docs\/x\/feature\/y\//)
  assert.match(handoff.message, /goalkeeper/)
})
