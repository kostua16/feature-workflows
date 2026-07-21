// Regression for issue #17: Workflow sandbox does not bind `export const meta` at
// runtime, so the dist must never use `meta.*`. Version stamps/skew use ENGINE_VERSION.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engine } from './harness.mjs'

const distPath = new URL('../plugins/feature-workflows/workflows/feature-pipeline.js', import.meta.url)
const dist = readFileSync(distPath, 'utf8')
const header = dist.match(/^\/\/ engine-version:\s*(\S+)/m)?.[1]

test('dist: no runtime meta. access (sandbox does not bind meta; issue #17)', () => {
  assert.ok(header, 'dist must have // engine-version: header')
  assert.match(dist, /^export const meta = \{/m, 'dist must keep export const meta for sandbox metadata')
  assert.doesNotMatch(
    dist,
    /\bmeta\./,
    'dist must not reference meta.* at runtime (Workflow sandbox leaves meta unbound; issue #17)'
  )
})

test('dist: ENGINE_VERSION injected and matches engine-version header', () => {
  const decl = `const ENGINE_VERSION = '${header}';`
  assert.ok(dist.includes(decl), `dist must contain ${decl}`)
  assert.match(dist, /engineVersion:\s*ENGINE_VERSION/, 'flushPipelineState must stamp ENGINE_VERSION')
  assert.match(dist, /detectResumeEngineSkew\(\s*resumed\.engineVersion,\s*ENGINE_VERSION\s*\)/, 'resume skew must use ENGINE_VERSION')
})

test('detectResumeEngineSkew: returns skew when saved differs from current', () => {
  const { detectResumeEngineSkew } = engine
  assert.ok(typeof detectResumeEngineSkew === 'function', 'detectResumeEngineSkew must be exported from dist')
  assert.equal(detectResumeEngineSkew(undefined, header), null)
  assert.equal(detectResumeEngineSkew(null, header), null)
  assert.equal(detectResumeEngineSkew(header, header), null)
  assert.deepEqual(detectResumeEngineSkew('0.0.0', header), { saved: '0.0.0', current: header })
})
