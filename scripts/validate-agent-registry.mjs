// EN-3: CI guard for the engine's agent references.
//
// The engine spawns subagents two ways:
//   1. by agentType (deterministic registry lookup):  nsAgent('todo-store'), nsAgent('file-writer')
//   2. by prompt persona only (no agentType):         "You are the X agent ..."
//
// A rename of an agent .md file silently degrades a persona-only reference to a generic
// subagent (the prompt still "works", just without the specialized system prompt), and an
// agentType typo throws at runtime. This script fails CI when:
//   - an nsAgent('X') reference has no plugins/feature-workflows/agents/X.md
//   - a "You are the X agent" persona is neither a real agent file nor an explicitly
//     allow-listed persona-only role (so a new/typo'd persona must be triaged, not ignored)
//   - an agent .md's frontmatter `name:` disagrees with its filename
//
// Exit 0 = all references resolve; exit 1 = at least one problem.
import { readFileSync, readdirSync } from 'node:fs'

const pluginRoot = new URL('../plugins/feature-workflows/', import.meta.url)
const agentsDir = new URL('agents/', pluginRoot)
const enginePath = new URL('workflows/feature-pipeline.js', pluginRoot)

// Persona references that intentionally run without a dedicated agent file (generic
// subagents driven purely by prompt). Keep this list tight — adding an entry is a
// conscious decision that "this role has no specialized agent and that is fine".
const PERSONA_ONLY = new Set([
  'file-reader',        // read-back for pipeline-state / append verification
  'issue-classifier',   // Phase I: upstream-vs-code finding classifier
  'tune-confirmation',  // Phase J: AskUserQuestion confirmation persona
  'test-runner',        // IM-4: stack-agnostic test gate (pytest/npm/go/cargo/…)
  'hash-sources',       // v1.6.0: per-file SHA-256 content fingerprinting
  'slice-digest',       // v1.6.0: combined slice digest computation
])

const problems = []

// 1. Build the known-agent set from the agent files + validate name<->filename.
const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
const knownAgents = new Set()
for (const file of agentFiles) {
  const base = file.replace(/\.md$/, '')
  knownAgents.add(base)
  const src = readFileSync(new URL(file, agentsDir), 'utf8')
  const nameMatch = src.match(/^name:\s*(\S+)\s*$/m)
  const declaredName = nameMatch ? nameMatch[1].replace(/^["']|["']$/g, '') : null
  if (!declaredName) {
    problems.push(`agents/${file}: missing frontmatter "name:" field`)
  } else if (declaredName !== base) {
    problems.push(`agents/${file}: frontmatter name "${declaredName}" != filename "${base}"`)
  }
}

const engine = readFileSync(enginePath, 'utf8')

// 2. Every nsAgent('X') must resolve to an agent file.
const agentTypeRefs = new Set()
for (const m of engine.matchAll(/nsAgent\('([^']+)'\)/g)) agentTypeRefs.add(m[1])
for (const name of agentTypeRefs) {
  if (!knownAgents.has(name)) {
    problems.push(`engine: agentType nsAgent('${name}') has no plugins/feature-workflows/agents/${name}.md`)
  }
}

// 3. Every "You are the/a X agent" persona must be a known agent or allow-listed.
const personaRefs = new Set()
for (const m of engine.matchAll(/You are (?:the |a )?([a-z0-9-]+) agent/g)) personaRefs.add(m[1])
for (const name of personaRefs) {
  if (!knownAgents.has(name) && !PERSONA_ONLY.has(name)) {
    problems.push(
      `engine: persona "You are the ${name} agent" matches no agent file and is not in the PERSONA_ONLY allow-list ` +
      `— add agents/${name}.md, fix the persona, or allow-list it in scripts/validate-agent-registry.mjs`
    )
  }
}

if (problems.length) {
  console.error('agent-registry validation FAILED:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(
  `agent-registry OK: ${knownAgents.size} agents, ` +
  `${agentTypeRefs.size} agentType ref(s), ${personaRefs.size} persona ref(s) all resolve`
)
