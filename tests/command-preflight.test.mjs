// Consistency guard for the pipeline command files. The engine install is
// user-level (~/.claude/workflows/ symlinks to the plugin, auto-repaired in
// preflight); every pipeline command must carry the SAME preflight block, and no
// command may reference the project's .claude/workflows/ except to detect the
// legacy per-project copies that would shadow the user-level engine.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const cmdDir = new URL('../plugins/feature-workflows/commands/', import.meta.url)
const PIPELINE_COMMANDS = [
  'design-feature.md',
  'implement-feature.md',
  'tune-feature.md',
  'extract-design.md',
  'review-design.md',
  'feature-pipeline.md',
  'pipeline-status.md',
]
const read = (f) => readFileSync(new URL(f, cmdDir), 'utf8')

const PREFLIGHT_HEADING = '## Preflight — engine link must be healthy'
const PREFLIGHT_END = 'instead of the current engine.'

const preflightOf = (text, file) => {
  const start = text.indexOf(PREFLIGHT_HEADING)
  assert.ok(start >= 0, `${file}: preflight heading missing`)
  const end = text.indexOf(PREFLIGHT_END, start)
  assert.ok(end >= 0, `${file}: preflight end marker missing`)
  return text.slice(start, end + PREFLIGHT_END.length)
}

test('preflight block is byte-identical across all 7 pipeline commands', () => {
  const canonical = preflightOf(read(PIPELINE_COMMANDS[0]), PIPELINE_COMMANDS[0])
  for (const file of PIPELINE_COMMANDS.slice(1)) {
    assert.equal(preflightOf(read(file), file), canonical, `${file}: preflight drifted from ${PIPELINE_COMMANDS[0]}`)
  }
})

test('preflight targets the user-level install with self-repair semantics', () => {
  const block = preflightOf(read(PIPELINE_COMMANDS[0]), PIPELINE_COMMANDS[0])
  for (const marker of [
    '~/.claude/workflows/feature-pipeline.js',
    '${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js',
    'ln -sfn',
    'mkdir -p ~/.claude/workflows/docs',
    'Auto-repair (silent',
    'LEGACY-COPY-PRESENT',
  ]) {
    assert.ok(block.includes(marker), `preflight must contain: ${marker}`)
  }
})

test('pipeline commands reference the project .claude/workflows only on legacy-detection lines', () => {
  for (const file of PIPELINE_COMMANDS) {
    const offenders = read(file)
      .split('\n')
      .filter((line) => /(^|[^~$}])\.claude\/workflows/.test(line.replaceAll('~/.claude/workflows', '').replaceAll('${CLAUDE_PLUGIN_ROOT}', '')))
      .filter((line) => !/Legacy/.test(line))
    assert.deepEqual(offenders, [], `${file}: project-path reference outside legacy detection`)
  }
})

test('every pipeline command grants the Bash verbs the auto-repair needs', () => {
  for (const file of PIPELINE_COMMANDS) {
    const tools = read(file).match(/^allowed-tools: (.+)$/m)
    assert.ok(tools, `${file}: allowed-tools line missing`)
    for (const perm of ['Bash(ln:*)', 'Bash(mkdir:*)', 'Bash(cp:*)', 'Bash(readlink:*)', 'Bash(test:*)', 'Bash(grep:*)']) {
      assert.ok(tools[1].includes(perm), `${file}: allowed-tools must include ${perm}`)
    }
  }
})

test('setup.md is a doctor: no project-dir install, dangling-link detection present', () => {
  const setup = read('setup.md')
  assert.ok(!/cp "\$\{CLAUDE_PLUGIN_ROOT\}[^"]*" \.claude\/workflows/.test(setup), 'setup must not copy the engine into the project')
  assert.ok(setup.includes('ln -sfn "${CLAUDE_PLUGIN_ROOT}/workflows/feature-pipeline.js" ~/.claude/workflows/feature-pipeline.js'), 'setup must recreate the user-level symlink')
  assert.ok(setup.includes('[ -L p ] && [ ! -e p ]'), 'setup must diagnose dangling symlinks')
  const legacyStep = setup.indexOf('legacy per-project copies')
  assert.ok(legacyStep >= 0, 'setup must keep the legacy-cleanup step')
  const beforeLegacy = setup
    .slice(0, legacyStep)
    .split('\n')
    .filter((line) => /(^|[^~$}])\.claude\/workflows/.test(line.replaceAll('~/.claude/workflows', '').replaceAll('${CLAUDE_PLUGIN_ROOT}', '')))
  assert.deepEqual(beforeLegacy, [], 'project-path references in setup.md must live in the legacy-cleanup step')
})
