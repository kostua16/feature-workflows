// Build the self-contained workflow dist script(s) from workflows/src/ ESM modules.
//
// The Workflow sandbox cannot resolve imports, so each dist file is a flat
// concatenation: banner -> `export const meta` literal (version injected from
// plugin.json) -> `const ENGINE_VERSION` (same version; sandbox-safe runtime
// binding — issue #17: sandbox does not bind `meta`) -> module bodies in
// manifest order -> the sandbox tail (`const final = await main()` / `return final`).
// Source modules use real ESM import/export so Node (and the test harness) can
// import them directly; the import lines and the trailing `export { ... }` list
// are STRIPPED at build time, everything else is emitted verbatim.
//
// Usage:
//   node scripts/build-workflows.mjs           # write dist file(s)
//   node scripts/build-workflows.mjs --check   # rebuild in memory, fail on drift
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const pluginRoot = new URL('../plugins/feature-workflows/', import.meta.url)
const wfRoot = new URL('workflows/', pluginRoot)
const version = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', pluginRoot), 'utf8')).version
if (!version) throw new Error('plugin.json has no version')

// `modules` is the emit order (original engine order — function decls hoist, but
// top-level const initializers may only reference EARLIER modules).
// NOTE: src/engine-version.mjs is Node-only (import target for state/main). It must
// NEVER be listed in modules[] — dist gets the injected ENGINE_VERSION const instead.
// Each entry has a `tail` — the sandbox-execution lines appended after module bodies.
// The top-level entry calls main(); the leaf entry calls extractSliceMain().
const ENTRIES = [
  {
    out: 'feature-pipeline.js',
    meta: 'src/meta/feature-pipeline.meta.mjs',
    banner: [
      '// feature-pipeline.js',
      `// engine-version: ${version}`,
      '// GENERATED FILE — do not edit. Source: workflows/src/*.mjs; rebuild with `npm run build`.',
      '// Gate-enforcing pipeline for new features / bug-fixes.',
      '//',
      '// Run via:',
      '//   Workflow({ scriptPath: "~/.claude/workflows/feature-pipeline.js",  // user-level symlink to the plugin engine',
      '//              args: { task: "...", autoCommit: false, gsdQuick: false } })',
    ],
    tail: [
      'const final = await main()',
      'return final',
    ],
    modules: [
      'schemas.mjs',
      'config.mjs',
      'text-utils.mjs',
      'state.mjs',
      'lifecycle.mjs',
      'migration.mjs',
      'revision.mjs',
      'inventory.mjs',
      'discovery.mjs',
      'graph-validation.mjs',
      'queue-semantics.mjs',
      'schedulability.mjs',
      'budget-admission.mjs',
      'retry-policy.mjs',
      'failure-isolation.mjs',
      'continuation.mjs',
      'synthesis.mjs',
      'observe-persist.mjs',
      'status-truth.mjs',
      'stages-issues.mjs',
      'tune.mjs',
      'extract-scope.mjs',
      'review-mode.mjs',
      'extract-slice.mjs',
      'publish-persist.mjs',
      'test-run.mjs',
      'agent-core.mjs',
      'json-repair.mjs',
      'review-loop.mjs',
      'decisions.mjs',
      'design-budget.mjs',
      'design-loops.mjs',
      'main.mjs',
    ],
  },
  {
    out: 'fp-extract-slice.js',
    meta: 'src/meta/fp-extract-slice.meta.mjs',
    banner: [
      '// fp-extract-slice.js',
      `// engine-version: ${version}`,
      '// GENERATED FILE — do not edit. Source: workflows/src/*.mjs; rebuild with `npm run build`.',
      '// Leaf workflow: extract design docs for one admitted feature.',
      '//',
      '// Run via:',
      '//   Workflow({ scriptPath: "~/.claude/workflows/fp-extract-slice.js",',
      '//              args: { slice: { id, name, planDir, files, ... }, task: "...", config: { ... } } })',
    ],
    tail: [
      'const final = await extractSliceMain()',
      'return final',
    ],
    // Same modules as the top-level entry EXCLUDING main.mjs (the leaf has its
    // own entry point and main() is never called from any leaf module — the
    // import binding is dead). This keeps the leaf dist focused: only the 2
    // phase() labels the leaf actually uses appear in the text.
    modules: [
      'schemas.mjs',
      'config.mjs',
      'text-utils.mjs',
      'state.mjs',
      'lifecycle.mjs',
      'migration.mjs',
      'revision.mjs',
      'inventory.mjs',
      'discovery.mjs',
      'graph-validation.mjs',
      'queue-semantics.mjs',
      'schedulability.mjs',
      'budget-admission.mjs',
      'retry-policy.mjs',
      'failure-isolation.mjs',
      'continuation.mjs',
      'synthesis.mjs',
      'observe-persist.mjs',
      'status-truth.mjs',
      'stages-issues.mjs',
      'tune.mjs',
      'extract-scope.mjs',
      'review-mode.mjs',
      'extract-slice.mjs',
      'publish-persist.mjs',
      'test-run.mjs',
      'agent-core.mjs',
      'json-repair.mjs',
      'review-loop.mjs',
      'decisions.mjs',
      'design-budget.mjs',
      'design-loops.mjs',
      'extract-slice-entry.mjs',
    ],
  },
]

