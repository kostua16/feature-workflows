// feature-pipeline.js
// engine-version: 1.0.0
// Gate-enforcing pipeline for new features / bug-fixes.
// Encodes CLAUDE.md agent rules as a deterministic gate sequence:
//   task-definition-architect -> plan-architect -> [review/refine loop] ->
//   plan-executor -> pytest-runner -> critical-reviewer(code) -> [git-ops]
//
// Enhancements:
//   - Per-gate todo-store checkpoints: each gate writes a compact note
//     (status/result/evidence/notes) to .planning/todos/ via the todo-store
//     agent, and the next gate reads the prior summary instead of
//     re-deriving it. This is the explicit compaction boundary between stages.
//   - gsd-quick fast-path: simple tasks can be routed through the gsd-quick
//     skill as an alternate executor; our own Test + Code-Review gates still
//     run afterward so the flow stays authoritative.
//   - gsd-debug recovery: on Gate 4 (Test) failure, the gsd-debug skill is
//     invoked to diagnose+fix and tests are re-run up to maxDebugRetries
//     before the gate hard-blocks.
//
// Run via:
//   Workflow({ scriptPath: ".claude/workflows/feature-pipeline.js",
//              args: { task: "...", autoCommit: false, gsdQuick: false } })

export const meta = {
  name: 'feature-pipeline',
  version: '1.0.0',
  description: '1 engine + 3 modes (design/implement/tune) gate-enforcing feature/bug-fix pipeline: THINK docs + plan + stageNN.md -> DO execute -> test -> review -> commit (or issues-handoff -> tune). Durable cross-mode state via pipeline-state.json.',
  phases: [
    { title: 'Categorize' },
    { title: 'Translate' },
    { title: 'Tune' },
    { title: 'Define' },
    { title: 'Knowledge' },
    { title: 'Codebase Facts' },
    { title: 'E2E Use Cases' },
    { title: 'Requirements' },
    { title: 'Requirements Review' },
    { title: 'Architecture' },
    { title: 'Arch Review' },
    { title: 'Detailed Design' },
    { title: 'Detailed Design Review' },
    { title: 'Enhance' },
    { title: 'Plan' },
    { title: 'TDD Enforce' },
    { title: 'Reconcile' },
    { title: 'Review/Refine' },
    { title: 'Chunk Plan' },
    { title: 'Execute' },
    { title: 'Test' },
    { title: 'Code Review' },
    { title: 'Publish' },
    { title: 'Persist' },
    { title: 'Commit' },
    { title: 'Debug' },
    { title: 'Design' },
    { title: 'Goalkeeper' },
  ],
}

// ---- Schemas (JSON Schema) -------------------------------------------------

const DEFINE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['definitionPath', 'needsClarification', 'assumptions', 'summary'],
  properties: {
    definitionPath: {
      type: 'string',
      description: 'Path to the idea doc written (objective, NFRs, pass gates, TDD scenarios)',
    },
    needsClarification: {
      type: 'boolean',
      description: 'true if a critical ambiguity would fork the whole approach and must be answered by the user before proceeding',
    },
    openQuestions: {
      type: 'array',
      description: 'If needsClarification, the questions that block proceeding',
      items: { type: 'string' },
    },
    assumptions: {
      type: 'array',
      description: 'Assumptions made to resolve non-blocking ambiguities',
      items: { type: 'string' },
    },
    passGates: {
      type: 'array',
      description: 'Objective pass gates defined for the task',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    recommendedPath: {
      type: 'string',
      enum: ['full', 'gsd-quick'],
      description: 'full = run all gates; gsd-quick = task is simple enough to route through the gsd-quick skill as executor',
    },
  },
}

// prompt-translator (Gate -1): detect+translate non-English task input before Define.
const TRANSLATOR_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['translated', 'originalLang', 'task'],
  properties: {
    translated: {
      type: 'boolean',
      description: 'true if translation was applied (non-English detected and converted)',
    },
    originalLang: {
      type: 'string',
      description: 'Detected language code (e.g. "zh", "ja", "es") or "en" if English',
    },
    task: {
      type: 'string',
      description: 'The English task text — either the original (if English) or the translation',
    },
    translatePath: {
      type: 'string',
      description: 'Path to the translation log written under planDir (records the original+translated text)',
    },
    summary: { type: 'string' },
  },
}

// feature-categorizer (Phase B1): classifies the task into project taxonomy so the
// planDir can be derived dynamically as docs/{category}/{subCategory}/feature/{leaf}/.
// Gate = both category + subCategory truthily populated.
// FX-11: each segment constrained to 1-3 kebab-case words (≤24 chars) so the planDir never
// becomes a raw task-text substring. `leaf` is a short summary name for the feature itself.
const KEBAB_PAT = '^[a-z0-9]+(-[a-z0-9]+){0,2}$'
const CATEGORY_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'subCategory'],
  properties: {
    category: {
      type: 'string',
      description: 'Top-level project category/module (e.g. "parser", "report", "cli"). 1-3 words, kebab-case, ≤24 chars.',
      maxLength: 24,
      pattern: KEBAB_PAT,
    },
    subCategory: {
      type: 'string',
      description: 'Component/sub-category within the category (e.g. "filters", "cache", "file-refs"). 1-3 words, kebab-case, ≤24 chars.',
      maxLength: 24,
      pattern: KEBAB_PAT,
    },
    leaf: {
      type: 'string',
      description: 'Short 1-3 word kebab-case summary naming this specific feature (e.g. "file-refs", "sql-prefixes"). 1-3 words, kebab-case, ≤24 chars.',
      maxLength: 24,
      pattern: KEBAB_PAT,
    },
    reasoning: { type: 'string' },
  },
}

const PLAN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['planPath', 'summary', 'lanes'],
  properties: {
    planPath: { type: 'string', description: 'Path to the plan markdown file written/updated' },
    summary: { type: 'string', description: 'One-paragraph summary of the plan and its tasks' },
    lanes: {
      type: 'array',
      description:
        'Execution lanes — file-disjoint work groups. Two+ DISJOINT lanes enable parallel execution. ' +
        'A single lane (one entry covering all steps) is the degenerate case. Each lane lists the ' +
        'exact source files it will touch so the pipeline can verify disjointness before fanning out.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'steps', 'files'],
        properties: {
          name: { type: 'string', description: 'Short lane name (e.g. "cli", "parser", "tests")' },
          steps: { type: 'string', description: 'The ordered plan steps this lane owns (verbatim from the plan)' },
          files: {
            type: 'array',
            description: 'Source files this lane will create/modify (paths as in the plan)',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}

const REVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'blockers', 'issues', 'summary'],
  properties: {
    accepted: { type: 'boolean', description: 'true if the artifact is good enough to proceed' },
    blockers: {
      type: 'array',
      description: 'Must-fix issues that block proceeding',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'title', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          fix: { type: 'string', description: 'Concrete fix recommendation' },
        },
      },
    },
    issues: { type: 'integer', description: 'Total number of findings (all severities)' },
    summary: { type: 'string' },
    notes: { type: 'string', description: 'Self-summary note persisted in lieu of a todo-store call' },
    evidence: {
      type: 'array',
      description: 'Concrete evidence (file:line refs) backing the findings',
      items: { type: 'string' },
    },
  },
}

const REFINE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['planPath', 'changesApplied', 'summary'],
  properties: {
    planPath: { type: 'string' },
    changesApplied: { type: 'integer', description: 'Number of review findings addressed' },
    summary: { type: 'string' },
  },
}

const EXECUTE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['completed', 'stepsDone', 'summary'],
  properties: {
    completed: { type: 'boolean', description: 'true if every task in the plan (or lane) was executed' },
    stepsDone: { type: 'integer' },
    summary: { type: 'string' },
    files: {
      type: 'array',
      description: 'Files this executor actually touched (lane-scoped). Used for post-run sanity, not a gate.',
      items: { type: 'string' },
    },
    notes: { type: 'string', description: 'Self-summary note (deviations, decisions) persisted in lieu of a todo-store call' },
    evidence: {
      type: 'array',
      description: 'Concrete evidence of completion (test names touched, construction sites updated)',
      items: { type: 'string' },
    },
  },
}

const TEST_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'summary', 'command'],
  properties: {
    passed: { type: 'boolean', description: 'true if the pytest run exited 0' },
    summary: { type: 'string', description: 'Short result line, e.g. "12 passed"' },
    command: { type: 'string', description: 'The pytest command that was run' },
  },
}

const COMMIT_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['committed', 'commitHash', 'summary'],
  properties: {
    committed: { type: 'boolean' },
    commitHash: { type: ['string', 'null'] },
    summary: { type: 'string' },
  },
}

// --- Checkpoint / GSD schemas ----------------------------------------------

const TODO_ACK = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: { type: 'boolean', description: 'true if the todo-store write/read succeeded' },
    note: { type: 'string', description: 'Path or short status note' },
  },
}

const FILE_ACK = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: { type: 'boolean', description: 'true if the file write succeeded' },
    path: { type: 'string', description: 'Path the file was written to' },
  },
}

const GSD_RUN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['ran', 'summary'],
  properties: {
    ran: { type: 'boolean', description: 'true if the gsd-quick skill ran to completion' },
    usedFallback: {
      type: 'boolean',
      description: 'true if the skill was unavailable and the agent implemented directly instead',
    },
    summary: { type: 'string', description: 'What was implemented and the test outcome gsd-quick observed' },
    testsPassed: { type: 'boolean', description: 'Whether gsd-quick reported its own tests passing' },
  },
}

const DEBUG_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['fixed', 'summary'],
  properties: {
    fixed: { type: 'boolean', description: 'true if gsd-debug applied a fix it believes resolves the failures' },
    summary: { type: 'string', description: 'Root cause hypothesis + change made' },
    changes: { type: 'string', description: 'Files changed / diff summary' },
    notes: { type: 'string', description: 'Gotcha/rule worth persisting (root cause, tricky edge case)' },
    evidence: { type: 'array', description: 'Evidence the fix is correct (failing test now passing, etc.)', items: { type: 'string' } },
  },
}

const ESCALATION_REVIEW = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'forceAcceptable', 'summary'],
  properties: {
    accepted: {
      type: 'boolean',
      description: 'true if no TRUE defects remain (clean accept — proceed normally)',
    },
    forceAcceptable: {
      type: 'boolean',
      description: 'true if every remaining blocker is implementation-detail (force-accept, carry notes forward)',
    },
    trueDefects: {
      type: 'array',
      description: 'Remaining blockers that ARE genuine plan defects (missing scope/spec/ordering/risk)',
      items: { type: 'string' },
    },
    implNotes: {
      type: 'array',
      description: 'Remaining blockers reclassified as implementer notes (call-site wiring)',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    notes: { type: 'string', description: 'Self-summary note persisted in lieu of a todo-store call' },
    evidence: { type: 'array', description: 'Evidence backing the reclassification', items: { type: 'string' } },
  },
}

// quick-decider (Phase E2): authoritative retry-or-stop verdict at a loop boundary.
// null (agent throw / safeAgent failure) -> conservative 'stop' (don't burn budget blindly).
const QUICK_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'reasoning'],
  properties: {
    decision: { type: 'string', enum: ['retry', 'stop'], description: 'retry = worth another attempt; stop = break the loop' },
    reasoning: { type: 'string' },
  },
}

// complex-decision-analyst goalkeeper (Phase E3): after final code-review, decides commit
// vs loop-back to an earlier phase. null -> conservative 'commit' (don't strand work).
const GOALKEEPER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'targetPhase', 'reasoning', 'trueDefects'],
  properties: {
    decision: { type: 'string', enum: ['commit', 'loop-back'], description: 'commit = proceed to publish/commit; loop-back = re-enter targetPhase and re-run downstream' },
    targetPhase: {
      type: 'string',
      enum: ['none', 'requirements', 'architecture', 'design', 'plan', 'tests'],
      description: 'none (with commit) or the phase to loop back to (with loop-back)',
    },
    reasoning: { type: 'string' },
    trueDefects: { type: 'array', description: 'Concrete defects justifying a loop-back (empty for clean commit)', items: { type: 'string' } },
  },
}

const ARCH_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['archPath', 'summary'],
  properties: {
    archPath: { type: 'string', description: 'Path to the high-level architecture design doc written' },
    summary: { type: 'string', description: 'One-paragraph summary of the architecture + NFRs it satisfies' },
    gaps: {
      type: 'array',
      description: 'NFRs or requirements the design could not fully satisfy (risk callouts)',
      items: { type: 'string' },
    },
    openQuestions: {
      type: 'array',
      description: 'Architectural ambiguities needing resolution (non-blocking unless needsClarification)',
      items: { type: 'string' },
    },
  },
}

const DETAILED_DESIGN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['designPath', 'summary'],
  properties: {
    designPath: { type: 'string', description: 'Path to the impl-ready detailed design doc written' },
    summary: { type: 'string', description: 'One-paragraph summary (component breakdown, interfaces, data models, edge cases)' },
    openGaps: {
      type: 'array',
      description: 'Detail-level gaps deferred to the plan/executor',
      items: { type: 'string' },
    },
  },
}

