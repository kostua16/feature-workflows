// Tests for the per-gate agent-call telemetry helpers:
// bumpGateTelemetry (counters + model histogram, lazy bucket creation) and
// renderTelemetrySummary (log-line rendering incl. the degradation trailer).
import test from 'node:test'
import assert from 'node:assert/strict'
import { engine } from './harness.mjs'

const { bumpGateTelemetry, renderTelemetrySummary } = engine

// ---- bumpGateTelemetry -------------------------------------------------------

test('bumpGateTelemetry: counts calls per gate with a model histogram', () => {
  const result = { gateTelemetry: {} }
  bumpGateTelemetry(result, { phase: 'Plan', label: 'plan-architect' }, 'call', 'sonnet')
  bumpGateTelemetry(result, { phase: 'Plan', label: 'plan-architect' }, 'call', 'sonnet')
  bumpGateTelemetry(result, { phase: 'Plan', label: 'critical-reviewer' }, 'call', 'opus')
  const bucket = result.gateTelemetry.Plan
  assert.equal(bucket.calls, 3)
  assert.equal(bucket.models.sonnet, 2)
  assert.equal(bucket.models.opus, 1)
})

test('bumpGateTelemetry: retry/escalation/fallback events hit their own counters', () => {
  const result = { gateTelemetry: {} }
  const opts = { phase: 'Test', label: 'test-runner' }
  bumpGateTelemetry(result, opts, 'call', 'haiku')
  bumpGateTelemetry(result, opts, 'retry')
  bumpGateTelemetry(result, opts, 'escalation')
  bumpGateTelemetry(result, opts, 'fallback')
  const bucket = result.gateTelemetry.Test
  assert.equal(bucket.calls, 1)
  assert.equal(bucket.retries, 1)
  assert.equal(bucket.escalations, 1)
  assert.equal(bucket.fallbacks, 1)
})

test('bumpGateTelemetry: lazily creates the field on results hydrated from older state', () => {
  const result = { executed: true } // pre-telemetry pipeline-state shape
  bumpGateTelemetry(result, { phase: 'Execute', label: 'plan-executor' }, 'call', 'sonnet')
  assert.equal(result.gateTelemetry.Execute.calls, 1)
})

test('bumpGateTelemetry: missing phase buckets under "unknown"; missing model as "(default)"', () => {
  const result = {}
  bumpGateTelemetry(result, { label: 'orphan' }, 'call')
  assert.equal(result.gateTelemetry.unknown.calls, 1)
  assert.equal(result.gateTelemetry.unknown.models['(default)'], 1)
})

test('bumpGateTelemetry: no-op on falsy result', () => {
  assert.doesNotThrow(() => bumpGateTelemetry(null, { phase: 'X' }, 'call', 'haiku'))
})

// ---- renderTelemetrySummary ---------------------------------------------------

test('renderTelemetrySummary: empty telemetry renders nothing', () => {
  assert.deepEqual(renderTelemetrySummary({}, undefined), [])
  assert.deepEqual(renderTelemetrySummary(undefined, undefined), [])
  assert.deepEqual(renderTelemetrySummary(undefined, { fallbacks: 0, escalations: 0, languageViolations: 0, circuitBreakers: 0 }), [])
})

test('renderTelemetrySummary: renders one row per gate with counters and models', () => {
  const lines = renderTelemetrySummary({
    Plan: { calls: 3, retries: 1, escalations: 0, fallbacks: 0, models: { sonnet: 2, opus: 1 } },
    Test: { calls: 1, retries: 0, escalations: 0, fallbacks: 1, models: { haiku: 1 } },
  }, null)
  assert.equal(lines[0], 'Telemetry (per gate):')
  const planRow = lines.find((l) => l.includes('Plan:'))
  assert.match(planRow, /calls=3/)
  assert.match(planRow, /retries=1/)
  assert.match(planRow, /sonnet x2/)
  const testRow = lines.find((l) => l.includes('Test:'))
  assert.match(testRow, /fallbacks=1/)
})

test('renderTelemetrySummary: degradation trailer appears only when non-zero', () => {
  const withDegradations = renderTelemetrySummary({}, { fallbacks: 2, escalations: 1, languageViolations: 0, circuitBreakers: 0 })
  assert.equal(withDegradations.length, 1)
  assert.match(withDegradations[0], /Degradations: fallbacks=2 escalations=1/)
})
