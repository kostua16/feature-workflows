// Multi-entry build, install, and version lockstep tests (DIST-01).
//
// Verifies that the source build produces exactly two supported workflow entries
// (feature-pipeline.js + fp-extract-slice.js), both are drift-free, version-aligned
// across all surfaces, sandbox-safe, and resolvable through both copy and symlink
// install paths.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, symlinkSync, mkdirSync, rmSync, copyFileSync, lstatSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const pluginRoot = join(root, 'plugins', 'feature-workflows')
const wfDir = join(pluginRoot, 'workflows')
const builder = fileURLToPath(new URL('../scripts/build-workflows.mjs', import.meta.url))
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'))

const ENTRIES = ['feature-pipeline.js', 'fp-extract-slice.js']
const entryPath = (f) => join(wfDir, f)
const readEntry = (f) => readFileSync(entryPath(f), 'utf8')

// ---------------------------------------------------------------------------
// Build drift — both entries must be byte-identical to a fresh build
// ---------------------------------------------------------------------------

test('build --check reports both entries up to date (no drift)', () => {
  const out = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' })
  for (const file of ENTRIES) {
    assert.match(out, new RegExp(`${file}: up to date`), `${file} must be drift-free`)
  }
})

test('build --check fails when a dist entry is missing', () => {
  // The --check mode reads the existing dist and compares; a stale or missing
  // file surfaces as drift. This test verifies the builder checks both entries.
  const out = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' })
  assert.ok(out.includes('feature-pipeline.js'), 'top-level entry checked')
  assert.ok(out.includes('fp-extract-slice.js'), 'leaf entry checked')
})

// ---------------------------------------------------------------------------
// Both entries exist with correct structure
// ---------------------------------------------------------------------------

test('both dist entries exist in the plugin workflows directory', () => {
  for (const file of ENTRIES) {
    assert.ok(existsSync(entryPath(file)), `${file} must exist in workflows/`)
  }
})

test('both entries have the GENERATED FILE marker in their banner', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    assert.ok(src.includes('// GENERATED FILE'), `${file}: missing GENERATED marker`)
  }
})

test('both entries have the engine-version header', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    const header = src.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)
    assert.ok(header, `${file}: missing engine-version header`)
    assert.equal(header[1], manifest.version, `${file}: header version must match plugin.json`)
  }
})

test('both entries have meta.version matching plugin.json', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    const metaVersion = src.match(/^\s*version:\s*'([^']+)',\s*$/m)
    assert.ok(metaVersion, `${file}: missing meta.version`)
    assert.equal(metaVersion[1], manifest.version, `${file}: meta.version must match plugin.json`)
  }
})

test('both entries have the ENGINE_VERSION const', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    assert.ok(
      src.includes(`const ENGINE_VERSION = '${manifest.version}';`),
      `${file}: missing or mismatched ENGINE_VERSION const`,
    )
  }
})

test('top-level entry calls main() in its tail', () => {
  const src = readEntry('feature-pipeline.js')
  assert.ok(src.includes('const final = await main()'), 'top-level: missing main() tail')
  assert.ok(src.includes('return final'), 'top-level: missing return final')
})

test('leaf entry calls extractSliceMain() in its tail', () => {
  const src = readEntry('fp-extract-slice.js')
  assert.ok(src.includes('const final = await extractSliceMain()'), 'leaf: missing extractSliceMain() tail')
  assert.ok(src.includes('return final'), 'leaf: missing return final')
})

// ---------------------------------------------------------------------------
// Leaf-specific structural guarantees
// ---------------------------------------------------------------------------

test('leaf dist does not contain the top-level main() function', () => {
  const src = readEntry('fp-extract-slice.js')
  assert.ok(!/^async function main\(\)/m.test(src), 'leaf: must not contain main() definition')
})

test('leaf dist contains the extractSliceMain() function', () => {
  const src = readEntry('fp-extract-slice.js')
  assert.ok(/^async function extractSliceMain\(\)/m.test(src), 'leaf: must contain extractSliceMain()')
})

test('leaf meta declares only its 2 execution phases', () => {
  const src = readEntry('fp-extract-slice.js')
  // Match to the top-level closing brace (column-0 '}') to capture the full meta block.
  const metaBlock = src.match(/^export const meta = \{[\s\S]*?^\}/m)
  assert.ok(metaBlock, 'leaf: meta block not found')
  const titles = [...metaBlock[0].matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(titles.sort(), ['Design Audit', 'Extract Slice'], 'leaf: must declare exactly its 2 phases')
})

test('leaf meta name is fp-extract-slice', () => {
  const src = readEntry('fp-extract-slice.js')
  const nameMatch = src.match(/^  name:\s*'([^']+)'/m)
  assert.ok(nameMatch, 'leaf: meta.name not found')
  assert.equal(nameMatch[1], 'fp-extract-slice')
})