const TDD_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['hardened', 'planPath', 'gatesAdded', 'redTests', 'yagniWarnings', 'summary'],
  properties: {
    hardened: { type: 'boolean', description: 'true if the plan was hardened in place with TDD gates' },
    planPath: { type: 'string', description: 'Path to the TDD-hardened plan' },
    gatesAdded: { type: 'integer', description: 'Number of TDD gates / sections added' },
    redTests: {
      type: 'array',
      description: 'RED-phase tests the plan now mandates (to write first, fail first)',
      items: { type: 'string' },
    },
    yagniWarnings: {
      type: 'array',
      description: 'YAGNI violations found — scope the plan should drop',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

const PERSIST_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['persisted', 'summary'],
  properties: {
    persisted: { type: 'boolean', description: 'true if knowledge was persisted to CLAUDE.md / Serena memory' },
    paths: {
      type: 'array',
      description: 'Paths/keys where findings were persisted',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

const KNOWLEDGE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['relevant', 'summary'],
  properties: {
    relevant: { type: 'boolean', description: 'true if relevant project knowledge was found for this task' },
    summary: { type: 'string', description: 'Concise brief of conventions/decisions/gotchas the designer should know' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Specific rules or gotchas cited' },
    notes: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

const INTERVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['asked', 'summary'],
  properties: {
    asked: { type: 'boolean', description: 'true if the interview was conducted' },
    answers: {
      type: 'array',
      description: 'Resolved {question, answer} pairs gathered from the user',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
      },
    },
    resolved: { type: 'boolean', description: 'true if all open questions were answered' },
    summary: { type: 'string' },
  },
}

const E2E_USECASE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['useCasePath', 'summary'],
  properties: {
    useCasePath: { type: 'string', description: 'Path to the e2e use cases doc' },
    useCases: {
      type: 'array',
      description: 'Defined end-to-end use cases / test scenarios',
      items: { type: 'string' },
    },
    openQuestions: {
      type: 'array',
      description: 'Ambiguities surfaced during use-case extraction',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

// code-explorer (Phase D2): gathers codebase facts (existing patterns, call sites, data
// carriers, interfaces) into <planDir>/codebase-facts.md so the requirements + architecture
// prompts consume structured facts rather than doing inline grep / guessing. Non-blocking.
// Gate (truthiness) = factsPath populated.
const CODEBASE_FACTS_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['factsPath', 'summary'],
  properties: {
    factsPath: { type: 'string', description: 'Path to the codebase-facts.md doc written' },
    relevantFiles: {
      type: 'array',
      description: 'Key files + line ranges relevant to the task (file_path:line refs)',
      items: { type: 'string' },
    },
    patterns: {
      type: 'array',
      description: 'Existing patterns the new work should mirror (NamedTuple append, filter glob, cache version, etc.)',
      items: { type: 'string' },
    },
    callSites: {
      type: 'array',
      description: 'Call sites / integration points the new work must wire into',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}


// requirements-collector (Phase C1): gathers FRs + NFRs into <planDir>/requirements.md
// so the architecture + detailed-design prompts consume a structured requirements doc
// instead of inferring from the idea doc. Gate = requirementsPath truthily populated.
const REQUIREMENTS_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['requirementsPath', 'summary'],
  properties: {
    requirementsPath: { type: 'string', description: 'Path to the requirements.md doc written' },
    functionalRequirements: {
      type: 'array',
      description: 'Functional requirements (FRs)',
      items: { type: 'string' },
    },
    nonFunctionalRequirements: {
      type: 'array',
      description: 'Non-functional requirements (NFRs): performance, reliability, security, etc.',
      items: { type: 'string' },
    },
    openQuestions: {
      type: 'array',
      description: 'Ambiguities surfaced during requirements collection',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

// design-reviser (Phase C2): applies critical-reviewer feedback to a design/artifact doc
// (requirements, architecture, or detailed-design) in place. Gate = artifactPath truthy.
const DESIGN_REVISE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['artifactPath', 'revised', 'summary'],
  properties: {
    artifactPath: { type: 'string', description: 'Path to the revised artifact doc' },
    revised: { type: 'boolean', description: 'true if changes were applied' },
    changesApplied: {
      type: 'array',
      description: 'Review findings addressed',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

// REVIEW_VERDICT already exists above (plan review). For requirements/arch/design review
// we reuse a lighter gate: accepted + blockers + gaps. The plan-review REVIEW_VERDICT has
// blockers/findings; we add a gaps field expectation via the same schema. To avoid drift we
// define a dedicated DESIGN_REVIEW_VERDICT for the non-plan artifacts.
const DESIGN_REVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'summary'],
  properties: {
    accepted: { type: 'boolean', description: 'true if the artifact passes review with no open blockers/gaps' },
    blockers: {
      type: 'array',
      description: 'Blocking findings that must be fixed before acceptance',
      items: { type: 'string' },
    },
    gaps: {
      type: 'array',
      description: 'Open gaps / open questions that should be closed',
      items: { type: 'string' },
    },
    findings: {
      type: 'array',
      description: 'Non-blocking findings / notes',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

// prompt-enhancer (Phase D1): hardens a base prompt for a retry attempt given the failure
// context (JSON-malformed, repeated-review, reviewer-feedback). Gate = enhancedPrompt truthy.
const ENHANCER_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['enhancedPrompt', 'intent', 'changes'],
  properties: {
    enhancedPrompt: { type: 'string', description: 'The hardened prompt text to use for the retry attempt' },
    intent: {
      type: 'string',
      description: 'The hardening intent applied (e.g. tighten-format, relax-review, improve-design)',
    },
    changes: {
      type: 'array',
      description: 'Specific changes applied to the base prompt',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
}

const RECONCILE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['consistent', 'summary'],
  properties: {
    consistent: { type: 'boolean', description: 'true if plan and design artifacts are aligned' },
    conflicts: {
      type: 'array',
      description: 'Inconsistencies/gaps/conflicts between plan and design',
      items: { type: 'string' },
    },
    designAtFault: { type: 'boolean', description: 'true if the DESIGN (not the plan) is the source of conflict and should be fixed' },
    designFixes: {
      type: 'array',
      description: 'If designAtFault, the concrete defects to fix in the design/architecture',
      items: { type: 'string' },
    },
    reconciledPlanPath: { type: 'string', description: 'Plan path if the plan was updated to match design' },
    summary: { type: 'string' },
    notes: { type: 'string', description: 'What was compared and decided' },
    evidence: {
      type: 'array',
      description: 'Cited specifics (section refs, field names) backing the verdict',
      items: { type: 'string' },
    },
  },
}

const PUBLISH_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['published', 'summary'],
  properties: {
    published: { type: 'boolean', description: 'true if docs were published/updated' },
    paths: {
      type: 'array',
      description: 'Documentation locations updated',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    notes: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

// Shape of <planDir>/pipeline-state.json (the --resume substrate). The file is
// written verbatim by the file-writer agent (FILE_ACK), so this documents the
// payload rather than being enforced as an agent-output schema.
const PIPELINE_STATE = {
  type: 'object',
  additionalProperties: false,
  required: ['task', 'slug', 'planPath', 'planDir', 'lastGate', 'result'],
  properties: {
    task: { type: 'string' },
    slug: { type: 'string' },
    planPath: { type: 'string' },
    planDir: { type: 'string' },
    lastGate: { type: 'string', description: 'Most recent gate reached' },
    result: { type: 'object', description: 'Full pipeline result object (verbatim). Phase F-K split adds optional fields inside result: mode (design|implement|tune), stages[], designReady, issuesPath, tunePlan, handoff. All default so pre-split state still hydrates.' },
    config: { type: 'object', description: 'args-derived flags, so resume re-derives without re-parsing. Gains mode/useChunker/useIssues/useTuneConfirm (Phase F-K).' },
  },
}

// File-reader output schema for loading pipeline-state.json on --resume.
const PIPELINE_STATE_READ = {
  type: 'object',
  additionalProperties: false,
  required: ['state'],
  properties: {
    state: {
      type: ['object', 'null'],
      description: 'Parsed pipeline-state.json, or null if the file is missing',
    },
  },
}

// plan-chunker (Phase H, design tail): chunk plan.md -> dependency-ordered stageNN.md files.
// Gate = stages array non-empty. The stages are the implement progress unit (lanes collapse INTO
// a stage; intra-stage parallelism reuses the existing lane fan-out, scoped to one stage).
const STAGE_PLAN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['stages', 'summary'],
  properties: {
    stages: {
      type: 'array',
      description: 'Dependency-ordered execution stages (stageNN.md). One stage = one implement tick.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'file', 'name', 'status', 'files'],
        properties: {
          id: { type: 'string', description: 'stage id, e.g. "stage01"' },
          file: { type: 'string', description: 'stage file path under planDir' },
          name: { type: 'string', description: 'short human-readable stage name' },
          status: { type: 'string', enum: ['pending', 'in-progress', 'done', 'blocked'], description: 'initially "pending"' },
          files: {
            type: 'array',
            description: 'source files this stage owns (lane-compatible — file-disjoint stages enable intra-stage parallel execution)',
            items: { type: 'string' },
          },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// issue-classifier (Phase I, implement): classify ONE code-review/goalkeeper finding as upstream
// vs code. Gate = verdict present. Drives whether to append to issues-and-improvements.md.
const ISSUE_CLASSIFY_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['isUpstream', 'gate'],
  properties: {
    isUpstream: { type: 'boolean', description: 'true = points at a design doc (plan/architecture/design/requirements); false = code-level' },
    gate: {
      type: 'string',
      enum: ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'],
      description: 'which design gate this issue maps to ("none" if code-level)',
    },
    severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
    finding: { type: 'string', description: 'the issue text, rephrased for a design-doc author' },
    suggestedFix: { type: 'string' },
  },
}

// tune-planner (Phase J, tune): derive the minimal gate-revisit plan from issues-and-improvements.md.
// Gate = planGates non-empty. Confirmed via AskUserQuestion before running.
const TUNE_PLAN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['planGates', 'summary'],
  properties: {
    planGates: {
      type: 'array',
      description: 'Ordered design gates to re-run in refine mode',
      items: { type: 'string', enum: ['requirements', 'architecture', 'design', 'plan'] },
    },
    issueRefs: { type: 'array', items: { type: 'string' }, description: 'issue file:line refs each gate addresses' },
    preserveStages: { type: 'array', items: { type: 'string' }, description: 'completed stage ids to NOT invalidate' },
    summary: { type: 'string' },
  },
}

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
  test: 'sonnet',     // pytest-runner
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
//   1. explicit args.mode (the slash command sets it: design-feature/implement-feature/tune-feature)
//   2. persisted config.mode (resume honors the mode that wrote the state)
//   3. default 'design' (bare /feature-pipeline backward-compat).
// On --resume with an explicit different mode (e.g. implement after design), the explicit
// arg wins so the user can drive the design->implement->tune cycle from the command line.
function resolveMode(args, persistedConfig, resumed) {
  const VALID = { design: true, implement: true, tune: true }
  if (args && args.mode && VALID[args.mode]) return args.mode
  if (persistedConfig && persistedConfig.mode && VALID[persistedConfig.mode]) return persistedConfig.mode
  if (resumed && resumed.result && resumed.result.mode && VALID[resumed.result.mode]) return resumed.result.mode
  return 'design'
}

// Phase F-K: RUN_GATE guard. A gate runs only if its mode is active. Design gates
// (THINK: define...review/refine + chunker) run in design+tune (tune revisits a subset in
// refine mode). Implement gates (DO: execute...commit) run in implement only. This is the
// single structural seam that turns one engine into 3 pipelines without code duplication.
function gateModeActive(gateGroup, mode) {
  if (gateGroup === 'design') return mode === 'design' || mode === 'tune'
  if (gateGroup === 'implement') return mode === 'implement'
  return true // shared front-matter gates (categorize/translate/resume) always active
}

// Deterministic slug from task text (no Date/Math.random in workflow scripts).
function taskSlug(task) {
  const cleaned = String(task)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'feature-pipeline-task'
}

// FX-11: bound a categorizer segment to kebab-case + ≤maxWords words + ≤maxChars chars.
// Summarization is the LLM's job (prompt + schema); this is the deterministic safety net so a
// path segment can never become a raw task-text substring. Mirrors taskSlug's normalization.
function categorizeSlug(s, maxWords = 3, maxChars = 24) {
  const cleaned = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // collapse non-alphanumeric to hyphens
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
  const words = cleaned.split('-').filter(Boolean).slice(0, maxWords) // cap word count
  let out = words.join('-').slice(0, maxChars)
  out = out.replace(/-+$/g, '')     // re-trim after char cap
  return out || 'misc'
}

// Extract a JIRA ticket id (e.g. PROJ-123) from task text for planDir naming.
// No Date/Math.random — pure regex on the task string. Returns null if absent.
function jiraIdFromTask(task) {
  const match = String(task || '').match(/\b([A-Z][A-Z0-9_]+-\d+)\b/)
  return match ? match[1] : null
}

// Heuristic non-English detection for the translator gate: ratio of non-ASCII letters
// to total letters. No regex, no Date/Math.random — pure char-code scan. Returns
// {isEnglish, ratio}. Threshold 0.15 tolerates accents/quotes in otherwise-English text.
function detectNonEnglish(text) {
  let letters = 0
  let nonAsciiLetters = 0
  const str = String(text || '')
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      letters++ // ASCII A-Z / a-z
    } else if (c > 127) {
      nonAsciiLetters++ // any non-ASCII char counted as a potential non-English letter
      letters++
    }
  }
  const ratio = letters > 0 ? nonAsciiLetters / letters : 0
  return { isEnglish: letters === 0 || ratio < 0.15, ratio }
}

// Consolidate the full pipeline result into ONE durable todo-store record.
// R4 replaces ~16 per-gate checkpoint() calls with this single write: gate
// verdicts (with their self-summarizing notes/evidence fields) already carry
// everything each stage decided, so we persist the whole result object once on
// success and once per hard-block exit. Prior context is passed between gates
// in-prompt from the in-memory `result`, not via todo-store reads.
async function consolidate(slug, result, config) {
  // R5/R6: flush the in-memory pipeline log to <planDir>/pipeline.log AND the
  // durable pipeline-state.json alongside the todo-store write, so every
  // consolidate point (success + each hard-block exit) persists the run log and
  // the resumable state. All three are non-fatal if they fail.
  if (result.planPath) {
    const planDir = result.planPath.replace(/plan\.md$/, '')
    await flushPipelineLog(planDir, result)
    await flushPipelineState(planDir, result, config)
  }
  return agent(
    `You are the todo-store agent. Write ONE consolidated record for task slug "${slug}"
under .planning/todos/. Capture the full pipeline result (JSON) verbatim as the durable task record:

${JSON.stringify(result, null, 2)}

Create or replace the todo entry for this task slug. Do NOT read or modify unrelated tasks.
Return ok=true once written.`,
    { label: 'todo-store:consolidate', phase: 'Checkpoint', agentType: nsAgent('todo-store'), schema: TODO_ACK, model: gm('todo') }
  )
}

// R5: flush the in-memory pipeline log to <planDir>/pipeline.log via a
// file-writing agent (workflow scripts have no direct FS access). Called at the
// same durable boundaries as consolidate() — on success and once per hard-block
// exit — so the log reflects the run's final state. Non-blocking: a flush
// failure never gates the pipeline.
//
// CHUNKING: a single file-writer call embeds the whole body in its prompt,
// which can exceed a subagent's context window on a long run. writeChunkedFile()
// splits the body at a char budget (~12k chars, safe margin under subagent
// limits) at line boundaries and writes sequentially: chunk 0 overwrites the
// file, chunks 1..N append. Each agent call carries only one chunk. On any chunk
// failure it stops and warns in the log. Shared by flushPipelineState too.
async function writeChunkedFile(filePath, body, labelPrefix, result, successNote) {
  const MAX_CHUNK_CHARS = 12000
  const lines = body.split('\n')
  const chunks = []
  let cur = ''
  for (const line of lines) {
    if (cur.length + line.length + 1 > MAX_CHUNK_CHARS && cur) {
      chunks.push(cur)
      cur = ''
    }
    cur += (cur ? '\n' : '') + line
  }
  if (cur) chunks.push(cur)

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0
    const total = chunks.length
    try {
      await agent(
        `You are a file-writer agent. ${isFirst ? `Write (create/overwrite) the file at ${filePath}. Create the parent directory if needed.` : `APPEND to the existing file ${filePath} (do not overwrite what is already there).`}
This is chunk ${i + 1} of ${total}. Write the body below verbatim, then return ok=true.

${chunks[i]}`,
        { label: `${labelPrefix}(${i + 1}/${total})`, phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
      )
    } catch (e) {
      result.logLines.push(`WARNING: ${filePath} chunk ${i + 1}/${total} write failed: ${String(e)}`)
      return filePath // stop on first failure — partial file is better than a corrupt one
    }
  }
  if (successNote && chunks.length > 1) result.logLines.push(successNote(chunks.length, MAX_CHUNK_CHARS))
  return filePath
}

async function flushPipelineLog(planDir, result) {
  const logPath = planDir.replace(/\/$/, '') + '/pipeline.log'
  const header = `Pipeline run log for task: ${result.task}\n`
  const rawLines = result.logLines && result.logLines.length
    ? result.logLines.map((l, i) => String(i + 1).padStart(3, '0') + '  ' + l)
    : ['(no log lines recorded)']
  const body = header + rawLines.join('\n')
  return writeChunkedFile(logPath, body, 'file-writer:pipeline-log', result,
    (n, max) => `pipeline.log flushed in ${n} chunks (>${max} chars)`)
}

// R6: persist the durable pipeline-state JSON to <planDir>/pipeline-state.json
// via the file-writer agent. This is the --resume substrate: every consolidate
// boundary (success + each hard-block exit) flushes the latest result + config
// so a blocked run can be resumed. Non-blocking: a write failure only warns.
// Reuses writeChunkedFile's greedy line-boundary chunking (>12k chars).
async function flushPipelineState(planDir, result, config) {
  const statePath = planDir.replace(/\/$/, '') + '/pipeline-state.json'
  const payload = {
    task: result.task,
    slug: result.slug,
    planPath: result.planPath,
    planDir,
    lastGate: (result._state && result._state.lastGate) || null,
    result,
    config,
  }
  return writeChunkedFile(statePath, JSON.stringify(payload, null, 2), 'file-writer:pipeline-state', result)
}

// Load <planDir>/pipeline-state.json for --resume. Returns { state: <obj|null> }
// via the file-reader agent; null if the file does not exist.
async function loadPipelineState(planDir) {
  const statePath = planDir.replace(/\/$/, '') + '/pipeline-state.json'
  return agent(
    `You are a file-reader agent. Read ${statePath} and return its full JSON content parsed as an
object in the "state" field. If the file does not exist, return state=null.`,
    { label: 'file-reader:pipeline-state', phase: 'Checkpoint', schema: PIPELINE_STATE_READ, model: gm('todo') }
  )
}

// chunkPlanIntoStages (Phase H, design tail): split plan.md -> dependency-ordered stageNN.md files
// via the plan-chunker agent. Stages become the implement progress unit (lanes collapse INTO a stage).
// Called once in design mode after Gate 2 (Review/Refine) acceptance, BEFORE the design-stop.
// Skipped when: disabled (--no-chunker), already chunked (result.stages non-empty on resume), or
// the chunker fails (degrades to a single implicit stage01 covering the whole plan). Non-blocking:
// a chunker failure never blocks design; it logs and emits a single implicit stage.
async function chunkPlanIntoStages({ planPath, planDir, task, result, lanes }) {
  const laneHint = lanes && lanes.length
    ? `The plan already declares these file-disjoint lanes (collapse each lane INTO a stage, or group file-disjoint lanes into one stage): ${JSON.stringify(lanes.map((l) => ({ name: l.name, files: l.files || [] })))}`
    : 'No lanes declared — chunk by dependency boundaries.'
  const chunk = await safeAgent(
    `You are the plan-chunker agent. Decompose the plan at ${planPath} into smaller, dependency-aware
execution stages so each stage fits one implement pass. Write each stage as a separate stageNN.md file
under ${planDir} (stage01.md, stage02.md, ... in dependency order). Update ${planPath} with TODO
references pointing to the created stage files (do not duplicate the stage bodies in the plan).

Task:
${task}

${laneHint}

Each stage file must state: its name, the ordered steps it owns (verbatim from the plan), the exact
source files it will touch, dependencies on earlier stages, and its own exit criteria / tests.
Stages must be dependency-ordered so they can execute sequentially; file-disjoint stages may run in
parallel WITHIN a stage. Read mem:core and mem:conventions first. Do NOT commit.

Return the stage manifest: each stage's id (stage01...), file path, name, initial status "pending",
and the source files it owns.`,
    { label: 'plan-chunker', phase: 'Detailed Design', schema: STAGE_PLAN_VERDICT, model: gm('planChunker') },
    result
  )
  if (chunk && chunk.stages && chunk.stages.length) {
    plogFromResult(result, `plan-chunker: ${chunk.stages.length} stage(s) written under ${planDir}`)
    return chunk.stages
  }
  // Degrade to a single implicit stage covering the whole plan (preserves single-executor behavior).
  plogFromResult(result, 'plan-chunker: returned no stages — degrading to single implicit stage01')
  return [{
    id: 'stage01',
    file: planDir + 'stage01.md',
    name: 'Whole plan',
    status: 'pending',
    files: (lanes || []).flatMap((l) => l.files || []),
  }]
}

// classifyAndRecordIssue (Phase I, implement): classify ONE code-review/goalkeeper finding as
// upstream (points at a design doc) vs code. If upstream, append it to
// <planDir>/issues-and-improvements.md (append-only, chunked) — the durable handoff signal that
// tune-feature consumes. Code-level findings are NOT recorded (they hard-block normally in implement).
// Over-classifies upstream (false-positive upstream → tune runs, cheap) rather than silently drop a
// goalkeeper loop-back. Returns the classification verdict (or null on failure). Non-blocking: a
// classifier failure returns null; the CALLER decides whether to plain-block (the --no-issues path).
async function classifyAndRecordIssue({ finding, planDir, result }) {
  if (!finding) return null
  const verdict = await safeAgent(
    `You are the issue-classifier agent. A code review / commit goalkeeper found this issue after
implementation. Classify it: is it UPSTREAM (the root cause is a defect in a design document — the
plan, architecture, detailed-design, or requirements — that the implementer faithfully followed) or
CODE (an implementation bug the executor introduced, fixable in code)?

Issue:
${typeof finding === 'string' ? finding : JSON.stringify(finding)}

Set isUpstream=true ONLY if fixing it requires revising a design doc, not just code. Map it to the
design gate that owns that doc: requirements | architecture | design | plan. Set gate="none" for
code-level issues. Rephrase the issue for a DESIGN-DOC AUTHOR (what is wrong with the doc, not the
code), and give a concrete suggested fix.`,
    { label: 'issue-classifier', phase: 'Goalkeeper', schema: ISSUE_CLASSIFY_VERDICT, model: gm('issueClassifier') },
    result
  )
  if (!verdict || !verdict.isUpstream) {
    plogFromResult(result, `issue-classifier: finding classified as code-level (not recorded) — ${verdict && verdict.finding ? String(verdict.finding).slice(0, 120) : '(no verdict)'}`)
    return verdict || null
  }
  // Upstream → append to issues-and-improvements.md (the tune handoff file).
  const issuesPath = planDir.replace(/\/$/, '') + '/issues-and-improvements.md'
  const section = [
    `## Upstream issue — gate: ${verdict.gate}`,
    '',
    `**Severity:** ${verdict.severity || '(unspecified)'}`,
    `**Finding:** ${verdict.finding || '(unspecified)'}`,
    `**Suggested fix:** ${verdict.suggestedFix || '(none)'}`,
    '',
    '---',
    '',
  ].join('\n')
  try {
    await agent(
      `You are a file-writer agent. APPEND the markdown section below to ${issuesPath}.
If the file does not exist, create it with a "# Issues & Improvements" header first, then the section.
Do NOT overwrite existing content — append only. Return ok=true after appending.

${section}`,
      { label: 'file-writer(issues)', phase: 'Goalkeeper', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
    )
    result.issuesPath = issuesPath
    plogFromResult(result, `issue-classifier: UPSTREAM issue recorded → ${issuesPath} (gate=${verdict.gate})`)
  } catch (e) {
    plogFromResult(result, `issue-classifier: issues-and-improvements.md append failed (non-blocking): ${String(e)}`)
  }
  return verdict
}

// tickStageFile (Phase I, implement): mark progress on a stageNN.md file (append a status note)
// + update result.stages[i].status. append-only so the stage accumulates its execution trail across
// resume. Non-blocking: a tick failure logs and continues (the in-memory result.stages is the
// source of truth; the file note is for human audit). Mirrors writeChunkedFile's append pattern.
async function tickStageFile({ stage, status, planDir, result, note }) {
  stage.status = status
  const entry = [
    `## Status: ${status}`,
    '',
    note || `(no note)`,
    '',
    '---',
    '',
  ].join('\n')
  try {
    await agent(
      `You are a file-writer agent. APPEND the status note below to the stage file at ${stage.file}.
If the file does not exist, create it with a "# Stage ${stage.id}: ${stage.name}" header first.
Do NOT overwrite existing content — append only. Return ok=true.

${entry}`,
      { label: `stage-tick:${stage.id}`, phase: 'Execute', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
    )
  } catch (e) {
    plogFromResult(result, `stage-tick ${stage.id} append failed (non-blocking): ${String(e)}`)
  }
}

// readIssuesFile (Phase J, tune): load <planDir>/issues-and-improvements.md for the tunePlanner.
// Returns the raw markdown text (null if the file is absent — tune requires it to exist).
async function readIssuesFile(planDir, result) {
  const issuesPath = planDir.replace(/\/$/, '') + '/issues-and-improvements.md'
  return safeAgent(
    `You are a file-reader agent. Read ${issuesPath} and return its FULL markdown text in the "content"
field. If the file does not exist, return content=null.`,
    { label: 'file-reader:issues', phase: 'Tune', schema: {
      type: 'object', additionalProperties: false,
      required: ['content'],
      properties: { content: { type: ['string', 'null'] } },
    }, model: gm('todo') },
    result
  ).then((v) => (v && v.content) || null).catch(() => null)
}

// planTuneFromIssues (Phase J, tune): derive the minimal gate-revisit plan from
// issues-and-improvements.md via the tunePlanner agent. Returns TUNE_PLAN_VERDICT (planGates,
// issueRefs, preserveStages) or null if the planner fails / no issues. Gate = planGates non-empty.
async function planTuneFromIssues({ planDir, task, result, stages }) {
  const issuesText = await readIssuesFile(planDir, result)
  if (!issuesText) {
    plogFromResult(result, 'tune: no issues-and-improvements.md — nothing to tune')
    return null
  }
  const stageSummary = stages && stages.length
    ? `Current stages (status): ${JSON.stringify(stages.map((s) => ({ id: s.id, name: s.name, status: s.status, files: s.files })))}`
    : 'No stages recorded.'
  const verdict = await safeAgent(
    `You are the tunePlanner agent. Read the issues-and-improvements.md below and the existing design
docs, then derive the MINIMAL gate-revisit plan: which design gates (requirements|architecture|design|
plan) must be re-run IN REFINE MODE to address the upstream issues. Order gates so earlier gates run
first (requirements -> architecture -> design -> plan). Do NOT include a gate unless at least one issue
maps to it. For each gate, cite the issue(s) it addresses (issueRefs). List completed stages that the
revisit should NOT invalidate (preserveStages — stages whose files are untouched by the revisions).

Task: ${task}
Plan dir: ${planDir}
${stageSummary}

Issues-and-improvements.md:
${issuesText}

Return the ordered planGates (subset of requirements|architecture|design|plan), issueRefs, and
preserveStages. Do NOT commit.`,
    { label: 'tunePlanner', phase: 'Tune', schema: TUNE_PLAN_VERDICT, model: gm('tunePlanner') },
    result
  )
  if (!verdict || !(verdict.planGates || []).length) {
    plogFromResult(result, 'tune: tunePlanner returned no gates — nothing to revisit')
    return null
  }
  return verdict
}

// invalidateStages (Phase J, tune): after a gate revisit, reset ONLY the stages whose files intersect
// the revised scope to 'pending'; stages in preserveStages (or file-disjoint) keep their 'done' status.
// Returns the count of reset stages. Mutates result.stages in place.
function invalidateStages(result, preserveStages, touchedFiles) {
  if (!result.stages || !result.stages.length) return 0
  const preserve = new Set(preserveStages || [])
  const touched = new Set((touchedFiles || []).map((f) => String(f)))
  let reset = 0
  for (const stage of result.stages) {
    if (stage.status !== 'done') continue
    if (preserve.has(stage.id)) continue
    const stageFiles = (stage.files || []).map((f) => String(f))
    if (touched.size && stageFiles.some((f) => touched.has(f))) {
      stage.status = 'pending'
      reset++
    }
  }
  return reset
}

// tuneRevisitGate (Phase J, tune): re-run ONE design gate in REFINE mode (the artifact already exists,
// so this revises it in place rather than rewriting from scratch). Maps a gate name to its
// {artifactPath, reviewerPrompt, reviserPrompt, reviewedFlag} so it reuses reviewLoop. Non-blocking
// gate: a null/fail-forward result does not block tune (the issue may be addressed well enough).
async function tuneRevisitGate({ gate, planDir, planPath, task, result, retryBudget, refineSubcap, spendRetry, useEnhancer, useQuickDecider, decisionCap }) {
  phase(gate)
  const GATE_MAP = {
    requirements: { path: result.requirementsPath, label: 'Requirements', artifactName: 'requirements' },
    architecture: { path: result.archPath, label: 'Arch Review', artifactName: 'architecture' },
    design: { path: result.designPath, label: 'Design Review', artifactName: 'detailed-design' },
    plan: { path: planPath, label: 'Plan Review', artifactName: 'plan' },
  }
  const entry = GATE_MAP[gate]
  if (!entry || !entry.path) {
    plogFromResult(result, `tune: gate ${gate} has no artifact path — skipping revisit`)
    return { gate, skipped: true }
  }
  plogFromResult(result, `tune: revisiting gate ${gate} in refine mode (${entry.path})`)
  const review = await reviewLoop({
    phaseLabel: entry.label,
    artifactPath: entry.path,
    artifactName: entry.artifactName,
    reviewerPrompt:
      `You are the critical-reviewer agent. This is a TUNE refine pass on the ${gate} artifact at ${entry.path}.
It was flagged by issues-and-improvements.md. Review it against the task definition at ${result.definitionPath} and the
issues below. Accept once the flagged upstream issues are addressed; do not block on implementer-discretion detail.
Task:\n${task}`,
    reviserPrompt: (rev) =>
      `You are the design-reviser agent. Address these tune findings on the ${gate} artifact at ${entry.path}. Close every
blocker + gap tied to the upstream issues. Write the revised artifact to ${entry.path} (in place).
Findings:\n${JSON.stringify({ blockers: (rev && rev.blockers) || [], gaps: (rev && rev.gaps) || [], findings: (rev && rev.findings) || [] }, null, 2)}`,
    reviewerModel: gm('reviewDesign'),
    reviserModel: gm('revise'),
    result, retryBudget, refineSubcap, spendRetry, planDir, useEnhancer, useQuickDecider, decisionCap,
  })
  // Mark the gate as re-reviewed so the review flag reflects the fresh pass.
  if (gate === 'requirements') result._reviewedRequirements = true
  else if (gate === 'architecture') result._reviewedArch = true
  else if (gate === 'design') result._reviewedDesign = true
  else if (gate === 'plan') result.planAccepted = true
  plogFromResult(result, `tune: gate ${gate} revisit ${review && review.accepted ? 'accepted' : 'fail-forward'} after ${review ? review.iterations : 0} iteration(s)`)
  return { gate, review }
}

// Gate 5.5: knowledge-persist (adopted agent). NON-BLOCKING: gathers the
// structured findings already in `result` and persists rules to CLAUDE.md +
// Serena memory. On any failure it sets result.persist without ever setting
// blockedAt — persisting is housekeeping, not a hard gate.
async function persistFindings(r) {
  if (!r) return
  try {
    const findings = {
      carriedBlockers: r.carriedBlockers || [],
      forceAccepted: !!r.forceAccepted,
      escalation: r._escalation,
      yagniWarnings: r.yagniWarnings || [],
      reconcileConflicts: (r.reconcile && r.reconcile.conflicts) || [],
      publishedPaths: (r.published && r.published.paths) || [],
      codeReview: r.codeReview,
      debug: r._debug,
      task: r.task,
    }
    const verdict = await agent(
      `You are the knowledge-persist agent. Persist the findings from this feature-pipeline run into
CLAUDE.md and Serena memory as durable rules/gotchas. Only persist genuinely reusable knowledge
(non-obvious gotchas, recurring rules, edge cases) — do NOT persist one-off task detail.

Findings (JSON):
${JSON.stringify(findings, null, 2)}

Read CLAUDE.md first; append rules, do not duplicate existing ones. Do NOT commit.`,
      { label: 'knowledge-persist', phase: 'Persist', schema: PERSIST_VERDICT, model: gm('persist') }
    )
    r.persist = verdict || { persisted: false }
  } catch (e) {
    r.persist = { persisted: false, summary: String(e) }
  }
}

// Gate 5.4: docs-architecture-publisher (adopted agent). NON-BLOCKING: publishes/organizes
// the plan + architecture design into project docs. Extracted so BOTH the implement-mode
// Publish gate AND the design-mode terminal gate can call it (design mode previously
// returned before this gate ran — F3). On any failure it sets result.published to an object
// and never sets blockedAt.
async function publishDesign(r, planPath, task) {
  if (!r) return
  try {
    const published = await agent(
      `You are the docs-architecture-publisher agent. Publish/organize the plan and architecture
design for this task into the project documentation. Source artifacts: plan at ${planPath},
architecture at ${r.archPath || '(none)'}, detailed design at ${r.designPath || '(none)'}.
Update the relevant docs (e.g. an architecture index / docs tree) so the design is discoverable.
Read mem:core and mem:conventions first. Do NOT commit; just write the docs.

Task:
${task || r.task || '(none)'}`,
      { label: 'docs-architecture-publisher', phase: 'Publish', schema: PUBLISH_VERDICT, model: gm('publish') }
    )
    r.published = published || { published: false, summary: 'publisher agent returned null' }
    plogFromResult(r, `Publish: published=${r.published.published}; paths=${(r.published.paths || []).length}`)
  } catch (e) {
    r.published = { published: false, summary: 'publish failed: ' + String(e) }
    plogFromResult(r, 'Publish: failed (non-blocking) — ' + String(e))
  }
}

// Run the pytest gate. Returns a TEST_VERDICT object (or null on agent failure).
async function runTests(testTarget) {
  const target = testTarget && testTarget.trim() ? testTarget.trim() : ''
  const pytestCmd = target ? `python -m pytest -v --tb=short ${target}` : 'python -m pytest -v --tb=short'
  log(`Running tests: ${pytestCmd}`)
  return agent(
    `You are the pytest-runner agent. Run this exact pytest command and report whether it passed:
${pytestCmd}
Report the exit status honestly (passed=true only on exit 0). Do NOT modify code or tests.`,
    { label: 'pytest-runner', phase: 'Test', schema: TEST_VERDICT, model: gm('test') }
  )
}

// agent() contract: returns null on user-skip or terminal API error. But a StructuredOutput
// retry-cap throw (TelemetrySafeError) escapes that contract and propagates uncaught — killing
// the workflow. safeAgent converts ANY throw into a null + log line so gate logic's existing
// null-handling (convergence gate, fail-forward) degrades gracefully instead of crashing.
// Use for the critical-path schema-gated calls whose throw would otherwise escape main().
async function safeAgent(prompt, opts, result) {
  try {
    return await agent(prompt, opts)
  } catch (e) {
    const msg = String(e && e.message ? e.message : e)
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (caught): ${msg}`)
    }
    log(`Agent "${opts && opts.label}" threw — converting to null (graceful degradation): ${msg}`)
    return null
  }
}

// Some non-standard providers fail to satisfy a forced-StructuredOutput schema with certain
// custom subagent types (e.g. task-definition-architect), even though the emitted JSON is
// syntactically valid. flexibleAgent tries the schema path first; on a schema-specific failure
// it falls back to a plain-text agent call with explicit JSON-only instructions and parses the
// response ourselves. This keeps the gate-enforcing pipeline intact on providers where forced
// tool-use is unreliable.
async function flexibleAgent(prompt, opts, result) {
  let out = null
  let schemaFailed = false
  let originalError = ''
  try {
    out = await agent(prompt, opts)
  } catch (e) {
    originalError = String(e && e.message ? e.message : e)
    schemaFailed = /StructuredOutput|schema|valid output/i.test(originalError)
    if (!schemaFailed) {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (caught): ${originalError}`)
      }
      log(`Agent "${opts && opts.label}" threw — converting to null (graceful degradation): ${originalError}`)
      return null
    }
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
    }
    log(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
  }
  if (out) {
    if (typeof out === 'object') return out
    const parsed = extractJson(out)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      }
      log(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      return parsed
    }
    // Not a valid object response — fall through to JSON-only retry.
  }

  const jsonPrompt = `${prompt}\n\nIMPORTANT: Return ONLY a single JSON object matching the expected structure. Do NOT include markdown fences, explanations, or prose. The JSON must be parseable by JSON.parse().`
  try {
    // Strip the schema property entirely so the fallback call is treated as plain text.
    const { schema: _unused, ...plainOpts } = opts
    const raw = await agent(jsonPrompt, plainOpts)
    const parsed = extractJson(raw)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      }
      log(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      return parsed
    }
  } catch (e2) {
    const msg2 = String(e2 && e2.message ? e2.message : e2)
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
    }
    log(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
  }
  return null
}

function extractJson(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  try { return JSON.parse(text) } catch (_) { /* continue */ }
  // Extract JSON from markdown fences (common failure mode).
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch (_) { /* continue */ }
  }
  // Extract first {...} block (greedy) and try to parse; if that fails, try last }.
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch (_) { /* continue */ }
  }
  return null
}

// Append a review verdict to <planDir>/review-history.md (Phase C2 persistence). Non-blocking.
// Writes one compact markdown section per iteration so resume + audit have the full review trail.
// Uses APPEND (never overwrite) so the history accumulates across iterations + gates.
async function appendReviewHistory(planDir, phaseLabel, iteration, verdict, acceptancePath) {
  const historyPath = planDir.replace(/\/$/, '') + '/review-history.md'
  const blockers = (verdict && verdict.blockers) || []
  const gaps = (verdict && verdict.gaps) || []
  const findings = (verdict && verdict.findings) || []
  const accepted = verdict && verdict.accepted
  const section = [
    `## ${phaseLabel} review — iteration ${iteration} — ${accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}${acceptancePath ? ` — acceptancePath: ${acceptancePath}` : ''}`,
    '',
    `**Blockers (${blockers.length}):**`,
    blockers.length ? blockers.map((b) => `- ${b}`).join('\n') : '- (none)',
    '',
    `**Gaps (${gaps.length}):**`,
    gaps.length ? gaps.map((g) => `- ${g}`).join('\n') : '- (none)',
    '',
    `**Findings (${findings.length}):**`,
    findings.length ? findings.map((f) => `- ${f}`).join('\n') : '- (none)',
    '',
    `Summary: ${(verdict && verdict.summary) || '(none)'}`,
    '',
    '---',
    '',
  ].join('\n')
  try {
    await agent(
      `You are a file-writer agent. APPEND the section below to the file at ${historyPath}.
Create the file (and parent dirs) if it does not exist. Do NOT overwrite existing content — append only.
Return ok=true after appending.

${section}`,
      { label: `review-history(${phaseLabel}#${iteration})`, phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
    )
  } catch (e) {
    log(`review-history append failed (${phaseLabel}#${iteration}): ${String(e)}`)
  }
}

// reviewLoop (Phase C2): DRY the Requirements/Architecture/Detailed-Design review gates.
// critical-reviewer reviews the artifact; if not accepted, design-reviser applies fixes; loop
// until accepted or the refine sub-cap. Mirrors the reconcile-loop pattern. Each verdict is
// appended to <planDir>/review-history.md. Returns {accepted, iterations, lastVerdict} or null
// on agent failure. null → caller treats as accepted-fail-forward (non-blocking for these gates).
async function reviewLoop({
  phaseLabel, artifactPath, artifactName, reviewerPrompt, reviserPrompt,
  reviewerModel, reviserModel, result, retryBudget, refineSubcap, spendRetry, planDir,
  useEnhancer = false, useQuickDecider = false, decisionCap = 0,
}) {
  // F2: a review without an artifact path would silently review the wrong (or no) doc.
  // Fail-forward instead of guessing.
  if (!artifactPath) {
    plogFromResult(result, `${phaseLabel}: no artifactPath — cannot review (fail-forward)`)
    return { accepted: true, iterations: 0, lastVerdict: null, failForward: true, acceptancePath: 'fail-forward (no-artifact)' }
  }
  let iterations = 0
  let lastVerdict = null
  while (iterations < refineSubcap && !budgetExhausted(retryBudget)) {
    // Phase E2: before the next iteration, ask quick-decider whether another pass is worth
    // spending budget on (fired only from the 2nd iteration onward so a clean one-shot accept
    // never pays the decision-agent tax). 'stop' bails to fail-forward; null -> stop (safe).
    if (useQuickDecider && iterations >= 1) {
      const decide = await runQuickDecider({
        result, planDir, model: gm('quickDecider'), decisionCap,
        opts: {
          loopName: phaseLabel,
          iterations,
          subcap: refineSubcap,
          retryBudget,
          lastFailure: `${phaseLabel} still not accepted after ${iterations} iteration(s). Outstanding blockers: ${JSON.stringify((lastVerdict && lastVerdict.blockers) || []).slice(0, 600)}; gaps: ${JSON.stringify((lastVerdict && lastVerdict.gaps) || []).slice(0, 400)}`,
        },
      })
      if (decide === 'stop') {
        plogFromResult(result, `${phaseLabel}: quick-decider said stop — bailing to fail-forward`)
        break
      }
    }
    iterations++
    spendRetry(1)
    phase(phaseLabel)
    const review = await safeAgent(
      reviewerPrompt,
      { label: `critical-reviewer(${artifactName})`, phase: phaseLabel, schema: DESIGN_REVIEW_VERDICT, model: reviewerModel },
      result
    )
    await appendReviewHistory(planDir, phaseLabel, iterations, review)
    if (!review) {
      // Reviewer agent failed — fail-forward (treat as accepted) so a flaky reviewer doesn't block.
      plogFromResult(result, `${phaseLabel}: reviewer returned null — fail-forward (accepted)`)
      await appendReviewHistory(planDir, phaseLabel, iterations, null, 'fail-forward (reviewer-null)')
      return { accepted: true, iterations, lastVerdict: null, failForward: true, acceptancePath: 'fail-forward (reviewer-null)' }
    }
    lastVerdict = review
    // F5: accept when accepted=true, no blockers, and no BLOCKING gaps. A gap flagged
    // non-blocking/deferred (object form) must NOT force the loop to sub-cap → fail-forward
    // (the prior behavior guaranteed non-acceptance on any gap, even explicitly-deferred ones).
    // String gaps are treated as blocking (conservative); object gaps honor nonBlocking/deferred.
    const allGaps = (review.gaps || [])
    const blockingGaps = allGaps.filter((g) => {
      if (!g || typeof g === 'string' || typeof g === 'number') return true
      return !g.nonBlocking && !g.deferred
    })
    const nonBlockingGaps = allGaps.length - blockingGaps.length
    if (review.accepted && !(review.blockers && review.blockers.length) && !blockingGaps.length) {
      const acceptTag = iterations === 1 ? 'clean' : `revised-${iterations}`
      plogFromResult(result, `${phaseLabel}: accepted after ${iterations} iteration(s)${nonBlockingGaps ? ` (${nonBlockingGaps} non-blocking gap(s) deferred)` : ''}`)
      await appendReviewHistory(planDir, phaseLabel, iterations, review, acceptTag)
      return { accepted: true, iterations, lastVerdict: review, acceptancePath: acceptTag }
    }
    plogFromResult(result, `${phaseLabel}: iteration ${iterations} not accepted — blockers=${(review.blockers || []).length}, blockingGaps=${blockingGaps.length}, nonBlockingGaps=${nonBlockingGaps}`)
    // Phase D1: on retries (iterations > 1), harden the reviser prompt so it applies reviewer feedback
    // more precisely (improve-design intent). Falls back to base prompt if enhancer disabled/failed.
    let revisePrompt = reviserPrompt(review)
    if (iterations > 1) {
      revisePrompt = await enhancePrompt({
        gateKey: `${phaseLabel}-revise`,
        basePrompt: revisePrompt,
        failureContext: `${phaseLabel} review iteration ${iterations}: prior revision did not satisfy the reviewer. Outstanding blockers: ${JSON.stringify(review.blockers).slice(0, 600)}; gaps: ${JSON.stringify(review.gaps).slice(0, 400)}`,
        intent: 'improve-design',
        result, planDir, useEnhancer,
      })
    }
    // Revise the artifact in place.
    const revise = await safeAgent(
      revisePrompt,
      { label: `design-reviser(${artifactName})`, phase: phaseLabel, schema: DESIGN_REVISE_VERDICT, model: reviserModel },
      result
    )
    if (!revise || !revise.artifactPath) {
      plogFromResult(result, `${phaseLabel}: reviser returned null — fail-forward (accepted)`)
      await appendReviewHistory(planDir, phaseLabel, iterations, review, 'fail-forward (reviser-null)')
      return { accepted: true, iterations, lastVerdict: review, failForward: true, acceptancePath: 'fail-forward (reviser-null)' }
    }
    plogFromResult(result, `${phaseLabel}: revised (${(revise.changesApplied || []).length} changes)`)
  }
  // Sub-cap exhausted without acceptance — fail-forward (non-terminal like the plan convergence gate).
  plogFromResult(result, `${phaseLabel}: sub-cap (${refineSubcap}) reached without acceptance — fail-forward`)
  await appendReviewHistory(planDir, phaseLabel, iterations, lastVerdict, 'fail-forward (sub-cap)')
  return { accepted: true, iterations, lastVerdict, failForward: true, acceptancePath: 'fail-forward (sub-cap)' }
}

// Tiny plog shim for module-level helpers that don't own `result`: push to logLines if present.
function plogFromResult(result, m) {
  log(m)
  if (result && Array.isArray(result.logLines)) result.logLines.push(m)
}

// enhancePrompt (Phase D1): calls prompt-enhancer to harden a base prompt for a retry attempt.
// failureContext describes what went wrong (so the enhancer knows HOW to harden); intent is the
// desired hardening (tighten-format | relax-review | improve-design | generic). Returns the
// hardened prompt string used for the RETRY ONLY. Caches per (gateKey) in result._enhancedPrompts
// (lazy map) and persists to <planDir>/enhanced-prompts.md. On enhancer failure / disabled, returns
// the original basePrompt unchanged (non-blocking). `useEnhancer` gates whether the agent runs.
async function enhancePrompt({ gateKey, basePrompt, failureContext, intent, result, planDir, useEnhancer }) {
  // Non-blocking short-circuit: disabled, or no result to cache into.
  if (!useEnhancer) return basePrompt
  if (!result) return basePrompt
  // Lazy-init the cache + persisted log path.
  if (!result._enhancedPrompts) {
    result._enhancedPrompts = {}
    result.enhancedPromptsPath = planDir.replace(/\/$/, '') + '/enhanced-prompts.md'
  }
  try {
    const enhanced = await agent(
      `You are the prompt-enhancer agent. Harden the following base prompt for a RETRY attempt. The prior
attempt failed for this reason:
${failureContext}

Desired hardening intent: ${intent}
(e.g. tighten-format => demand strict JSON, no markdown fences; relax-review => soften over-strict
reviewer after repeated rejections; improve-design => add specificity after reviewer feedback.)

Base prompt:
${basePrompt}

Return the FULL hardened prompt text (the downstream agent will receive it verbatim). Summarize the
changes you made. Do NOT commit.`,
      { label: `prompt-enhancer(${gateKey})`, phase: 'Enhance', schema: ENHANCER_VERDICT, model: gm('enhancer') }
    )
    if (enhanced && enhanced.enhancedPrompt) {
      result._enhancedPrompts[gateKey] = { intent, failureContext, enhancedPrompt: enhanced.enhancedPrompt, changes: enhanced.changes || [] }
      // Append the hardened prompt to the persisted log (non-blocking).
      const entry = [
        `## ${gateKey} — ${intent}`,
        '',
        `**Failure context:** ${failureContext}`,
        `**Changes:** ${(enhanced.changes || []).join('; ') || '(none)'}`,
        '',
        '```',
        enhanced.enhancedPrompt,
        '```',
        '',
        '---',
        '',
      ].join('\n')
      try {
        await agent(
          `You are a file-writer agent. APPEND the entry below to ${result.enhancedPromptsPath}.
Create the file if absent. Do NOT overwrite. Return ok=true.

${entry}`,
          { label: `enhanced-prompts(${gateKey})`, phase: 'Enhance', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
        )
      } catch (e) {
        log(`enhanced-prompts append failed (${gateKey}): ${String(e)}`)
      }
      plogFromResult(result, `Prompt enhanced for ${gateKey} (${intent}): ${(enhanced.changes || []).join('; ')}`)
      return enhanced.enhancedPrompt
    }
    plogFromResult(result, `Prompt enhancer returned null for ${gateKey} — using original prompt`)
  } catch (e) {
    plogFromResult(result, `Prompt enhancer threw for ${gateKey} — using original prompt: ${String(e)}`)
  }
  return basePrompt
}

// runQuickDecider (Phase E2): authoritative retry-or-stop verdict at a loop boundary.
// Called before a sub-cap increment to decide whether another iteration is worth the budget.
// Returns 'retry' | 'stop'. null (safeAgent failure) -> conservative 'stop'.
// `opts` carries the loop-specific context the decider needs (loopName, iterations, subcap,
// retryBudget, lastFailure). `result` needed for decisionCap accounting + plog.
async function runQuickDecider({ result, planDir, model, decisionCap, opts }) {
  if (!result) return 'stop'
  if (decisionBudgetExhausted(decisionCap)) {
    plogFromResult(result, `quick-decider: decision cap exhausted (${decisionState.used}/${decisionCap}) — stop (will hard-block)`)
    if (planDir) {
      await appendDecisionLog(planDir, `## Quick-decider (${opts.loopName}, iter ${opts.iterations})\nDecision: stop (cap exhausted ${decisionState.used}/${decisionCap})\n`, result)
    }
    return 'stop'
  }
  spendDecision(1)
  result.decisionUsed = decisionState.used
  const verdict = await safeAgent(
    `You are the quick-decider agent. A loop in feature-pipeline is at a retry boundary. Decide whether
another iteration is worth spending the global retry budget, or whether the loop should stop (escalate /
fail-forward / block, depending on the loop).

Loop: ${opts.loopName}
Iterations so far: ${opts.iterations}
Sub-cap: ${opts.subcap}
Global retry budget used: ${retryState.used}/${opts.retryBudget}
Last failure / reason the loop is still looping:
${opts.lastFailure}

Return decision='retry' only if you have concrete reason to believe another attempt will make progress
(a fixable failure, remaining budget, untried approach). Return 'stop' if the loop is spinning on an
unfixable problem, the failure is genuine (true defect), or further attempts would waste budget. Be decisive.`,
    { label: `quick-decider(${opts.loopName})`, phase: 'Decide', schema: QUICK_DECISION_SCHEMA, model },
    result
  )
  if (!verdict || !verdict.decision) {
    plogFromResult(result, `quick-decider(${opts.loopName}): returned null — conservative stop`)
    if (planDir) {
      await appendDecisionLog(planDir, `## Quick-decider (${opts.loopName}, iter ${opts.iterations})\nDecision: stop (decider returned null — conservative)\n`, result)
    }
    return 'stop'
  }
  plogFromResult(result, `quick-decider(${opts.loopName}): ${verdict.decision} — ${verdict.reasoning ? String(verdict.reasoning).slice(0, 200) : '(no reasoning)'}`)
  if (planDir) {
    await appendDecisionLog(
      planDir,
      `## Quick-decider (${opts.loopName}, iter ${opts.iterations})\nDecision: ${verdict.decision}\nReasoning: ${verdict.reasoning ? String(verdict.reasoning).slice(0, 300) : '(none)'}\n`,
      result,
    )
  }
  return verdict.decision === 'retry' ? 'retry' : 'stop'
}

// runGoalkeeper (Phase E3): complex-decision-analyst decides commit vs loop-back after final
// code-review. 'commit' proceeds; 'loop-back' + targetPhase sets result._loopBack so the E4
// do/while re-enters that phase and re-runs downstream. null -> conservative 'commit'.
async function runGoalkeeper({ result, planDir, model, decisionCap, pass, maxPasses }) {
  if (!result) return { decision: 'commit', targetPhase: 'none' }
  if (decisionBudgetExhausted(decisionCap)) {
    plogFromResult(result, `goalkeeper: decision cap exhausted (${decisionState.used}/${decisionCap}) — conservative commit`)
    return { decision: 'commit', targetPhase: 'none' }
  }
  spendDecision(1)
  result.decisionUsed = decisionState.used
  const verdict = await safeAgent(
    `You are the complex-decision-analyst acting as the COMMIT GOALKEEPER after final code-review in
feature-pipeline. The implementation passed code review with no blockers, but decide whether to COMMIT
now or LOOP BACK to an earlier phase because a genuine upstream defect remains.

Context:
Task: ${result.task}
Plan: ${result.planPath}
Architecture: ${result.archPath || '(none)'}
Detailed design: ${result.designPath || '(none)'}
Requirements: ${result.requirementsPath || '(none)'}
Code review: issues=${(result.codeReview && result.codeReview.issues) || 0}, blockers=${(result.codeReview && result.codeReview.blockers && result.codeReview.blockers.length) || 0}
Tests: ${result.testSummary || '(none)'}
Carried blockers (from force-accept): ${JSON.stringify(result.carriedBlockers || [])}
Goalkeeper pass: ${pass}/${maxPasses}

decision='commit' if the work is genuinely complete (green tests, clean review, requirements met).
decision='loop-back' ONLY if there is a concrete upstream defect — set targetPhase to the EARLIEST
phase that must be redone to fix it (requirements | architecture | design | plan | tests). Loop-back is
expensive (re-runs downstream gates); default to commit when in doubt. List trueDefects for any loop-back.`,
    { label: 'goalkeeper', phase: 'Goalkeeper', schema: GOALKEEPER_SCHEMA, model },
    result
  )
  if (!verdict || !verdict.decision) {
    plogFromResult(result, 'goalkeeper: returned null — conservative commit')
    return { decision: 'commit', targetPhase: 'none' }
  }
  result._goalkeeper = verdict
  plogFromResult(result, `goalkeeper: ${verdict.decision}${verdict.decision === 'loop-back' ? ' -> ' + verdict.targetPhase : ''} — ${verdict.reasoning ? String(verdict.reasoning).slice(0, 200) : '(no reasoning)'}`)
  return { decision: verdict.decision, targetPhase: verdict.targetPhase || 'none', trueDefects: verdict.trueDefects || [] }
}

// appendDecisionLog (Phase E3): APPEND-only decision log to <planDir>/decisions.md via file-writer.
// Non-blocking. Records each quick-decider + goalkeeper verdict for audit/resume evidence.
// F9: if `result` is passed, sets result.decisionsPath ONLY on a successful write — so the path
// is never advertised for a file that doesn't exist (design mode runs no goalkeeper/quick-decider).
async function appendDecisionLog(planDir, entry, result) {
  if (!planDir) return
  const path = planDir.replace(/\/$/, '') + '/decisions.md'
  try {
    await agent(
      `You are a file-writer agent. APPEND the markdown entry below to ${path}.
If the file does not exist, create it with a "# Decision Log" header first, then the entry.
Do NOT overwrite existing content. Entry to append:

${entry}`,
      { label: 'file-writer(decisions)', phase: 'Goalkeeper' }
    )
    if (result) result.decisionsPath = path
  } catch (e) {
    log('appendDecisionLog failed (non-blocking): ' + String(e))
  }
}

// writeOpenQuestions (F10 + I4): tracks every open question surfaced across the design gates
// (Define clarification, E2E, Requirements) into <planDir>/open-questions.md. Append-only and
// non-blocking. Each entry is {gate, id, text, severity, status:'open'} so review gates can later
// mark entries resolved. result.openQuestionsPath is set ONLY on a successful write (honest verdict).
async function writeOpenQuestions(planDir, entries, result) {
  if (!planDir) return
  if (!entries || !entries.length) return
  const path = planDir.replace(/\/$/, '') + '/open-questions.md'
  // Normalize heterogeneous sources (strings vs objects) into a stable record form.
  const records = entries.map((e, i) => {
    const isObj = e && typeof e === 'object'
    return {
      gate: (isObj && e.gate) || 'unknown',
      id: (isObj && e.id) || `OQ-${String(i + 1).padStart(2, '0')}`,
      text: (isObj && (e.text || e.question || e.message)) || String(e),
      severity: (isObj && e.severity) || 'unspecified',
      status: 'open',
    }
  })
  const body = records.map((r) => `- [${r.status.toUpperCase()}] [${r.gate}] ${r.id} (${r.severity}): ${r.text}`).join('\n')
  try {
    await agent(
      `You are a file-writer agent. APPEND the open-questions list below to ${path}.
If the file does not exist, create it with a "# Open Questions" header first, then the list.
Do NOT overwrite existing content — append only. List to append:

${body}`,
      { label: 'file-writer(open-questions)', phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
    )
    if (result) result.openQuestionsPath = path
    plogFromResult(result, `open-questions.md: appended ${records.length} entr${records.length === 1 ? 'y' : 'ies'} (${path})`)
  } catch (e) {
    log('writeOpenQuestions failed (non-blocking): ' + String(e))
  }
}

// writeFailedLaunch (F12): pre-`result` blocked returns (missing-task / resume-no-state) sit
// BEFORE main()'s safety-net try-block and BEFORE slug/planDir are derived, so they cannot reach
// consolidate(). Writing a breadcrumb here gives the user an audit trail for a silent no-op launch.
// Best-effort — the leaf comes from the resume path or 'fresh'; a failure never blocks.
async function writeFailedLaunch(leaf, blockedAt, reason, argsKeys) {
  const safeLeaf = String(leaf || 'fresh').replace(/[^\w.-]/g, '_').slice(0, 80)
  const dir = '.planning/todos/'
  const path = `${dir}_failed_launch_${safeLeaf}.md`
  const stamp = 'pre-result-exit'
  const body = `# Failed launch breadcrumb\n\n- blockedAt: ${blockedAt}\n- reason: ${reason}\n- argsKeys: ${argsKeys}\n- writtenAt: ${stamp}\n`
  try {
    await agent(
      `You are a file-writer agent. Write (overwrite) the markdown below to the file at ${path}.
Create the parent directory if it does not exist. Content:

${body}`,
      { label: 'file-writer(failed-launch)', phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') }
    )
  } catch (e) {
    log('writeFailedLaunch failed (non-blocking): ' + String(e))
  }
}

// clearGateAndDownstream (Phase E4): on a goalkeeper loop-back, clear the target gate's completion
// marker AND every downstream gate marker so the do/while re-runs them. Idempotent gate bodies then
// re-execute fresh. Maps a targetPhase to the ordered list of result flags to clear.
// Phase order (full path): requirements -> architecture -> design -> plan -> tests.
const LOOPBACK_FLAG_MAP = {
  requirements: ['requirementsPath', '_requirements', '_reviewedRequirements', 'archPath', '_arch', '_reviewedArch', 'designPath', '_design', '_reviewedDesign', 'planned', '_plan', 'tddEnforced', 'reconcile', '_reviewedPlan', 'planAccepted', 'forceAccepted', 'carriedBlockers', 'executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
  architecture: ['archPath', '_arch', '_reviewedArch', 'designPath', '_design', '_reviewedDesign', 'planned', '_plan', 'tddEnforced', 'reconcile', '_reviewedPlan', 'planAccepted', 'forceAccepted', 'carriedBlockers', 'executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
  design: ['designPath', '_design', '_reviewedDesign', 'planned', '_plan', 'tddEnforced', 'reconcile', '_reviewedPlan', 'planAccepted', 'forceAccepted', 'carriedBlockers', 'executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
  plan: ['planned', '_plan', 'tddEnforced', 'reconcile', '_reviewedPlan', 'planAccepted', 'forceAccepted', 'carriedBlockers', 'executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
  tests: ['testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
}
function clearGateAndDownstream(result, targetPhase) {
  if (!result) return
  const flags = LOOPBACK_FLAG_MAP[targetPhase] || []
  for (const flag of flags) {
    if (flag in result) {
      result[flag] = flag === 'carriedBlockers' ? [] : null
    }
  }
  result._loopBack = null
  // Reset post-execute state so re-run is faithful.
  result.ready = false
  if ('testsPassed' in result) result.testsPassed = false
}

// ---- Script body -----------------------------------------------------------

async function main() {
  // ARGS-TYPE GUARD: the harness/caller sometimes delivers `args` as a JSON STRING (seen in run
  // metadata wf_59811bec/wf_94675359: args recorded as a serialized string → args.task was
  // undefined on a String → engine hit the missing-task block, 0 agents, ~40ms). Coerce to an
  // object here so every downstream `args.X` read resolves regardless of how args arrived.
  // No-op when args is already an object (or null). Non-strict mode allows reassigning the
  // injected global. Wrap in try so malformed JSON degrades to {} (caught as missing-task below).
  if (args !== null && typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { log(`main: args arrived as unparseable string, coercing to {} (${String(e && e.message)})`); args = {} }
  } else if (args == null) {
    args = {}
  }

  // --resume <planDir>: hydrate persisted pipeline state and re-run linearly.
  // args.resume is the ORIGINAL RUN's planDir (e.g. docs/parser/feature/add-retry-layer).
  // When set, args.task is optional (resolved from the persisted state). Slug-only resume
  // is no longer supported — the path is the sole resume format.
  const resumeArg = args && args.resume

  // An explicit --plan is authoritative on fresh runs only. On resume the planDir comes
  // from args.resume itself; --plan is ignored on resume.
  let resumed = null
  let explicitPlanPath = (args && args.planPath) || null

  if (resumeArg) {
    // resumeArg is a planDir (or a plan.md path); normalize to a dir.
    const resumeDir = resumeArg.replace(/(^|\/)plan\.md$/, '$1').replace(/\/$/, '') + '/'
    const loaded = await loadPipelineState(resumeDir)
    resumed = loaded && loaded.state
    if (!resumed) {
      // No persisted state at the resume path. Return a clean blocked result instead of a raw
      // throw: this site sits BEFORE main()'s safety-net try-block, so a throw would escape as an
      // unrecoverable Workflow crash with no pipeline-state.json written. A blocked return keeps
      // the run recoverable and gives the caller an actionable handoff message.
      log(`main: --resume found no pipeline-state.json at ${resumeDir}; returning blocked result`)
      await writeFailedLaunch(resumeDir.replace(/[\/]+$/, '').split(/[\/]/).pop(), 'resume-no-state', `no pipeline-state.json at ${resumeDir}`, Object.keys(args || {}))
      const block = {
        task: '',
        mode: resolveMode(args, {}, false),
        planDir: resumeDir,
        ready: false,
        blockedAt: 'resume-no-state',
        handoff: {
          from: resolveMode(args, {}, false),
          message: `No pipeline-state.json at ${resumeDir} — cannot resume. Run /design-feature to start fresh.`,
          nextMode: 'design',
          planDir: resumeDir,
        },
        logLines: [`main: resume blocked — no pipeline-state.json at ${resumeDir}`],
      }
      return block
    }
    // The persisted planPath is authoritative on resume — we never re-categorize or
    // re-derive the dynamic planDir (the categorizer is non-deterministic).
    explicitPlanPath = resumed.planPath || (resumeDir + 'plan.md')
  }

  // task is required for a fresh run; on resume it is resolved from state.
  // `let` because the Define clarification fold (user-interviewer) appends
  // resolved answers to it so every downstream gate prompt sees them.
  let task = resumeArg ? (resumed && resumed.task) : (args && args.task)
  if (!task) {
    // Missing task on a fresh (non-resume) run. This site sits BEFORE main()'s safety-net
    // try-block (first try at the gate body), so a throw would escape as a raw, unrecoverable
    // Workflow crash — the exact failure seen in the TUI: `args.task is required at main`.
    // Return a clean blocked result instead so the caller gets an actionable handoff message
    // rather than a bare stack trace. Nothing to persist (no slug/planDir derivable without a
    // task), so we skip consolidate and just return.
    log('main: args.task missing on a fresh run; returning blocked result')
    await writeFailedLaunch('fresh', 'missing-task', 'args.task absent on fresh run', Object.keys(args || {}))
    return {
      task: '',
      mode: resolveMode(args, {}, false),
      ready: false,
      blockedAt: 'missing-task',
      handoff: {
        from: resolveMode(args, {}, false),
        message: 'No task description provided. Usage: /design-feature "<task>" or /feature-pipeline "<task>" (a /implement-feature or /tune-feature <planDir> resolves task from persisted state).',
        nextMode: 'design',
      },
      logLines: ['main: missing-task — args.task absent on fresh run'],
    }
  }

  // Slug: on resume it is read from the persisted state (never re-derived); fresh runs
  // derive it from the task. Persisted state.slug is the source of truth (L904).
  const slug = resumeArg ? (resumed && resumed.slug) || taskSlug(task) : taskSlug(task)

  // Single global retry budget — the only "stop" condition for loops. Per-loop
  // soft sub-caps keep one loop from monopolizing the whole budget.
  const retryBudget = (args && args.retryBudget) || RETRY_BUDGET_DEFAULT
  const refineSubcap = (args && args.maxRefineIterations) || REFINE_SUBCAP_DEFAULT
  const debugSubcap = (args && args.maxDebugRetries) || DEBUG_SUBCAP_DEFAULT
  const reconcileSubcap = (args && args.maxReconcileIterations) || RECONCILE_SUBCAP_DEFAULT
  const decisionCap = (args && args.decisionCap) || DECISION_CAP_DEFAULT
  const autoCommit = !!(args && args.autoCommit)
  const testTarget = (args && args.testTarget) || '' // empty => whole suite

  // GSD integration options.
  const gsdQuick = !!(args && args.gsdQuick) // force the gsd-quick fast-path
  const useGsdDebug = args && args.useGsdDebug === false ? false : true // default true

  // Resolve the full config ONCE so every consolidate() boundary (success + each
  // hard-block exit) can flush pipeline-state.json with the run's flag set. On
  // --resume the persisted config is the base; an explicit disabling arg still
  // wins, otherwise the persisted value (if any) is honored.
  const persistedConfig = resumed && resumed.config ? resumed.config : {}
  const cfgFlag = (argVal, persistedVal, defaultVal) =>
    argVal === false ? false : (persistedVal !== undefined ? persistedVal : defaultVal)
  const config = {
    useTranslator: cfgFlag(args && args.useTranslator, persistedConfig.useTranslator, true),
    useCategorizer: cfgFlag(args && args.useCategorizer, persistedConfig.useCategorizer, true),
    useEnhancer: cfgFlag(args && args.useEnhancer, persistedConfig.useEnhancer, true),
    useExplorer: cfgFlag(args && args.useExplorer, persistedConfig.useExplorer, true),
    useRequirements: cfgFlag(args && args.useRequirements, persistedConfig.useRequirements, true),
    useArchDesign: cfgFlag(args && args.useArchDesign, persistedConfig.useArchDesign, true),
    useDetailedDesign: cfgFlag(args && args.useDetailedDesign, persistedConfig.useDetailedDesign, true),
    useTddEnforce: cfgFlag(args && args.useTddEnforce, persistedConfig.useTddEnforce, true),
    useKnowledgePersist: cfgFlag(args && args.useKnowledgePersist, persistedConfig.useKnowledgePersist, true),
    useE2eUsecase: cfgFlag(args && args.useE2eUsecase, persistedConfig.useE2eUsecase, true),
    useKnowledgeConsult: cfgFlag(args && args.useKnowledgeConsult, persistedConfig.useKnowledgeConsult, true),
    useReconcile: cfgFlag(args && args.useReconcile, persistedConfig.useReconcile, true),
    usePublish: cfgFlag(args && args.usePublish, persistedConfig.usePublish, true),
    useInterview: cfgFlag(args && args.useInterview, persistedConfig.useInterview, true),
    useGoalkeeper: cfgFlag(args && args.useGoalkeeper, persistedConfig.useGoalkeeper, true),
    useQuickDecider: cfgFlag(args && args.useQuickDecider, persistedConfig.useQuickDecider, true),
    decisionCap: decisionCap,
    allowParallelExecute: cfgFlag(args && args.allowParallelExecute, persistedConfig.allowParallelExecute, true),
    gsdQuick,
    useGsdDebug,
    retryBudget,
    refineSubcap,
    reconcileSubcap,
    debugSubcap,
    autoCommit,
    testTarget,
    // Phase F-K: pipeline-split modes. ONE engine, 3 invocations:
    //   design   = THINK gates only (define ... review/refine); stops pre-execute.
    //   implement = DO gates (execute stages ... commit); upstream defect -> issues file + stop.
    //   tune     = FIX gates (revisit only issue-mapped design gates in refine mode; preserve done stages).
    // Default 'design' preserves backward-compat (a bare /feature-pipeline with no mode = design).
    mode: resolveMode(args, persistedConfig, resumed),
    // Phase H: plan-chunker (design tail). --no-chunker collapses to a single implicit stage.
    useChunker: cfgFlag(args && args.useChunker, persistedConfig.useChunker, true),
    // Phase I: issues-and-improvements.md handoff (implement -> tune). --no-issues = hard-block instead.
    useIssues: cfgFlag(args && args.useIssues, persistedConfig.useIssues, true),
    // Phase J: tune AskUserQuestion confirmation. --no-confirm runs the derived plan directly.
    useTuneConfirm: cfgFlag(args && args.useTuneConfirm, persistedConfig.useTuneConfirm, true),
  }

  // R4 adopted-agent gates (full path only; default ON, disable via flags).
  // Gate-control flags are read from the merged `config` (not raw args) so that
  // --resume honors a gate disabled in the original run: an explicit disabling
  // arg wins, else the persisted value, else the default. All adopted agents are
  // mandated by project CLAUDE.md, so they run unless explicitly disabled.
  const useArchDesign = config.useArchDesign
  const useTranslator = config.useTranslator
  const useCategorizer = config.useCategorizer
  const useEnhancer = config.useEnhancer
  const useExplorer = config.useExplorer
  const useRequirements = config.useRequirements
  const useDetailedDesign = config.useDetailedDesign
  const useTddEnforce = config.useTddEnforce
  const useKnowledgePersist = config.useKnowledgePersist
  const useE2eUsecase = config.useE2eUsecase
  const useKnowledgeConsult = config.useKnowledgeConsult
  const useReconcile = config.useReconcile
  const usePublish = config.usePublish
  const useInterview = config.useInterview
  const useGoalkeeper = config.useGoalkeeper
  const useQuickDecider = config.useQuickDecider
  const allowParallelExecute = config.allowParallelExecute
  // Phase F-K: pipeline-split modes + their sub-flags.
  const mode = config.mode
  const useChunker = config.useChunker
  const useIssues = config.useIssues
  const useTuneConfirm = config.useTuneConfirm
  const isDesignMode = mode === 'design'
  const isImplementMode = mode === 'implement'
  const isTuneMode = mode === 'tune'

  // Dynamic planDir (Phase B1). Cases:
  //  - Explicit --plan (fresh OR resume): used verbatim (escapes categorization).
  //  - Resume without --plan: impossible (guarded above — throws).
  //  - Resume with --plan: explicitPlanPath is the persisted dir; we reuse it.
  //  - Fresh run, no --plan: feature-categorizer → docs/{cat}/{sub}/feature/{leaf}/.
  // {leaf} = JIRA id from task text, else args.timestamp, else slug. The categorizer
  // is NOT re-run on resume (non-deterministic); persisted artifacts stay coherent.
  // NOTE: uses plain log() here — plog/result are not yet initialized.
  let categorization = null
  let planPath
  if (explicitPlanPath) {
    planPath = explicitPlanPath
  } else {
    // Fresh run with no explicit --plan → derive dynamically.
    const leafId = jiraIdFromTask(task) || ((args && args.timestamp) ? args.timestamp : slug)
    if (useCategorizer) {
      phase('Categorize')
      log('Categorizing feature for dynamic planDir')
      const cat = await safeAgent(
        `You are the feature-categorizer agent. Categorize the following feature/task into the project taxonomy. Return a category (top-level module/global area), a subCategory (component/sub-area), and a leaf (a short summary name for THIS specific feature).

Each of category, subCategory, and leaf MUST be a short kebab-case phrase of 1-3 words (≤24 chars total), derived by SUMMARIZING the task. Do NOT copy, quote, or truncate the task text — produce concise, recognizable names. Prefer recognized module/component names over descriptive phrases.

Task:
${task}

Return ONLY category + subCategory + leaf (all required). Do NOT commit.`,
        { label: 'feature-categorizer', phase: 'Categorize', schema: CATEGORY_VERDICT, model: gm('categorizer') },
        null
      )
      if (cat && cat.category && cat.subCategory) {
        categorization = cat
        const catSeg = categorizeSlug(cat.category)
        const subSeg = categorizeSlug(cat.subCategory)
        const leafSeg = categorizeSlug(cat.leaf)
        // FX-11: leafId prefers the summarized categorizer `leaf` so the path's final segment
        // is a short name, not a raw task-text substring from taskSlug().
        const shortLeaf = cat.leaf && leafSeg !== 'misc'
          ? leafSeg
          : (jiraIdFromTask(task) || ((args && args.timestamp) ? args.timestamp : slug))
        planPath = `docs/${catSeg}/${subSeg}/feature/${shortLeaf}/plan.md`
        log(`Categorized → ${catSeg}/${subSeg}/${shortLeaf}; planDir = ${planPath.replace(/plan\.md$/, '')}`)
      } else {
        planPath = `docs/uncategorized/feature/${leafId}/plan.md`
        log('Categorizer unavailable (null) — falling back to docs/uncategorized/feature/<leaf>/')
      }
    } else {
      planPath = `docs/uncategorized/feature/${leafId}/plan.md`
      log('Categorizer disabled (--no-categorizer) — using docs/uncategorized/feature/<leaf>/')
    }
  }
  const definitionPath = (args && args.definitionPath) ||
    planPath.replace(/plan\.md$/, 'idea.md')
  const planDir = planPath.replace(/plan\.md$/, '')
  const archPath = planDir + 'architecture.md'
  const designPath = planDir + 'detailed-design.md'

  let result
  // plog: narrate to the workflow progress tree AND append to the in-memory
  // pipeline log. A closure over `result` — defined before result is hydrated
  // but only ever called after, so the binding is live by then. (Module-level
  // helpers like runTests keep plain log() — they don't own result.)
  const plog = (m) => {
    log(m)
    if (result && Array.isArray(result.logLines)) result.logLines.push(m)
  }

  if (resumed && resumed.result) {
    // Hydrate the full result (deep copy) so resumed-run progress continues.
    result = JSON.parse(JSON.stringify(resumed.result))
    // Carry over logLines verbatim (already part of result) so the log continues.
    // Fresh state cursor (don't carry over the prior seq counter).
    result._state = { seq: 0, lastGate: null, status: null }
    // planDir/planPath reflect the --plan used for this resume (authoritative),
    // never re-categorized. Keep the freshly-derived values in sync with state.
    result.planPath = planPath
    result.planDir = planDir
    // A prior block is re-evaluated by the gate that's re-entered; clear it so a
    // now-passing gate doesn't report a stale block in the final result.
    result.blockedAt = null
    // Reset the global retry budget so the resumed run gets a fresh allocation.
    retryState.used = 0
    // Phase F-K: stamp the resolved mode onto the hydrated result. The resolved mode
    // (explicit arg > persisted > default) reflects THIS invocation, so design->implement
    // or implement->tune transitions are visible on the result the gates read.
    result.mode = mode
    // Backfill new fields on pre-split state (old pipeline-state.json lacks them).
    if (!result.stages) result.stages = []
    if (result.designReady === undefined) result.designReady = false
    if (result.issuesPath === undefined) result.issuesPath = null
    if (result.tunePlan === undefined) result.tunePlan = null
    if (result.handoff === undefined) result.handoff = null
    if (!result.logLines) result.logLines = []
    plog(`--resume: hydrated state for slug "${slug}" (mode=${mode}, priorLastGate=${(resumed.result._state && resumed.result._state.lastGate) || 'none'})`)
  } else {
    result = {
      task,
      slug,
      planPath,
      planDir,
      _categorization: categorization,
      definitionPath: null,
      _translator: null,
      translatePath: null,
      _enhancedPrompts: null, // Phase D1: lazy map gateKey -> hardenedPrompt
      enhancedPromptsPath: null,
      factsPath: null, // Phase D2: <planDir>/codebase-facts.md
      _facts: null, // Phase D2: code-explorer verdict
      _goalkeeper: null, // Phase E3: complex-decision-analyst verdict
      decisionsPath: null, // Phase E3: <planDir>/decisions.md
      _loopBack: null, // Phase E4: loop-back directive {targetPhase} set by goalkeeper; cleared after re-entry
      decisionUsed: 0, // Phase E1: spent from decisionCap
      requirementsPath: null,
      _requirements: null,
      _reviewedRequirements: false,
      _reviewedRequirementsForced: false, // F6: fail-forward marker — resume re-runs the review
      _reviewedArch: false,
      _reviewedArchForced: false, // F6
      _reviewedDesign: false,
      _reviewedDesignForced: false, // F6
      archPath: null,
      designPath: null,
      _knowledge: null,
      useCasePath: null,
      openQuestionsPath: null, // F10/I4: <planDir>/open-questions.md tracked artifact
      reconcile: null,
      published: null,
      recommendedPath: null,
      tddEnforced: false,
      yagniWarnings: [],
      designWarnings: [], // I14: design-mode artifact assertions (non-blocking)
      lanes: null,
      lanesUsed: 0,
      needsClarification: false,
      interview: null,
      planned: false,
      planAccepted: false,
      forceAccepted: false,
      carriedBlockers: [],
      refineIterations: 0,
      retryUsed: 0,
      executed: false,
      gsdQuick: false,
      debugRetries: 0,
      testsPassed: false,
      testSummary: null,
      codeReview: null,
      persist: null,
      ready: false,
      committed: false,
      commitHash: null,
      blockedAt: null,
      logLines: [], // R5: in-memory pipeline log; flushed to <planDir>/pipeline.log at consolidate points
      // Phase F-K (pipeline split): the 3-mode shared contract. All optional/default so
      // pre-split pipeline-state.json hydrates without breakage (backward-compat).
      mode: mode, // design | implement | tune — which pipeline wrote this result
      stages: [], // design-tail chunker output: [{id,file,name,status,files}]; implement ticks status
      designReady: false, // design sets true on exit; implement asserts it; tune re-sets after revisit
      issuesPath: null, // implement sets on upstream-defect handoff; tune consumes
      tunePlan: null, // tune: derived minimal gate-revisit plan (TUNE_PLAN_VERDICT)
      handoff: null, // handoff directive shown to user at mode boundaries (design->implement, implement->tune)
    }
  }

  // stateCheckpoint: advance the in-memory state cursor. Mirrors plog (no file
  // write here — flush happens once at consolidate boundaries). seq is a
  // monotonic stand-in for timestamps (workflow scripts forbid Date/Math.random).
  const stateCheckpoint = (gate, status) => {
    if (!result._state) result._state = { seq: 0, lastGate: null, status: null }
    result._state.seq = (result._state.seq || 0) + 1
    result._state.lastGate = gate
    result._state.status = status
  }

  // gateDone: resume self-skip helper. Returns true (and logs) if the gate's
  // completion flag is already set, so the gate body can skip its agent call.
  const gateDone = (flag) => { if (result[flag]) { plog(`resume: skip gate (${flag} set)`); return true } return false }

  // Safety net: wrap the entire pipeline body so ANY throw escaping a gate (beyond safeAgent's
  // coverage — e.g. a throw in non-agent code, or a future gate without the wrapper) still
  // persists pipeline-state.json and returns a blocked, resumable result instead of crashing the
  // Workflow tool. Early `return result` statements below remain valid inside try.
  try {
    // ===== Phase J: tune-mode targeted-gate branch =============================
    // Tune mode is a FIX flow: it does NOT re-run the full THINK chain or the DO chain. It reads
    // <planDir>/issues-and-improvements.md (written by implement on an upstream defect), derives a
    // MINIMAL gate-revisit plan, confirms it (AskUserQuestion, skippable via --no-confirm), re-runs
    // only those gates in REFINE mode (artifacts revised in place, not rewritten), re-reconciles the
    // touched docs, invalidates only the stages whose files intersect the revisions (preserving done
    // stages), then re-sets designReady=true and stops — telling the user to re-run implement.
    // Tune requires issues-and-improvements.md to exist (else block: run /implement-feature first).
    if (isTuneMode) {
      phase('Tune')
      plog('Tune mode: deriving minimal gate-revisit plan from issues-and-improvements.md')
      const tunePlan = result.tunePlan || await planTuneFromIssues({ planDir, task, result, stages: result.stages })
      if (!tunePlan) {
        result.blockedAt = 'tune-no-issues'
        result.handoff = {
          from: 'tune',
          message: `Nothing to tune — no issues-and-improvements.md at ${planDir} (or no gates derived). Run /implement-feature ${planDir} first to surface upstream defects.`,
          nextMode: 'implement',
          planDir,
        }
        plog('Tune: no issues / no gates — blocking (run /implement-feature first)')
        stateCheckpoint('Tune', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result.tunePlan = tunePlan
      const gatesList = (tunePlan.planGates || []).join(', ')
      plog(`Tune: derived plan — gates=[${gatesList}]; preserveStages=${(tunePlan.preserveStages || []).join(', ')}`)

      // Confirm the derived plan with the user (AskUserQuestion), unless disabled or already confirmed.
      // useTuneConfirm default ON (--no-confirm runs directly). On resume with result.tuneConfirmed we
      // skip re-confirming.
      if (useTuneConfirm && !result.tuneConfirmed) {
        const confirmed = await agent(
          `You are the tune-confirmation agent. Confirm the following tune gate-revisit plan with the user
via AskUserQuestion. Present the derived gates + preserved stages; offer to run as-is, edit (the user
replies with a corrected gate set), or cancel.

Derived gates to revisit (in order): ${gatesList}
Issue refs: ${(tunePlan.issueRefs || []).join('; ') || '(none)'}
Stages preserved (not invalidated): ${(tunePlan.preserveStages || []).join(', ') || '(none)'}
Plan dir: ${planDir}

If the user approves (as-is or edited), set confirmed=true and record the FINAL gate list in finalGates
(defaults to the derived planGates if approved as-is). If cancelled, set confirmed=false.`,
          { label: 'tune-confirm', phase: 'Tune', schema: {
            type: 'object', additionalProperties: false,
            required: ['confirmed'],
            properties: {
              confirmed: { type: 'boolean', description: 'true if the user approved the revisit plan' },
              finalGates: { type: 'array', items: { type: 'string', enum: ['requirements', 'architecture', 'design', 'plan'] }, description: 'final approved gate list (may differ from derived)' },
            },
          }, model: gm('quickDecider') }
        )
        if (!confirmed || !confirmed.confirmed) {
          result.blockedAt = 'tune-cancelled'
          result.handoff = {
            from: 'tune',
            message: 'Tune cancelled by user. Re-run /tune-feature <planDir> when ready.',
            nextMode: 'tune',
            planDir,
          }
          plog('Tune: user cancelled the revisit plan — stopping')
          stateCheckpoint('Tune', 'cancelled')
          await consolidate(slug, result, config)
          return result
        }
        if (confirmed.finalGates && confirmed.finalGates.length) tunePlan.planGates = confirmed.finalGates
        result.tuneConfirmed = true
        plog(`Tune: plan confirmed — gates=[${(tunePlan.planGates || []).join(', ')}]`)
      }

      // Revisit each gate in refine mode (ordered: requirements -> architecture -> design -> plan).
      const ORDER = ['requirements', 'architecture', 'design', 'plan']
      const ordered = (tunePlan.planGates || []).slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
      const touchedFiles = []
      for (const gate of ordered) {
        const revisit = await tuneRevisitGate({
          gate, planDir, planPath, task, result, retryBudget, refineSubcap,
          spendRetry, useEnhancer, useQuickDecider, decisionCap,
        })
        // Collect touched files from the revisited artifact's scope (best-effort: the gate's stage files).
        if (!revisit.skipped) {
          const scopeFiles = gate === 'plan'
            ? (result.lanes || []).flatMap((l) => l.files || [])
            : []
          touchedFiles.push(...scopeFiles)
        }
      }

      // Re-reconcile the plan against the revisited design docs (Gate 1.7 style) so plan<->design
      // stay consistent after the tune edits. Non-blocking — a conflict is information, not a hard error.
      if (result.requirementsPath || result.archPath || result.designPath) {
        phase('Reconcile')
        plog('Tune: re-reconciling plan against revisited design docs')
        const reconcile = await safeAgent(
          `You are the design-plan-reconciler agent. After a TUNE pass, re-compare the plan at ${planPath}
against the (possibly revised) artifacts: requirements at ${result.requirementsPath || '(none)'}, architecture
at ${result.archPath || '(none)'}, detailed design at ${result.designPath || '(none)'}. Flag any NEW
inconsistencies the tune revisions introduced; if the plan can be aligned, update it in place.
Task:\n${task}`,
          { label: 'design-plan-reconciler(tune)', phase: 'Reconcile', schema: RECONCILE_VERDICT, model: gm('reconcile') },
          result
        )
        result.reconcile = reconcile || result.reconcile
        plog(`Tune: reconcile consistent=${result.reconcile.consistent}; conflicts=${(result.reconcile.conflicts || []).length}`)
      }

      // Invalidate only the stages whose files intersect the revisions (preserve the rest).
      const resetCount = invalidateStages(result, tunePlan.preserveStages, touchedFiles)
      plog(`Tune: invalidated ${resetCount} stage(s) (file-intersection rule); preserved rest`)

      // Re-enable designReady so implement can resume (re-running only invalidated stages).
      result.designReady = true
      result.handoff = {
        from: 'tune',
        message: `Docs tuned. Revisited gates=[${ordered.join(', ')}]; ${resetCount} stage(s) reset. Re-run: /implement-feature ${planDir}`,
        nextMode: 'implement',
        planDir,
        revisitedGates: ordered,
        stagesReset: resetCount,
      }
      stateCheckpoint('Tune', 'done')
      plog(`Tune: complete — designReady re-set; ${resetCount} stage(s) reset`)
      await consolidate(slug, result, config)
      return result
    }

    // Gate -1: Prompt Translator ---------------------------------------------
    // Detect non-English task input and translate it to English before Define so every
    // downstream agent prompt (and the persisted idea doc) is English. Skips when the
    // task is already English, when disabled, or once run (result._translator set, so
    // --resume never re-translates). Non-blocking: a translator failure leaves the
    // original task text in place (Define proceeds with whatever it gets).
    if (!result._translator && useTranslator) {
      const langCheck = detectNonEnglish(task)
      if (!langCheck.isEnglish) {
        phase('Translate')
        plog(`Non-English task detected (non-ASCII letter ratio=${langCheck.ratio.toFixed(2)}) — translating to English`)
        const translatePath = planDir + 'translation.md'
        const translated = await safeAgent(
          `You are the prompt-translator agent. The task description below contains non-English text.
Translate it to clear English. Preserve all technical terms, identifiers, file paths, code, commands,
and formatting exactly. Write a short translation log to ${translatePath} (original language detected +
the translated text) so the run keeps an audit trail. Do NOT add or remove requirements.

Task:
${task}`,
          { label: 'prompt-translator', phase: 'Translate', schema: TRANSLATOR_VERDICT, model: gm('translator') },
          result
        )
        if (translated && translated.translated && translated.task) {
          task = translated.task
          result.task = task
          result._translator = translated
          result.translatePath = translated.translatePath || translatePath
          plog(`Translated task to English from ${translated.originalLang} (log: ${result.translatePath})`)
        } else {
          plog('Translation unavailable (agent returned null) — proceeding with original task text')
        }
        stateCheckpoint('Translate', 'done')
      } else {
        plog('Task input is English — translator skipped')
        result._translator = { translated: false, originalLang: 'en', task: task }
      }
    }

    // ===== Phase E4: state-machine loop =========================================
    // The full-path section (Define -> Code Review -> Goalkeeper) runs inside a do/while driven by
    // result._loopBack. The goalkeeper can request a loop-back to an earlier phase; on loop-back it
    // already cleared that gate's completion marker + every downstream marker (clearGateAndDownstream),
    // so the idempotent gate bodies re-execute fresh on the next iteration. The loop exits when the
    // goalkeeper commits (result._loopBack cleared) or the decision cap is exhausted (hard-block).
    // First iteration (fresh/resume): result._loopBack is null, loop runs once.
    let _e4LoopGuard = 0
    do {
      _e4LoopGuard++
      if (_e4LoopGuard > 1) plog(`Phase E4: re-running full path (loop-back pass ${_e4LoopGuard})`)

    // Gate 0: Define ---------------------------------------------------------
    phase('Define')
  let definition = result._define || null
  if (result.definitionPath && !result.needsClarification) {
    plog('resume: skip Define (definitionPath set)')
  } else {
    plog('Producing task definition')
    definition = await flexibleAgent(
      `You are the task-definition-architect agent. Turn this raw task sketch into a rigorous
task definition and write it to ${definitionPath}.

Task sketch:
${task}

Define objective pass gates, NFRs, and TDD scenarios. Resolve non-blocking
ambiguities with explicit assumptions. Only set needsClarification=true if a
critical ambiguity would fork the whole approach and must be answered by the
user. Recommend gsd-quick as the path only if the task is genuinely simple
(small, single-area, low-risk); otherwise recommend full.`,
      { label: 'task-definition-architect', phase: 'Define', schema: DEFINE_VERDICT, model: gm('define') },
      result
    )
    // Some providers return a structurally-different JSON envelope when forced
    // StructuredOutput is unavailable. Normalize a nested { definition, path,
    // recommendation } envelope into the expected DEFINE_VERDICT shape so the
    // gate can proceed without losing the content the agent already wrote.
    if (definition && !definition.definitionPath) {
      const nested = definition.definition || {}
      if (definition.path || definition.recommendation || nested.objective || nested.success_criteria) {
        plog('Define: normalizing alternative task-definition response envelope')
        definition.definitionPath = definitionPath
        definition.needsClarification = !!definition.needsClarification
        definition.openQuestions = definition.openQuestions || []
        definition.recommendedPath = definition.path || 'full'
        definition.assumptions = Array.isArray(nested.assumptions)
          ? nested.assumptions.map(a => a && a.text ? a.text : String(a))
          : []
        definition.passGates = Array.isArray(nested.success_criteria) ? nested.success_criteria : []
        definition.summary = nested.objective || definition.recommendation || '(no summary)'
      }
    }
    if (!definition || !definition.definitionPath) {
      result.blockedAt = 'define'
      stateCheckpoint('Define', 'blocked')
      await consolidate(slug, result, config)
      return result
    }
    result.definitionPath = definition.definitionPath
    result.needsClarification = !!definition.needsClarification
    result.recommendedPath = definition.recommendedPath || 'full'
    result._define = definition
    if (result.needsClarification) {
      result.openQuestions = definition.openQuestions || []
      // Gate 0 clarification: try to resolve open questions via the
      // user-interviewer agent (interactive — uses AskUserQuestion). If it
      // resolves all questions, fold the answers into `task` and continue the
      // pipeline instead of stopping. If interviewer is disabled or cannot
      // resolve, fall back to surfacing the questions and stopping.
      if (useInterview && !result.interview) {
        plog('Define: needsClarification=true — invoking user-interviewer to resolve open questions')
        try {
          const interview = await flexibleAgent(
            `You are the user-interviewer agent. The task-definition-architect flagged these open
questions that block proceeding. Interview the user to gather structured answers for each.

Task: ${result.task}
Open questions:
${(result.openQuestions || []).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Use AskUserQuestion (or AskUser if available) to get the user's answers. Do NOT guess — if the user
cannot answer a question, mark resolved=false. Return the gathered {question, answer} pairs.`,
            { label: 'user-interviewer', phase: 'Define', schema: INTERVIEW_VERDICT, model: gm('interview') },
            result
          )
          result.interview = interview || { asked: false, resolved: false, summary: 'interviewer returned null' }
          if (interview && interview.resolved && (interview.answers || []).length) {
            // Fold answers into BOTH result.task (persisted/log) and the live
            // `task` var — downstream gate prompts (Architecture, Design, Plan,
            // etc.) interpolate ${task}, so the resolved answers must reach it.
            const folded = interview.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n')
            task = `${task}\n\nResolved clarifications:\n${folded}`
            result.task = task
            result.needsClarification = false
            plog(`Define: user-interviewer resolved ${interview.answers.length} question(s) — continuing`)
          } else {
            plog('Define: user-interviewer could not resolve all questions — surfacing to user')
          }
        } catch (e) {
          result.interview = { asked: false, resolved: false, summary: 'interview failed: ' + String(e) }
          plog('Define: user-interviewer failed — surfacing open questions')
        }
      }
      if (result.needsClarification) {
        plog('Define: needsClarification=true — stopping to surface open questions')
        stateCheckpoint('Define', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
    }
    plog(`Define: definition written to ${definition.definitionPath}; recommendedPath=${definition.recommendedPath || 'full'}`)
  }
  stateCheckpoint('Define', 'done')

  // Decide execution path: explicit gsdQuick arg wins, else honor the define
  // recommendation persisted on result (so resume routes the same way).
  // Phase F-K: gsd-quick is an ALTERNATE EXECUTOR, so it belongs to implement mode only.
  // In design/tune mode the fast-path is suppressed (design stops pre-execute; tune never
  // executes). A define recommendation of gsd-quick is remembered on result so implement
  // mode (which runs later via /implement-feature) can still take it.
  const useQuickPath = isImplementMode && (gsdQuick || result.recommendedPath === 'gsd-quick')

  if (useQuickPath) {
    // --- gsd-quick fast-path (alternate executor; our gates stay authoritative) ---
    result.gsdQuick = true
    result.planAccepted = true // gsd-quick authors its own plan internally
    if (result.executed) {
      plog('resume: skip gsd-quick fast-path (executed set)')
    } else {
      phase('Execute')
      plog('gsd-quick fast-path: implementing via gsd-quick skill')
      const gsdRun = await agent(
        `You are running inside feature-pipeline. Invoke the "gsd-quick" skill via your Skill tool
to implement this task end-to-end (plan + execute + test):

Task:
${task}

Definition doc: ${definition.definitionPath}
Plan dir: ${planPath.replace(/plan\.md$/, '')}

Adhere to the pass gates in the definition doc. Do NOT commit. Do NOT weaken tests.
If the gsd-quick skill or the Skill tool is unavailable, implement directly following
the definition pass gates and set usedFallback=true. Report what was implemented and the
test outcome you observed.`,
        { label: 'gsd-quick', phase: 'Execute', schema: GSD_RUN_VERDICT, model: gm('gsdQuick') }
      )
      if (!gsdRun || !gsdRun.ran) {
        result.blockedAt = 'gsd-quick'
        stateCheckpoint('Execute', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result.executed = true
      result._gsdRun = gsdRun
      plog(`gsd-quick: ran=${gsdRun.ran}; summary=${gsdRun.summary || '(none)'}${gsdRun.usedFallback ? ' (used fallback)' : ''}`)
    }
    stateCheckpoint('Execute', result.executed ? 'done' : 'blocked')

    // Fall through to our own Test (Gate 4), Code Review (Gate 5), Persist (5.5).
  } else {
    // --- Full path: Knowledge -> Architecture -> Detailed Design -> E2E -> Plan -> TDD -> Reconcile -> Review/Refine -> Execute ---

    // Gate 0.1: Knowledge Consult (adopted agent, non-blocking) ------------
    // Consults existing project knowledge/findings so the design incorporates
    // established gotchas, conventions, and prior decisions. Never blocks.
    let knowledgeContext = ''
    if (result._knowledge) {
      plog('resume: skip Knowledge Consult (_knowledge set)')
      knowledgeContext = result._knowledge.summary ? `Project knowledge: ${result._knowledge.summary}\n` : ''
    } else if (!useKnowledgeConsult) {
      stateCheckpoint('Knowledge', 'skipped')
    } else {
      phase('Knowledge')
      plog('Consulting project knowledge')
      try {
        const knowledge = await flexibleAgent(
          `You are the project-knowledge-consultant agent. Consult the project knowledge and findings
(CLAUDE.md, Serena memories) to answer: what should the designer know about this task before
designing it? Surface relevant conventions, prior decisions, gotchas, and constraints.

Task:
${task}
Definition: ${result.definitionPath}

Return a concise brief the architecture + detailed-design agents can consume. Do NOT commit.`,
          { label: 'project-knowledge-consultant', phase: 'Knowledge', schema: KNOWLEDGE_VERDICT, model: gm('knowledgeConsult') },
          result
        )
        result._knowledge = knowledge || { relevant: false, summary: 'knowledge-consultant returned null' }
        knowledgeContext = knowledge && knowledge.summary ? `Project knowledge brief: ${knowledge.summary}\n` : ''
        plog(`Knowledge Consult: relevant=${result._knowledge.relevant}`)
      } catch (e) {
        result._knowledge = { relevant: false, summary: 'consult failed: ' + String(e) }
        plog('Knowledge Consult: failed (non-blocking) — ' + String(e))
      }
      stateCheckpoint('Knowledge', 'done')
    }

    // Gate 0.2: Codebase Facts (Phase D2 — code-explorer routing) ---------
    // Gathers structured codebase facts (existing patterns, call sites, data carriers, interfaces)
    // into <planDir>/codebase-facts.md so the requirements + architecture prompts consume real
    // structure rather than inferring. Non-blocking. Skipped on the gsd-quick fast-path.
    let factsContext = ''
    if (result.factsPath) {
      plog('resume: skip Codebase Facts (factsPath set)')
      factsContext = result._facts && result._facts.summary ? `Codebase facts: ${result._facts.summary}\n` : ''
    } else if (gsdQuick || !useExplorer) {
      stateCheckpoint('Codebase Facts', gsdQuick ? 'skipped (gsd-quick)' : 'skipped')
    } else {
      phase('Codebase Facts')
      plog('Gathering codebase facts via code-explorer')
      try {
        const facts = await safeAgent(
          `You are the code-explorer agent. Explore the codebase to gather STRUCTURE FACTS for this task
and write them to ${planDir}codebase-facts.md. Use Serena (activate_project "log_analysis", read_file,
get_symbols_overview, find_referencing_symbols, search_for_pattern) — do NOT inline-grep from the prompt.

Task:
${task}
Definition: ${result.definitionPath}

Capture and write to the file:
- relevantFiles: key files + line ranges the work touches (as file_path:line refs)
- patterns: existing patterns the new work MUST mirror (e.g. NamedTuple append-only fields at tuple end,
  cache version bump, fnmatch glob filters, stdlib-only invariant, append-only default None fields)
- callSites: integration points the new work wires into (yield sites, constructor calls, CLI flags,
  serializer dicts, formatter columns)
- any gotchas: backward-compat constraints, parallel-safety invariants

Be concrete with file:line evidence. Read mem:core and mem:conventions first. Do NOT propose changes
or commit. Return the path + a concise summary of the most important facts.`,
          { label: 'code-explorer', phase: 'Codebase Facts', schema: CODEBASE_FACTS_VERDICT, model: gm('explorer') },
          result
        )
        result._facts = facts || { factsPath: '', summary: 'code-explorer returned null' }
        if (facts && facts.factsPath) {
          result.factsPath = facts.factsPath
          factsContext = `Codebase facts: ${facts.summary}\n(see ${facts.factsPath})\n`
          plog(`Codebase Facts: written to ${facts.factsPath} (${(facts.patterns || []).length} patterns, ${(facts.callSites || []).length} call sites)`)
        } else {
          plog('Codebase Facts: no path returned — continuing without facts (non-blocking)')
        }
      } catch (e) {
        result._facts = { factsPath: '', summary: 'code-explorer failed: ' + String(e) }
        plog('Codebase Facts: failed (non-blocking) — ' + String(e))
      }
      stateCheckpoint('Codebase Facts', 'done')
    }


    // Scenarios now inform requirements + architecture (was after design).
    let useCaseContext = ''
    if (result.useCasePath) {
      plog('resume: skip E2E Use Cases (useCasePath set)')
      if (result._e2e) useCaseContext = `E2E use cases: ${result._e2e.useCasePath}\n${result._e2e.summary}\n`
    } else if (!useE2eUsecase) {
      stateCheckpoint('E2E Use Cases', 'skipped')
    } else {
      phase('E2E Use Cases')
      const useCasePath = planDir + 'e2e-use-cases.md'
      plog('Extracting end-to-end use cases')
      const useCases = await flexibleAgent(
        `You are the e2e-usecase-extractor agent. Identify and define end-to-end use cases / test
scenarios for this task and write them to ${useCasePath}. Consume the idea doc at
${result.definitionPath}${result._knowledge && result._knowledge.summary ? ' and the knowledge brief' : ''}.

Task:
${task}
${knowledgeContext}
Define the critical user journeys and the scenarios that must hold end-to-end. Read mem:core and
mem:conventions first. Do NOT commit.`,
        { label: 'e2e-usecase-extractor', phase: 'E2E Use Cases', schema: E2E_USECASE_VERDICT, model: gm('e2eUsecase') },
        result
      )
      // e2e-usecase-extractor sometimes returns a file metadata envelope
      // { status, file, action, source_consumed, commit } or an
      // appropriateness envelope instead of the required E2E_USECASE_VERDICT.
      // Normalize any envelope containing a file path into the expected shape.
      if (useCases && !useCases.useCasePath) {
        const candidate = useCases.file || useCases.path || useCases.useCasePath
        if (candidate) {
          plog('E2E Use Cases: normalizing alternative response envelope')
          useCases.useCasePath = candidate
          useCases.summary = useCases.summary || useCases.action || '(e2e use cases written)'
          useCases.useCases = Array.isArray(useCases.useCases) ? useCases.useCases : []
          useCases.openQuestions = Array.isArray(useCases.openQuestions) ? useCases.openQuestions : []
        }
      }
      if (!useCases || !useCases.useCasePath) {
        result.blockedAt = 'e2e-usecases'
        stateCheckpoint('E2E Use Cases', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result.useCasePath = useCases.useCasePath
      result._e2e = useCases
      useCaseContext = `E2E use cases: ${useCases.useCasePath}\n${useCases.summary}\n`
      plog(`E2E Use Cases: written to ${useCases.useCasePath}; useCases=${(useCases.useCases || []).length}`)
      if ((useCases.openQuestions || []).length) {
        plog(`  e2e openQuestions: ${(useCases.openQuestions || []).join('; ')}`)
        await writeOpenQuestions(planDir, useCases.openQuestions.map((q) => ({ gate: 'E2E Use Cases', text: q, severity: 'unspecified' })), result)
      }
      stateCheckpoint('E2E Use Cases', 'done')
    }

    // Gate 0.75: Requirements (Phase C1) ---------------------------------
    // Collects FRs + NFRs into <planDir>/requirements.md, consumed (by path)
    // by the architecture + detailed-design prompts. Feeds the arch/design
    // review loops (gaps == unmet requirements).
    let requirementsContext = ''
    if (result.requirementsPath) {
      plog('resume: skip Requirements (requirementsPath set)')
      requirementsContext = result.requirementsPath ? `Requirements doc: ${result.requirementsPath}\n` : ''
    } else if (!useRequirements) {
      stateCheckpoint('Requirements', 'skipped')
    } else {
      phase('Requirements')
      const requirementsPath = planDir + 'requirements.md'
      plog('Collecting FRs + NFRs')
      const requirements = await safeAgent(
        `You are the requirements-collector agent. Collect and structure the functional (FRs) and
non-functional (NFRs) requirements for this task and write them to ${requirementsPath}. Consume the
idea doc at ${result.definitionPath} and the e2e use cases at ${result.useCasePath || '(none)'}.

IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT available.
Do NOT attempt user interviews. Produce requirements entirely from the task description, idea doc,
e2e use cases, codebase facts, and project conventions. Record anything that would normally require
user clarification in the openQuestions array instead.

Task:
${task}
${useCaseContext}${factsContext}
Elicit explicit FRs (what it must do) and NFRs (performance, reliability, security, usability,
maintainability). Where a requirement is ambiguous, record it in openQuestions rather than guessing.
Read mem:core and mem:conventions first. Do NOT commit.

Write the requirements doc to ${requirementsPath} and return requirementsPath set to that path.`,
        { label: 'requirements-collector', phase: 'Requirements', schema: REQUIREMENTS_VERDICT, model: gm('requirements') },
        result
      )
      if (!requirements || !requirements.requirementsPath) {
        result.blockedAt = 'requirements'
        stateCheckpoint('Requirements', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result.requirementsPath = requirements.requirementsPath
      result._requirements = requirements
      requirementsContext = `Requirements doc: ${requirements.requirementsPath}\n`
      plog(`Requirements: written to ${requirements.requirementsPath}; FRs=${(requirements.functionalRequirements || []).length}, NFRs=${(requirements.nonFunctionalRequirements || []).length}`)
      if ((requirements.openQuestions || []).length) {
        plog(`  requirements openQuestions: ${(requirements.openQuestions || []).join('; ')}`)
        await writeOpenQuestions(planDir, requirements.openQuestions.map((q) => ({ gate: 'Requirements', text: q, severity: 'unspecified' })), result)
      }
      stateCheckpoint('Requirements', 'done')
    }

    // Gate 0.75R: Requirements review loop (Phase C2) --------------------
    // Runs IMMEDIATELY after Requirements (before Architecture + Detailed Design
    // consume requirements.md) so defects it finds re-feed the dependent artifacts.
    if (useRequirements && !result._reviewedRequirements) {
      const reqReview = await reviewLoop({
        phaseLabel: 'Requirements Review',
        artifactPath: result.requirementsPath,
        artifactName: 'requirements',
        reviewerPrompt:
          `You are the critical-reviewer agent. Review the requirements doc at ${result.requirementsPath}.
Reject on: ambiguous/incomplete FRs, missing NFRs (performance/reliability/security), contradictions,
or openQuestions that should have been resolved. Accept once requirements are clear, complete, and testable.
Task:\n${task}`,
        reviserPrompt: (rev) =>
          `You are the design-reviser agent. Address the following review findings on the requirements at ${result.requirementsPath}.
Close every blocker and open question. Write the revised requirements to ${result.requirementsPath} (in place).
Findings:\n${JSON.stringify({ blockers: (rev && rev.blockers) || [], gaps: (rev && rev.gaps) || [], findings: (rev && rev.findings) || [] }, null, 2)}`,
        reviewerModel: gm('reviewDesign'),
        reviserModel: gm('revise'),
        result, retryBudget, refineSubcap, spendRetry, planDir, useEnhancer, useQuickDecider, decisionCap,
      })
      // F6: mark reviewed only on a clean accept; on fail-forward set a separate Forced
      // flag so resume re-runs the review instead of masking unresolved gaps.
      result._requirementsReview = reqReview
      if (reqReview && reqReview.accepted && !reqReview.failForward) {
        result._reviewedRequirements = true
      } else {
        result._reviewedRequirementsForced = true
      }
      plog(`Requirements Review: ${reqReview && reqReview.accepted ? 'accepted' : 'fail-forward'} after ${reqReview ? reqReview.iterations : 0} iteration(s)${reqReview && reqReview.failForward ? ' (fail-forward)' : ''}`)
      stateCheckpoint('Requirements Review', 'done')
    }

    // Gate 0.5: Architecture (adopted agent) -------------------------------
    let archContext = ''
    if (useArchDesign) {
      if (result.archPath) {
        plog('resume: skip Architecture (archPath set)')
        if (result._arch) archContext = `Architecture design: ${result._arch.archPath}\n${result._arch.summary}\n`
      } else {
        phase('Architecture')
        plog('Producing high-level architecture design')
        const arch = await flexibleAgent(
          `You are the arch-design-orchestrator agent. Produce a high-level architecture design for this task
and write it to ${archPath}. Consume the idea doc at ${result.definitionPath}${requirementsContext ? ', the requirements at ' + result.requirementsPath : ''} (its NFRs are your input contract).

Task:
${task}
${knowledgeContext}${factsContext}${useCaseContext}${requirementsContext}
Satisfy the stated NFRs. Produce a design summary other agents can consume. Do NOT commit.
Read mem:core and mem:conventions before designing.`,
          { label: 'arch-design-orchestrator', phase: 'Architecture', schema: ARCH_VERDICT, model: gm('archDesign') },
          result
        )
        if (!arch || !arch.archPath) {
          result.blockedAt = 'architecture'
          stateCheckpoint('Architecture', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        result.archPath = arch.archPath
        result._arch = arch
        archContext = `Architecture design: ${arch.archPath}\n${arch.summary}\n`
        plog(`Architecture: design written to ${arch.archPath}; gaps=${(arch.gaps || []).length}`)
        if ((arch.gaps || []).length) plog(`  arch gaps: ${(arch.gaps || []).join('; ')}`)
      }
      // Gate 0.5R: Architecture review loop (Phase C2) ----------------------
      if (!result._reviewedArch) {
        const archReview = await reviewLoop({
          phaseLabel: 'Arch Review',
          artifactPath: result.archPath,
          artifactName: 'architecture',
          reviewerPrompt:
            `You are the critical-reviewer agent. Review the architecture design at ${result.archPath}.
Reject on: missing scope/spec, unmet requirements (compare against ${result.requirementsPath || result.definitionPath}),
wrong component decomposition, unhandled risk/NFR. Do NOT block on un-enumerated call-site wiring.
Return accepted=true only when all gaps + open questions are closed.
Task:\n${task}`,
          reviserPrompt: (rev) =>
            `You are the design-reviser agent. Address the following review findings on the architecture at ${result.archPath}.
Close every blocker and gap. Write the revised architecture to ${result.archPath} (in place).
Findings:\n${JSON.stringify({ blockers: (rev && rev.blockers) || [], gaps: (rev && rev.gaps) || [], findings: (rev && rev.findings) || [] }, null, 2)}`,
          reviewerModel: gm('reviewDesign'),
          reviserModel: gm('revise'),
          result, retryBudget, refineSubcap, spendRetry, planDir, useEnhancer, useQuickDecider, decisionCap,
        })
        result._archReview = archReview
        if (archReview && archReview.accepted && !archReview.failForward) {
          result._reviewedArch = true
        } else {
          result._reviewedArchForced = true
        }
        plog(`Arch Review: ${archReview && archReview.accepted ? 'accepted' : 'fail-forward'} after ${archReview ? archReview.iterations : 0} iteration(s)${archReview && archReview.failForward ? ' (fail-forward)' : ''}`)
        stateCheckpoint('Arch Review', 'done')
      }
      stateCheckpoint('Architecture', 'done')
    }

    // Gate 0.6: Detailed Design (adopted agent) ----------------------------
    let designContext = ''
    if (useDetailedDesign) {
      if (result.designPath) {
        plog('resume: skip Detailed Design (designPath set)')
        if (result._design) designContext = `Detailed design: ${result._design.designPath}\n${result._design.summary}\n`
      } else {
        phase('Detailed Design')
        plog('Producing detailed design')
        const design = await flexibleAgent(
          `You are the detailed-design-architect agent. Produce an implementation-ready detailed design for this task
and write it to ${designPath}. Consume the high-level architecture at ${result.archPath || '(none — infer from idea doc)'},
the idea doc at ${result.definitionPath}${requirementsContext ? ', and the requirements at ' + result.requirementsPath : ''}.

Task:
${task}

Cover component breakdown, interfaces, data models, algorithms, error handling, edge cases, config,
and test strategy. Read mem:core, mem:handoff, mem:conventions, mem:task_completion before designing.
Do NOT commit.`,
          { label: 'detailed-design-architect', phase: 'Detailed Design', schema: DETAILED_DESIGN_VERDICT, model: gm('detailedDesign') },
          result
        )
        if (!design || !design.designPath) {
          result.blockedAt = 'detailed-design'
          stateCheckpoint('Detailed Design', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        result.designPath = design.designPath
        result._design = design
        designContext = `Detailed design: ${design.designPath}\n${design.summary}\n`
        plog(`Detailed Design: design written to ${design.designPath}`)
        if ((design.openGaps || []).length) plog(`  design openGaps: ${(design.openGaps || []).join('; ')}`)
      }
      stateCheckpoint('Detailed Design', 'done')
    }

    // Gate 0.6R: Detailed-Design review loop (Phase C2) -------------------
    if (useDetailedDesign && !result._reviewedDesign) {
      const designReview = await reviewLoop({
        phaseLabel: 'Detailed Design Review',
        artifactPath: result.designPath,
        artifactName: 'detailed-design',
        reviewerPrompt:
          `You are the critical-reviewer agent. Review the detailed design at ${result.designPath}.
Reject on: missing component breakdown, undefined interfaces/data models, unhandled edge cases,
unmet requirements (compare against ${result.requirementsPath || result.definitionPath}), unresolved
openGaps. Do NOT block on implementer-discretion detail.
Return accepted=true only when all openGaps are closed.
Task:\n${task}`,
        reviserPrompt: (rev) =>
          `You are the design-reviser agent. Address the following review findings on the detailed design at ${result.designPath}.
Close every blocker and gap. Write the revised design to ${result.designPath} (in place).
Findings:\n${JSON.stringify({ blockers: (rev && rev.blockers) || [], gaps: (rev && rev.gaps) || [], findings: (rev && rev.findings) || [] }, null, 2)}`,
        reviewerModel: gm('reviewDesign'),
        reviserModel: gm('revise'),
        result, retryBudget, refineSubcap, spendRetry, planDir, useEnhancer, useQuickDecider, decisionCap,
      })
      result._designReview = designReview
      if (designReview && designReview.accepted && !designReview.failForward) {
        result._reviewedDesign = true
      } else {
        result._reviewedDesignForced = true
      }
      plog(`Detailed Design Review: ${designReview && designReview.accepted ? 'accepted' : 'fail-forward'} after ${designReview ? designReview.iterations : 0} iteration(s)${designReview && designReview.failForward ? ' (fail-forward)' : ''}`)
      stateCheckpoint('Detailed Design Review', 'done')
    }

    // Gate 1: Plan ----------------------------------------------------------
    let plan = result._plan || null
    if (result.planned) {
      plog('resume: skip Plan (planned set)')
    } else {
      phase('Plan')
      plog('Producing plan')
      plan = await flexibleAgent(
        `You are the plan-architect agent. Create (or update) the implementation plan at ${planPath}
for this task. Consume the task definition at ${result.definitionPath} as the input contract.
${archContext}${designContext}${useCaseContext}
Task:
${task}

Break the work into ordered, verifiable steps with TDD scenarios. Include a build/test sequence.

MANDATORY plan sections (reviewers check for these):
1. "Edge-case enumeration" — list EVERY input variant/sample observed and the test that covers it.
2. "Regression mechanics" — call out, with exact construction sites, any data-carrier changes:
   NamedTuple positional-vs-keyword migration (show the exact \`yield Match(...)\` /
   \`ReportRow(...)\` lines that must change), serialization/deserialization backward-compat for
   changed carriers, and regex anchoring assumptions (^/MULTILINE semantics under line-by-line
   processing). These are a checklist for the executor, not hand-waving.

PARALLEL EXECUTION: emit a \`lanes\` array of file-disjoint work groups. Split the plan into 2+
lanes ONLY if the work touches clearly separable, file-disjoint areas (e.g. cli vs parser vs tests).
Each lane MUST list the exact source files it owns; lanes must NOT share files (shared files force
single-lane execution). If the work is not cleanly separable, emit exactly ONE lane covering all steps.`,
        { label: 'plan-architect', phase: 'Plan', schema: PLAN_VERDICT, model: gm('plan') },
        result
      )
      if (!plan || !plan.planPath) {
        result.blockedAt = 'plan'
        stateCheckpoint('Plan', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result._plan = plan
      result.lanes = plan.lanes || null
      result.planned = true
      plog(`Plan: plan written to ${plan.planPath}; lanes=${(plan.lanes || []).length}`)
    }
    stateCheckpoint('Plan', 'done')

    // Gate 1.5: TDD Enforce (adopted agent) --------------------------------
    if (useTddEnforce) {
      if (gateDone('tddEnforced')) {
        // skip — tddEnforced already set
      } else {
        phase('TDD Enforce')
        plog('Enforcing TDD + YAGNI on plan')
        const tdd = await flexibleAgent(
          `You are the tdd-plan-enforcer agent. Harden the plan at ${planPath} IN PLACE with TDD and YAGNI discipline.
Add TDD gates (RED: tests to write first and watch fail; GREEN: per-feature success criteria; integration;
exit criteria). Add the RED test list and the GREEN success/exit criteria as plan sections. Audit for YAGNI
violations — call out scope the plan should drop. Read mem:core, mem:conventions, mem:task_completion,
mem:suggested_commands before enforcing. Do NOT commit.`,
          { label: 'tdd-plan-enforcer', phase: 'TDD Enforce', schema: TDD_VERDICT, model: gm('tddEnforce') },
          result
        )
        if (!tdd || !tdd.hardened) {
          result.blockedAt = 'tdd-enforce'
          stateCheckpoint('TDD Enforce', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        result.tddEnforced = true
        result.yagniWarnings = tdd.yagniWarnings || []
        result._tdd = tdd
        plog(`TDD Enforce: plan hardened in place; gatesAdded=${tdd.gatesAdded || 0}; redTests=${(tdd.redTests || []).length}`)
        if ((tdd.yagniWarnings || []).length) plog(`  YAGNI warnings: ${(tdd.yagniWarnings || []).join('; ')}`)
        // F8: a YAGNI warning marked BLOCKER must not silently ride to execute (where it surfaces
        // as a test failure). Escalate it into reconcile.conflicts so the Reconcile + Review gates
        // are forced to address it via the existing conflict-resolution path.
        const blockerYagni = (result.yagniWarnings || []).filter((y) => {
          const s = typeof y === 'string' ? y : (y && (y.text || y.message || JSON.stringify(y))) || ''
          return /BLOCKER/i.test(s)
        })
        if (blockerYagni.length) {
          if (!result.reconcile || !result.reconcile.conflicts) result.reconcile = { consistent: false, conflicts: [], summary: 'pre-reconcile' }
          for (const by of blockerYagni) result.reconcile.conflicts.push(`[YAGNI BLOCKER] ${by}`)
          result.reconcile.consistent = false
          plog(`  YAGNI escalation: ${blockerYagni.length} BLOCKER warning(s) routed into reconcile.conflicts`)
        }
      }
      stateCheckpoint('TDD Enforce', 'done')
    }

    // Gate 1.7: Reconcile design vs plan (adopted agent, NON-BLOCKING) ------
    // Compares the plan against the arch/detailed-design/e2e artifacts. Conflicts
    // are surfaced to the review gate and to persist, but reconcile never blocks:
    // a gap is information, not a hard error.
    let reconcileContext = ''
    if (result.reconcile) {
      plog('resume: skip Reconcile (reconcile set)')
      reconcileContext = result.reconcile.conflicts && result.reconcile.conflicts.length
        ? `Reconcile conflicts to re-check: ${JSON.stringify(result.reconcile.conflicts)}\n`
        : ''
    } else if (!useReconcile) {
      stateCheckpoint('Reconcile', 'skipped')
    } else {
      phase('Reconcile')
      plog('Reconciling plan against design artifacts')
      const reconcile = await flexibleAgent(
        `You are the design-plan-reconciler agent. Compare the plan at ${planPath} against the design
artifacts: architecture at ${result.archPath || '(none)'}, detailed design at ${result.designPath || '(none)'},
and e2e use cases at ${result.useCasePath || '(none)'}. Identify inconsistencies, gaps, or conflicts
between the plan and the designs. If the plan can be brought into alignment, update it in place
and report reconciledPlanPath. Do NOT commit.

Task:
${task}`,
        { label: 'design-plan-reconciler', phase: 'Reconcile', schema: RECONCILE_VERDICT, model: gm('reconcile') },
        result
      )
      result.reconcile = reconcile || { consistent: false, conflicts: [], summary: 'reconcile agent returned null' }
      // F7: consistent must reflect the actual conflict count, not the reconciler agent's
      // self-reported flag (which could be true over live conflicts). Conflict count is truth.
      result.reconcile.consistent = (result.reconcile.conflicts || []).length === 0
      reconcileContext = result.reconcile.conflicts && result.reconcile.conflicts.length
        ? `Reconcile conflicts (address in review): ${JSON.stringify(result.reconcile.conflicts)}\n`
        : ''
      plog(`Reconcile: consistent=${result.reconcile.consistent}; conflicts=${(result.reconcile.conflicts || []).length}; designAtFault=${!!result.reconcile.designAtFault}`)

      // Design-fix loop-back: if the reconciler judges the DESIGN (not the plan)
      // as the source of conflict, re-run arch-design-orchestrator to fix the
      // architecture in place, then re-reconcile. Bounded by BOTH a per-loop soft
      // sub-cap (reconcileSubcap) and the shared global budget, so a persistently
      // broken design can't monopolize the budget the refine/debug loops need. On
      // either limit the (still-conflicting) design is carried forward into review.
      let reconcileIterations = 0
      while (result.reconcile.designAtFault && (result.reconcile.designFixes || []).length
             && reconcileIterations < reconcileSubcap && !budgetExhausted(retryBudget)) {
        // Phase E2: once already looping (reconcileIterations >= 1), ask quick-decider whether
        // another design-fix cycle is worth it before spending budget. 'stop' carries the
        // still-conflicting design forward into review (reconcile never hard-blocks). null -> stop.
        if (useQuickDecider && reconcileIterations >= 1) {
          const decide = await runQuickDecider({
            result, planDir, model: gm('quickDecider'), decisionCap,
            opts: {
              loopName: 'reconcile-designfix',
              iterations: reconcileIterations,
              subcap: reconcileSubcap,
              retryBudget,
              lastFailure: `Reconcile design-fix loop still flags the DESIGN at fault after ${reconcileIterations} fix iteration(s). Remaining design defects: ${JSON.stringify(result.reconcile.designFixes || []).slice(0, 800)}`,
            },
          })
          if (decide === 'stop') {
            plog('Reconcile: quick-decider said stop — carrying design conflict forward into review')
            break
          }
        }
        spendRetry(1)
        reconcileIterations += 1
        plog(`Reconcile: design at fault — fixing architecture (${result.reconcile.designFixes.length} defect(s); fix ${reconcileIterations}/${reconcileSubcap}, retries used ${retryState.used}/${retryBudget})`)
        phase('Architecture')
        let archFixPrompt = `You are the arch-design-orchestrator agent. The design-plan-reconciler found the DESIGN
(not the plan) is the source of conflict. Fix the architecture design at ${result.archPath || archPath}
to address these defects, then report the updated path.

Task:
${task}

Design defects to fix:
${(result.reconcile.designFixes || []).map((f, i) => `${i + 1}. ${f}`).join('\n')}

Keep the design consistent with the task definition at ${result.definitionPath}.
Do NOT commit.`
        // Phase D1: harden the arch-fix prompt on later design-fix iterations (still flagged after a prior fix).
        if (reconcileIterations > 1) {
          archFixPrompt = await enhancePrompt({
            gateKey: 'reconcile-archfix',
            basePrompt: archFixPrompt,
            failureContext: `Reconcile design-fix iteration ${reconcileIterations}: prior architecture fix did not resolve conflicts. Remaining design defects: ${JSON.stringify(result.reconcile.designFixes).slice(0, 800)}`,
            intent: 'improve-design',
            result, planDir, useEnhancer,
          })
        }
        const archFix = await flexibleAgent(
          archFixPrompt,
          { label: 'arch-design-orchestrator(fix)', phase: 'Architecture', schema: ARCH_VERDICT, model: gm('archDesign') },
          result
        )
        if (archFix && archFix.archPath) {
          result.archPath = archFix.archPath
          result._arch = archFix
          plog(`Reconcile: architecture fixed at ${archFix.archPath} — re-reconciling`)
        } else {
          plog('Reconcile: architecture fix returned no path — carrying conflict forward')
          break
        }
        phase('Reconcile')
        const reReconcile = await flexibleAgent(
          `You are the design-plan-reconciler agent. Re-compare the plan at ${planPath} against the
JUST-FIXED architecture at ${result.archPath} and detailed design at ${result.designPath || '(none)'}.

Task:
${task}

Did the design fix resolve the conflicts? If new conflicts now point at the plan (not design), set
designAtFault=false. If the design is STILL wrong, keep designAtFault=true with the remaining defects.`,
          { label: 'design-plan-reconciler(recheck)', phase: 'Reconcile', schema: RECONCILE_VERDICT, model: gm('reconcile') },
          result
        )
        result.reconcile = reReconcile || result.reconcile
        // F7: re-derive consistent from conflict count after the design-fix re-reconcile.
        result.reconcile.consistent = (result.reconcile.conflicts || []).length === 0
        reconcileContext = result.reconcile.conflicts && result.reconcile.conflicts.length
          ? `Reconcile conflicts (address in review): ${JSON.stringify(result.reconcile.conflicts)}\n`
          : ''
        plog(`Reconcile: re-check consistent=${result.reconcile.consistent}; designAtFault=${!!result.reconcile.designAtFault}`)
        if (result.reconcile.consistent) break
      }
      if (result.reconcile.designAtFault) {
        const reason = budgetExhausted(retryBudget)
          ? `retry budget exhausted (${retryState.used}/${retryBudget})`
          : `reconcile sub-cap reached (${reconcileIterations}/${reconcileSubcap})`
        plog(`Reconcile: design-fix loop stopped — ${reason}; carrying conflict forward`)
      }
      stateCheckpoint('Reconcile', 'done')
    }

    // Gate 2: Review / Refine loop (global-budget-bounded, never terminal) --
    // Loops while the plan is rejected AND the refine sub-cap is unmet AND the
    // global retry budget is not exhausted. On sub-cap exhaustion it escalates
    // to a final reviewer; if escalation still finds only impl-detail blockers
    // (or even true defects), it force-accepts and proceeds to Execute. The
    // only way out of this gate as "blocked" is the global budget running dry.
    if (result.planAccepted) {
      plog('resume: skip Review/Refine (planAccepted set)')
    } else {
      let reviewState = { accepted: false }
      let refineCount = 0
      while (!reviewState.accepted && refineCount < refineSubcap && !budgetExhausted(retryBudget)) {
        phase('Review/Refine')
        plog(`Review iteration ${refineCount + 1} (retries used ${retryState.used}/${retryBudget})`)
        const review = await safeAgent(
          `You are the critical-reviewer agent. Review the plan at ${planPath} against the task
definition at ${result.definitionPath}. Task:
${task}
${reconcileContext}

Look for missing scope, ambiguous spec, wrong ordering, and unhandled risk (edge cases,
error conditions).
SCOPE RULE: block ONLY on missing scope/spec/ordering/risk. Un-enumerated call-site wiring
(individual yield/construction sites) is an IMPLEMENTER NOTE, NOT a plan blocker — the plan's
Regression-mechanics section is a checklist; it need not list every line. Do not reject a plan
for being implementable.
Return accepted=true iff there are NO blocker-severity findings. List blockers otherwise.`,
          { label: 'critical-reviewer(plan)', phase: 'Review/Refine', schema: REVIEW_VERDICT, model: gm('review') }, result
        )
        spendRetry(1)
        if (!review) {
          // Reviewer agent failure is a retryable condition, not terminal.
          refineCount += 1
          continue
        }
        if (review.accepted) {
          reviewState = review
          result.refineIterations = refineCount
          break
        }
        // Not accepted -> refine, then loop re-reviews. Retry is counted once per
        // cycle by the reviewer spend above; a second spend here would exhaust the
        // global budget at the sub-cap and make escalation unreachable.
        // Phase E2: before spending another refine cycle, ask quick-decider whether it's
        // worth it (fired only once we're already looping, refineCount >= 1, so a clean
        // first-pass accept never pays the tax). 'stop' bails to escalation; null -> stop.
        if (useQuickDecider && refineCount >= 1) {
          const decide = await runQuickDecider({
            result, planDir, model: gm('quickDecider'), decisionCap,
            opts: {
              loopName: 'plan-refine',
              iterations: refineCount,
              subcap: refineSubcap,
              retryBudget,
              lastFailure: `Plan review rejected after ${refineCount} refine iteration(s). Outstanding blockers: ${JSON.stringify(review.blockers || []).slice(0, 800)}`,
            },
          })
          if (decide === 'stop') {
            plog('Refine: quick-decider said stop — escalating to final reviewer')
            break
          }
        }
        // Phase D1: on retries (refineCount > 0) harden the refine prompt via prompt-enhancer
        // so the refiner applies reviewer feedback more precisely.
        let refinePrompt = `You are the plan-refiner agent. Address the following review findings on the plan at ${planPath}.
Do not reduce scope of the pass gates.
Findings:
${JSON.stringify(review.blockers, null, 2)}`
        if (refineCount > 0) {
          refinePrompt = await enhancePrompt({
            gateKey: 'plan-refine',
            basePrompt: refinePrompt,
            failureContext: `Prior refine iteration still rejected; review blockers not fully addressed. Review blockers: ${JSON.stringify(review.blockers).slice(0, 800)}`,
            intent: 'improve-design',
            result, planDir, useEnhancer,
          })
        }
        const refine = await safeAgent(
          refinePrompt,
          { label: 'plan-refiner', phase: 'Review/Refine', schema: REFINE_VERDICT, model: gm('refine') }, result
        )
        refineCount += 1
        if (!refine) {
          continue
        }
        reviewState = review
      }

      // Convergence gate: if still not accepted, escalate. Escalation reclassifies
      // blockers; clean-accept or force-accept proceeds to Execute; genuine true
      // defects hard-block (resumable via --resume). Real residual issues surface
      // at Test + Code-Review.
      if (!reviewState.accepted) {
        if (budgetExhausted(retryBudget)) {
          result.blockedAt = 'review'
          result.retryUsed = retryState.used
          stateCheckpoint('Review/Refine', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        phase('Review/Refine')
        plog('Refine sub-cap reached — escalating to final reviewer')
        // Escalation agent: retry up to ESCALATION_RETRIES times with a hardened prompt before
        // giving up. A schema/JSON throw (safeAgent -> null) on the final plan-review gate must NOT
        // silently force-accept an unreviewed plan — exhaust retries, then hard-block (resumable).
        const ESCALATION_RETRIES = 5
        const escalatePrompt = (attempt) => `You are the FINAL escalation reviewer. Prior review rounds rejected this plan; the blockers they
raised are below. Reclassify EACH: is it a TRUE plan defect (missing scope/spec/ordering/risk) or an
IMPLEMENTATION-DETAIL (call-site wiring, individual yield/construction sites, mechanics that belong to
the executor)? Only TRUE defects block a plan; implementation-detail is an implementer note carried to
the executor.

Plan: ${planPath}
Definition: ${result.definitionPath}
Task: ${task}

Prior blockers:
${JSON.stringify((reviewState && reviewState.blockers) || [], null, 2)}

Set accepted=true if no TRUE defects remain. Set forceAcceptable=true if every remaining blocker is
implementation-detail. List trueDefects (genuine plan defects) and implNotes (implementer-detail) separately.${
          attempt > 1
            ? `

IMPORTANT (retry ${attempt}/${ESCALATION_RETRIES}): A prior response failed JSON/schema validation.
Respond with STRICT valid JSON ONLY — no markdown, no code fences, no commentary. Keep every array and
object well-formed and within the schema. If unsure, return accepted=false with empty arrays rather than
malformed output.`
            : ''
        }`
        let escalation = null
        for (let attempt = 1; attempt <= ESCALATION_RETRIES; attempt++) {
          // Phase E2: on schema-recovery retries (attempt > 1, prior escalation returned null),
          // ask quick-decider whether more JSON-format retries are worth it. 'stop' bails to the
          // hard-block path below (escalation stays null). null -> stop.
          if (useQuickDecider && attempt > 1) {
            const decide = await runQuickDecider({
              result, planDir, model: gm('quickDecider'), decisionCap,
              opts: {
                loopName: 'escalation',
                iterations: attempt - 1,
                subcap: ESCALATION_RETRIES,
                retryBudget,
                lastFailure: `Escalation reviewer returned malformed JSON / null on ${attempt - 1} prior attempt(s) (schema-recovery loop).`,
              },
            })
            if (decide === 'stop') {
              plog('Escalation: quick-decider said stop — hard-block (escalation unreviewed)')
              break
            }
          }
          // Phase D1: on retries, harden the escalation prompt via prompt-enhancer (tighten-format)
          // in addition to the in-band STRICT note. Falls back to the base prompt if enhancer fails.
          let attemptPrompt = escalatePrompt(attempt)
          if (attempt > 1) {
            attemptPrompt = await enhancePrompt({
              gateKey: 'escalation',
              basePrompt: attemptPrompt,
              failureContext: `Escalation agent returned malformed JSON / null on prior attempt (attempt ${attempt}/${ESCALATION_RETRIES}). Need strict valid JSON conforming to ESCALATION_REVIEW schema.`,
              intent: 'tighten-format',
              result, planDir, useEnhancer,
            })
          }
          escalation = await safeAgent(
            attemptPrompt,
            { label: 'critical-reviewer(escalation)', phase: 'Review/Refine', schema: ESCALATION_REVIEW, model: gm('reviewEscalation') }, result
          )
          spendRetry(1)
          if (escalation != null) break
          plog(`Escalation agent failed (attempt ${attempt}/${ESCALATION_RETRIES}) — retrying with hardened prompt`)
        }
        if (escalation == null) {
          // All retries exhausted: hard-block rather than force-accept an unreviewed plan.
          result.blockedAt = 'review'
          result.retryUsed = retryState.used
          result.forceAccepted = false
          result.carriedBlockers = ((reviewState && reviewState.blockers) || []).map((b) => b && b.title).filter(Boolean)
          result.refineIterations = refineCount
          result._escalation = escalation
          stateCheckpoint('Review/Refine', 'blocked')
          plog(`Escalation failed after ${ESCALATION_RETRIES} retries — hard-block (resumable via --resume)`)
          await consolidate(slug, result, config)
          return result
        } else if (escalation.accepted === true) {
          // Clean accept: no true defects remain.
          result.refineIterations = refineCount
          result._escalation = escalation
          plog('Escalation: clean accept (no true defects)')
        } else if (escalation.forceAcceptable === true || !(escalation.trueDefects || []).length) {
          // Impl-detail only → force-accept, carry implNotes (+ any trueDefects) to executor + code-review.
          result.forceAccepted = true
          result.carriedBlockers = (escalation.trueDefects || []).concat(escalation.implNotes || [])
          result.refineIterations = refineCount
          result._escalation = escalation
          plog(`Force-accepting plan — ${result.carriedBlockers.length} blocker(s) carried forward (impl-detail)`)
        } else {
          // Genuine TRUE plan defects → hard-block (resumable via --resume).
          result.blockedAt = 'review'
          result.retryUsed = retryState.used
          result.forceAccepted = false
          result.carriedBlockers = escalation.trueDefects || []
          result.refineIterations = refineCount
          result._escalation = escalation
          plog(`Escalation: hard-block — ${(escalation.trueDefects || []).length} true defect(s): ${(escalation.trueDefects || []).join('; ')}`)
          stateCheckpoint('Review/Refine', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
      }
      result.planAccepted = true
      plog(`Review/Refine: plan accepted (iterations=${refineCount}, forceAccepted=${result.forceAccepted})`)
    }
    stateCheckpoint('Review/Refine', 'done')

    // ===== Phase H: plan-chunker → stages (design tail) ===========================
    // In design mode the THINK section ends right after this. Plan-chunker splits plan.md into
    // dependency-ordered stageNN.md files so implement can tick stages as its progress unit (lanes
    // collapse INTO a stage). Runs ONCE in design mode; never re-run on resume (mirror categorizer
    // rule — persisted result.stages is reused). --no-chunker collapses to a single implicit stage.
    if (isDesignMode && !result.stages.length) {
      if (useChunker) {
        phase('Chunk Plan')
        plog('Chunking plan into stages (design tail)')
        const stages = await chunkPlanIntoStages({ planPath, planDir, task, result, lanes: result.lanes })
        result.stages = stages
        plog(`plan-chunker: ${stages.length} stage(s) — ${stages.map((s) => s.id).join(', ')}`)
        stateCheckpoint('Chunk Plan', 'done')
      } else {
        // --no-chunker: single implicit stage covering the whole plan (single-executor behavior).
        result.stages = [{
          id: 'stage01',
          file: planDir + 'stage01.md',
          name: 'Whole plan',
          status: 'pending',
          files: (result.lanes || []).flatMap((l) => l.files || []),
        }]
        plog('Chunker disabled (--no-chunker) — single implicit stage01')
        stateCheckpoint('Chunk Plan', 'skipped')
      }
    }

    // ===== Phase G: design-mode terminal gate ====================================
    // In design mode the THINK section ends here (after plan acceptance + review/refine + chunk).
    // We set designReady and return so the human can review the design artifacts before any code
    // executes. The DO gates (execute...commit) run in implement mode via /implement-feature <planDir>.
    // Tune mode never reaches here (it has its own targeted-gate branch; see Phase J).
    if (isDesignMode) {
      // F3 + FX-3: run the mandated non-blocking side-effect gates BEFORE the design-stop return.
      // Previously the design-stop returned before Gate 5.4 (Publish) and 5.5 (Persist) ran,
      // so design runs silently skipped both (run meta showed published:None, persist:None).
      // Both are non-blocking + resume-skippable (guarded by result.published / result.persist).
      // Wrapped in try/catch (FX-3) so an unexpected throw (e.g. a helper scope bug) is caught and
      // logged rather than propagating past the designReady=true assignment below.
      try {
        if (usePublish && !result.published) {
          phase('Publish')
          plog('Design mode: publishing plan + architecture before design-stop')
          await publishDesign(result, planPath, task)
          stateCheckpoint('Publish', 'done')
        }
        if (useKnowledgePersist && !result.persist) {
          phase('Persist')
          plog('Design mode: persisting findings before design-stop')
          await persistFindings(result)
          plog(`Persist: persisted=${result.persist && result.persist.persisted}`)
          stateCheckpoint('Persist', 'done')
        }
      } catch (e) {
        plog('Design-stop: non-blocking Publish/Persist threw — caught, continuing to designReady. ' + String(e))
      }
      // I14: artifact assertion — before advertising designReady, confirm every mandated artifact
      // whose gate was ENABLED actually produced a path. A missing path means the gate silently
      // failed without blocking; surface it as a warning (not a hard block — the gate may have been
      // intentionally disabled, or the path legitimately optional for that task).
      const mandatedArtifacts = [
        { key: 'idea', path: result.definitionPath, gate: 'Define', flag: true },
        { key: 'requirements', path: result.requirementsPath, gate: 'Requirements', flag: useRequirements },
        { key: 'architecture', path: result.archPath, gate: 'Architecture', flag: useArchDesign },
        { key: 'detailed-design', path: result.designPath, gate: 'Detailed Design', flag: useDetailedDesign },
        { key: 'plan', path: result.planPath, gate: 'Plan', flag: true },
        { key: 'stages', path: (result.stages || []).length ? 'present' : null, gate: 'Chunk Plan', flag: useChunker },
      ]
      const missingArtifacts = mandatedArtifacts.filter((a) => a.flag && !a.path)
      if (missingArtifacts.length) {
        const msg = `designWarnings: ${missingArtifacts.length} mandated artifact(s) produced no path: ${missingArtifacts.map((a) => `${a.key}(${a.gate})`).join(', ')}`
        plog(msg)
        result.designWarnings.push(msg)
      }

      phase('Design')
      result.designReady = true
      result.handoff = {
        from: 'design',
        message: `Design ready. Plan + artifacts are in ${planDir}. Review them, then run: /implement-feature ${planDir}`,
        nextMode: 'implement',
        planDir,
      }
      stateCheckpoint('Design', 'done')
      plog(`Design mode: designReady=true — stopping pre-execute (stages=${result.stages.length})`)
      await consolidate(slug, result, config)
      return result
    }

    // ===== Phase I: implement-mode entry guard ===================================
    // implement-feature requires designReady (design mode set it). Without it the stages + design
    // docs are absent; block and tell the user to run /design-feature first. Hard-block (resumable
    // only after design has run), not fail-forward.
    if (isImplementMode && !result.designReady) {
      result.blockedAt = 'design-not-ready'
      result.handoff = {
        from: 'implement',
        message: `Cannot implement — design not ready. Run /design-feature first (or /design-feature --resume ${planDir} if a design run exists).`,
        nextMode: 'design',
        planDir,
      }
      plog('Implement mode: designReady=false — blocking (run /design-feature first)')
      stateCheckpoint('Execute', 'blocked')
      await consolidate(slug, result, config)
      return result
    }

    // Gate 3: Execute (plan-driven stages — parallel when file-disjoint) ----
    // Phase I: stages are the progress unit. We execute each non-done stage in dependency order,
    // ticking stageNN.md status (pending -> in-progress -> done) + result.stages[i].status. Intra-stage
    // parallelism reuses the lane fan-out, scoped to ONE stage's files. Design mode never reaches here
    // (its terminal gate returned pre-execute). On resume, done stages are skipped via their status.
    // A single implicit stage (--no-chunker, or pre-chunker runs) keeps the legacy whole-plan execute.
    if (gateDone('executed')) {
      // skip — executed already set
    } else {
      phase('Execute')
      const stages = result.stages && result.stages.length
        ? result.stages
        : [{ id: 'stage01', file: planDir + 'stage01.md', name: 'Whole plan', status: 'pending', files: (result.lanes || []).flatMap((l) => l.files || []) }]
      const carriedBlockersLine = result.carriedBlockers && result.carriedBlockers.length
        ? `Carried-forward blockers from force-accept (address specifically): ${JSON.stringify(result.carriedBlockers)}`
        : ''

      const aggregate = { completed: true, stepsDone: 0, files: [], laneOutcomes: [], lanesUsed: 0 }
      let stageFailed = null

      for (let si = 0; si < stages.length; si++) {
        const stage = stages[si]
        if (stage.status === 'done') {
          plog(`Execute: stage ${stage.id} ("${stage.name}") already done — skipping`)
          continue
        }
        // Keep result.stages in sync (the source of truth the resume + tick helpers read).
        if (result.stages[si]) result.stages[si].status = stage.status
        await tickStageFile({ stage, status: 'in-progress', planDir, result, note: `Beginning execution of stage ${stage.id} ("${stage.name}").` })

        // Intra-stage parallelism: a stage owns files; if 2+ file-disjoint lane-groups exist inside
        // it (derived from the plan lanes that touch this stage's files), fan them out. Else single exec.
        const stageFiles = new Set(stage.files || [])
        const stageLanes = (result.lanes || [])
          .filter((l) => l && l.steps && (l.files || []).some((f) => stageFiles.has(f)))
        // Scope each lane's files to this stage (touch ONLY stage files here).
        const scopedLanes = stageLanes.map((l) => ({ ...l, files: (l.files || []).filter((f) => stageFiles.has(f)) }))
        let lanesDisjoint = false
        if (scopedLanes.length >= 2) {
          const seen = new Set()
          lanesDisjoint = true
          for (const lane of scopedLanes) {
            for (const f of lane.files || []) {
              if (seen.has(f)) { lanesDisjoint = false; break }
              seen.add(f)
            }
            if (!lanesDisjoint) break
          }
        }
        const useLanes = allowParallelExecute && scopedLanes.length >= 2 && lanesDisjoint

        let exec
        if (useLanes) {
          plog(`Execute: stage ${stage.id} — ${scopedLanes.length} file-disjoint lanes in parallel`)
          const laneVerdicts = await parallel(scopedLanes.map((lane) => () =>
            agent(
              `You are the plan-executor agent. Execute stage ${stage.id} ("${stage.name}") of the plan at ${planPath}.

Task:
${task}

Stage: ${stage.id} ("${stage.name}")
Lane name: ${lane.name}
Your steps:
${lane.steps}

Your files (touch ONLY these in THIS stage): ${JSON.stringify(lane.files || [])}

Follow the plan's ordered steps for this stage/lane. Write/modify code only within your lane's files.
Do NOT commit. Write tests per the plan's TDD scenarios. The plan's "Regression-mechanics" and
"Edge-case enumeration" sections are a checklist — verify every named construction site in your lane
is updated before declaring completion. ${carriedBlockersLine}
Return completed=true only if your lane's steps are fully executed.`,
              { label: `plan-executor:${stage.id}:${lane.name}`, phase: 'Execute', schema: EXECUTE_VERDICT, model: gm('execute') }
            )
          ))
          const valid = laneVerdicts.filter(Boolean)
          const laneOutcomes = laneVerdicts
            .map((v, i) => v && ({ lane: scopedLanes[i].name, completed: v.completed, files: v.files || [] }))
            .filter(Boolean)
          const allCompleted = valid.length === scopedLanes.length && valid.every((v) => v.completed)
          exec = {
            completed: allCompleted,
            stepsDone: valid.reduce((n, v) => n + (v.stepsDone || 0), 0),
            summary: valid.map((v) => `[${stage.id}:${v.summary || ''}]`).join(' | '),
            files: valid.flatMap((v) => v.files || []),
            _laneVerdicts: laneOutcomes,
          }
          aggregate.lanesUsed = Math.max(aggregate.lanesUsed, scopedLanes.length)
        } else {
          if (scopedLanes.length >= 2 && !lanesDisjoint) {
            plog(`Execute: stage ${stage.id} — lanes overlap files, single executor (merge-safety)`)
          } else {
            plog(`Execute: stage ${stage.id} ("${stage.name}") — single executor`)
          }
          exec = await safeAgent(
            `You are the plan-executor agent. Execute stage ${stage.id} ("${stage.name}") of the plan at ${planPath}.
The full stage detail is in the stage file at ${stage.file}. Read it first.
Task:
${task}

Follow this stage's ordered steps. Write/modify code only as the stage specifies. Do NOT commit.
Write tests per the plan's TDD scenarios. The "Regression-mechanics" and "Edge-case enumeration"
sections are a checklist — verify every named construction site in this stage is updated before
declaring completion. ${carriedBlockersLine}`,
            { label: `plan-executor:${stage.id}`, phase: 'Execute', schema: EXECUTE_VERDICT, model: gm('execute') }, result
          )
          aggregate.lanesUsed = Math.max(aggregate.lanesUsed, 1)
        }
        if (!exec || !exec.completed) {
          stageFailed = { stage, exec }
          if (result.stages[si]) result.stages[si].status = 'blocked'
          await tickStageFile({ stage, status: 'blocked', planDir, result, note: `Stage ${stage.id} did not complete. Executor summary: ${(exec && exec.summary) || '(none)'}.` })
          break
        }
        aggregate.completed = true
        aggregate.stepsDone += exec.stepsDone || 0
        aggregate.files = aggregate.files.concat(exec.files || [])
        if (exec._laneVerdicts) aggregate.laneOutcomes = aggregate.laneOutcomes.concat(exec._laneVerdicts)
        stage.status = 'done'
        if (result.stages[si]) result.stages[si].status = 'done'
        await tickStageFile({ stage, status: 'done', planDir, result, note: `Stage ${stage.id} ("${stage.name}") complete. Files: ${((exec.files || []).join(', ')) || '(none)'}.` })
        plog(`Execute: stage ${stage.id} ("${stage.name}") done (stepsDone=${exec.stepsDone || 0}, files=${(exec.files || []).length})`)
        // Persist after each stage so a mid-run block/resume preserves stage progress.
        result._execute = { completed: false, stepsDone: aggregate.stepsDone, files: aggregate.files, _laneVerdicts: aggregate.laneOutcomes }
        await consolidate(slug, result, config)
      }

      if (stageFailed) {
        result.blockedAt = 'execute'
        result.retryUsed = retryState.used
        result._execute = { completed: false, stepsDone: aggregate.stepsDone, files: aggregate.files, _laneVerdicts: aggregate.laneOutcomes, _failedStage: stageFailed.stage && stageFailed.stage.id }
        stateCheckpoint('Execute', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      result.executed = true
      result._execute = { completed: true, stepsDone: aggregate.stepsDone, files: aggregate.files, _laneVerdicts: aggregate.laneOutcomes }
      result.lanesUsed = aggregate.lanesUsed
      const fileCount = (aggregate.files && aggregate.files.length) || 0
      plog(`Execute: all ${stages.length} stage(s) done (lanesUsed=${result.lanesUsed}, stepsDone=${aggregate.stepsDone || 0}, files=${fileCount})`)
      if (aggregate.laneOutcomes && aggregate.laneOutcomes.length) {
        aggregate.laneOutcomes.forEach((o) => {
          plog(`  lane "${o.lane}": completed=${o.completed}, files=${(o.files || []).join(', ')}`)
        })
      }
    }
    stateCheckpoint('Execute', 'done')

  } // end full-path branch — Gate 4+ run at main() level for BOTH paths

  // Gate 4: Test (with optional gsd-debug recovery) -----------------------
  phase('Test')
  if (result.testsPassed) {
    plog('resume: skip Test (testsPassed set)')
  } else {
    let test = await runTests(testTarget)
    let attempts = 0

    while ((!test || !test.passed) && useGsdDebug && attempts < debugSubcap && !budgetExhausted(retryBudget)) {
      // Phase E2: once already looping (attempts >= 1), ask quick-decider whether another
      // gsd-debug fix cycle is worth it. 'stop' bails to the test-failure hard-block (green
      // cannot be reached) instead of burning the whole debug sub-cap. null -> stop.
      if (useQuickDecider && attempts >= 1) {
        const decide = await runQuickDecider({
          result, planDir, model: gm('quickDecider'), decisionCap,
          opts: {
            loopName: 'gsd-debug',
            iterations: attempts,
            subcap: debugSubcap,
            retryBudget,
            lastFailure: `Tests still failing after ${attempts} gsd-debug fix attempt(s). Last failure summary: ${test && test.summary ? String(test.summary).slice(0, 800) : '(unknown)'}`,
          },
        })
        if (decide === 'stop') {
          plog('Debug: quick-decider said stop — cannot reach green (hard-block test)')
          break
        }
      }
      attempts += 1
      spendRetry(1)
      result.debugRetries = attempts
      phase('Debug')
      plog(`Tests failed — invoking gsd-debug (attempt ${attempts}/${debugSubcap}, retries used ${retryState.used}/${retryBudget})`)
      let debugPrompt = `You are running inside feature-pipeline. Invoke the "gsd-debug" skill via your Skill tool
to diagnose and fix the failing pytest run for this task.

Task:
${task}

Test target: ${testTarget || '(whole suite)'}
Failure summary: ${test && test.summary}
Test command: ${test && test.command}
Plan: ${planPath}
Definition: ${result.definitionPath}

Root-cause the failure and fix the CODE (do not weaken or skip tests). If the gsd-debug skill
or Skill tool is unavailable, debug directly. Return whether you applied a fix you believe
resolves the failures, plus a change summary.`
      // Phase D1: harden the debug prompt on later fix attempts (a prior fix did not reach green).
      if (attempts > 1) {
        debugPrompt = await enhancePrompt({
          gateKey: 'gsd-debug',
          basePrompt: debugPrompt,
          failureContext: `gsd-debug attempt ${attempts}: prior code fix(es) did not resolve the test failures. Tests still failing: ${test && test.summary ? String(test.summary).slice(0, 800) : '(unknown)'}`,
          intent: 'improve-design',
          result, planDir, useEnhancer,
        })
      }
      const dbg = await agent(
        debugPrompt,
        { label: 'gsd-debug', phase: 'Debug', schema: DEBUG_VERDICT, model: gm('gsdDebug') }
      )
      result._debug = dbg
      if (!dbg || !dbg.fixed) {
        break // gsd-debug could not fix -> stop retrying
      }
      phase('Test')
      test = await runTests(testTarget)
    }

    if (!test || !test.passed) {
      result.testSummary = test && test.summary
      result._testRun = test
      result.blockedAt = 'test'
      plog(`Test: FAILED — ${test && test.summary || '(no summary)'}; debugRetries=${result.debugRetries}`)
      result.retryUsed = retryState.used
      stateCheckpoint('Test', 'blocked')
      await consolidate(slug, result, config)
      return result
    }
    result.testsPassed = true
    result.testSummary = test.summary
    result._testRun = test
    plog(`Test: PASSED — ${test.summary || '(no summary)'}`)
  }
  stateCheckpoint('Test', 'done')

  // Gate 5: Code review ---------------------------------------------------
  phase('Code Review')
  if (result.ready) {
    plog('resume: skip Code Review (ready set)')
  } else {
    plog('Reviewing code diff')
    const codeReview = await safeAgent(
      `You are the critical-reviewer agent. Review the current git working-tree diff (git diff)
for the task: ${task}

Plan: ${planPath}
Definition: ${result.definitionPath}

Look for bugs, logic errors, security issues (OWASP), and adherence to project conventions.
Return accepted=true iff there are NO blocker-severity findings. List blockers otherwise.
Do NOT include formatting nits unless they change meaning.`,
      { label: 'critical-reviewer(code)', phase: 'Code Review', schema: REVIEW_VERDICT, model: gm('codeReview') }, result
    )
    if (!codeReview) {
      result.blockedAt = 'code-review'
      result.retryUsed = retryState.used
      if (useKnowledgePersist) await persistFindings(result)
      stateCheckpoint('Code Review', 'blocked')
      await consolidate(slug, result, config)
      return result
    }
    result.codeReview = {
      blockers: codeReview.blockers,
      issues: codeReview.issues,
      summary: codeReview.summary,
    }
    plog(`Code Review: issues=${codeReview.issues || 0}, blockers=${(codeReview.blockers || []).length}`)
    const hasBlocker = (codeReview.blockers || []).some(
      (b) => b.severity === 'blocker' || b.severity === 'high'
    )
    if (hasBlocker) {
      result.blockedAt = 'code-review'
      result.retryUsed = retryState.used
      if (useKnowledgePersist) await persistFindings(result)
      stateCheckpoint('Code Review', 'blocked')
      await consolidate(slug, result, config)
      return result
    }
  }
  stateCheckpoint('Code Review', 'done')

  // Gate 5.1: Commit Goalkeeper (Phase E3 — complex-decision-analyst) ---------
  // After final code-review passes, an authoritative decision-agent decides COMMIT vs LOOP-BACK.
  //   - DESIGN mode: loop-back + targetPhase -> set result._loopBack so the E4 do/while clears that
  //     gate + downstream and re-enters (legacy in-memory rewind). commit -> proceed to publish/commit.
  //   - IMPLEMENT mode (Phase I): implement CANNOT rewind into design. loop-back to a DESIGN gate
  //     (requirements|architecture|design|plan) -> classify each trueDefect; UPSTREAM findings append
  //     to issues-and-improvements.md, then BLOCK (blockedAt='issues-handoff') + STOP, telling the user
  //     to run /tune-feature. loop-back to 'tests' is a code path -> treated as code (no issues file).
  //     --no-issues degrades loop-back to a plain block (backward-compat escape hatch).
  // Skipped when disabled (--no-goalkeeper) or on the gsd-quick fast-path. Non-blocking to readiness:
  // on null/commit the run proceeds normally.
  result._loopBack = null
  if (useGoalkeeper && !gsdQuick && !result._goalkeeper) {
    phase('Goalkeeper')
    plog('Goalkeeper: deciding commit vs loop-back')
    const maxPasses = 3 // bound goalkeeper-driven re-runs; decision-cap is the hard floor anyway
    let pass = 0
    let goalkeeperDecision = await runGoalkeeper({ result, planDir, model: gm('decisionAnalyst'), decisionCap, pass: pass + 1, maxPasses })
    pass += 1
    await appendDecisionLog(planDir, `## Goalkeeper pass ${pass}/${maxPasses}\nDecision: ${goalkeeperDecision.decision}${goalkeeperDecision.decision === 'loop-back' ? ' -> ' + goalkeeperDecision.targetPhase : ''}\nTrueDefects: ${JSON.stringify(goalkeeperDecision.trueDefects || [])}\n`, result)
    const isDesignLoopback = goalkeeperDecision.decision === 'loop-back'
      && goalkeeperDecision.targetPhase
      && goalkeeperDecision.targetPhase !== 'none'
      && goalkeeperDecision.targetPhase !== 'tests'
    if (isImplementMode && isDesignLoopback) {
      // Phase I issues-handoff: classify each trueDefect; record upstream ones; STOP for tune.
      const defects = (goalkeeperDecision.trueDefects || []).slice()
      plog(`Goalkeeper: loop-back -> ${goalkeeperDecision.targetPhase} in implement mode — ${defects.length} defect(s) to classify`)
      await appendDecisionLog(planDir, `_Implement mode: loop-back -> ${goalkeeperDecision.targetPhase} treated as issues-handoff (no rewind). Classifying ${defects.length} defect(s)._\n`, result)
      let upstreamCount = 0
      if (useIssues) {
        for (const defect of defects) {
          const classified = await classifyAndRecordIssue({ finding: defect, planDir, result })
          if (classified && classified.isUpstream) upstreamCount += 1
        }
      } else {
        plog('Goalkeeper: --no-issues — skipping classification; plain block (no issues file)')
      }
      result.blockedAt = 'issues-handoff'
      result.retryUsed = retryState.used
      result.handoff = {
        from: 'implement',
        message: upstreamCount > 0
          ? `Upstream defect found (${upstreamCount} upstream issue(s) written to ${planDir}issues-and-improvements.md). Run: /tune-feature ${planDir}`
          : `Upstream-flagged defect recorded but none classified upstream. Review the code-review/goalkeeper findings; re-run /implement-feature ${planDir} after fixing, or /tune-feature ${planDir} to revisit design.`,
        nextMode: 'tune',
        planDir,
        upstreamCount,
      }
      plog(`Goalkeeper: issues-handoff — ${upstreamCount} upstream issue(s); blocking for tune`)
      stateCheckpoint('Goalkeeper', 'issues-handoff')
      await consolidate(slug, result, config)
      return result
    } else if (goalkeeperDecision.decision === 'loop-back' && goalkeeperDecision.targetPhase && goalkeeperDecision.targetPhase !== 'none') {
      const target = goalkeeperDecision.targetPhase
      plog(`Goalkeeper: LOOP-BACK -> ${target} — clearing gate + downstream markers, re-running`)
      await appendDecisionLog(planDir, `_Loop-back to ${target}; downstream gates will re-run (pass ${pass}/${maxPasses})._\n`, result)
      clearGateAndDownstream(result, target)
      result._loopBack = { targetPhase: target, pass }
      // NOTE: do NOT set result.ready here. The E4 do/while (below) sees result._loopBack and
      // re-runs the full-path section; readiness is set only when the re-run passes code review again.
    } else {
      plog(`Goalkeeper: COMMIT — proceeding to publish/commit`)
    }
  } else if (!useGoalkeeper) {
    stateCheckpoint('Goalkeeper', 'skipped')
  }

  // All hard gates passed (unless the goalkeeper looped back — then readiness is deferred).
  if (!result._loopBack) {
    result.ready = true
  }

  // ===== Phase E4: close state-machine loop ===================================
  // Loop while the goalkeeper set a loop-back directive. Decision cap is the hard floor:
  // if it is exhausted mid-loop-back, hard-block (resumable) instead of spinning forever.
    } while (result._loopBack && !decisionBudgetExhausted(decisionCap))
    if (result._loopBack && decisionBudgetExhausted(decisionCap)) {
      result.blockedAt = 'goalkeeper'
      result.retryUsed = retryState.used
      result._uncaughtError = `decision cap exhausted (${decisionState.used}/${decisionCap}) during a goalkeeper loop-back`
      plog(`Phase E4: decision cap exhausted during loop-back — hard-block (resumable via --resume)`)
      stateCheckpoint('Goalkeeper', 'blocked')
      await consolidate(slug, result, config)
      return result
    }
  // ===== end Phase E4 loop ====================================================


  // Gate 5.4: Publish docs (adopted agent, non-blocking) ------------------
  // Publishes/organizes the plan + architecture design into project docs.
  // Never blocks the pipeline; on failure logs and sets published={published:false}.
  if (result.published) {
    plog('resume: skip Publish (published set)')
  } else if (!usePublish) {
    stateCheckpoint('Publish', 'skipped')
  } else {
    phase('Publish')
    plog('Publishing plan + architecture to project docs')
    await publishDesign(result, planPath, task)
    stateCheckpoint('Publish', 'done')
  }

  // Gate 5.5: Persist (adopted agent, non-blocking) ----------------------
  if (useKnowledgePersist && !result.persist) {
    phase('Persist')
    await persistFindings(result)
    plog(`Persist: persisted=${result.persist && result.persist.persisted}`)
  }
  stateCheckpoint('Persist', 'done')

  // ONE consolidated todo-store write on success (ready checkpoint).
  result.retryUsed = retryState.used
  await consolidate(slug, result, config)

  // Gate 6: Commit (optional, irreversible) -------------------------------
  if (autoCommit && !result.committed) {
    phase('Commit')
    plog('Committing (autoCommit=true)')
    const commit = await agent(
      `You are the git-ops agent. Stage and commit the current changes for this task:
${task}

Commit on the current branch (do NOT push unless already instructed).
Use a clear conventional-commit message. Return the commit hash.`,
      { label: 'git-ops', phase: 'Commit', schema: COMMIT_VERDICT, model: gm('commit') }
    )
    result.committed = !!(commit && commit.committed)
    result.commitHash = commit ? commit.commitHash : null
    plog(`Commit: committed=${result.committed}; hash=${result.commitHash || '(none)'}`)
  }

    // Reflect the true terminal gate in the persisted state and flush once more
    // so a committed run records committed=true (idempotent / resumable).
    stateCheckpoint(result.committed ? 'Commit' : 'Done', 'done')
    result.retryUsed = retryState.used
    await consolidate(slug, result, config)

    return result
  } catch (e) {
    // Safety net: a throw escaped the pipeline body. Persist so the run is --resume-able,
    // then return a blocked result rather than letting the Workflow tool report a raw crash.
    const msg = String(e && e.message ? e.message : e)
    plog(`UNCAUGHT pipeline error (safety net caught): ${msg}`)
    result.blockedAt = result.blockedAt || 'uncaught-throw'
    result._uncaughtError = msg
    result.retryUsed = retryState.used
    stateCheckpoint(result.blockedAt, 'blocked')
    try {
      await consolidate(slug, result, config)
    } catch (persistErr) {
      // Last resort: even consolidate failed. Log; still return blocked result.
      log(`SAFETY NET: consolidate also failed: ${String(persistErr)}`)
    }
    return result
  }
}

const final = await main()
return final
