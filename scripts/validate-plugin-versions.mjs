// Enforces the plugin's 3-way version lockstep:
//   1. plugins/feature-workflows/.claude-plugin/plugin.json -> "version"
//   2. plugins/feature-workflows/workflows/feature-pipeline.js -> "// engine-version:" header
//   3. plugins/feature-workflows/workflows/feature-pipeline.js -> meta.version
// The setup command and the pipeline-command preflights compare copies by the header
// alone, so a header that drifts from the manifest silently disables drift detection.
// Exit 0 = all three match; exit 1 = mismatch or a marker is missing.
import { readFileSync } from 'node:fs'

const pluginRoot = new URL('../plugins/feature-workflows/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', pluginRoot), 'utf8'))
const engine = readFileSync(new URL('workflows/feature-pipeline.js', pluginRoot), 'utf8')

const headerVersion = engine.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)?.[1] ?? null
const metaVersion = engine.match(/^\s*version:\s*'([^']+)',\s*$/m)?.[1] ?? null

const versions = {
  'plugin.json version': manifest.version ?? null,
  'engine-version header': headerVersion,
  'meta.version': metaVersion,
}

let failed = false
for (const [name, value] of Object.entries(versions)) {
  if (!value) {
    console.error(`MISSING: ${name}`)
    failed = true
  }
}
const distinct = new Set(Object.values(versions).filter(Boolean))
if (distinct.size > 1) {
  console.error('VERSION MISMATCH:')
  for (const [name, value] of Object.entries(versions)) console.error(`  ${name}: ${value}`)
  failed = true
}

if (failed) process.exit(1)
console.log(`version lockstep OK: ${[...distinct][0]}`)
