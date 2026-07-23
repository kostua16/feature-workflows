import { validatePipelineState } from './state.mjs'
import { safeAgent } from './agent-core.mjs'


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
    passed: { type: 'boolean', description: 'true if the test run exited 0' },
    summary: { type: 'string', description: 'Short result line, e.g. "12 passed"' },
    command: { type: 'string', description: 'The exact test command that was run' },
  },
}

const TEST_AUTHORING_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['written', 'summary'],
  properties: {
    written: { type: 'boolean', description: 'true if the planned RED/coverage tests were written or already existed' },
    summary: { type: 'string', description: 'Short summary of tests authored or confirmed' },
    files: {
      type: 'array',
      description: 'Test files created or updated',
      items: { type: 'string' },
    },
    redTests: {
      type: 'array',
      description: 'RED tests added before implementation',
      items: { type: 'string' },
    },
    evidence: {
      type: 'array',
      description: 'Concrete evidence such as test names, commands, or existing coverage refs',
      items: { type: 'string' },
    },
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
    totalBytes: { type: 'number', description: 'EN-4: total size of the file in bytes AFTER the write (used to verify append-only files grew and were not overwritten). Report it for append operations.' },
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
    checksum: { type: 'string', description: 'IM-1: djb2 hash of JSON.stringify(result), verified on resume (validatePipelineState) to detect a truncated chunked write. Optional — pre-checksum state files still resume.' },
    result: { type: 'object', description: 'Full pipeline result object (verbatim). Phase F-K split adds optional fields inside result: mode (design|implement|tune|extract), stages[], designReady, issuesPath, tunePlan, handoff. v1.2.0 adds gateTelemetry (per-gate agent-call counters), designApproved + approvalPending (human design-approval checkpoint). v1.3.0 extract mode adds extractScope, scopeManifestPath, scopeConfirmed, extractQueue[], overviewPath, extractReady, auditPath. All default so older state still hydrates.' },
    config: { type: 'object', description: 'args-derived flags, so resume re-derives without re-parsing. Gains mode/useChunker/useIssues/useTuneConfirm (Phase F-K); useApproval (v1.2.0); useScopeConfirm/useDecompose/useAudit/useExtractRequirements/useExtractReview/maxSlices/slices (v1.3.0 extract); useReviewVerify/minSeverity/reviewLenses (v1.4.0 review).' },
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

const ARTIFACT_CHECK = {
  type: 'object',
  additionalProperties: false,
  required: ['exists', 'sizeBytes', 'summary'],
  properties: {
    exists: { type: 'boolean' },
    sizeBytes: { type: 'integer' },
    hasExpectedHeadings: { type: 'boolean' },
    summary: { type: 'string' },
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

// scope-resolver (extract Gate X0): resolve the hybrid extract input (free text / paths /
// globs / entry points) into a concrete scope manifest written to <planDir>/scope-manifest.md.
// Gate = scopePath + files populated. `wide=true` routes into the decomposition gate.
const SCOPE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['scopePath', 'files', 'wide', 'summary'],
  properties: {
    scopePath: { type: 'string', description: 'Path to the scope-manifest.md written' },
    files: { type: 'array', items: { type: 'string' }, description: 'Concrete resolved file paths in scope' },
    entryPoints: { type: 'array', items: { type: 'string' }, description: 'Observable entry points (API routes, CLI commands, event handlers, exported functions)' },
    symbols: { type: 'array', items: { type: 'string' }, description: 'Key symbols (classes/functions) anchoring the scope' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How confident the resolver is that the scope matches the input' },
    ambiguities: { type: 'array', items: { type: 'string' }, description: 'Scope ambiguities recorded to open-questions.md (non-blocking)' },
    wide: { type: 'boolean', description: 'true when the scope spans multiple coherent subsystems and should be decomposed into slices' },
    suggestedSlices: {
      type: 'array',
      description: 'When wide: candidate feature/subsystem slices for the decomposition gate',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', description: 'kebab-case slice id' },
          name: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          entryPoints: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string', description: 'why this is a coherent slice' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// subsystem-decomposer (extract Gate X1): split a confirmed wide scope into dependency-aware
// feature/subsystem slices. Gate = slices non-empty. The slice list seeds the resumable
// extract queue (one full extraction cycle runs per slice).
const DECOMPOSE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['slices', 'summary'],
  properties: {
    slices: {
      type: 'array',
      description: 'Dependency-aware feature/subsystem slices (each gets its own extraction cycle)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'files'],
        properties: {
          id: { type: 'string', description: 'kebab-case slice id' },
          name: { type: 'string', description: 'short human-readable slice name' },
          files: { type: 'array', items: { type: 'string' }, description: 'files this slice owns' },
          entryPoints: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'slice ids this slice depends on (extraction order hint)' },
        },
      },
    },
    overviewNotes: { type: 'string', description: 'cross-slice observations for the system-overview synthesis' },
    summary: { type: 'string' },
  },
}

// as-is design auditor (extract Gate X7): audit the EXTRACTED design docs for design debt,
// gaps, and doc<->code inconsistencies. Findings mirror ISSUE_CLASSIFY_VERDICT's field shape
// (severity/gate/finding/suggestedFix) so they append to issues-and-improvements.md in the
// exact section format the tune planner already consumes.
const AUDIT_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['auditPath', 'findings', 'summary'],
  properties: {
    auditPath: { type: 'string', description: 'Path to the design-audit.md written' },
    findings: {
      type: 'array',
      description: 'Design-debt / gap / inconsistency findings on the extracted design',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'gate', 'finding'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          gate: {
            type: 'string',
            enum: ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'],
            description: 'which design gate owns the doc this finding maps to ("none" if purely code-level)',
          },
          finding: { type: 'string', description: 'the issue, phrased for a design-doc author' },
          suggestedFix: { type: 'string' },
          evidence: { type: 'string', description: 'file:line evidence from the code' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// review-mode lens reviewer (Gate R1): one critical-reviewer pass over the WHOLE design
// docset through a single review dimension (lens). Finding shape mirrors AUDIT_VERDICT /
// ISSUE_CLASSIFY_VERDICT (severity/gate/finding/suggestedFix) so confirmed findings append
// to issues-and-improvements.md in the exact section format the tune planner consumes.
const REVIEW_FINDINGS_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      description: 'Design issues found through this lens across the whole docset',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'gate', 'finding'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          gate: {
            type: 'string',
            enum: ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'],
            description: 'which design gate owns the doc that must change to fix this ("none" if out of the docset\'s control)',
          },
          finding: { type: 'string', description: 'the issue, phrased for a design-doc author' },
          suggestedFix: { type: 'string' },
          evidence: { type: 'string', description: 'doc file:line (or section) evidence for the finding' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// review-mode merger (Gate R2): dedup/merge the union of all lens findings against each
// other AND against issues already recorded in issues-and-improvements.md (so a re-run
// never re-records the same issue). Gate = findings array present (possibly empty).
const REVIEW_MERGE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      description: 'Deduplicated findings (overlapping lens findings merged into one)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'gate', 'finding'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          gate: { type: 'string', enum: ['requirements', 'architecture', 'design', 'plan', 'tests', 'none'] },
          finding: { type: 'string' },
          suggestedFix: { type: 'string' },
          evidence: { type: 'string' },
          lenses: { type: 'array', items: { type: 'string' }, description: 'lens keys that surfaced this finding' },
        },
      },
    },
    droppedDuplicates: { type: 'number', description: 'raw findings merged away as duplicates (incl. already-recorded issues)' },
    summary: { type: 'string' },
  },
}

// review-mode adversarial verifier (Gate R3): an independent reviewer tries to REFUTE one
// merged finding against the actual docs. Only confirmed findings reach the issues file —
// a false positive recorded here would send /tune-feature revising healthy design docs.
const REVIEW_VERIFY_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'reasoning'],
  properties: {
    confirmed: { type: 'boolean', description: 'true = the finding survives an active refutation attempt' },
    reasoning: { type: 'string' },
    adjustedSeverity: {
      type: 'string',
      enum: ['blocker', 'high', 'medium', 'low'],
      description: 'corrected severity when the finding is real but mis-rated (omit to keep the original)',
    },
  },
}

