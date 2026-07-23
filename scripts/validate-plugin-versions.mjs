// Enforces the plugin's version lockstep across the manifest and ALL generated
// workflow entries. Every dist file must carry the same engine-version header
// and meta.version, and both must equal plugin.json's version.
//
// Checked surfaces:
//   1. plugins/feature-workflows/.claude-plugin/plugin.json -> "version"
//   2. For each generated entry (feature-pipeline.js, fp-extract-slice.js):
//      a. "// engine-version:" header
//      b. meta.version literal
//
// The pipeline-command preflights compare the user-level install to the plugin
// by the header alone and auto-repair on drift, so a header that drifts from the
// manifest silently disables drift detection. Exit 0 = all surfaces match;
// exit 1 = mismatch or a marker is missing.
import { readFileSync } from 'node:fs'

const pluginRoot = new URL('../plugins/feature-workflows/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', pluginRoot), 'utf8'))

const ENTRIES = ['feature-pipeline.js', 'fp-extract-slice.js']

const versions = {}
versions['plugin.json version'] = manifest.version ?? null

for (const file of ENTRIES) {
  const src = readFileSync(new URL(`workflows/${file}`, pluginRoot), 'utf8')
  const headerVersion = src.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)?.[1] ?? null
  const metaVersion = src.match(/^\s*version:\s*'([^']+)',\s*$/m)?.[1] ?? null
  versions[`${file} engine-version header`] = headerVersion
  versions[`${file} meta.version`] = metaVersion
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
console.log(`version lockstep OK: ${[...distinct][0]} (${ENTRIES.length} entries)`)
