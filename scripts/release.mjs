// Prepare a release entirely in git (option 2+4 — see docs/release-process.md):
//
//   npm run release -- 1.5.0
//
// Steps (all local; nothing is pushed):
//   1. guard: clean working tree, tag vX.Y.Z does not exist, version is new
//   2. bump plugins/feature-workflows/.claude-plugin/plugin.json -> version
//   3. npm run build (injects the version into the dist header + meta.version)
//   4. full validation: validate:build, validate:versions, validate:agents, npm test
//   5. commit `chore(release): vX.Y.Z` and create the annotated tag vX.Y.Z
//   6. pin the marketplace catalog to the tag (git-subdir ref+sha) and commit
//
// Then publish with:  git push --atomic --follow-tags origin main
// (the tag push triggers .github/workflows/release.yml -> GitHub Release + assets)
//
// The pin commit intentionally lands AFTER the tag: users' catalogs refresh from the
// default branch while plugin CONTENT is fetched from the pinned tag commit, so the
// tag itself never needs to contain its own pin.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { cwd: root, stdio: 'inherit', ...opts })
const capture = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, encoding: 'utf8' }).trim()

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: npm run release -- X.Y.Z')
  process.exit(2)
}
const tag = `v${version}`

// ---- guards -----------------------------------------------------------------
if (capture('git', ['status', '--porcelain']) !== '')
  throw new Error('working tree is not clean — commit or stash first')
if (capture('git', ['tag', '--list', tag]) !== '')
  throw new Error(`tag ${tag} already exists`)

const manifestPath = new URL('../plugins/feature-workflows/.claude-plugin/plugin.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
// strictly increasing semver only — rollbacks repoint the marketplace pin
// (scripts/pin-marketplace.mjs --release <prev-tag>), they never cut a lower release
const semverCmp = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}
if (semverCmp(version, manifest.version) <= 0)
  throw new Error(`version ${version} must be greater than the current ${manifest.version} (rollback = repoint the pin, not a lower release)`)

const branch = capture('git', ['branch', '--show-current'])
if (branch !== 'main' && !process.argv.includes('--allow-branch'))
  throw new Error(`releases are cut from main (on '${branch}'); pass --allow-branch to override`)

// ---- bump + build + validate --------------------------------------------------
// A failure anywhere in this phase auto-reverts the bump and the rebuilt dist, so
// the tree is clean again and the release is safely re-runnable after the fix.
console.log(`\n== release ${tag}: bump ${manifest.version} -> ${version}`)
const currentVersion = manifest.version
manifest.version = version
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

const MUTATED = [
  'plugins/feature-workflows/.claude-plugin/plugin.json',
  'plugins/feature-workflows/workflows/feature-pipeline.js',
]
try {
  run(process.execPath, ['scripts/build-workflows.mjs'])
  run(process.execPath, ['scripts/build-workflows.mjs', '--check'])
  run(process.execPath, ['scripts/validate-plugin-versions.mjs'])
  run(process.execPath, ['scripts/validate-agent-registry.mjs'])
  run('npm', ['test'])
} catch (err) {
  run('git', ['checkout', '--', ...MUTATED])
  console.error(`\n== release ${tag} ABORTED: validation failed. The version bump and rebuilt dist were reverted (back at ${currentVersion}, tree clean) — fix the failure and re-run.`)
  throw err
}

// ---- release commit + tag ------------------------------------------------------
run('git', ['add', 'plugins/feature-workflows/.claude-plugin/plugin.json', 'plugins/feature-workflows/workflows/feature-pipeline.js'])
run('git', ['commit', '-m', `chore(release): ${tag}`])
run('git', ['tag', '-a', tag, '-m', `feature-workflows ${tag}`])

// ---- pin the catalog to the tag -------------------------------------------------
run(process.execPath, ['scripts/pin-marketplace.mjs', '--release', tag])
run('git', ['add', '.claude-plugin/marketplace.json'])
run('git', ['commit', '-m', `chore(release): pin marketplace to ${tag}`])

console.log(`
== ${tag} prepared (2 commits + tag, nothing pushed).
Publish with:

  git push --atomic --follow-tags origin ${branch}

The tag push triggers the release workflow (GitHub Release + dist assets + checksums).
Rollback after publishing: node scripts/pin-marketplace.mjs --release <previous-tag> && commit.`)