// system-overview synthesizer (extract Gate X8, multi-slice only): synthesize per-slice
// architectures into <parentPlanDir>/system-overview.md with a slice index table.
const OVERVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['overviewPath', 'summary'],
  properties: {
    overviewPath: { type: 'string', description: 'Path to the system-overview.md written' },
    sliceIndex: {
      type: 'array',
      description: 'Index of the slices covered by the overview',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'planDir', 'status'],
        properties: {
          id: { type: 'string' },
          planDir: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

// --- Pending-confirmation protocol schemas (extract D0) -------------------

// PREFLIGHT_VERDICT: returned by resolveScopePreflight — wraps a SCOPE_VERDICT with
// the pending-confirmation lifecycle fields. The pendingId is engine-generated
// (deterministic djb2 of task+timestamp); the agent resolves the scope but does NOT
// write any files. State transitions: PENDING → PROMOTED (on --confirm).
const PREFLIGHT_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['pendingId', 'task', 'verdict', 'state', 'createdAt'],
  properties: {
    pendingId: { type: 'string', description: 'Deterministic 16-hex confirmation id' },
    task: { type: 'string' },
    verdict: { type: 'object', description: 'Full SCOPE_VERDICT from the preflight resolution' },
    state: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'PROMOTED'] },
    createdAt: { type: 'string', description: 'ISO-like timestamp from args.timestamp' },
    promotedAt: { type: 'string' },
    planDir: { type: 'string' },
    fileHashes: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash from the hash-sources agent',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string', description: 'Repo-relative POSIX path' },
          contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
        },
      },
    },
    scopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs' },
    featureId: { type: 'string', description: 'Deterministic feature id: <primarySlug>-<scopeId16>' },
    derivedPlanDir: { type: 'string', description: 'Deterministic docs/extract/<area>/<featureId>/ path' },
  },
}

