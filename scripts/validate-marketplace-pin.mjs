// Verify the marketplace catalog's release pin (see docs/release-process.md).
//
// End users install whatever the `feature-workflows` entry's source points at, so a
// typo'd or hand-edited ref/sha would silently repoint every install. This check
// asserts, whenever the source is the pinned git-subdir form:
//   1. the source shape is exactly {git-subdir, url, path, ref, sha}
//   2. `ref` is a vX.Y.Z tag that exists (fetched on demand — CI checkouts are shallow)
//   3. `sha` is exactly the commit the tag points at
//   4. plugin.json AT the pinned commit carries the version the tag names
// The pre-first-release relative-path source passes trivially (nothing to verify).
// Exit 0 = pin consistent; exit 1 = pin broken.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const PLUGIN_NAME = 'feature-workflows'
const PLUGIN_PATH = 'plugins/feature-workflows'
const git = (...argv) => execFileSync('git', argv, { encoding: 'utf8' }).trim()

const catalog = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'))
const entry = catalog.plugins.find((p) => p.name === PLUGIN_NAME)
if (!entry) throw new Error(`marketplace.json has no plugin entry named '${PLUGIN_NAME}'`)

const src = entry.source
if (typeof src === 'string') {
  console.log(`pin check: relative source (${src}) — pre-release state, nothing to verify`)
  process.exit(0)
}

const fail = (msg) => {
  console.error(`MARKETPLACE PIN BROKEN: ${msg}`)
  process.exit(1)
}

if (src.source !== 'git-subdir') fail(`source type is '${src.source}', expected 'git-subdir'`)
if (src.path !== PLUGIN_PATH) fail(`source path is '${src.path}', expected '${PLUGIN_PATH}'`)
if (!src.url?.includes('github.com/kostua16/feature-workflows')) fail(`unexpected source url '${src.url}'`)
if (!/^v\d+\.\d+\.\d+$/.test(src.ref ?? '')) fail(`ref '${src.ref}' is not a vX.Y.Z release tag`)
if (!/^[0-9a-f]{40}$/.test(src.sha ?? '')) fail(`sha '${src.sha}' is not a 40-char commit sha`)

// make the tag resolvable in shallow CI checkouts (fetched with its commit + trees)
try {
  git('rev-parse', '--verify', `refs/tags/${src.ref}`)
} catch {
  try {
    git('fetch', '--depth=1', 'origin', 'tag', src.ref)
  } catch {
    fail(`tag ${src.ref} does not exist locally and could not be fetched from origin`)
  }
}

const tagCommit = git('rev-list', '-n1', src.ref)
if (tagCommit !== src.sha) fail(`sha ${src.sha} does not match tag ${src.ref} -> ${tagCommit}`)

const pinnedManifest = JSON.parse(git('show', `${src.sha}:${PLUGIN_PATH}/.claude-plugin/plugin.json`))
if (`v${pinnedManifest.version}` !== src.ref)
  fail(`plugin.json at the pinned commit is version ${pinnedManifest.version}, but the pin claims ${src.ref}`)

console.log(`pin check OK: ${src.ref} (${src.sha.slice(0, 12)}) — tag, sha, and pinned plugin version all agree`)
