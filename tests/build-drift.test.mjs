// The committed dist engine must be exactly what `npm run build` produces from
// workflows/src/ — a src edit without a rebuild (or a hand-edit of the dist)
// fails here before it fails in CI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const builder = fileURLToPath(new URL('../scripts/build-workflows.mjs', import.meta.url))

test('dist engine is byte-identical to a fresh build of workflows/src/', () => {
  const out = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' })
  assert.match(out, /up to date/)
})
