import { TEST_VERDICT } from './schemas.mjs'
import { gm } from './config.mjs'
import { safeAgent } from './agent-core.mjs'


// IM-4: this is a general-purpose marketplace plugin, so the test gate must be
// stack-agnostic instead of hardcoding pytest. Map a framework name (+ optional
// target) to a concrete command. Pure + testable; returns null for an unknown
// framework so the caller can fall back to agent auto-detection.
const TEST_COMMAND_TEMPLATES = {
  pytest: (t) => (t ? `python -m pytest -v --tb=short ${t}` : 'python -m pytest -v --tb=short'),
  npm: (t) => (t ? `npm test -- ${t}` : 'npm test'),
  jest: (t) => (t ? `npx jest ${t}` : 'npx jest'),
  vitest: (t) => (t ? `npx vitest run ${t}` : 'npx vitest run'),
  node: (t) => (t ? `node --test ${t}` : 'node --test'),
  go: (t) => (t ? `go test ${t}` : 'go test ./...'),
  cargo: (t) => (t ? `cargo test ${t}` : 'cargo test'),
  make: () => 'make test',
}
function detectTestCommand(framework, target) {
  const t = target && String(target).trim() ? String(target).trim() : ''
  const tmpl = framework ? TEST_COMMAND_TEMPLATES[String(framework).toLowerCase()] : null
  return tmpl ? tmpl(t) : null
}

// Run the test gate. Command resolution precedence (all stack-agnostic):
//   1. explicit --test-cmd "<cmd>"      -> run verbatim
//   2. --test-framework <name> [+target] -> mapped template (pytest/npm/go/cargo/…)
//   3. neither                          -> the runner agent auto-detects the project's
//      test command (pytest / npm test / go test / cargo test) from its manifests.
async function runTests(testTarget, testCmd, testFramework) {
  const target = testTarget && testTarget.trim() ? testTarget.trim() : ''
  const explicit = testCmd && String(testCmd).trim() ? String(testCmd).trim() : null
  const mapped = explicit ? null : detectTestCommand(testFramework, target)
  const cmd = explicit || mapped
  if (cmd) {
    log(`Running tests: ${cmd}`)
    return safeAgent(
      `You are the test-runner agent. Run this exact command and report whether it passed:
${cmd}
Report the exit status honestly (passed=true only on exit 0). Do NOT modify code or tests.`,
      { label: 'test-runner', phase: 'Test', schema: TEST_VERDICT, model: gm('test') },
      null
    )
  }
  // Auto-detect: no command was pinned. Let the runner discover the stack.
  log('Running tests: auto-detect project test command')
  return safeAgent(
    `You are the test-runner agent. Detect this project's test command from its manifests
(pytest/tox.ini/pyproject for Python, package.json "test" script for Node, go.mod for Go,
Cargo.toml for Rust, Makefile "test" target, etc.) and run it${target ? ` scoped to: ${target}` : ''}.
Report the exact command you ran in the "command" field and the exit status honestly
(passed=true only on exit 0). Do NOT modify code or tests.`,
    { label: 'test-runner', phase: 'Test', schema: TEST_VERDICT, model: gm('test') },
    null
  )
}

export { TEST_COMMAND_TEMPLATES, detectTestCommand, runTests }