// PENDING_RECORD: shape of docs/extract/.pending/<pendingId>.json — the durable
// scratch checkpoint written by the preflight and updated on promotion.
const PENDING_RECORD = {
  type: 'object',
  additionalProperties: false,
  required: ['pendingId', 'task', 'verdict', 'state', 'createdAt'],
  properties: {
    pendingId: { type: 'string' },
    task: { type: 'string' },
    verdict: { type: 'object' },
    state: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'PROMOTED', 'EXPIRED'] },
    createdAt: { type: 'string' },
    promotedAt: { type: 'string' },
    planDir: { type: 'string' },
    expiredAt: { type: 'string', description: 'Set when the bulky payload is TTL-expired' },
    fileHashes: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash from the hash-sources agent',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string', description: 'Repo-relative POSIX path' },
          contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
        },
      },
    },
    scopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs' },
    featureId: { type: 'string', description: 'Deterministic feature id: <primarySlug>-<scopeId16>' },
    derivedPlanDir: { type: 'string', description: 'Deterministic docs/extract/<area>/<featureId>/ path' },
  },
}

// HASH_SOURCES_VERDICT: the hash-sources agent reads each file, computes per-file
// SHA-256 (64-hex), then frames sorted [path, contentSha256] pairs as JSON and
// SHA-256s that to produce scopeDigest. Agent-mediated — the engine never hashes.
const HASH_SOURCES_VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'scopeDigest'],
  properties: {
    files: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string', description: 'Repo-relative POSIX path' },
          contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
        },
      },
    },
    scopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs' },
  },
}

// IDENTITY_RECORD: shape of <planDir>/.identity.json. The ownershipScopeDigest is the
// immutable full 64-hex SHA-256 scope digest, fixed at creation (never overwritten).
const IDENTITY_RECORD = {
  type: 'object',
  additionalProperties: false,
  required: ['featureId', 'planDir', 'ownershipScopeDigest', 'area', 'createdAt'],
  properties: {
    featureId: { type: 'string', description: 'Deterministic feature id' },
    planDir: { type: 'string', description: 'Repo-relative POSIX folder path' },
    ownershipScopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 scope digest (immutable at creation)' },
    area: { type: 'string', description: 'First-2-segment area, fixed at creation' },
    scopeId16: { type: 'string', description: '16-hex display/folder id' },
    createdAt: { type: 'string' },
  },
}

