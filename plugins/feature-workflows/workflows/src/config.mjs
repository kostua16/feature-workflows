import { runTests } from './test-run.mjs'
import { main } from './main.mjs'


// ---- Helpers --------------------------------------------------------------

// Global retry budget. The pipeline only exits on a TRUE hard error (no artifact,
// needsClarification) or when retryUsed >= retryBudget. Per-loop soft sub-caps stop one
// loop from monopolizing the whole budget.
// The named agents this engine spawns by agentType (todo-store, file-writer) ship inside
// the feature-workflows plugin, where the subagent registry lists them under the plugin
// namespace. Change ONE constant if the plugin is renamed; set to '' to fall back to bare
// names (agents copied into the project's .claude/agents/).
const AGENT_NS = 'feature-workflows'
const nsAgent = (name) => (AGENT_NS ? `${AGENT_NS}:${name}` : name)

const RETRY_BUDGET_DEFAULT = 20
const REFINE_SUBCAP_DEFAULT = 10   // soft per-loop cap on plan refine iterations
const DEBUG_SUBCAP_DEFAULT = 20    // soft per-loop cap on gsd-debug fix+retest
const RECONCILE_SUBCAP_DEFAULT = 5 // soft per-loop cap on reconcile design-fix iterations
const DECISION_CAP_DEFAULT = 50   // Phase E1: hard runaway cap on authoritative decision-agent calls
const AGENT_TIMEOUT_MS_DEFAULT = 10 * 60 * 1000
const AGENT_MAX_OUTPUT_CHARS_DEFAULT = 200000
const IDENTICAL_FAILURE_LIMIT = 3

const GATE_FALLBACKS = {
  'quick-decider': { decision: 'stop', reasoning: 'fallback after unavailable verdict' },
  'complex-decision-analyst': { decision: 'commit', targetPhase: 'none', reasoning: 'fallback after unavailable verdict', trueDefects: [] },
  'test-runner': { passed: false, summary: 'fallback after unavailable test verdict' },
  'prompt-enhancer': null,
}

// Per-gate model tiers (tier aliases resolved by the model-routing layer).
// Override any of these via args.models, e.g. { models: { plan: 'sonnet' } }.
// Deep-analysis gates default to opus; mechanical gates to sonnet/haiku.
const MODEL_DEFAULTS = {
  translator: 'sonnet', // prompt-translator (Gate -1, non-English task input)
  categorizer: 'haiku', // feature-categorizer (Phase B1 dynamic planDir)
  enhancer: 'sonnet', // prompt-enhancer (Phase D1 retry prompt hardening)
  explorer: 'sonnet', // code-explorer (Phase D2 codebase-facts gate)
  quickDecider: 'opus', // quick-decider (Phase E2 loop-boundary retry-or-stop)
  decisionAnalyst: 'opus', // complex-decision-analyst (Phase E3 commit goalkeeper)
  requirements: 'opus', // requirements-collector (Phase C1)
  reviewDesign: 'opus', // critical-reviewer on requirements/arch/design (Phase C2)
  revise: 'opus',   // design-reviser (Phase C2)
  define: 'opus',     // task-definition-architect
  archDesign: 'opus', // arch-design-orchestrator (high-level design)
  detailedDesign: 'opus', // detailed-design-architect
  plan: 'opus',       // plan-architect
  tddEnforce: 'opus', // tdd-plan-enforcer
  review: 'opus',     // critical-reviewer (plan + code)
  refine: 'opus',     // plan-refiner
  execute: 'sonnet',  // plan-executor
  gsdQuick: 'sonnet', // gsd-quick skill
  gsdDebug: 'opus',   // gsd-debug root-cause
  testWriter: 'opus',
  test: 'sonnet',
  codeReview: 'opus', // critical-reviewer (code)
  e2eUsecase: 'opus', // e2e-usecase-extractor (Gate 0.7)
  knowledgeConsult: 'sonnet', // project-knowledge-consultant (Gate 0.1)
  interview: 'sonnet',   // user-interviewer (Define clarification)
  reconcile: 'opus',  // design-plan-reconciler (Gate 1.7)
  publish: 'sonnet',  // docs-architecture-publisher (Gate 5.4)
  persist: 'sonnet',  // knowledge-persist
  commit: 'sonnet',   // git-ops
  reviewEscalation: 'opus', // final escalation reviewer (convergence gate)
  todo: 'haiku',      // todo-store write (consolidated record)
  read: 'haiku',      // todo-store read (unused after R4; kept for parity)
  // Phase F-K (pipeline split): modes + chunker + issues/tune agents.
  planChunker: 'sonnet',  // plan-chunker (design tail: plan.md -> stageNN.md)
  issueClassifier: 'opus', // classifies implement findings as upstream-vs-code
  tunePlanner: 'opus',    // derives minimal gate-revisit plan from issues file
  // Extract mode (reverse design extraction) gates.
  scopeResolver: 'sonnet', // code-explorer resolving hybrid input into a scope manifest (Gate X0)
  decomposer: 'opus',      // arch-design-orchestrator slicing a wide scope into subsystems (Gate X1)
  audit: 'opus',           // critical-reviewer auditing the extracted design for debt (Gate X7)
  overview: 'sonnet',      // arch-design-orchestrator synthesizing the multi-slice overview (Gate X8)
  // Review mode (standalone design-docset audit) gates.
  reviewLens: 'opus',      // critical-reviewer per review dimension (Gate R1)
  reviewMerge: 'sonnet',   // dedup/merge of lens findings (Gate R2 — mechanical, cross-checked by R3)
  reviewVerify: 'opus',    // adversarial verification of merged findings (Gate R3)
}