const DECL_RE = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^const\s+([A-Za-z_$][\w$]*)|^let\s+([A-Za-z_$][\w$]*)/
const check = process.argv.includes('--check')
let failed = false

for (const entry of ENTRIES) {
  // ---- meta literal, with the version injected from plugin.json
  let metaSrc = readFileSync(new URL(entry.meta, wfRoot), 'utf8').trimEnd()
  if (!metaSrc.startsWith('export const meta = {')) throw new Error(`${entry.meta}: must start with the meta literal`)
  metaSrc = metaSrc.replace(/version: '[^']*',[^\n]*/, `version: '${version}',`)
  if (!metaSrc.includes(`version: '${version}',`)) throw new Error(`${entry.meta}: no version field to inject`)

  const engineVersionDecl = `const ENGINE_VERSION = '${version}';`

  // ---- module bodies: strip import lines + the export list, keep the rest verbatim
  const seen = new Map()
  // Injected binding — register before scanning modules so a module redeclaring
  // ENGINE_VERSION fails with a clear duplicate-name error (issue #17).
  seen.set('ENGINE_VERSION', '<injected>')
  const bodies = entry.modules.map((file) => {
    const raw = readFileSync(new URL(`src/${file}`, wfRoot), 'utf8')
    if (raw.includes('\r')) throw new Error(`${file}: source module contains CRLF — normalize to LF`)
    const kept = []
    for (const line of raw.split('\n')) {
      if (/^import[ {]/.test(line)) continue
      if (/^export \{[^}]*\}$/.test(line)) continue
      // top-level import/export is always column 0 in src; indented matches would be
      // template-literal prompt text, which must pass through untouched
      if (/^(import|export)\b/.test(line)) throw new Error(`${file}: unsupported import/export form: ${line}`)
      kept.push(line)
      const m = line.match(DECL_RE)
      if (m) {
        const name = m[1] || m[2] || m[3]
        if (seen.has(name)) throw new Error(`duplicate top-level name '${name}' in ${seen.get(name)} and ${file}`)
        seen.set(name, file)
      }
    }
    // one blank line between modules, none duplicated at edges
    while (kept.length && kept[0] === '') kept.shift()
    while (kept.length && kept[kept.length - 1] === '') kept.pop()
    return kept.join('\n')
  })

  const dist = [
    entry.banner.join('\n'),
    '',
    metaSrc,
    '',
    engineVersionDecl,
    '',
    bodies.join('\n\n'),
    '',
    ...entry.tail,
    '',
  ].join('\n')

  if (!dist.includes(engineVersionDecl)) {
    throw new Error(`${entry.out}: ENGINE_VERSION injection missing`)
  }

  // ---- post-emit self-checks -----------------------------------------------
  // CRLF in the emitted dist blocks Workflow execution (issue #16); the source-module
  // check above is the primary gate, this is a belt-and-suspenders net over the assembly.
  if (dist.includes('\r')) throw new Error(`${entry.out}: emitted dist contains CR — source has CRLF`)
  // forbidden tokens (sandbox-unsafe / must have been stripped)
  for (const [re, why] of [
    [/^import[ {]/m, 'unstripped import'],
    [/^export (?!const meta)/m, 'unexpected export'],
    [/\brequire\(/, 'require() call'],
    [/\bDate\.now\(/, 'Date.now()'],
    [/\bMath\.random\(/, 'Math.random()'],
    [/\bnew Date\(\)/, 'argless new Date()'],
    // Whole-dist scan: `export const meta =` does not match. Sandbox does not bind
    // `meta` at runtime — use ENGINE_VERSION instead (issue #17).
    [/\bmeta\./, 'runtime meta. access (sandbox does not bind meta; issue #17)'],
  ]) {
    if (re.test(dist)) throw new Error(`${entry.out}: forbidden token (${why})`)
  }
  // every phase('X') literal must be declared in meta.phases
  const declaredPhases = new Set([...metaSrc.matchAll(/\{ title: '([^']+)' \}/g)].map((m) => m[1]))
  const usedPhases = new Set([...dist.matchAll(/phase\('([^']+)'\)/g)].map((m) => m[1]))
  const undeclared = [...usedPhases].filter((p) => !declaredPhases.has(p))
  if (undeclared.length) throw new Error(`${entry.out}: phase() labels missing from meta.phases: ${undeclared.join(', ')}`)
  // ESM syntax check (mirrors CI: neutralize the sandbox-only top-level return)
  const neutralized = dist.replace(/^return final$/m, '// __sandbox_return__ final')
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: neutralized })

  // ---- write or compare ------------------------------------------------------
  const outUrl = new URL(entry.out, wfRoot)
  if (check) {
    const existing = readFileSync(outUrl, 'utf8')
    if (existing !== dist) {
      console.error(`DRIFT: ${entry.out} is stale — run \`npm run build\` and commit the result`)
      failed = true
    } else {
      console.log(`${entry.out}: up to date (engine-version ${version}, ${entry.modules.length} modules, ${seen.size} top-level names)`)
    }
  } else {
    writeFileSync(outUrl, dist)
    console.log(`built ${entry.out} (engine-version ${version}, ${entry.modules.length} modules, ${seen.size} top-level names)`)
  }
}

if (failed) process.exit(1)