// LOCATOR_ENTRY: compact permanent record in docs/extract/.pending-locator.json.
// Retained indefinitely so --confirm <pendingId> always resolves to the authoritative
// folder even after the bulky pending payload is TTL-expired.
const LOCATOR_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['pendingId', 'featureId', 'planDir', 'promotedAt'],
  properties: {
    pendingId: { type: 'string' },
    featureId: { type: 'string' },
    planDir: { type: 'string' },
    promotedAt: { type: 'string' },
  },
}

// REGISTRY_ENTRY: a single feature's entry in docs/extract/.registry.json.
// The files array carries current per-file hashes (mutable — rebuilt from
// pipeline-state on recovery). Immutable ownership fields come from .identity.json.
const REGISTRY_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['featureId', 'planDir', 'ownershipScopeDigest', 'scopeId16', 'files', 'status', 'updatedAt'],
  properties: {
    featureId: { type: 'string', description: 'Deterministic feature id' },
    planDir: { type: 'string', description: 'Repo-relative POSIX folder path' },
    ownershipScopeDigest: { type: 'string', description: 'Full 64-hex SHA-256 scope digest (immutable, mirrors .identity.json)' },
    scopeId16: { type: 'string', description: '16-hex display/folder id' },
    files: {
      type: 'array',
      description: 'Current file set with content hashes',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string' },
          contentSha256: { type: 'string' },
        },
      },
    },
    anchorPath: { type: 'string', description: 'Anchor file path (lex-smallest, immutable ownership evidence)' },
    status: { type: 'string', enum: ['extracting', 'current', 'stale'], description: 'Registry lifecycle status' },
    updatedAt: { type: 'string', description: 'ISO timestamp of last registry update' },
  },
}

// REGISTRY_FILE: the top-level registry shape — a map of featureId to REGISTRY_ENTRY.
const REGISTRY_FILE = {
  type: 'object',
  additionalProperties: false,
  required: ['features'],
  properties: {
    features: {
      type: 'object',
      description: 'Map of featureId to REGISTRY_ENTRY',
      additionalProperties: REGISTRY_ENTRY,
    },
  },
}

// RECONCILE_FILE: a file with its content fingerprint (shared input/output shape for reconcile).
const RECONCILE_FILE = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'contentSha256'],
  properties: {
    path: { type: 'string', description: 'Repo-relative POSIX path' },
    contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
  },
}

// RECONCILE_DELTA: change record returned by reconcileSlices.
const RECONCILE_DELTA = {
  type: 'object',
  additionalProperties: false,
  required: ['added', 'removed', 'moved', 'newSlices', 'removedSlices', 'overlaps'],
  properties: {
    added: {
      type: 'array',
      description: 'Files assigned to an existing non-removed slice via prefix score',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256', 'sliceId'],
        properties: {
          path: { type: 'string' },
          contentSha256: { type: 'string' },
          sliceId: { type: 'string', description: 'Slice that received the file' },
        },
      },
    },
    removed: {
      type: 'array',
      description: 'Files dropped from their owner (old path no longer in current set)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sliceId'],
        properties: {
          path: { type: 'string' },
          sliceId: { type: 'string', description: 'Slice that lost the file' },
        },
      },
    },
    moved: {
      type: 'array',
      description: 'Files whose path changed but contentSha256 uniquely matches a gone old path',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['oldPath', 'newPath', 'contentSha256', 'sliceId'],
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
          contentSha256: { type: 'string' },
          sliceId: { type: 'string', description: 'Original owner (unchanged)' },
        },
      },
    },
    newSlices: {
      type: 'array',
      description: 'New slices created from zero-score clusters',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sliceId', 'files'],
        properties: {
          sliceId: { type: 'string' },
          files: { type: 'array', items: RECONCILE_FILE },
        },
      },
    },
    removedSlices: {
      type: 'array',
      description: 'Slices emptied by membership loss (terminal for re-extraction)',
      items: { type: 'string' },
    },
    overlaps: {
      type: 'array',
      description: 'Overlap conflicts resolved by lex-smallest sliceId',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'winnerSliceId', 'loserSliceId'],
        properties: {
          path: { type: 'string' },
          winnerSliceId: { type: 'string' },
          loserSliceId: { type: 'string' },
        },
      },
    },
  },
}

