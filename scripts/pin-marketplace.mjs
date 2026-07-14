// Point the marketplace catalog's `feature-workflows` plugin source at either a
// pinned release tag (what end users install) or the local working tree (dogfooding).
//
//   node scripts/pin-marketplace.mjs --release v1.5.0   # git-subdir pinned to tag + sha
//   node scripts/pin-marketplace.mjs --dev              # relative path ./plugins/feature-workflows
//
// --release is also the ROLLBACK tool: repointing at a previous tag is one run + commit.
// The plugin lives in a subdirectory, so the pinned source type is `git-subdir`
// ({url, path, ref, sha}) — a plain `github` source would expect the plugin manifest
// at the repository root. With both ref and sha set, the sha is the effective pin.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const REPO_URL = 'https://github.com/kostua16/feature-workflows'
const PLUGIN_PATH = 'plugins/feature-workflows'
const PLUGIN_NAME = 'feature-workflows'
const catalogUrl = new URL('../.claude-plugin/marketplace.json', import.meta.url)

const args = process.argv.slice(2)
const mode = args[0]

const catalog = JSON.parse(readFileSync(catalogUrl, 'utf8'))
const entry = catalog.plugins.find((p) => p.name === PLUGIN_NAME)
if (!entry) throw new Error(`marketplace.json has no plugin entry named '${PLUGIN_NAME}'`)

if (mode === '--dev') {
  entry.source = `./${PLUGIN_PATH}`
} else if (mode === '--release') {
  const tag = args[1]
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error(`--release needs a vX.Y.Z tag, got: ${tag}`)
  const sha = execFileSync('git', ['rev-list', '-n1', tag], { encoding: 'utf8' }).trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`could not resolve ${tag} to a commit sha`)
  entry.source = { source: 'git-subdir', url: REPO_URL, path: PLUGIN_PATH, ref: tag, sha }
} else {
  console.error('usage: pin-marketplace.mjs --release vX.Y.Z | --dev')
  process.exit(2)
}

writeFileSync(catalogUrl, JSON.stringify(catalog, null, 2) + '\n')
console.log(`marketplace.json: '${PLUGIN_NAME}' source -> ${typeof entry.source === 'string' ? entry.source : `${entry.source.ref} (${entry.source.sha.slice(0, 12)})`}`)