// Config profiles: a named preset for the gate-control flag zoo. Individual --no-*
// flags still override the profile (see cfgFlag wiring in main()). A profile only
// supplies the DEFAULT for a flag the user did not set explicitly, so on --resume the
// persisted per-run flags still win. Unknown names fall back to 'full' (all gates on).
//   full     = every adopted gate ON (the historical default; backward-compatible).
//   standard = drops the two heaviest optional context gates for mid-size tasks.
//   light    = small-task preset: drops the opus review/enhancer/quick-decider loops and
//              the extra design gates so a tiny fix does not pay for the full THINK stack.
const PROFILES = {
  full: {},
  standard: {
    useE2eUsecase: false,
    useKnowledgeConsult: false,
    useExtractReview: false,
  },
  light: {
    useEnhancer: false,
    useQuickDecider: false,
    useArchDesign: false,
    useDetailedDesign: false,
    useReconcile: false,
    useE2eUsecase: false,
    useKnowledgeConsult: false,
    useInterview: false,
    useExtractReview: false,
    useExtractRequirements: false,
    useAudit: false,
  },
}
// Resolve a profile name to its flag-default overrides. Pure; unknown => 'full'.
function resolveProfile(name) {
  return PROFILES[name] ? PROFILES[name] : PROFILES.full
}

function resolveConfigFlag(argVal, persistedVal, defaultVal) {
  return argVal === false ? false : (persistedVal !== undefined ? persistedVal : defaultVal)
}

function profileDefault(profile, key, defaultVal) {
  return profile && profile[key] !== undefined ? profile[key] : defaultVal
}

function resolveUseTestWriter(args, persistedConfig) {
  const profile = resolveProfile(args && args.profile)
  return resolveConfigFlag(
    args && args.useTestWriter,
    persistedConfig && persistedConfig.useTestWriter,
    profileDefault(profile, 'useTestWriter', true),
  )
}

// Shared retry budget state. Both the refine loop and the debug loop draw from
// and increment this single counter so the pipeline has one global "stop" point.
const retryState = { used: 0 }
function budgetExhausted(budget) {
  return retryState.used >= budget
}
function spendRetry(n) {
  retryState.used += n
}