// SLICE_DIGEST: shape of <sliceDir>/.source-digest.json — per-file fingerprints + slice digest.
const SLICE_DIGEST = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'digest'],
  properties: {
    files: {
      type: 'array',
      description: 'Per-file path + SHA-256 content hash (fingerprints for change detection)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'contentSha256'],
        properties: {
          path: { type: 'string', description: 'Repo-relative POSIX path' },
          contentSha256: { type: 'string', description: 'Full 64-hex SHA-256 of file content' },
        },
      },
    },
    digest: { type: 'string', description: 'Full 64-hex SHA-256 over framed sorted (path, contentSha256) pairs for this slice' },
  },
}

// SLICE_DIGEST_RESULT: agent return for per-slice SHA-256 digest computation.
const SLICE_DIGEST_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['slices'],
  properties: {
    slices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sliceId', 'digest'],
        properties: {
          sliceId: { type: 'string', description: 'Slice identifier' },
          digest: { type: 'string', description: 'Full 64-hex SHA-256 of the framed per-file pairs' },
        },
      },
    },
  },
}

const INVALIDATION_EVENT = {
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'key', 'action'],
  properties: {
    sliceId: { type: 'string', description: 'Slice whose evidence was invalidated' },
    key: { type: 'string', description: 'Durable key that was versioned or removed' },
    action: { type: 'string', enum: ['versioned', 'removed', 'superseded'], description: 'How the key was invalidated (no-demote: never demoted)' },
    reason: { type: 'string', description: 'Why the evidence was invalidated' },
  },
}

export { DEFINE_VERDICT, TRANSLATOR_VERDICT, KEBAB_PAT, CATEGORY_VERDICT, PLAN_VERDICT, REVIEW_VERDICT, REFINE_VERDICT, EXECUTE_VERDICT, TEST_VERDICT, TEST_AUTHORING_VERDICT, COMMIT_VERDICT, TODO_ACK, FILE_ACK, GSD_RUN_VERDICT, DEBUG_VERDICT, ESCALATION_REVIEW, QUICK_DECISION_SCHEMA, GOALKEEPER_SCHEMA, ARCH_VERDICT, DETAILED_DESIGN_VERDICT, TDD_VERDICT, PERSIST_VERDICT, KNOWLEDGE_VERDICT, INTERVIEW_VERDICT, E2E_USECASE_VERDICT, CODEBASE_FACTS_VERDICT, REQUIREMENTS_VERDICT, DESIGN_REVISE_VERDICT, DESIGN_REVIEW_VERDICT, ENHANCER_VERDICT, RECONCILE_VERDICT, PUBLISH_VERDICT, PIPELINE_STATE, PIPELINE_STATE_READ, ARTIFACT_CHECK, STAGE_PLAN_VERDICT, ISSUE_CLASSIFY_VERDICT, TUNE_PLAN_VERDICT, SCOPE_VERDICT, DECOMPOSE_VERDICT, AUDIT_VERDICT, REVIEW_FINDINGS_VERDICT, REVIEW_MERGE_VERDICT, REVIEW_VERIFY_VERDICT, OVERVIEW_VERDICT, PREFLIGHT_VERDICT, PENDING_RECORD, LOCATOR_ENTRY, HASH_SOURCES_VERDICT, IDENTITY_RECORD, REGISTRY_ENTRY, REGISTRY_FILE, RECONCILE_FILE, RECONCILE_DELTA, SLICE_DIGEST, SLICE_DIGEST_RESULT, INVALIDATION_EVENT }
