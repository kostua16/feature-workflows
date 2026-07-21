// A stray `\r` in any shipped plugin file (source or artifact) blocks Workflow
// execution: the host reads the engine bytes as the `script` field and the
// Workflow validator rejects control characters. This guard fails the suite —
// and thus CI — before a CRLF blob can ship. See issue #16.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('../plugins/feature-workflows/', import.meta.url))
const EXT = /\.(js|mjs|md|json)$/
const offenders = []
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!EXT.test(e)) continue
    if (readFileSync(p, 'utf8').includes('\r')) offenders.push(relative(root, p))
  }
}
walk(root)

test('no plugin source/artifact file contains CR (CRLF blocks Workflow execution, issue #16)', () => {
  assert.deepEqual(offenders, [], `CRLF found in: ${offenders.join(', ')}`)
})