// IM-2: budget carry-over across --resume. By default a resume grants a FULL new
// budget (retryState/decisionState both re-zeroed), so a run that hard-blocked on a
// spinning loop can be resumed straight back into the same spin indefinitely. Persist
// the used counters in state and resume from them unless --fresh-budget is passed.
// Pure: reads persisted counters off the hydrated result; returns the seed values.
function hydrateBudget(resumedResult, args) {
  if (args && args.freshBudget) return { retryUsed: 0, decisionUsed: 0 }
  const r = resumedResult || {}
  const retryUsed = Number.isFinite(r.retryUsed) ? r.retryUsed : 0
  const decisionUsed = Number.isFinite(r.decisionUsed) ? r.decisionUsed : 0
  return { retryUsed: Math.max(0, retryUsed), decisionUsed: Math.max(0, decisionUsed) }
}

// Decision budget (Phase E1): authoritative decision-agents (quick-decider + goalkeeper)
// drive continue/break. To stop a runaway decision loop (e.g. goalkeeper repeatedly loops
// back, or quick-decider ping-ponging), a SINGLE runaway cap bounds total decision calls.
// Unlike retryBudget (the loop "stop"), decisionCap is pure runaway protection: hitting it
// hard-blocks (resumable via --resume) rather than letting an oscillating decision loop spin.
const decisionState = { used: 0 }
function decisionBudgetExhausted(cap) {
  return decisionState.used >= cap
}
function spendDecision(n) {
  decisionState.used += n
}

// Resolve the model for a gate key: explicit override wins, else default.
// Reads the global args so helpers (checkpoint/runTests) need no params.
function gm(key) {
  const override = args && args.models && args.models[key]
  return override || MODEL_DEFAULTS[key]
}

// Phase F-K: resolve the pipeline mode. Precedence:
//   1. explicit args.mode (the slash command sets it: design/implement/tune/extract/review commands)
//   2. persisted config.mode (resume honors the mode that wrote the state)
//   3. default 'design' (bare /feature-pipeline backward-compat).
// On --resume with an explicit different mode (e.g. implement after design), the explicit
// arg wins so the user can drive the design->implement->tune cycle from the command line.
function resolveMode(args, persistedConfig, resumed) {
  const VALID = { design: true, implement: true, tune: true, status: true, extract: true, review: true }
  if (args && args.mode && VALID[args.mode]) return args.mode
  if (persistedConfig && persistedConfig.mode && VALID[persistedConfig.mode]) return persistedConfig.mode
  if (resumed && resumed.result && resumed.result.mode && VALID[resumed.result.mode]) return resumed.result.mode
  return 'design'
}

// Phase F-K: RUN_GATE guard. A gate runs only if its mode is active. Design gates
// (THINK: define...review/refine + chunker) run in design+tune (tune revisits a subset in
// refine mode). Implement gates (DO: execute...commit) run in implement only. Extract gates
// (reverse design extraction: scope...audit/overview) run in extract only. This is the
// single structural seam that turns one engine into 5 pipelines without code duplication.
function gateModeActive(gateGroup, mode) {
  if (gateGroup === 'design') return mode === 'design' || mode === 'tune'
  if (gateGroup === 'implement') return mode === 'implement'
  if (gateGroup === 'extract') return mode === 'extract'
  if (gateGroup === 'review') return mode === 'review'
  return true // shared front-matter gates (categorize/translate/resume) always active
}

export { AGENT_NS, nsAgent, RETRY_BUDGET_DEFAULT, REFINE_SUBCAP_DEFAULT, DEBUG_SUBCAP_DEFAULT, RECONCILE_SUBCAP_DEFAULT, DECISION_CAP_DEFAULT, AGENT_TIMEOUT_MS_DEFAULT, AGENT_MAX_OUTPUT_CHARS_DEFAULT, IDENTICAL_FAILURE_LIMIT, GATE_FALLBACKS, MODEL_DEFAULTS, PROFILES, resolveProfile, resolveConfigFlag, profileDefault, resolveUseTestWriter, retryState, budgetExhausted, spendRetry, hydrateBudget, decisionState, decisionBudgetExhausted, spendDecision, gm, resolveMode, gateModeActive }