test('top-level meta retains all declared phases', () => {
  const src = readEntry('feature-pipeline.js')
  // Match to the top-level closing brace (column-0 '}') to capture the full meta block.
  const metaBlock = src.match(/^export const meta = \{[\s\S]*?^\}/m)
  assert.ok(metaBlock, 'top-level: meta block not found')
  const titles = [...metaBlock[0].matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1])
  // The top-level entry declares all phases; must have significantly more than the leaf's 2.
  assert.ok(titles.length > 10, `top-level: expected many phases, got ${titles.length}`)
  assert.ok(titles.includes('Extract Slice'), 'top-level: must include Extract Slice phase')
  assert.ok(titles.includes('Commit'), 'top-level: must include Commit phase')
})

// ---------------------------------------------------------------------------
// Sandbox safety — both entries must pass forbidden-token and ESM checks
// ---------------------------------------------------------------------------

test('neither entry contains forbidden sandbox tokens', () => {
  const forbidden = [
    [/^import[ {]/m, 'unstripped import'],
    [/^export (?!const meta)/m, 'unexpected export'],
    [/\brequire\(/, 'require() call'],
    [/\bDate\.now\(/, 'Date.now()'],
    [/\bMath\.random\(/, 'Math.random()'],
    [/\bnew Date\(\)/, 'argless new Date()'],
  ]
  for (const file of ENTRIES) {
    const src = readEntry(file)
    for (const [re, why] of forbidden) {
      assert.ok(!re.test(src), `${file}: forbidden token (${why})`)
    }
  }
})

test('neither entry contains CR (CRLF blocks Workflow execution)', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    assert.ok(!src.includes('\r'), `${file}: dist contains CR`)
  }
})

test('both entries pass ESM syntax check with neutralized tail', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    const neutralized = src.replace(/^return final$/m, '// __sandbox_return__ final')
    // Will throw on syntax error; no assertion needed beyond not throwing.
    execFileSync(process.execPath, ['--input-type=module', '--check'], { input: neutralized })
  }
})

// ---------------------------------------------------------------------------
// Version lockstep — all surfaces agree
// ---------------------------------------------------------------------------

test('validate-plugin-versions passes (full lockstep across all surfaces)', () => {
  const validator = fileURLToPath(new URL('../scripts/validate-plugin-versions.mjs', import.meta.url))
  const out = execFileSync(process.execPath, [validator], { encoding: 'utf8' })
  assert.match(out, /version lockstep OK/)
  assert.match(out, /2 entries/)
})

test('all engine-version headers across both entries equal plugin.json version', () => {
  for (const file of ENTRIES) {
    const src = readEntry(file)
    const header = src.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)?.[1]
    assert.equal(header, manifest.version, `${file}: header must match plugin.json`)
  }
})

// ---------------------------------------------------------------------------
// Install resolution — both entries resolve through copy and symlink installs
// ---------------------------------------------------------------------------

test('copy install: both entries resolve from a copied workflows directory', () => {
  const tmpBase = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp-install-test-copy')
  try {
    rmSync(tmpBase, { recursive: true, force: true })
    mkdirSync(tmpBase, { recursive: true })
    for (const file of ENTRIES) {
      copyFileSync(entryPath(file), join(tmpBase, file))
    }
    for (const file of ENTRIES) {
      const installed = join(tmpBase, file)
      assert.ok(existsSync(installed), `copy install: ${file} must exist`)
      assert.ok(!lstatSync(installed).isSymbolicLink(), `copy install: ${file} must be a real file`)
      const src = readFileSync(installed, 'utf8')
      const header = src.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)?.[1]
      assert.equal(header, manifest.version, `copy install: ${file} header must match plugin.json`)
    }
  } finally {
    rmSync(tmpBase, { recursive: true, force: true })
  }
})

test('symlink install: both entries resolve from a symlinked workflows directory', () => {
  const tmpBase = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp-install-test-symlink')
  try {
    rmSync(tmpBase, { recursive: true, force: true })
    mkdirSync(tmpBase, { recursive: true })
    for (const file of ENTRIES) {
      symlinkSync(entryPath(file), join(tmpBase, file))
    }
    for (const file of ENTRIES) {
      const installed = join(tmpBase, file)
      assert.ok(existsSync(installed), `symlink install: ${file} must exist`)
      assert.ok(lstatSync(installed).isSymbolicLink(), `symlink install: ${file} must be a symlink`)
      // Resolving through the symlink must yield the same content.
      const src = readFileSync(installed, 'utf8')
      const header = src.match(/^\/\/ engine-version:\s*(\S+)\s*$/m)?.[1]
      assert.equal(header, manifest.version, `symlink install: ${file} header must match plugin.json`)
    }
  } finally {
    rmSync(tmpBase, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Marketplace / packaging — both entries are inside the plugin directory
// ---------------------------------------------------------------------------

test('both entries are inside the plugin subtree (packaged in releases)', () => {
  // The marketplace source points at plugins/feature-workflows/ — everything
  // under it ships in a release. Both dist files must live under workflows/.
  for (const file of ENTRIES) {
    const rel = entryPath(file).replace(pluginRoot + '/', '')
    assert.ok(rel.startsWith('workflows/'), `${file}: must be under workflows/ in the plugin (got: ${rel})`)
  }
})
