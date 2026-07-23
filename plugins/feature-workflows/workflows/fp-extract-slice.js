// fp-extract-slice.js
// engine-version: 1.4.5
// GENERATED FILE — do not edit. Source: workflows/src/*.mjs; rebuild with `npm run build`.
// Leaf workflow: extract design docs for one admitted feature.
//
// Run via:
//   Workflow({ scriptPath: "~/.claude/workflows/fp-extract-slice.js",
//              args: { slice: { id, name, planDir, files, ... }, task: "...", config: { ... } } })

export const meta = {
  name: 'fp-extract-slice',
  version: '1.4.5',
  description: 'Leaf workflow: extract design docs for one admitted feature through the per-slice extraction gates (code facts, e2e use cases, detailed design, architecture, fidelity reviews, requirements, audit). Processes exactly one feature; the top-level pipeline retains discovery, scheduling, synthesis, continuation, and readiness authority.',
  phases: [
    { title: 'Extract Slice' },
    { title: 'Design Audit' },
  ],
}

const ENGINE_VERSION = '1.4.5';

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
const ESCALATION_RETRIES_DEFAULT = 5 // configurable cap on plan-review escalation retries (DLOOP-01)
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

// Maps artifact path keys to their checkpoint gate names so digest-driven
// verification can look up the durable checkpoint recorded at gate completion.
const ARTIFACT_CHECKPOINT_GATE_MAP = {
  definitionPath: 'define',
  requirementsPath: 'requirements',
  archPath: 'architecture',
  designPath: 'detailed-design',
  planPath: 'plan',
}

// Deterministic artifact verification using the durable digest/revision
// contract. When a gate was durably checkpointed and its artifact digest was
// recorded, the artifact is verified without trusting an LLM self-report.
// Pure: no I/O, no side effects.
function verifyArtifactDigest(result, pathKey) {
  if (!result || !pathKey) return { verified: false, reason: 'no-path-key', digest: null }
  const checkpoints = result._designCheckpoints || {}
  const digests = result._artifactDigests || {}
  const gateName = ARTIFACT_CHECKPOINT_GATE_MAP[pathKey]
  if (!gateName) return { verified: false, reason: 'no-gate-mapping', digest: null }
  const cp = checkpoints[gateName]
  const digest = digests[pathKey]
  if (!cp || !cp.acknowledged) return { verified: false, reason: 'no-checkpoint', digest: null }
  if (!digest) return { verified: false, reason: 'no-digest', digest: null }
  return { verified: true, reason: 'checkpoint-verified', digest }
}


// Consolidate the full pipeline result into ONE durable todo-store record.
// R4 replaces ~16 per-gate checkpoint() calls with this single write: gate
// verdicts (with their self-summarizing notes/evidence fields) already carry
// everything each stage decided, so we persist the whole result object once on
// success and once per hard-block exit. Prior context is passed between gates
// in-prompt from the in-memory `result`, not via todo-store reads.
async function consolidate(slug, result, config) {
  // IM-2: stamp BOTH live budget counters at the single persist boundary so every
  // consolidate captures them, independent of where they were last spent. retryUsed is
  // also set ad hoc at each gate, but decisionUsed was only touched at the two decision
  // spend sites — centralizing here guarantees a --resume that never spent a decision
  // (or spent one long before the exit) still round-trips the true decision budget.
  result.retryUsed = retryState.used
  result.decisionUsed = decisionState.used
  // R5/R6: flush the in-memory pipeline log to <planDir>/pipeline.log AND the
  // durable pipeline-state.json alongside the todo-store write, so every
  // consolidate point (success + each hard-block exit) persists the run log and
  // the resumable state. All three are non-fatal if they fail.
  if (result.planPath) {
    const planDir = result.planPath.replace(/plan\.md$/, '')
    await flushPipelineLog(planDir, result)
    await flushPipelineState(planDir, result, config)
  }
  return safeAgent(
    `You are the todo-store agent. Write ONE consolidated record for task slug "${slug}"
under .planning/todos/. Capture the full pipeline result (JSON) verbatim as the durable task record:

${JSON.stringify(result, null, 2)}

Create or replace the todo entry for this task slug. Do NOT read or modify unrelated tasks.
Return ok=true once written.`,
    { label: 'todo-store:consolidate', phase: 'Checkpoint', agentType: nsAgent('todo-store'), schema: TODO_ACK, model: gm('todo') },
    result
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
      await safeAgent(
        `You are a file-writer agent. ${isFirst ? `Write (create/overwrite) the file at ${filePath}. Create the parent directory if needed.` : `APPEND to the existing file ${filePath} (do not overwrite what is already there).`}
This is chunk ${i + 1} of ${total}. Write the body below verbatim, then return ok=true.

${chunks[i]}`,
        { label: `${labelPrefix}(${i + 1}/${total})`, phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
        result
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

// IM-1: deterministic integrity check for pipeline-state.json. The state file is
// written through an LLM file-writer in ~12k-char chunks, so a failed middle chunk
// can leave a file that still parses as JSON but silently drops fields. We can't
// checksum on the host (the engine has no FS), so we embed a self-describing checksum
// over the serialized `result` and re-verify it on resume. djb2 is a small, pure,
// dependency-free string hash — enough to catch truncation/corruption, not a security MAC.
function stateChecksum(str) {
  const s = String(str == null ? '' : str)
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0 // h * 33 + c, kept unsigned
  }
  return h.toString(16)
}

// EN-2: structural validation of a hydrated pipeline-state.json before resume trusts
// it. `loadPipelineState` hydrates whatever the reader returns into 25+ result flags, so
// a corrupt/truncated file (IM-1) would poison the run. Pure: returns {ok, errors[]}.
// Also verifies the IM-1 checksum when present (older state files without it still pass
// the structural check — the checksum is advisory, not required, for backward-compat).
function validatePipelineState(state) {
  const errors = []
  if (!state || typeof state !== 'object') {
    return { ok: false, errors: ['state is not an object'] }
  }
  for (const key of ['task', 'slug', 'planPath', 'planDir']) {
    if (typeof state[key] !== 'string' || !state[key]) errors.push(`missing/invalid ${key}`)
  }
  if (!state.result || typeof state.result !== 'object') {
    errors.push('missing/invalid result object')
  }
  if (state.config !== undefined && (typeof state.config !== 'object' || state.config === null)) {
    errors.push('config present but not an object')
  }
  if (typeof state.checksum === 'string' && state.result) {
    const actual = stateChecksum(JSON.stringify(state.result))
    if (actual !== state.checksum) errors.push(`checksum mismatch (state file may be truncated/corrupt): expected ${state.checksum}, got ${actual}`)
  }
  return { ok: errors.length === 0, errors }
}

// Status-report helpers (status mode). All three are pure and defensive against results
// hydrated from older pipeline-state.json files (any flag may be absent) — a status query
// must render best-effort, never throw.

// Map the result's completion flags onto a gate list with done/pending/blocked status.
// `blocked` is attributed by substring-matching result.blockedAt against the gate name
// (covers blockedAt='test' vs gate 'tests' AND compound names like 'detailed-design' vs
// gate 'design'); non-gate block reasons (issues-handoff, uncaught-throw, …) surface in
// the report header instead.
function summarizeGates(result) {
  const r = result || {}
  const rows = [
    ['define', !!r.definitionPath],
    ['requirements', !!r.requirementsPath],
    ['architecture', !!r.archPath],
    ['design', !!r.designPath],
    ['plan', !!(r.planned || r.planAccepted)],
    ['tdd', !!r.tddEnforced],
    ['reconcile', !!r.reconcile],
    ['chunker', !!(Array.isArray(r.stages) && r.stages.length)],
    ['design-ready', !!r.designReady],
    ['execute', !!r.executed],
    ['tests', !!r.testsPassed],
    ['code-review', !!r.codeReview],
    ['goalkeeper', !!r._goalkeeper],
    ['ready', !!r.ready],
    ['commit', !!r.committed],
  ]
  const blockedAt = String(r.blockedAt || '')
  return rows.map(([gate, done]) => {
    if (done) return { gate, status: 'done' }
    const blocked = blockedAt && (blockedAt === gate || gate.includes(blockedAt) || blockedAt.includes(gate))
    return { gate, status: blocked ? 'blocked' : 'pending' }
  })
}

// Derive the exact next command for a persisted run. Precedence: a committed run needs
// nothing; an explicit handoff (set at every mode boundary) is the most precise directive;
// then readiness, block state, and design progress in that order.
function deriveNextCommand(state) {
  const s = state || {}
  const r = s.result || {}
  const planDir = s.planDir || r.planDir || '<planDir>'
  if (r.committed) return { command: '(none)', reason: 'run committed — pipeline complete' }
  const handoff = r.handoff
  if (handoff && handoff.nextMode) {
    const dir = handoff.planDir || planDir
    const command = handoff.nextMode === 'implement' ? `/implement-feature ${dir}`
      : handoff.nextMode === 'tune' ? `/tune-feature ${dir}`
      : handoff.nextMode === 'review' ? `/review-design ${dir}`
      : `/design-feature --resume ${dir}`
    return { command, reason: handoff.message || `handoff from ${handoff.from || 'pipeline'}` }
  }
  if (r.ready) return { command: `/implement-feature ${planDir} --auto-commit`, reason: 'implementation ready; commit pending' }
  if (r.blockedAt) {
    const mode = r.mode || (s.config && s.config.mode) || 'design'
    const command = mode === 'implement' ? `/implement-feature ${planDir}`
      : mode === 'tune' ? `/tune-feature ${planDir}`
      : mode === 'review' ? `/review-design ${planDir}`
      : `/design-feature --resume ${planDir}`
    return { command, reason: `blocked at ${r.blockedAt} — resume after addressing it` }
  }
  if (r.designReady && !r.executed) return { command: `/implement-feature ${planDir}`, reason: 'design ready; implementation not started' }
  return { command: `/design-feature --resume ${planDir}`, reason: 'design incomplete — resume design' }
}

// Render the full human-readable status report for a persisted run: header, gate table,
// stage table, budgets, telemetry, open questions/issues, and the exact next command.
// `validation` (optional, from validatePipelineState) downgrades to a warning line —
// inspecting a corrupt/stuck run is exactly when a status report is most needed.
function renderStatusReport(state, validation) {
  const s = state || {}
  const r = s.result || {}
  const c = s.config || {}
  const lines = []
  lines.push(`Pipeline status — ${s.planDir || r.planDir || '(unknown planDir)'}`)
  if (validation && validation.ok === false) {
    lines.push(`WARNING: pipeline-state.json failed validation (${(validation.errors || []).join('; ')}) — report is best-effort`)
  }
  const task = String(s.task || r.task || '(unknown task)')
  lines.push(`Task: ${task.length > 200 ? task.slice(0, 200) + '…' : task}`)
  const cursor = r._state || {}
  lines.push(`Mode: ${r.mode || c.mode || '(unknown)'} | profile: ${c.profile || 'full'} | lastGate: ${cursor.lastGate || s.lastGate || '(none)'}${cursor.status ? ` (${cursor.status})` : ''} | blockedAt: ${r.blockedAt || '(none)'}`)
  lines.push('Gates:')
  for (const g of summarizeGates(r)) {
    lines.push(`  ${g.status === 'done' ? '[x]' : g.status === 'blocked' ? '[!]' : '[ ]'} ${g.gate}`)
  }
  const stages = Array.isArray(r.stages) ? r.stages : []
  if (stages.length) {
    lines.push('Stages:')
    for (const st of stages) {
      lines.push(`  ${(st && st.id) || '(?)'} [${(st && st.status) || 'pending'}] ${(st && st.name) || ''} — ${((st && st.files) || []).length} file(s)`)
    }
  }
  lines.push(`Budgets: retries ${r.retryUsed || 0}/${c.retryBudget || '?'}, decisions ${r.decisionUsed || 0}/${c.decisionCap || '?'}`)
  for (const line of renderTelemetrySummary(r.gateTelemetry, r.degradationTelemetry)) lines.push(line)
  if (r.openQuestionsPath) lines.push(`Open questions: ${r.openQuestionsPath}`)
  if (r.needsClarification) lines.push('Needs clarification: yes (unresolved interview answers)')
  if (r.issuesPath) lines.push(`Issues file: ${r.issuesPath}`)
  if (r._uncaughtError) lines.push(`Last error: ${r._uncaughtError}`)
  const next = deriveNextCommand(s)
  lines.push(`Next: ${next.command} — ${next.reason}`)
  return lines.join('\n')
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
    // Engine version that wrote this state. Installs track the plugin (user-level
    // symlink), so a later --resume may run a newer engine; the resume path warns
    // on skew instead of hydrating silently. Absent on pre-1.5.0 state files.
    // Use ENGINE_VERSION (build-injected), not the meta export binding — the Workflow
    // sandbox does not bind `export const meta` at runtime (issue #17).
    engineVersion: ENGINE_VERSION,
    // IM-1: integrity checksum over the serialized result, verified by
    // validatePipelineState() on resume to detect a truncated chunked write.
    checksum: stateChecksum(JSON.stringify(result)),
    result,
    config,
  }
  return writeChunkedFile(statePath, JSON.stringify(payload, null, 2), 'file-writer:pipeline-state', result)
}

// Pure: compare a resumed state's engineVersion to the running engine. Returns
// {saved, current} when both are present and differ; otherwise null. Pre-1.5.0
// state files omit engineVersion and stay silent. Used by --resume (issue #17:
// must not read the meta export binding — sandbox leaves meta unbound).
function detectResumeEngineSkew(savedVersion, currentVersion) {
  if (savedVersion && savedVersion !== currentVersion) {
    return { saved: savedVersion, current: currentVersion }
  }
  return null
}

// Load <planDir>/pipeline-state.json for --resume. Returns { state: <obj|null> }
// via the file-reader agent; null if the file does not exist.
async function loadPipelineState(planDir) {
  const statePath = planDir.replace(/\/$/, '') + '/pipeline-state.json'
  return safeAgent(
    `You are a file-reader agent. Read ${statePath} and return its full JSON content parsed as an
object in the "state" field. If the file does not exist, return state=null.`,
    { label: 'file-reader:pipeline-state', phase: 'Checkpoint', schema: PIPELINE_STATE_READ, model: gm('todo') },
    null
  )
}


// Retain a last-good snapshot before each state write so resume can auto-recover
// from a truncated/partial chunked write. Before writing the new state, copies
// the current pipeline-state.json to pipeline-state.last-good.json via agent I/O.
// Non-blocking: a copy failure warns but does not prevent the new write.
async function flushPipelineStateWithSnapshot(planDir, result, config) {
  const lastGoodPath = planDir.replace(/\/$/, '') + '/pipeline-state.last-good.json'
  try {
    const current = await loadPipelineState(planDir)
    if (current && current.state) {
      await writeChunkedFile(
        lastGoodPath,
        JSON.stringify(current.state, null, 2),
        'file-writer:last-good',
        result
      )
    }
  } catch (e) {
    if (result && result.logLines) {
      result.logLines.push(`snapshot: last-good copy skipped (${String(e)})`)
    }
  }
  return flushPipelineState(planDir, result, config)
}

// Load pipeline state with auto-recovery from a last-good snapshot. If the
// primary state file fails validation (truncated/corrupt chunked write), the
// last-good snapshot is loaded and validated instead. Returns { state, recovered }
// where recovered=true signals the primary file was bypassed.
async function loadPipelineStateWithRecovery(planDir) {
  const loaded = await loadPipelineState(planDir)
  const state = loaded && loaded.state
  if (state) {
    const validation = validatePipelineState(state)
    if (validation.ok) {
      return { state, recovered: false }
    }
  }
  const lastGoodPath = planDir.replace(/\/$/, '') + '/pipeline-state.last-good.json'
  const lastGoodLoaded = await safeAgent(
    `You are a file-reader agent. Read ${lastGoodPath} and return its full JSON content parsed as an
object in the "state" field. If the file does not exist, return state=null.`,
    { label: 'file-reader:last-good', phase: 'Checkpoint', schema: PIPELINE_STATE_READ, model: gm('todo') },
    null
  )
  const lastGoodState = lastGoodLoaded && lastGoodLoaded.state
  if (lastGoodState) {
    const lastGoodValidation = validatePipelineState(lastGoodState)
    if (lastGoodValidation.ok) {
      return { state: lastGoodState, recovered: true }
    }
  }
  return { state: null, recovered: false }
}

async function verifyArtifactPresence({ path, gate, expectedHeadings, result, pathKey }) {
  if (!path || path === 'present') return { exists: !!path, sizeBytes: 0, hasExpectedHeadings: true, summary: 'not a file path' }
  // Deterministic verification via durable digest contract. An LLM file-reader's
  // self-reported existence cannot be trusted — a hallucinated claim could pass
  // a missing artifact. When a durable checkpoint recorded this artifact with a
  // digest, that is the authoritative verification and the LLM call is skipped.
  if (pathKey) {
    const digestResult = verifyArtifactDigest(result, pathKey)
    if (digestResult.verified) {
      return { exists: true, sizeBytes: 1, hasExpectedHeadings: true, summary: 'verified via durable digest checkpoint' }
    }
  }
  const headingLine = expectedHeadings && expectedHeadings.length
    ? `Also verify the file contains at least one of these headings/markers: ${expectedHeadings.join(', ')}.`
    : 'No specific heading marker is required.'
  const verdict = await safeAgent(
    `You are a file-reader agent. Verify the artifact file for gate "${gate}" exists at ${path}.
Read the file metadata/content just enough to answer:
- exists: true only if the file exists
- sizeBytes: approximate byte size; 0 if missing
- hasExpectedHeadings: true when the heading/marker expectation is met
${headingLine}
Return summary with the evidence. Do not modify files.`,
    { label: `artifact-check:${gate}`, phase: 'Checkpoint', schema: ARTIFACT_CHECK, model: gm('todo') },
    result
  )
  return verdict || { exists: false, sizeBytes: 0, hasExpectedHeadings: false, summary: 'artifact check returned null' }
}

async function repairResumeArtifactFlags(result) {
  if (!result) return []
  const repairs = []
  const checkpoints = result._designCheckpoints || {}
  const digests = result._artifactDigests || {}

  // Map each artifact to its checkpoint gate name so digest-driven skip can
  // consult the durable checkpoint record. When a gate was durably
  // acknowledged and its artifact digest was recorded, the artifact was
  // verified at checkpoint time and the expensive LLM re-verification can be
  // skipped entirely on resume.
  const checkpointGateMap = ARTIFACT_CHECKPOINT_GATE_MAP
  const artifacts = [
    { pathKey: 'definitionPath', flags: ['_define'], gate: 'Define' },
    { pathKey: 'requirementsPath', flags: ['_requirements', '_reviewedRequirements'], gate: 'Requirements' },
    { pathKey: 'archPath', flags: ['_arch', '_reviewedArch'], gate: 'Architecture' },
    { pathKey: 'designPath', flags: ['_design', '_reviewedDesign'], gate: 'Detailed Design' },
    { pathKey: 'planPath', flags: ['planned', '_plan', '_reviewedPlan', 'planAccepted', 'tddEnforced', 'reconcile'], gate: 'Plan' },
  ].filter((a) =>
    !(a.pathKey === 'planPath' && !result.planned)
  )
  for (const artifact of artifacts) {
    const path = result[artifact.pathKey]
    if (!path) continue

    const cpGate = checkpointGateMap[artifact.pathKey]
    const cp = cpGate ? checkpoints[cpGate] : null
    const storedDigest = digests[artifact.pathKey]
    if (cp && cp.acknowledged && storedDigest) {
      continue
    }

    const checked = await verifyArtifactPresence({
      path,
      gate: `resume:${artifact.gate}`,
      expectedHeadings: ['#'],
      result,
      pathKey: artifact.pathKey,
    })
    if (checked.exists && checked.sizeBytes > 0 && checked.hasExpectedHeadings !== false) continue
    for (const flag of artifact.flags) {
      if (flag in result) result[flag] = null
    }
    result[artifact.pathKey] = null
    repairs.push(`${artifact.pathKey} (${artifact.gate})`)
  }
  if (repairs.length) {
    result.designReady = false
    result.ready = false
    result.executed = null
    result.testsPassed = false
    result.codeReview = null
    result._goalkeeper = null
  }
  return repairs
}

// Pure lifecycle state contract: explicit feature lifecycle states, deterministic
// transition reducer, and readiness derivation. No I/O — all functions are pure
// and deterministic. Designed for property-based table tests.

// Canonical lifecycle states a feature may occupy. Exactly one is active per feature
// at any time. Excluded features are outside the coverage denominator; all others
// contribute to the readiness invariant.
const LIFECYCLE_STATES = Object.freeze({
  RUNNABLE: 'runnable',
  DEFERRED: 'deferred',
  IN_PROGRESS: 'in-progress',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  EXCLUDED: 'excluded',
  COMPLETED: 'completed',
})

// Three distinct skip classifications with different readiness implications.
// Feature-level skip means the feature itself was abandoned — remains incomplete.
// Policy-disabled optional skip may complete if policy evidence is recorded.
// Required-gate skip blocks completion permanently until resolved.
const SKIP_REASONS = Object.freeze({
  FEATURE_LEVEL: 'feature-level',
  POLICY_DISABLED_OPTIONAL: 'policy-disabled-optional',
  REQUIRED_GATE: 'required-gate',
})

// Legal transitions: maps current state to the set of event types that may fire.
// Any event not listed for the current state is illegal and throws.
const TRANSITION_TABLE = Object.freeze({
  runnable: ['start', 'defer', 'skip', 'exclude'],
  deferred: ['start', 'exclude'],
  'in-progress': ['block', 'fail', 'complete', 'skip'],
  blocked: ['start', 'fail', 'exclude'],
  failed: ['start', 'exclude'],
  skipped: ['start', 'complete', 'exclude'],
  excluded: [],
  completed: [],
})

// Pure transition reducer. Takes the current feature state and an event, returns a
// new state object. Throws on illegal transitions. Does NOT mutate the input.
//
// state: { lifecycle, skipReason?, policyEvidence? }
// event: { type: 'admit'|'start'|'block'|'fail'|'skip'|'exclude'|'complete', payload? }
function applyLifecycleEvent(state, event) {
  if (!state || typeof state !== 'object') {
    throw new Error('applyLifecycleEvent: state must be an object')
  }
  if (!event || typeof event !== 'object' || !event.type) {
    throw new Error('applyLifecycleEvent: event must have a type')
  }

  const current = state.lifecycle
  if (!current || !TRANSITION_TABLE[current]) {
    throw new Error(`applyLifecycleEvent: unknown lifecycle state '${current}'`)
  }

  const allowed = TRANSITION_TABLE[current]
  if (!allowed.includes(event.type)) {
    throw new Error(
      `applyLifecycleEvent: illegal transition '${current}' + '${event.type}' (allowed: ${allowed.join(', ') || 'none'})`
    )
  }

  // Build new state — never mutate the original
  const next = { ...state }

  switch (event.type) {
    case 'start':
      next.lifecycle = LIFECYCLE_STATES.IN_PROGRESS
      delete next.skipReason
      delete next.policyEvidence
      break
    case 'defer':
      next.lifecycle = LIFECYCLE_STATES.DEFERRED
      break
    case 'block':
      next.lifecycle = LIFECYCLE_STATES.BLOCKED
      break
    case 'fail':
      next.lifecycle = LIFECYCLE_STATES.FAILED
      break
    case 'skip': {
      const reason = event.payload && event.payload.skipReason
      if (!reason || !Object.values(SKIP_REASONS).includes(reason)) {
        throw new Error('applyLifecycleEvent: skip event requires valid payload.skipReason')
      }
      next.lifecycle = LIFECYCLE_STATES.SKIPPED
      next.skipReason = reason
      if (event.payload.policyEvidence) {
        next.policyEvidence = event.payload.policyEvidence
      }
      break
    }
    case 'exclude':
      next.lifecycle = LIFECYCLE_STATES.EXCLUDED
      if (event.payload && event.payload.rationale) {
        next.exclusionRationale = event.payload.rationale
      }
      break
    case 'complete':
      // A skipped feature can only complete under specific skip-reason rules
      if (current === LIFECYCLE_STATES.SKIPPED) {
        if (state.skipReason === SKIP_REASONS.REQUIRED_GATE) {
          throw new Error('applyLifecycleEvent: cannot complete — required gate was skipped')
        }
        if (state.skipReason === SKIP_REASONS.FEATURE_LEVEL) {
          throw new Error('applyLifecycleEvent: cannot complete — feature was skipped at feature level')
        }
        if (state.skipReason === SKIP_REASONS.POLICY_DISABLED_OPTIONAL) {
          if (!state.policyEvidence) {
            throw new Error('applyLifecycleEvent: cannot complete — policy-disabled skip requires policyEvidence')
          }
        }
      }
      next.lifecycle = LIFECYCLE_STATES.COMPLETED
      break
    default:
      throw new Error(`applyLifecycleEvent: unhandled event type '${event.type}'`)
  }

  return next
}

// Derive readiness from a project manifest. Pure: no side effects.
// Returns whether the project is ready plus exact counts.
//
// manifest: {
//   schemaVersion: string,
//   features: [{ id, lifecycle, skipReason?, policyEvidence? }]
// }
function deriveReadiness(manifest) {
  const features = (manifest && manifest.features) || []
  const counts = {
    runnable: 0, deferred: 0, inProgress: 0, blocked: 0,
    failed: 0, skipped: 0, excluded: 0, completed: 0,
  }

  for (const f of features) {
    const lc = f.lifecycle
    if (lc === LIFECYCLE_STATES.RUNNABLE) counts.runnable++
    else if (lc === LIFECYCLE_STATES.DEFERRED) counts.deferred++
    else if (lc === LIFECYCLE_STATES.IN_PROGRESS) counts.inProgress++
    else if (lc === LIFECYCLE_STATES.BLOCKED) counts.blocked++
    else if (lc === LIFECYCLE_STATES.FAILED) counts.failed++
    else if (lc === LIFECYCLE_STATES.SKIPPED) counts.skipped++
    else if (lc === LIFECYCLE_STATES.EXCLUDED) counts.excluded++
    else if (lc === LIFECYCLE_STATES.COMPLETED) counts.completed++
  }

  // Denominator excludes 'excluded' features
  const denominator = features.length - counts.excluded
  const incomplete = counts.runnable + counts.deferred + counts.inProgress + counts.blocked + counts.failed

  // Skipped features need special handling: only policy-disabled-optional with evidence counts as complete
  let effectiveSkippedIncomplete = 0
  for (const f of features) {
    if (f.lifecycle === LIFECYCLE_STATES.SKIPPED) {
      if (f.skipReason === SKIP_REASONS.POLICY_DISABLED_OPTIONAL && f.policyEvidence) {
        counts.completed++ // counts as completed for readiness
      } else {
        effectiveSkippedIncomplete++
      }
    }
  }
  // Adjust: skipped that can complete are already counted in completed above;
  // the rest are incomplete
  const totalIncomplete = incomplete + effectiveSkippedIncomplete

  return {
    ready: denominator > 0 && totalIncomplete === 0 && counts.completed >= denominator,
    denominator,
    completed: counts.completed,
    remaining: counts.runnable + counts.deferred + counts.inProgress,
    blocked: counts.blocked,
    failed: counts.failed,
    skipped: effectiveSkippedIncomplete,
    excluded: counts.excluded,
  }
}

// Terminal states: once reached, the feature does not transition further
function isTerminal(lifecycleState) {
  return lifecycleState === LIFECYCLE_STATES.COMPLETED ||
    lifecycleState === LIFECYCLE_STATES.FAILED ||
    lifecycleState === LIFECYCLE_STATES.EXCLUDED
}

// Incomplete states: features that still need work before the project can be ready.
// Feature-level skipped is incomplete. Policy-disabled-optional with evidence is NOT.
function isIncomplete(lifecycleState, skipReason) {
  if (lifecycleState === LIFECYCLE_STATES.DEFERRED ||
    lifecycleState === LIFECYCLE_STATES.BLOCKED ||
    lifecycleState === LIFECYCLE_STATES.IN_PROGRESS ||
    lifecycleState === LIFECYCLE_STATES.RUNNABLE) {
    return true
  }
  if (lifecycleState === LIFECYCLE_STATES.SKIPPED) {
    return skipReason !== SKIP_REASONS.POLICY_DISABLED_OPTIONAL
  }
  return false
}

// Root-last migration from v1.4.5 monolithic pipeline-state.json to v1.5.0 sharded
// state contract. All functions are pure and deterministic — no I/O.
//
// Migration order:
// 1. Validate the legacy envelope before mutation.
// 2. Derive deterministic feature identities and default new version/revision fields.
// 3. Write and validate every referenced child shard.
// 4. Reclassify legacy cap/selector outcomes as deferred where evidence shows undispatched scope.
// 5. Atomically acknowledge the compact project manifest only after all child references are durable.


// Derive a stable canonical feature identity from a legacy extract-queue slice.
// The identity is based on the slice name and primary entry point, not array index,
// so the same slice produces the same ID across runs and traversals.
function deriveFeatureId(legacySlice) {
  if (!legacySlice) return 'unknown'
  const name = legacySlice.name || legacySlice.id || 'feature'
  const slug = categorizeSlug(String(name))
  // Incorporate first entry point or file for uniqueness when names collide
  const entryPoint = (legacySlice.entryPoints && legacySlice.entryPoints[0]) || ''
  const fileHint = (legacySlice.files && legacySlice.files[0]) || ''
  const disambiguator = categorizeSlug(String(entryPoint || fileHint))
  // If slug is unique enough, skip the disambiguator
  if (disambiguator && disambiguator !== 'misc' && disambiguator !== slug) {
    return `${slug}-${disambiguator}`
  }
  return slug || 'feature'
}

// Pure transform: convert legacy v1.4.5 pipeline-state.json structure to v1.5.0
// sharded project manifest. Idempotent — calling twice produces the same output.
//
// legacyState: the deserialized pipeline-state.json { result: { slices: [...] }, ... }
// Returns: {
//   schemaVersion: '1.5.0',
//   status: 'migrating' | 'migrated',
//   features: [{ id, lifecycle, skipReason?, policyEvidence?, shardRef, legacyStatus }],
//   legacyEngineVersion: string | null,
// }
function migrateLegacyState(legacyState) {
  if (!legacyState || typeof legacyState !== 'object') {
    throw new Error('migrateLegacyState: input must be an object')
  }

  const result = legacyState.result || {}
  const legacySlices = Array.isArray(result.slices) ? result.slices : []
  const legacyEngineVersion = legacyState.engineVersion || null

  // If already migrated (idempotent check), return as-is
  if (legacyState.schemaVersion === '1.5.0') {
    return {
      schemaVersion: '1.5.0',
      status: 'migrated',
      features: legacyState.features || [],
      legacyEngineVersion,
    }
  }

  const features = legacySlices.map((slice) => {
    const id = deriveFeatureId(slice)
    const legacyStatus = slice.status || 'pending'

    // Map legacy statuses to v1.5.0 lifecycle states
    let lifecycle
    let skipReason = null
    let policyEvidence = null
    let rationale = null

    if (legacyStatus === 'pending') {
      lifecycle = LIFECYCLE_STATES.DEFERRED
    } else if (legacyStatus === 'skipped') {
      // Legacy 'skipped' conflated cap-exceeded with deselected.
      // Cap-exceeded slices are still in-scope → deferred with rationale.
      // Deselected slices are excluded.
      lifecycle = LIFECYCLE_STATES.DEFERRED
      rationale = 'legacy cap-exceeded or deselected — reclassified as deferred for v1.5.0'
    } else if (legacyStatus === 'completed') {
      lifecycle = LIFECYCLE_STATES.COMPLETED
    } else if (legacyStatus === 'failed') {
      lifecycle = LIFECYCLE_STATES.FAILED
    } else if (legacyStatus === 'excluded') {
      lifecycle = LIFECYCLE_STATES.EXCLUDED
    } else {
      lifecycle = LIFECYCLE_STATES.DEFERRED
    }

    const feature = {
      id,
      lifecycle,
      shardRef: slice.planDir || `feature-state/${id}.json`,
      legacyStatus,
    }
    if (skipReason) feature.skipReason = skipReason
    if (policyEvidence) feature.policyEvidence = policyEvidence
    if (rationale) feature.migrationRationale = rationale

    return feature
  })

  return {
    schemaVersion: '1.5.0',
    status: 'migrating',
    features,
    legacyEngineVersion,
  }
}

// Validate migration boundaries for fault injection. Uses an internal-accumulator
// pattern: the 'child-write' phase marks the matched child with _durable=true
// in-place (a mutation of the passed-in state object) so subsequent 'before-root'
// and 'after-children' checks can gate root acknowledgement on all children being
// durable. Deterministic and side-effect-free from an I/O perspective, but NOT a
// pure read-only check — it mutates the accumulator state between phase calls.
//
// state: the in-progress migration output
// phase: 'child-write' | 'before-root' | 'after-children'
// childId: (optional) specific child to check for 'child-write'
//
// Returns: { ok: boolean, reason?: string }
function validateMigrationBoundary(state, phase, childId) {
  if (!state || typeof state !== 'object') {
    return { ok: false, reason: 'state is not an object' }
  }

  const features = state.features || []

  if (phase === 'child-write') {
    if (!childId) return { ok: false, reason: 'childId required for child-write phase' }
    const child = features.find((f) => f.id === childId)
    if (!child) return { ok: false, reason: `child '${childId}' not found` }
    // In a real system, this checks durable write of the shard.
    // For pure testing: the child must have a shardRef.
    if (!child.shardRef) return { ok: false, reason: `child '${childId}' missing shardRef` }
    child._durable = true
    return { ok: true }
  }

  if (phase === 'before-root') {
    // Root cannot be acknowledged until ALL children are durable
    const undurable = features.filter((f) => !f._durable && f.lifecycle !== LIFECYCLE_STATES.EXCLUDED)
    if (undurable.length > 0) {
      return {
        ok: false,
        reason: `${undurable.length} child shard(s) not yet durable: ${undurable.map((f) => f.id).join(', ')}`,
      }
    }
    return { ok: true }
  }

  if (phase === 'after-children') {
    // All children must be validated/durable before root acknowledgement
    const unvalidated = features.filter((f) => !f._durable && f.lifecycle !== LIFECYCLE_STATES.EXCLUDED)
    if (unvalidated.length > 0) {
      return {
        ok: false,
        reason: `${unvalidated.length} child shard(s) not validated`,
      }
    }
    return { ok: true }
  }

  return { ok: false, reason: `unknown migration phase '${phase}'` }
}

// Migrate a v1.4.5 pipeline-state.json in-place for v1.5.0 resume. Detects legacy
// extract state by the presence of result.slices (a v1.4.5 extract-queue field absent
// from v1.5.0 state) and a non-1.5.0 schemaVersion. Runs the root-last migration and
// injects the v1.5.0 project manifest into the state so the resume path sees the
// current structure. Strips the stale checksum (result changed during migration).
//
// This is an explicit, opt-in transform invoked via --migrate on resume — NOT
// auto-detected on every resume to avoid misfire-prone heuristics on ambiguous state.
// Idempotent: a v1.5.0 state passes through unchanged.
//
// state: the deserialized pipeline-state.json (must have result.slices for migration)
// Returns: the migrated state object (or the original if no migration was needed)
function migrateResumeState(state) {
  if (!state || typeof state !== 'object') return state
  if (state.schemaVersion === '1.5.0') return state

  const result = state.result || {}
  const hasLegacySlices = Array.isArray(result.slices) && result.slices.length > 0

  if (!hasLegacySlices) return state

  const manifest = migrateLegacyState(state)

  const { checksum, ...stateWithoutChecksum } = state
  return {
    ...stateWithoutChecksum,
    result: {
      ...result,
      projectManifest: manifest,
    },
    schemaVersion: '1.5.0',
    engineVersion: state.engineVersion || '1.4.5',
  }
}

// Selective revision invalidation: deterministic digest computation, revision
// comparison, and gate-level selective invalidation. All functions are pure —
// no I/O, no side effects.
//
// When source files, scope, graph inputs, dependency summaries, or artifacts
// change, the engine compares durable revisions/digests and selectively
// invalidates only affected feature gates and derived project views while
// retaining independently valid evidence.

// Reuse the proven djb2 hash from state.mjs (same algorithm, already tested).
// Defined independently here to avoid import issues in the concatenated dist.
function computeDigest(input) {
  let str
  if (typeof input === 'string') {
    str = input
  } else if (input == null) {
    str = String(input)
  } else {
    str = JSON.stringify(sortKeys(input))
  }
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

// Deterministic JSON stringify with sorted keys for stable serialization.
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortKeys)
  const sorted = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key])
  }
  return sorted
}

// Stable digest for arbitrary JSON-serializable content.
function computeContentDigest(content) {
  return computeDigest(JSON.stringify(sortKeys(content)))
}

// Revision input types that drive selective invalidation.
// Each type maps to the gates it affects.
const REVISION_INPUTS = Object.freeze({
  SOURCE: 'source',       // affects: codeFacts, arch
  SCOPE: 'scope',         // affects: codeFacts
  GRAPH: 'graph',         // affects: arch
  DEPS: 'deps',           // affects: arch
  ARTIFACT: 'artifact',   // affects: only the gate that owns the artifact
})

// Gate-dependency map: which revision inputs affect which gates.
// This is the contract for selective invalidation — only listed gates
// are invalidated when their input revision changes.
const GATE_DEPENDENCY_MAP = Object.freeze({
  codeFacts: ['source', 'scope'],
  arch: ['source', 'graph', 'deps'],
  design: ['artifact'],
  plan: ['artifact'],
  tests: ['artifact'],
  requirements: ['artifact'],
  useCases: ['artifact'],
})

// Compare old and new revision sets and identify affected features and gates.
//
// oldRevisions: { source?: digest, scope?: digest, graph?: digest, deps?: digest,
//                 artifacts?: { gateName: digest } }
// newRevisions: same shape
// featureId: (optional) the feature these revisions belong to
//
// Returns: { affectedGates: [...], changedInputs: [...] }
function compareRevisions(oldRevisions, newRevisions, featureId) {
  const oldR = oldRevisions || {}
  const newR = newRevisions || {}
  const changedInputs = []
  const affectedGates = new Set()

  // Check top-level revision inputs
  for (const inputType of ['source', 'scope', 'graph', 'deps']) {
    if (oldR[inputType] !== newR[inputType]) {
      changedInputs.push(inputType)
      // Find gates affected by this input type
      for (const [gate, inputs] of Object.entries(GATE_DEPENDENCY_MAP)) {
        if (inputs.includes(inputType)) {
          affectedGates.add(gate)
        }
      }
    }
  }

  // Check artifact-level revisions
  const oldArtifacts = oldR.artifacts || {}
  const newArtifacts = newR.artifacts || {}
  for (const gateName of Object.keys({ ...oldArtifacts, ...newArtifacts })) {
    if (oldArtifacts[gateName] !== newArtifacts[gateName]) {
      changedInputs.push('artifact')
      affectedGates.add(gateName)
    }
  }

  return {
    affectedGates: Array.from(affectedGates).sort(),
    changedInputs: Array.from(changedInputs).sort(),
  }
}

// Selectively invalidate only affected gates in a feature shard.
//
// featureShard: { gates: { gateName: { digest, valid, ... }, ... } }
// revisionDelta: { affectedGates: [...], changedInputs: [...] } from compareRevisions
//
// Returns: new shard with only affected gates marked invalid. Independent
// gates retain their valid status. Does NOT mutate input.
function selectiveInvalidate(featureShard, revisionDelta) {
  if (!featureShard || typeof featureShard !== 'object') {
    throw new Error('selectiveInvalidate: featureShard must be an object')
  }
  const gates = featureShard.gates || {}
  const affectedGates = (revisionDelta && revisionDelta.affectedGates) || []

  // Build new gates object — only mark affected gates as invalid
  const newGates = {}
  for (const [gateName, gateState] of Object.entries(gates)) {
    if (affectedGates.includes(gateName)) {
      // Invalidate this gate
      newGates[gateName] = { ...gateState, valid: false, invalidReason: 'revision-changed' }
    } else {
      // Retain independent evidence — gate is still valid
      newGates[gateName] = { ...gateState }
    }
  }

  return { ...featureShard, gates: newGates }
}

// Filter a feature shard to only independently valid evidence.
// Returns a shard containing only gates whose inputs have not changed
// (i.e., gates that are still valid after selective invalidation).
function retainValidEvidence(featureShard) {
  if (!featureShard || typeof featureShard !== 'object') {
    return { gates: {} }
  }
  const gates = featureShard.gates || {}
  const validGates = {}

  for (const [gateName, gateState] of Object.entries(gates)) {
    if (gateState && gateState.valid !== false) {
      validGates[gateName] = { ...gateState }
    }
  }

  return { ...featureShard, gates: validGates }
}

// Deterministic repository inventory: path classification, inventory construction,
// digest computation, and oversized-area refinement.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Every discovered path is accounted for as included or explicitly excluded,
// with the applicable policy (generated, vendor, ignore) recorded as evidence.


// Path classification policies. Each policy has a test predicate and a verdict.
const PATH_POLICIES = Object.freeze({
  INCLUDED: 'included',
  EXCLUDED: 'excluded',
  GENERATED: 'generated',
  VENDOR: 'vendor',
  IGNORED: 'ignored',
})

// Common generated/vendor/ignore directory patterns. A path matches if any
// segment equals one of these names. Deterministic: same path → same verdict.
const GENERATED_SEGMENTS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out', 'target',
  '__pycache__', '.pytest_cache', 'coverage', '.nyc_output',
  'vendor', '.vendor', 'third_party', 'third-party',
])
const IGNORE_SEGMENTS = new Set([
  '.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db',
])

// Common generated file extensions that indicate non-source paths.
const GENERATED_EXTENSIONS = new Set([
  '.min.js', '.min.css', '.map', '.lock', '.pyc', '.pyo',
  '.class', '.o', '.so', '.dylib', '.dll', '.exe',
])

// Classify a single path against the policy set.
// Returns { path, verdict, policy, evidence } — deterministic.
//
// policies: optional override { generatedSegments?, ignoreSegments?, generatedExtensions?, includePatterns?, excludePatterns? }
function classifyPath(path, policies) {
  const opts = policies || {}
  const genSegs = opts.generatedSegments || GENERATED_SEGMENTS
  const ignSegs = opts.ignoreSegments || IGNORE_SEGMENTS
  const genExts = opts.generatedExtensions || GENERATED_EXTENSIONS
  const includePats = opts.includePatterns || []
  const excludePats = opts.excludePatterns || []

  if (!path || typeof path !== 'string') {
    return { path: String(path || ''), verdict: PATH_POLICIES.EXCLUDED, policy: 'invalid', evidence: 'path is not a string' }
  }

  const segments = path.split('/')
  const basename = segments[segments.length - 1] || ''
  const ext = basename.substring(basename.lastIndexOf('.'))

  // Check ignore patterns first (highest precedence)
  for (const seg of segments) {
    if (ignSegs.has(seg)) {
      return { path, verdict: PATH_POLICIES.IGNORED, policy: 'ignore', evidence: `segment '${seg}' matches ignore list` }
    }
  }
  for (const pat of excludePats) {
    if (path.includes(pat)) {
      return { path, verdict: PATH_POLICIES.EXCLUDED, policy: 'exclude-pattern', evidence: `matches exclude pattern '${pat}'` }
    }
  }

  // Check generated/vendor
  for (const seg of segments) {
    if (genSegs.has(seg)) {
      const isVendor = seg === 'vendor' || seg === '.vendor' || seg === 'third_party' || seg === 'third-party'
      return {
        path,
        verdict: PATH_POLICIES.GENERATED,
        policy: isVendor ? 'vendor' : 'generated',
        evidence: `segment '${seg}' classified as ${isVendor ? 'vendor' : 'generated'}`,
      }
    }
  }

  // Check generated extensions
  for (const gExt of genExts) {
    if (basename.endsWith(gExt)) {
      return { path, verdict: PATH_POLICIES.GENERATED, policy: 'generated', evidence: `extension '${gExt}' is generated` }
    }
  }

  // Check explicit include patterns
  for (const pat of includePats) {
    if (path.includes(pat)) {
      return { path, verdict: PATH_POLICIES.INCLUDED, policy: 'include-pattern', evidence: `matches include pattern '${pat}'` }
    }
  }

  // Default: included
  return { path, verdict: PATH_POLICIES.INCLUDED, policy: 'default', evidence: 'no exclusion policy matched' }
}

// Build a deterministic inventory from a list of paths.
// Sorts paths canonically (by UTF-16 code unit order) so the same input
// always produces the same output regardless of traversal order.
//
// paths: string[]
// policies: optional override (see classifyPath)
// Returns: { entries: [...], digest, counts }
function buildInventory(paths, policies) {
  if (!Array.isArray(paths)) {
    throw new Error('buildInventory: paths must be an array')
  }

  // Canonical sort ensures deterministic ordering regardless of traversal order
  const sorted = [...paths].sort()

  const entries = sorted.map((p) => classifyPath(p, policies))

  const counts = {
    included: 0,
    excluded: 0,
    generated: 0,
    vendor: 0,
    ignored: 0,
  }

  for (const e of entries) {
    if (e.verdict === PATH_POLICIES.INCLUDED) counts.included++
    else if (e.verdict === PATH_POLICIES.EXCLUDED) counts.excluded++
    else if (e.verdict === PATH_POLICIES.GENERATED) {
      if (e.policy === 'vendor') counts.vendor++
      else counts.generated++
    } else if (e.verdict === PATH_POLICIES.IGNORED) counts.ignored++
  }

  return {
    entries,
    digest: inventoryDigest({ entries }),
    counts,
  }
}

// Compute a deterministic digest over an inventory's entries.
// Only the path and verdict of each entry contribute to the digest,
// so reclassification of evidence text does not change the fingerprint.
function inventoryDigest(inventory) {
  const entries = (inventory && inventory.entries) || []
  const fingerprint = entries.map((e) => `${e.path}|${e.verdict}`).join('\n')
  return computeDigest(fingerprint)
}

// Recursively refine an oversized area into bounded pages.
// If the area has more paths than maxPathsPerPage, split it in half
// recursively until each page is within the bound.
//
// area: { name, paths: string[] }
// maxPathsPerPage: number (must be > 0)
// Returns: pages — array of { name, paths, depth }
function refineOversizedArea(area, maxPathsPerPage) {
  if (!area || !Array.isArray(area.paths)) {
    throw new Error('refineOversizedArea: area must have a paths array')
  }
  if (!Number.isFinite(maxPathsPerPage) || maxPathsPerPage <= 0) {
    throw new Error('refineOversizedArea: maxPathsPerPage must be a positive number')
  }

  const pages = []

  function splitRecursive(name, paths, depth) {
    if (paths.length <= maxPathsPerPage) {
      pages.push({ name, paths: [...paths].sort(), depth })
      return
    }

    // Sort paths for deterministic splitting
    const sorted = [...paths].sort()
    const mid = Math.ceil(sorted.length / 2)

    // Derive sub-area names from the path prefix at the split point
    const firstHalf = sorted.slice(0, mid)
    const secondHalf = sorted.slice(mid)

    // Use common directory prefix for naming sub-areas
    const firstName = `${name}-a`
    const secondName = `${name}-b`

    splitRecursive(firstName, firstHalf, depth + 1)
    splitRecursive(secondName, secondHalf, depth + 1)
  }

  splitRecursive(area.name || 'area', area.paths, 0)
  return pages
}

// Durable paginated discovery: cursors, page advancement, interruption recovery.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Oversized areas refine recursively into bounded durable pages; interrupted
// discovery resumes without gaps or duplicates through stable cursor positions.


// Create a pagination cursor over an inventory.
// The cursor tracks position so interrupted discovery can resume exactly.
//
// inventory: { entries: [...], digest, counts } from buildInventory
// pageSize: number of entries per page (must be > 0)
// Returns: { includedEntries, pageSize, offset, exhausted, digest, pagesEmitted }
function createCursor(inventory, pageSize) {
  if (!inventory || !Array.isArray(inventory.entries)) {
    throw new Error('createCursor: inventory must have an entries array')
  }
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error('createCursor: pageSize must be a positive number')
  }

  // Only included entries are paginated; excluded/generated/ignored are
  // accounted for but not paged
  const included = inventory.entries.filter((e) => e.verdict === 'included')

  return {
    includedEntries: included,
    pageSize,
    offset: 0,
    exhausted: included.length === 0,
    digest: inventory.digest,
    pagesEmitted: 0,
    totalIncluded: included.length,
  }
}

// Advance the cursor by one page. Returns the page entries and an updated cursor.
// The page includes entries [offset, offset+pageSize). The updated cursor's
// offset advances past the page.
//
// cursor: from createCursor
// Returns: { page: [...], cursor: updatedCursor } or { page: [], cursor: same } if exhausted
function nextPage(cursor) {
  if (!cursor || cursor.exhausted || cursor.offset >= cursor.includedEntries.length) {
    return { page: [], cursor: { ...cursor, exhausted: true } }
  }

  const start = cursor.offset
  const end = Math.min(start + cursor.pageSize, cursor.includedEntries.length)
  const page = cursor.includedEntries.slice(start, end)

  const newOffset = end
  const exhausted = newOffset >= cursor.includedEntries.length

  return {
    page,
    cursor: {
      ...cursor,
      offset: newOffset,
      exhausted,
      pagesEmitted: cursor.pagesEmitted + 1,
    },
  }
}

// Resume discovery from an interrupted cursor position.
// Returns the same result as nextPage but validates that the cursor's
// digest matches the expected inventory — if the inventory changed,
// the cursor is marked stale.
//
// cursor: interrupted cursor
// expectedDigest: digest of the current inventory
// Returns: { page, cursor, stale } — stale=true if inventory changed
function resumeDiscovery(cursor, expectedDigest) {
  if (!cursor) {
    throw new Error('resumeDiscovery: cursor is required')
  }

  const stale = expectedDigest && cursor.digest !== expectedDigest
  if (stale) {
    // Cursor is stale — discovery must restart
    return { page: [], cursor: { ...cursor, exhausted: false, offset: 0, pagesEmitted: 0, digest: expectedDigest }, stale: true }
  }

  const result = nextPage(cursor)
  return { ...result, stale: false }
}

// Check if a cursor has covered all included entries.
function exhausted(cursor) {
  if (!cursor) return true
  return cursor.exhausted || cursor.offset >= (cursor.totalIncluded || 0)
}

// Collect all pages from an inventory at once (for testing/small inventories).
// Returns an array of page arrays.
function allPages(inventory, pageSize) {
  const cursor = createCursor(inventory, pageSize)
  const pages = []
  let c = cursor
  while (!exhausted(c)) {
    const result = nextPage(c)
    if (result.page.length === 0) break
    pages.push(result.page)
    c = result.cursor
  }
  return pages
}

// Compute a deterministic page digest from a single page's entries.
function pageDigest(pageEntries) {
  const fingerprint = (pageEntries || [])
    .map((e) => `${e.path}|${e.verdict}`)
    .join('\n')
  return computeDigest(fingerprint)
}

// Discovery result: pages + canonical feature identity extraction.
// Takes the full set of included pages and extracts canonical feature identities
// using path-based grouping. Each unique directory prefix becomes a candidate feature.
//
// pages: array of page arrays (from allPages or accumulated nextPage calls)
// Returns: { features: [{ id, paths, digest }], totalFeatures, coverageDigest }
function extractFeaturesFromPages(pages) {
  if (!Array.isArray(pages)) {
    throw new Error('extractFeaturesFromPages: pages must be an array')
  }

  // Flatten all pages into a single entry list
  const allEntries = pages.flat()

  // Group by directory prefix for feature extraction
  const dirMap = new Map()
  for (const entry of allEntries) {
    const segs = entry.path.split('/')
    // Use parent directory as feature identity (or root for top-level files)
    const dir = segs.length > 1 ? segs.slice(0, -1).join('/') : '(root)'
    if (!dirMap.has(dir)) {
      dirMap.set(dir, [])
    }
    dirMap.get(dir).push(entry.path)
  }

  const features = []
  for (const [dir, paths] of dirMap) {
    // Canonicalize the directory into a feature ID
    const id = dir.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'root'
    features.push({
      id,
      paths: paths.sort(),
      digest: computeDigest(paths.sort().join('\n')),
    })
  }

  // Sort features by ID for deterministic ordering
  features.sort((a, b) => a.id.localeCompare(b.id))

  return {
    features,
    totalFeatures: features.length,
    coverageDigest: computeDigest(features.map((f) => f.id).sort().join('\n')),
  }
}

// Validated feature graph: canonical identities, ownership verification,
// dependency edge validation, and cycle detection.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Graph validation rejects unexplained ownership gaps/overlap, collisions,
// dangling edges, and unsupported cycles before extraction.


// Cycle policy classifications
const CYCLE_POLICIES = Object.freeze({
  SUPPORTED: 'supported',   // cycle allowed via explicit policy (e.g. priority override)
  UNSUPPORTED: 'unsupported', // cycle must not be scheduled — deadlock
  NONE: 'none',             // no cycle detected
})

// Graph validation result verdicts
const GRAPH_VERDICTS = Object.freeze({
  VALID: 'valid',
  INVALID: 'invalid',
})

// Canonicalize feature identities to be collision-free.
// If two features have the same derived ID, disambiguate using their paths.
//
// features: [{ id, paths: [...], ... }]
// Returns: { canonical: [{ id, originalId, paths, ... }], collisions: [...] }
function canonicalizeIdentity(features) {
  if (!Array.isArray(features)) {
    throw new Error('canonicalizeIdentity: features must be an array')
  }

  const idMap = new Map()
  for (const f of features) {
    const id = f.id || 'unknown'
    if (!idMap.has(id)) {
      idMap.set(id, [])
    }
    idMap.get(id).push(f)
  }

  const collisions = []
  const canonical = []

  for (const [id, group] of idMap) {
    if (group.length === 1) {
      canonical.push({ ...group[0], originalId: id })
    } else {
      // Collision: disambiguate by index suffix
      collisions.push({ id, count: group.length, paths: group.flatMap((f) => f.paths || []) })
      group.forEach((f, i) => {
        canonical.push({ ...f, originalId: id, id: `${id}-${i + 1}` })
      })
    }
  }

  return { canonical, collisions }
}

// Detect cycles in a dependency edge list using depth-first search.
// Returns the first cycle found (if any) as an array of feature IDs.
//
// edges: [{ from, to }] — from depends on to (to must complete first)
// Returns: { hasCycle, cycle: [...], allCycles: [...] }
function detectCycle(edges) {
  if (!Array.isArray(edges)) {
    return { hasCycle: false, cycle: [], allCycles: [] }
  }

  // Build adjacency list
  const adj = new Map()
  const nodes = new Set()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from).push(e.to)
    nodes.add(e.from)
    nodes.add(e.to)
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map()
  for (const n of nodes) color.set(n, WHITE)

  const allCycles = []

  function dfsVisit(node, path) {
    color.set(node, GRAY)
    path.push(node)

    const neighbors = adj.get(node) || []
    for (const next of neighbors) {
      if (!color.has(next)) {
        color.set(next, WHITE)
      }
      const c = color.get(next)
      if (c === GRAY) {
        // Found a cycle — extract it from the path
        const cycleStart = path.indexOf(next)
        const cycle = path.slice(cycleStart).concat([next])
        allCycles.push(cycle)
      } else if (c === WHITE) {
        dfsVisit(next, path)
      }
    }

    path.pop()
    color.set(node, BLACK)
  }

  for (const n of nodes) {
    if (color.get(n) === WHITE) {
      dfsVisit(n, [])
    }
  }

  // Deduplicate cycles (normalize rotation)
  const seen = new Set()
  const uniqueCycles = []
  for (const cycle of allCycles) {
    // Normalize: rotate so the smallest ID is first, then join as key
    const minIdx = cycle.indexOf(cycle.reduce((a, b) => (a < b ? a : b)))
    const normalized = [...cycle.slice(minIdx, -1), ...cycle.slice(0, minIdx)].join('->')
    if (!seen.has(normalized)) {
      seen.add(normalized)
      uniqueCycles.push(cycle)
    }
  }

  return {
    hasCycle: uniqueCycles.length > 0,
    cycle: uniqueCycles[0] || [],
    allCycles: uniqueCycles,
  }
}

// Classify a cycle as supported (policy override) or unsupported (deadlock).
//
// edges: [{ from, to }]
// cyclePolicy: optional map of { edgeKey: 'supported' | 'unsupported' }
// Returns: { classification: 'supported' | 'unsupported' | 'none', cycle: [...] }
function classifyCycle(edges, cyclePolicy) {
  const detection = detectCycle(edges)
  if (!detection.hasCycle) {
    return { classification: CYCLE_POLICIES.NONE, cycle: [] }
  }

  // Check if the cycle has explicit policy support
  const policy = cyclePolicy || {}
  const cycleEdges = detection.cycle
  let allSupported = true

  for (let i = 0; i < cycleEdges.length - 1; i++) {
    const key = `${cycleEdges[i]}->${cycleEdges[i + 1]}`
    if (policy[key] !== 'supported') {
      allSupported = false
      break
    }
  }

  return {
    classification: allSupported ? CYCLE_POLICIES.SUPPORTED : CYCLE_POLICIES.UNSUPPORTED,
    cycle: detection.cycle,
  }
}

// Validate the full feature graph.
//
// features: [{ id, paths: [...] }]
// edges: [{ from, to }] — dependency edges
// ownershipMap: optional { path: featureId } — explicit ownership assignment
// cyclePolicy: optional map for supported cycles
//
// Returns: {
//   verdict: 'valid' | 'invalid',
//   errors: [{ type, detail }],
//   warnings: [{ type, detail }],
// }
function validateGraph(features, edges, ownershipMap, cyclePolicy) {
  const errors = []
  const warnings = []

  // 1. Check for identity collisions
  const idSet = new Set()
  const idCounts = new Map()
  for (const f of features || []) {
    const id = f.id || 'unknown'
    idCounts.set(id, (idCounts.get(id) || 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ type: 'identity-collision', detail: `Feature ID '${id}' appears ${count} times` })
    }
  }

  // 2. Check ownership gaps (explicit ownership map references unknown features)
  if (ownershipMap) {
    const featureIds = new Set((features || []).map((f) => f.id))

    for (const [path, ownerId] of Object.entries(ownershipMap)) {
      if (!featureIds.has(ownerId)) {
        errors.push({ type: 'ownership-gap', detail: `Path '${path}' owned by unknown feature '${ownerId}'` })
      }
    }
  }

  // 2b. Check for path overlaps between features.
  // Two features claiming the same path is an ownership overlap; if an
  // ownershipMap resolves the path to one of the claimants, the overlap is
  // explained (warning), otherwise it is unexplained (error).
  const pathClaims = new Map()
  for (const f of features || []) {
    for (const p of (f.paths || [])) {
      if (!pathClaims.has(p)) {
        pathClaims.set(p, [])
      }
      pathClaims.get(p).push(f.id)
    }
  }
  for (const [path, claimants] of pathClaims) {
    if (claimants.length > 1) {
      const uniqueClaimants = [...new Set(claimants)]
      if (uniqueClaimants.length > 1) {
        const resolvedBy = ownershipMap ? ownershipMap[path] : undefined
        if (resolvedBy && uniqueClaimants.includes(resolvedBy)) {
          warnings.push({
            type: 'ownership-overlap-explained',
            detail: `Path '${path}' claimed by ${uniqueClaimants.join(', ')}; resolved to '${resolvedBy}'`,
          })
        } else {
          errors.push({
            type: 'ownership-overlap',
            detail: `Path '${path}' claimed by multiple features: ${uniqueClaimants.join(', ')}`,
          })
        }
      }
    }
  }

  // 2c. Warn about feature paths not covered by the ownership map
  if (ownershipMap) {
    const allFeaturePaths = new Set((features || []).flatMap((f) => f.paths || []))
    for (const p of allFeaturePaths) {
      if (!(p in ownershipMap)) {
        warnings.push({ type: 'ownership-unassigned', detail: `Path '${p}' not in ownership map` })
      }
    }
  }

  // 3. Check for dangling edges (references to non-existent features)
  const featureIdSet = new Set((features || []).map((f) => f.id))
  for (const e of edges || []) {
    if (!featureIdSet.has(e.from)) {
      errors.push({ type: 'dangling-edge', detail: `Edge from unknown feature '${e.from}'` })
    }
    if (!featureIdSet.has(e.to)) {
      errors.push({ type: 'dangling-edge', detail: `Edge to unknown feature '${e.to}'` })
    }
  }

  // 4. Check for cycles
  if (edges && edges.length > 0) {
    const cycleResult = classifyCycle(edges, cyclePolicy)
    if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
      errors.push({
        type: 'unsupported-cycle',
        detail: `Unsupported dependency cycle: ${cycleResult.cycle.join(' -> ')}`,
      })
    } else if (cycleResult.classification === CYCLE_POLICIES.SUPPORTED) {
      warnings.push({
        type: 'supported-cycle',
        detail: `Supported dependency cycle: ${cycleResult.cycle.join(' -> ')}`,
      })
    }
  }

  return {
    verdict: errors.length === 0 ? GRAPH_VERDICTS.VALID : GRAPH_VERDICTS.INVALID,
    errors,
    warnings,
  }
}

// Compute a deterministic digest of the feature graph.
// Includes feature IDs (sorted), paths, and edges (sorted).
function graphDigest(features, edges) {
  const fPart = (features || [])
    .map((f) => `${f.id}:${(f.paths || []).sort().join(',')}`)
    .sort()
    .join('\n')
  const ePart = (edges || [])
    .map((e) => `${e.from}->${e.to}`)
    .sort()
    .join('\n')
  return computeDigest(`${fPart}\n---\n${ePart}`)
}

// Truthful queue semantics: exactly-one-state guarantee, cap enforcement,
// selector application, deferred promotion, and coverage denominator.
// All functions are pure and deterministic — no I/O, no side effects.
//
// Caps and selectors retain unprocessed in-scope features as resumable deferred
// work rather than completion. Excluded paths remain outside the denominator
// with recorded rationale.


// Apply a segment cap to a list of features. Features beyond the cap are
// marked deferred (NOT excluded or completed). Previously runnable features
// within the cap remain runnable. Idempotent: reapplying the same cap produces
// the same result.
//
// features: [{ id, lifecycle, ... }]
// cap: max number of features in non-deferred processing state
// Returns: new features array with cap applied (does NOT mutate input)
function applyCap(features, cap) {
  if (!Array.isArray(features)) {
    throw new Error('applyCap: features must be an array')
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('applyCap: cap must be a positive number')
  }

  let processingCount = 0
  return features.map((f) => {
    // Only consider in-scope features (not excluded)
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // Count features already in a processing state (in-progress, runnable that
    // have been admitted, completed, failed, blocked, skipped)
    const isProcessing = f.lifecycle !== LIFECYCLE_STATES.DEFERRED &&
      f.lifecycle !== LIFECYCLE_STATES.EXCLUDED

    if (isProcessing || f.lifecycle === LIFECYCLE_STATES.RUNNABLE) {
      if (processingCount < cap) {
        processingCount++
        return { ...f }
      }
      // Over cap — defer with rationale
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'cap-exceeded',
      }
    }

    // Already deferred or other state — leave as-is
    return { ...f }
  })
}

// Apply a selector to filter which features are admitted. Non-selected
// in-scope features are marked deferred (NOT excluded). Idempotent.
//
// features: [{ id, lifecycle, ... }]
// selector: { includeIds: [...] } or { excludeIds: [...] }
// Returns: new features array with selector applied
function applySelector(features, selector) {
  if (!Array.isArray(features)) {
    throw new Error('applySelector: features must be an array')
  }
  if (!selector) {
    return features.map((f) => ({ ...f }))
  }

  const includeSet = new Set(selector.includeIds || [])
  const excludeSet = new Set(selector.excludeIds || [])

  return features.map((f) => {
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // If includeIds is specified, non-matching features are deferred
    if (includeSet.size > 0 && !includeSet.has(f.id)) {
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'selector-excluded',
      }
    }

    // If excludeIds is specified, matching features are deferred
    if (excludeSet.size > 0 && excludeSet.has(f.id)) {
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.DEFERRED,
        deferReason: 'selector-excluded',
      }
    }

    return { ...f }
  })
}

// Promote deferred features up to cap after some features have completed.
// Each feature is promoted from deferred exactly once. Returns updated features.
//
// features: [{ id, lifecycle, ... }]
// completedIds: Set or array of feature IDs that have completed
// cap: max processing features
// Returns: { features: updated, promoted: [...], remainingDeferred: number }
function promoteDeferred(features, completedIds, cap) {
  if (!Array.isArray(features)) {
    throw new Error('promoteDeferred: features must be an array')
  }

  const completedSet = completedIds instanceof Set ? completedIds : new Set(completedIds || [])
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('promoteDeferred: cap must be a positive number')
  }

  // Count only actively processing features (runnable, in-progress, blocked)
  // against the cap — completed and failed features do NOT consume cap slots
  let processingCount = 0
  const promoted = []

  const updated = features.map((f) => {
    // Completed features stay completed — they free their cap slot
    if (completedSet.has(f.id) || f.lifecycle === LIFECYCLE_STATES.COMPLETED) {
      return { ...f, lifecycle: LIFECYCLE_STATES.COMPLETED }
    }

    // Excluded features stay excluded
    if (f.lifecycle === LIFECYCLE_STATES.EXCLUDED) {
      return { ...f }
    }

    // Failed features do not consume cap slots
    if (f.lifecycle === LIFECYCLE_STATES.FAILED) {
      return { ...f }
    }

    // Actively processing features (runnable, in-progress, blocked) consume cap
    if (f.lifecycle !== LIFECYCLE_STATES.DEFERRED && f.lifecycle !== LIFECYCLE_STATES.SKIPPED) {
      processingCount++
      return { ...f }
    }

    // Deferred feature — promote if under cap
    if (processingCount < cap) {
      processingCount++
      promoted.push(f.id)
      return {
        ...f,
        lifecycle: LIFECYCLE_STATES.RUNNABLE,
        promotedAt: (f.promotedAt || 0) + 1,
      }
    }

    // Still deferred — over cap
    return { ...f }
  })

  const remainingDeferred = updated.filter(
    (f) => f.lifecycle === LIFECYCLE_STATES.DEFERRED
  ).length

  return { features: updated, promoted, remainingDeferred }
}

// Compute the coverage denominator: total in-scope features excluding
// those explicitly excluded. This is the truth source for readiness.
//
// features: [{ id, lifecycle, ... }]
// Returns: { denominator, excluded, total, breakdown: { ... } }
function queueDenominator(features) {
  if (!Array.isArray(features)) {
    throw new Error('queueDenominator: features must be an array')
  }

  const breakdown = {}
  let excluded = 0
  let total = features.length

  for (const f of features) {
    const lc = f.lifecycle || 'unknown'
    breakdown[lc] = (breakdown[lc] || 0) + 1
    if (lc === LIFECYCLE_STATES.EXCLUDED) {
      excluded++
    }
  }

  return {
    denominator: total - excluded,
    excluded,
    total,
    breakdown,
  }
}

// Compute exact completed/deferred counts for a cap-constrained segment.
// This is the core computation for the 23-feature/cap-8 progression:
// segment 1: 8 processed / 15 deferred
// segment 2: 16 processed / 7 deferred
// segment 3: 23 processed / 0 deferred
//
// totalFeatures: number of in-scope features
// cap: per-segment processing cap
// segment: 1-based segment number
// Returns: { processed, deferred, complete }
function segmentProgression(totalFeatures, cap, segment) {
  if (!Number.isFinite(totalFeatures) || totalFeatures < 0) {
    throw new Error('segmentProgression: totalFeatures must be non-negative')
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('segmentProgression: cap must be positive')
  }
  if (!Number.isFinite(segment) || segment < 1) {
    throw new Error('segmentProgression: segment must be >= 1')
  }

  const processed = Math.min(totalFeatures, cap * segment)
  const deferred = Math.max(0, totalFeatures - processed)
  const complete = processed >= totalFeatures

  return { processed, deferred, complete }
}

// Schedulability plan: prerequisite waves, cycle/no-progress classification,
// and bounded dependency context. All functions are pure and deterministic.
//
// The schedulability plan produces deterministic prerequisite waves, explicit
// cycle/no-progress outcomes, and bounded verified dependency summaries.


// Schedulability verdicts
const SCHEDULABILITY_VERDICTS = Object.freeze({
  SCHEDULABLE: 'schedulable',
  NO_PROGRESS: 'no-progress',
  UNSUPPORTED_CYCLE: 'unsupported-cycle',
})

// Compute deterministic prerequisite waves from features and dependency edges.
// Features with no unmet dependencies form wave 1; features whose dependencies
// are all in earlier waves form subsequent waves. Within a wave, cap limits
// how many features can be admitted.
//
// features: [{ id, ... }]
// edges: [{ from, to }] — from depends on to (to must complete first)
// cap: max features per wave (0 = unlimited)
// Returns: { waves: [[featureId, ...], ...], unscheduled: [...], verdict: 'schedulable'|'no-progress'|'unsupported-cycle' }
function computeWaves(features, edges, cap, cyclePolicy) {
  if (!Array.isArray(features)) {
    throw new Error('computeWaves: features must be an array')
  }

  const featureIds = new Set(features.map((f) => f.id))

  // Build reverse adjacency: for each feature, what does it depend on?
  const dependencies = new Map()
  for (const id of featureIds) {
    dependencies.set(id, new Set())
  }
  for (const e of (edges || [])) {
    if (featureIds.has(e.from) && featureIds.has(e.to)) {
      dependencies.get(e.from).add(e.to)
    }
  }

  // Check for unsupported cycles (respecting policy)
  const cycleCheck = detectCycle(edges || [])
  if (cycleCheck.hasCycle) {
    const cycleResult = classifyCycle(edges, cyclePolicy || {})
    if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
      return {
        waves: [],
        unscheduled: [...featureIds],
        verdict: SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE,
        cycle: cycleCheck.cycle,
      }
    }
  }

  // Topological wave assignment (Kahn's algorithm with wave tracking)
  // Cap is per-wave: limits how many features each wave admits, not total budget
  const waves = []
  const scheduled = new Set()

  while (scheduled.size < featureIds.size) {
    // Find features whose dependencies are all scheduled
    const ready = []
    for (const id of featureIds) {
      if (scheduled.has(id)) continue
      const deps = dependencies.get(id)
      let allMet = true
      for (const d of deps) {
        if (!scheduled.has(d)) {
          allMet = false
          break
        }
      }
      if (allMet) {
        ready.push(id)
      }
    }

    if (ready.length === 0) {
      // No progress — remaining features have unresolvable dependencies
      break
    }

    ready.sort() // deterministic ordering
    // Per-wave cap: limits features admitted per wave, not total budget.
    // Overflow features stay eligible for the next wave.
    const waveCap = (Number.isFinite(cap) && cap > 0) ? cap : ready.length
    const wave = ready.slice(0, waveCap)

    for (const id of wave) {
      scheduled.add(id)
    }
    waves.push(wave)
  }

  const unscheduled = [...featureIds].filter((id) => !scheduled.has(id)).sort()

  return {
    waves,
    unscheduled,
    verdict: unscheduled.length > 0
      ? SCHEDULABILITY_VERDICTS.NO_PROGRESS
      : SCHEDULABILITY_VERDICTS.SCHEDULABLE,
  }
}

// Compute bounded dependency context for a single feature.
// Traverses the dependency graph up to maxDepth hops, collecting verified
// summaries of each dependency. The context is bounded to prevent
// unbounded prompt growth.
//
// featureId: the feature to compute context for
// features: [{ id, paths, digest, ... }]
// edges: [{ from, to }]
// maxDepth: maximum traversal depth (default 3)
// Returns: { featureId, context: [{ id, depth, paths, digest }], bounded: boolean }
function boundedDependencyContext(featureId, features, edges, maxDepth) {
  if (!featureId) {
    throw new Error('boundedDependencyContext: featureId is required')
  }

  const depth = Number.isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 3

  // Build feature lookup
  const featureMap = new Map()
  for (const f of features || []) {
    featureMap.set(f.id, f)
  }

  // Build reverse dependency lookup: what does each feature depend on?
  const depsOf = new Map()
  for (const e of edges || []) {
    if (!depsOf.has(e.from)) depsOf.set(e.from, [])
    depsOf.get(e.from).push(e.to)
  }

  const context = []
  const visited = new Set([featureId])
  const queue = [{ id: featureId, currentDepth: 0 }]

  while (queue.length > 0) {
    const { id, currentDepth } = queue.shift()

    if (currentDepth >= depth) continue

    const deps = depsOf.get(id) || []
    for (const depId of deps.sort()) {
      if (visited.has(depId)) continue
      visited.add(depId)

      const depFeature = featureMap.get(depId)
      context.push({
        id: depId,
        depth: currentDepth + 1,
        paths: (depFeature && depFeature.paths) || [],
        digest: (depFeature && depFeature.digest) || null,
      })

      queue.push({ id: depId, currentDepth: currentDepth + 1 })
    }
  }

  return {
    featureId,
    context,
    bounded: visited.size > depth * 5, // heuristic: if we visited many nodes, context was bounded
  }
}

// Overall schedulability decision for the full feature set.
// Combines cycle detection, wave computation, and no-progress detection.
//
// features: [{ id, ... }]
// edges: [{ from, to }]
// cap: optional per-wave cap
// cyclePolicy: optional map of supported cycle edges
// Returns: { verdict, waves, unscheduled, cycleDetected, details }
function schedulabilityDecision(features, edges, cap, cyclePolicy) {
  const cycleResult = classifyCycle(edges || [], cyclePolicy || {})

  if (cycleResult.classification === CYCLE_POLICIES.UNSUPPORTED) {
    return {
      verdict: SCHEDULABILITY_VERDICTS.UNSUPPORTED_CYCLE,
      waves: [],
      unscheduled: (features || []).map((f) => f.id).sort(),
      cycleDetected: true,
      cycle: cycleResult.cycle,
      details: `Unsupported dependency cycle prevents scheduling: ${cycleResult.cycle.join(' -> ')}`,
    }
  }

  const waveResult = computeWaves(features, edges, cap, cyclePolicy)

  return {
    verdict: waveResult.verdict,
    waves: waveResult.waves,
    unscheduled: waveResult.unscheduled,
    cycleDetected: cycleResult.classification === CYCLE_POLICIES.SUPPORTED,
    cycle: cycleResult.classification === CYCLE_POLICIES.SUPPORTED ? cycleResult.cycle : [],
    details: waveResult.verdict === SCHEDULABILITY_VERDICTS.SCHEDULABLE
      ? `All ${waveResult.waves.reduce((s, w) => s + w.length, 0)} features scheduled across ${waveResult.waves.length} wave(s)`
      : `${waveResult.unscheduled.length} feature(s) cannot be scheduled (no progress)`,
  }
}

// Budget admission: characterize limits, track spend, and reserve non-spendable
// capacity for checkpoint, reconciliation, synthesis, and handoff.
// All functions are pure and deterministic — no I/O, no side effects.

// Non-spendable reserve categories — capacity reserved for system-critical work
// that must never be consumed by gate/feature processing.
const RESERVE_TYPES = Object.freeze({
  CHECKPOINT: 'checkpoint',
  RECONCILIATION: 'reconciliation',
  SYNTHESIS: 'synthesis',
  HANDOFF: 'handoff',
})

// Characterized budget limits derived from runtime evidence, not guessed.
// callCeiling: shared runtime agent-call ceiling (default 1000)
// tokenCeiling: shared token budget (0 = uncharacterized)
// concurrency: max parallel features per segment
// retryPerGate: max retry attempts per gate per feature
// retryPerFeature: max total retries per feature
function createBudgetLimits(opts) {
  const o = opts || {}
  return {
    callCeiling: o.callCeiling || 1000,
    tokenCeiling: o.tokenCeiling || 0,
    concurrency: o.concurrency || 1,
    retryPerGate: o.retryPerGate || 3,
    retryPerFeature: o.retryPerFeature || 10,
  }
}

// Create a budget accountant that tracks actual spend against limits.
// Pure: all state is in the returned object, no mutation of inputs.
function createBudgetAccountant(limits) {
  return {
    limits,
    callsSpent: 0,
    tokensSpent: 0,
    reserve: {
      [RESERVE_TYPES.CHECKPOINT]: 0,
      [RESERVE_TYPES.RECONCILIATION]: 0,
      [RESERVE_TYPES.SYNTHESIS]: 0,
      [RESERVE_TYPES.HANDOFF]: 0,
    },
  }
}

// Set aside non-spendable reserve capacity. Returns a new accountant.
function setReserve(accountant, category, amount) {
  const next = {
    ...accountant,
    reserve: { ...accountant.reserve },
  }
  next.reserve[category] = amount
  return next
}

// Compute total reserved capacity across all categories.
function totalReserve(accountant) {
  return Object.values(accountant.reserve).reduce(function (s, v) { return s + v }, 0)
}

// Compute remaining callable budget after subtracting spent and reserved.
function callsRemaining(accountant) {
  var reserved = totalReserve(accountant)
  return Math.max(0, accountant.limits.callCeiling - accountant.callsSpent - reserved)
}

// Compute remaining token budget after subtracting spent and reserved.
// NOTE: totalReserve() is denominated in CALL units (DESIGN_RESERVE_CALLS etc.).
// Token-unit reserve accounting is deferred until tokenCeiling is characterized in
// real terms (v1.5.0 cleanup D3); until then reserves are a single call-unit pool
// applied to both budgets — harmless while tokenCeiling is uncharacterized (default 0,
// which short-circuits to Infinity above).
function tokensRemaining(accountant) {
  if (!accountant.limits.tokenCeiling) return Infinity
  var reserved = totalReserve(accountant)
  return Math.max(0, accountant.limits.tokenCeiling - accountant.tokensSpent - reserved)
}

// Admit a segment: check if estimated work fits within remaining budget
// after reserving non-spendable capacity. Never accept a segment that
// crosses the characterized ceiling.
function admitSegment(accountant, segmentCost) {
  var calls = callsRemaining(accountant)
  var tokens = tokensRemaining(accountant)
  var neededCalls = (segmentCost && segmentCost.calls) || 0
  var neededTokens = (segmentCost && segmentCost.tokens) || 0

  if (neededCalls > calls) {
    return { admitted: false, reason: 'call-ceiling', remaining: { calls: calls, tokens: tokens } }
  }
  if (neededTokens > tokens) {
    return { admitted: false, reason: 'token-ceiling', remaining: { calls: calls, tokens: tokens } }
  }
  return { admitted: true, remaining: { calls: calls, tokens: tokens } }
}

// Record actual budget spend. Pure: returns a new accountant.
function spendBudget(accountant, calls, tokens) {
  return {
    ...accountant,
    callsSpent: accountant.callsSpent + (calls || 0),
    tokensSpent: accountant.tokensSpent + (tokens || 0),
    reserve: { ...accountant.reserve },
  }
}

// Check if a feature's next atomic gate can complete within remaining budget.
// Prevents admitting a feature whose next gate would cross the ceiling.
function canFinishNextGate(accountant, gateCost) {
  var calls = callsRemaining(accountant)
  var tokens = tokensRemaining(accountant)
  var neededCalls = (gateCost && gateCost.calls) || 0
  var neededTokens = (gateCost && gateCost.tokens) || 0
  return neededCalls <= calls && neededTokens <= tokens
}

// Budget summary for handoff/status reporting.
function budgetSummary(accountant) {
  return {
    callCeiling: accountant.limits.callCeiling,
    callsSpent: accountant.callsSpent,
    callsRemaining: callsRemaining(accountant),
    reserved: totalReserve(accountant),
    reserveBreakdown: { ...accountant.reserve },
  }
}

// Bounded retry policy: per-gate and per-feature retry limits, persistent
// attempt history with monotonic sequence, and terminal reason tracking.
// Exhausted retries are never reclassified as completed.
// All functions are pure and deterministic — no I/O, no side effects.

// Attempt outcomes
const ATTEMPT_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  RETRYABLE_FAILURE: 'retryable-failure',
  TIMEOUT: 'timeout',
  INVALID_OUTPUT: 'invalid-output',
  PERMANENT_FAILURE: 'permanent-failure',
  BLOCKED_DEPENDENCY: 'blocked-dependency',
})

// Outcomes that count toward retry exhaustion
var EXHAUSTING_OUTCOMES = {
  'retryable-failure': true,
  'timeout': true,
  'invalid-output': true,
}

// Create a retry policy with per-gate and per-feature limits.
function createRetryPolicy(opts) {
  var o = opts || {}
  return {
    maxPerGate: o.maxPerGate || 3,
    maxPerFeature: o.maxPerFeature || 10,
  }
}

// Create a fresh attempt history. The _seq counter is monotonic.
function createAttemptHistory() {
  return {
    attempts: [],
    _seq: 0,
  }
}

// Record an attempt. Pure: returns a new history with a new monotonic sequence number.
function recordAttempt(history, featureId, gate, outcome, reason) {
  var seq = history._seq + 1
  var attempt = {
    seq: seq,
    featureId: featureId,
    gate: gate,
    outcome: outcome,
    reason: reason || null,
  }
  return {
    attempts: history.attempts.concat([attempt]),
    _seq: seq,
  }
}

// Count retryable attempts for a specific feature+gate combination.
// Only exhausting outcomes (retryable-failure, timeout, invalid-output) count.
function gateAttemptCount(history, featureId, gate) {
  var count = 0
  for (var i = 0; i < history.attempts.length; i++) {
    var a = history.attempts[i]
    if (a.featureId === featureId && a.gate === gate && EXHAUSTING_OUTCOMES[a.outcome]) {
      count++
    }
  }
  return count
}

// Count total retryable attempts for a feature across all gates.
function featureAttemptCount(history, featureId) {
  var count = 0
  for (var i = 0; i < history.attempts.length; i++) {
    var a = history.attempts[i]
    if (a.featureId === featureId && EXHAUSTING_OUTCOMES[a.outcome]) {
      count++
    }
  }
  return count
}

// Check if per-gate retries are exhausted for a feature+gate.
function isGateRetriesExhausted(history, featureId, gate, policy) {
  return gateAttemptCount(history, featureId, gate) >= policy.maxPerGate
}

// Check if total per-feature retries are exhausted.
function isFeatureRetriesExhausted(history, featureId, policy) {
  return featureAttemptCount(history, featureId) >= policy.maxPerFeature
}

// Check if a feature is terminally failed — no more retries possible.
// A permanent failure or blocked dependency is immediately terminal.
// Exhausted retries (per-gate or per-feature) are also terminal.
function isTerminalFailure(history, featureId, policy) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  if (featureAttempts.length === 0) return false

  var lastOutcome = featureAttempts[featureAttempts.length - 1].outcome
  if (lastOutcome === ATTEMPT_OUTCOMES.PERMANENT_FAILURE) return true
  if (lastOutcome === ATTEMPT_OUTCOMES.BLOCKED_DEPENDENCY) return true

  return isFeatureRetriesExhausted(history, featureId, policy)
}

// Get the terminal reason for a feature (if terminally failed).
function terminalReason(history, featureId) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  if (featureAttempts.length === 0) return null
  var last = featureAttempts[featureAttempts.length - 1]
  return last.reason || last.outcome
}

// Summary of attempts for a feature for handoff/status reporting.
function attemptSummary(history, featureId) {
  var featureAttempts = history.attempts.filter(function (a) { return a.featureId === featureId })
  return {
    totalAttempts: featureAttempts.length,
    lastOutcome: featureAttempts.length > 0 ? featureAttempts[featureAttempts.length - 1].outcome : null,
    lastReason: featureAttempts.length > 0 ? featureAttempts[featureAttempts.length - 1].reason : null,
    gates: featureAttempts.map(function (a) { return a.gate }).filter(function (v, i, arr) { return arr.indexOf(v) === i }),
  }
}

// Failure isolation: one feature failure does not lose or poison independent work.
// Updates only the failed feature's shard; eligible independent features continue.
// Verified artifacts are preserved on failure.
// All functions are pure and deterministic — no I/O, no side effects.

// Isolate a feature failure: update only the failed feature's lifecycle,
// preserving all other features' state and verified artifacts.
// Pure: returns a new queue array, does NOT mutate the input.
// Timeout and blocked failures are resumable (status='blocked'); other
// failure types are terminal (status='failed').
function isolateFailure(queue, failedId, failureType) {
  var resumable = failureType === 'timeout' || failureType === 'blocked'
  return queue.map(function (entry) {
    if (entry.id !== failedId) {
      return Object.assign({}, entry)
    }
    // Failed feature: preserve verified artifacts, update status
    return Object.assign({}, entry, {
      status: resumable ? 'blocked' : 'failed',
      failureType: failureType || 'unknown',
      // Artifacts are PRESERVED — failure does not lose verified work
      artifacts: entry.artifacts || {},
    })
  })
}

// Given a failed feature, determine which other features are eligible to
// continue independently (not blocked by the failure through dependencies).
// Uses transitive closure: any feature whose dependency chain reaches the
// failed feature is blocked.
function eligibleIndependents(queue, failedId, edges) {
  var transitivelyBlocked = {}
  transitivelyBlocked[failedId] = true

  // Propagate: any feature whose dependency is blocked is itself blocked
  var changed = true
  while (changed) {
    changed = false
    for (var i = 0; i < (edges || []).length; i++) {
      var e = edges[i]
      if (transitivelyBlocked[e.to] && !transitivelyBlocked[e.from]) {
        transitivelyBlocked[e.from] = true
        changed = true
      }
    }
  }

  // Eligible: not transitively blocked, and still has work to do
  return queue.filter(function (entry) {
    if (transitivelyBlocked[entry.id]) return false
    return entry.status === 'pending' || entry.status === 'in-progress'
  })
}

// Preserve verified artifacts from a failed feature slice.
// Returns only the artifacts that were actually produced (truthy paths).
function preserveVerifiedArtifacts(slice) {
  var artifacts = slice.artifacts || {}
  var verified = {}
  for (var key in artifacts) {
    if (artifacts[key]) verified[key] = artifacts[key]
  }
  return verified
}

// Determine if a segment should continue after a feature failure.
// True if at least one eligible independent feature remains.
function shouldContinueAfterFailure(queue, failedId, edges) {
  return eligibleIndependents(queue, failedId, edges).length > 0
}

// Count features by terminal status within a segment.
// Maps both 'done' and 'completed' to the completed bucket since the
// extract queue uses 'done' while the lifecycle reducer uses 'completed'.
function segmentOutcome(queue) {
  var counts = {
    completed: 0,
    blocked: 0,
    failed: 0,
    deferred: 0,
    skipped: 0,
    pending: 0,
  }
  for (var i = 0; i < queue.length; i++) {
    var status = queue[i].status
    if (status === 'done' || status === 'completed') counts.completed++
    else if (status in counts) counts[status]++
    else counts.pending++
  }
  return counts
}

// Transactional automatic continuation: monotonic segment identifiers,
// idempotency keys, and convergence of duplicate/lost/out-of-order launches.
// One command launches the next segment while progress is possible; every
// stop emits an exact idempotent manual resume command.
// All functions are pure and deterministic — no I/O, no side effects.

// Create a continuation state tracker.
function createContinuationState() {
  return {
    lastSegmentId: 0,
    intents: [],
    acknowledgements: [],
  }
}

// Allocate the next monotonic segment identifier. Pure: returns new state + id.
function nextSegmentId(state) {
  var segmentId = state.lastSegmentId + 1
  return {
    state: Object.assign({}, state, { lastSegmentId: segmentId }),
    segmentId: segmentId,
  }
}

// Generate an idempotency key for a segment. Deterministic: same features + revision
// produce the same key, so duplicate launches converge to one outcome.
function idempotencyKey(segmentId, featureIds, revision) {
  var ids = featureIds.slice().sort().join(',')
  return 'seg-' + segmentId + '-' + ids + '-' + (revision || 'none')
}

// Create a segment intent: the orchestrator declares it is about to launch
// a segment. This is the write-intent phase before actual work begins.
// Duplicate intents for the same segment converge (idempotent).
function createSegmentIntent(state, segmentId, featureIds, revision) {
  var key = idempotencyKey(segmentId, featureIds, revision)
  // Check if this exact intent already exists (duplicate launch)
  for (var i = 0; i < state.intents.length; i++) {
    if (state.intents[i].segmentId === segmentId && state.intents[i].idempotencyKey === key) {
      return { state: state, duplicate: true, intent: state.intents[i] }
    }
  }
  var intent = {
    segmentId: segmentId,
    idempotencyKey: key,
    features: featureIds.slice().sort(),
    revision: revision || null,
    acknowledged: false,
  }
  return {
    state: Object.assign({}, state, { intents: state.intents.concat([intent]) }),
    duplicate: false,
    intent: intent,
  }
}

// Acknowledge a segment completion: the commit phase.
// Idempotent: acknowledging the same segment twice converges to one outcome.
function acknowledgeSegment(state, segmentId, key, outcome, counts) {
  // Check if already acknowledged (duplicate acknowledgement)
  for (var i = 0; i < state.acknowledgements.length; i++) {
    if (state.acknowledgements[i].segmentId === segmentId) {
      return { state: state, duplicate: true, acknowledgement: state.acknowledgements[i] }
    }
  }

  var acknowledgement = {
    segmentId: segmentId,
    idempotencyKey: key,
    outcome: outcome || 'partial',
    counts: counts || {},
  }

  // Mark intent as acknowledged
  var intents = state.intents.map(function (i) {
    if (i.segmentId === segmentId) return Object.assign({}, i, { acknowledged: true })
    return i
  })

  return {
    state: Object.assign({}, state, {
      intents: intents,
      acknowledgements: state.acknowledgements.concat([acknowledgement]),
    }),
    duplicate: false,
    acknowledgement: acknowledgement,
  }
}

// Resolve convergence of duplicate, lost, resumed, or out-of-order launches.
// Produces the canonical durable outcome — one outcome per segment, no skipped
// or double-applied work. First acknowledgement for each segment wins.
function resolveConvergence(state) {
  var seen = {} // segmentId -> canonical ack

  for (var i = 0; i < state.acknowledgements.length; i++) {
    var ack = state.acknowledgements[i]
    if (!seen[ack.segmentId]) {
      seen[ack.segmentId] = ack
    }
    // Duplicate: first acknowledgement wins (idempotent)
  }

  var converged = Object.keys(seen).map(function (k) { return seen[k] })
  converged.sort(function (a, b) { return a.segmentId - b.segmentId })

  // Check for unacknowledged intents (lost acknowledgements / crashes)
  var unacknowledged = state.intents.filter(function (intent) {
    return !seen[intent.segmentId]
  })

  return {
    converged: converged,
    unacknowledged: unacknowledged,
    pendingRetry: unacknowledged.map(function (i) {
      return {
        segmentId: i.segmentId,
        idempotencyKey: i.idempotencyKey,
        features: i.features,
      }
    }),
  }
}

// Determine if progress is still possible (continuation decision).
// True if there are pending or in-progress features.
function shouldContinue(queue) {
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].status === 'pending' || queue[i].status === 'in-progress') {
      return true
    }
  }
  return false
}

// Count features by outcome across all acknowledged segments.
function segmentCounts(state) {
  var counts = { completed: 0, deferred: 0, blocked: 0, failed: 0, skipped: 0 }
  for (var i = 0; i < state.acknowledgements.length; i++) {
    var c = state.acknowledgements[i].counts || {}
    counts.completed += c.completed || 0
    counts.deferred += c.deferred || 0
    counts.blocked += c.blocked || 0
    counts.failed += c.failed || 0
    counts.skipped += c.skipped || 0
  }
  return counts
}

// Generate the exact idempotent manual resume command for a stopped segment.
// This command reproduces the same state transition when run manually.
function resumeCommand(planDir, segmentId, state) {
  var convergence = resolveConvergence(state)
  var hasUnack = convergence.unacknowledged.length > 0
  return {
    command: '/feature-workflows:extract-design --resume ' + planDir,
    segmentId: segmentId,
    reason: hasUnack ? 'unacknowledged-intent' : 'no-progress-or-ceiling',
    counts: segmentCounts(state),
    idempotent: true,
  }
}

// Detect out-of-order delivery: an acknowledgement for segment N+1 arriving
// before segment N's acknowledgement. Out-of-order acks converge correctly.
function isOutOfOrder(state, segmentId) {
  var ackedIds = {}
  for (var i = 0; i < state.acknowledgements.length; i++) {
    ackedIds[state.acknowledgements[i].segmentId] = true
  }
  // Out-of-order if a lower segment has an intent but no ack
  for (var j = 0; j < state.intents.length; j++) {
    if (state.intents[j].segmentId < segmentId && !ackedIds[state.intents[j].segmentId]) {
      return true
    }
  }
  return false
}

// Check if automatic relaunch is possible (not refused).
// Returns false when the budget is exhausted or too many unacknowledged
// intents exist (potential crash loop).
function canAutoRelaunch(state, budgetCallsRemaining) {
  if (budgetCallsRemaining <= 0) return false
  var convergence = resolveConvergence(state)
  return convergence.unacknowledged.length < 3
}

// Full continuation summary for handoff/status reporting.
function continuationSummary(state) {
  var convergence = resolveConvergence(state)
  return {
    lastSegmentId: state.lastSegmentId,
    acknowledgedSegments: convergence.converged.length,
    unacknowledgedIntents: convergence.unacknowledged.length,
    totalCounts: segmentCounts(state),
    hasUnacknowledged: convergence.unacknowledged.length > 0,
  }
}

// Incremental project-view synthesis: derive system overview, dependency map,
// cross-cutting concerns, and coverage index from bounded verified feature
// summaries. All functions are pure — no I/O, no side effects.
//
// Views update idempotently: the same verified summaries always produce the
// same project views. Selective revision invalidation means only views whose
// contributing feature digests changed are rebuilt; unaffected views are
// retained. This obeys the revision contract established for feature gates.

// Reuse the proven djb2 hash algorithm (same as revision.mjs and state.mjs).
// Defined independently to keep this module self-contained in the concatenated dist.
function synthHash(str) {
  var s = String(str == null ? '' : str)
  var h = 5381
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

function synthDigest(obj) {
  return synthHash(JSON.stringify(synthSortKeys(obj)))
}

function synthSortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(synthSortKeys)
  var sorted = {}
  for (var key of Object.keys(obj).sort()) {
    sorted[key] = synthSortKeys(obj[key])
  }
  return sorted
}

// View types produced by synthesis. Each derives from feature summaries.
const VIEW_TYPES = Object.freeze({
  SYSTEM_OVERVIEW: 'systemOverview',
  DEPENDENCY_MAP: 'dependencyMap',
  CROSS_CUTTING: 'crossCutting',
  COVERAGE_INDEX: 'coverageIndex',
})

// Initialize empty synthesis state.
function createSynthesisState() {
  return {
    views: {},
    viewRevisions: {},
    featureDigests: {},
    synthesized: false,
  }
}

// Derive the coverage index from feature summaries.
// Pure: counts lifecycle states deterministically.
function deriveCoverageIndex(summaries) {
  var counts = {
    completed: 0,
    deferred: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    'in-progress': 0,
    runnable: 0,
  }
  for (var i = 0; i < summaries.length; i++) {
    var lc = summaries[i].lifecycle || 'runnable'
    if (counts[lc] !== undefined) counts[lc]++
  }
  var denominator = summaries.length - counts.excluded
  return {
    denominator: denominator,
    completed: counts.completed,
    deferred: counts.deferred,
    remaining: counts.runnable + counts.deferred + counts['in-progress'],
    blocked: counts.blocked,
    failed: counts.failed,
    skipped: counts.skipped,
    excluded: counts.excluded,
  }
}

// Derive the dependency map from feature summaries.
// Collects all declared cross-feature dependencies into a unified edge list.
function deriveDependencyMap(summaries) {
  var edges = []
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i]
    var deps = s.dependencies || []
    for (var j = 0; j < deps.length; j++) {
      edges.push({ from: s.id, to: deps[j], type: 'depends-on' })
    }
  }
  edges.sort(function (a, b) {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1
    if (a.to !== b.to) return a.to < b.to ? -1 : 1
    return 0
  })
  return { edges: edges, totalEdges: edges.length }
}

// Derive cross-cutting concerns from feature summaries.
// Aggregates shared tags/concerns across features.
function deriveCrossCutting(summaries) {
  var concernMap = {}
  for (var i = 0; i < summaries.length; i++) {
    var concerns = summaries[i].crossCuttingConcerns || []
    for (var j = 0; j < concerns.length; j++) {
      var c = concerns[j]
      if (!concernMap[c]) concernMap[c] = []
      concernMap[c].push(summaries[i].id)
    }
  }
  var result = []
  for (var concern of Object.keys(concernMap).sort()) {
    if (concernMap[concern].length > 1) {
      result.push({ concern: concern, features: concernMap[concern].sort() })
    }
  }
  return { sharedConcerns: result }
}

// Derive the system overview from feature summaries.
// Aggregates module names, descriptions, and artifact paths.
function deriveSystemOverview(summaries) {
  var modules = []
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i]
    modules.push({
      id: s.id,
      name: s.name || s.id,
      lifecycle: s.lifecycle || 'runnable',
      artifacts: s.artifacts || {},
    })
  }
  modules.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 })
  return { modules: modules, totalModules: modules.length }
}

// Synthesize all project views from verified feature summaries.
// Idempotent: same summaries + revisions always produce the same views.
// Only summaries whose digest changed trigger a view rebuild.
function synthesizeProjectViews(featureSummaries, oldState, revisions) {
  if (!featureSummaries || !Array.isArray(featureSummaries)) {
    featureSummaries = []
  }
  var prev = oldState || createSynthesisState()
  var revs = revisions || {}

  // Compute per-feature digests to detect changes
  var newDigests = {}
  var changed = false
  for (var i = 0; i < featureSummaries.length; i++) {
    var s = featureSummaries[i]
    var d = synthDigest(s)
    newDigests[s.id] = d
    if (prev.featureDigests[s.id] !== d) {
      changed = true
    }
  }

  // Detect feature-set membership changes (removals not caught by digest check)
  if (Object.keys(prev.featureDigests || {}).length !== Object.keys(newDigests).length) {
    changed = true
  }

  // If nothing changed and revisions match, retain existing views (idempotent)
  var revChanged = false
  for (var key of Object.keys(revs)) {
    if (prev.viewRevisions[key] !== revs[key]) revChanged = true
  }

  if (!changed && !revChanged && prev.synthesized) {
    // Fully idempotent: return previous state
    return prev
  }

  // Derive all four view types from the verified summaries
  var views = {
    systemOverview: deriveSystemOverview(featureSummaries),
    dependencyMap: deriveDependencyMap(featureSummaries),
    crossCutting: deriveCrossCutting(featureSummaries),
    coverageIndex: deriveCoverageIndex(featureSummaries),
  }

  return {
    views: views,
    viewRevisions: Object.assign({}, revs),
    featureDigests: newDigests,
    synthesized: true,
  }
}

// Check if synthesis views are current against the given revisions.
function isSynthesisCurrent(state, currentRevisions) {
  if (!state || !state.synthesized) return false
  var revs = currentRevisions || {}
  for (var key of Object.keys(revs)) {
    if (state.viewRevisions[key] !== revs[key]) return false
  }
  return true
}

// Selectively invalidate only views whose contributing features changed.
// Uses the revision contract: only affected views are marked stale.
function invalidateStaleViews(state, revisionDelta) {
  if (!state || !state.synthesized) return createSynthesisState()
  var affected = (revisionDelta && revisionDelta.changedInputs) || []
  if (affected.length === 0) return state

  // Source changes affect system overview and dependency map
  // Scope changes affect system overview and coverage index
  // Graph changes affect dependency map
  // Artifact changes affect system overview
  var staleViews = {}
  var VIEW_DEPS = {
    systemOverview: ['source', 'scope', 'artifact'],
    dependencyMap: ['source', 'graph', 'deps'],
    crossCutting: ['source', 'scope'],
    coverageIndex: ['scope'],
  }

  for (var view of Object.keys(VIEW_DEPS)) {
    var inputs = VIEW_DEPS[view]
    for (var j = 0; j < affected.length; j++) {
      if (inputs.indexOf(affected[j]) !== -1) {
        staleViews[view] = true
        break
      }
    }
  }

  if (Object.keys(staleViews).length === 0) return state

  // Mark synthesis as not current — next synthesize call rebuilds stale views
  var newState = Object.assign({}, state)
  newState.staleViews = Object.keys(staleViews).sort()
  return newState
}

// Summary for handoff/status reporting.
function synthesisSummary(state) {
  if (!state || !state.synthesized) {
    return { synthesized: false, views: 0, staleViews: [] }
  }
  return {
    synthesized: true,
    views: Object.keys(state.views).length,
    staleViews: state.staleViews || [],
    coverage: state.views.coverageIndex || null,
  }
}

// Attempted-vs-durable persistence tracking: distinguish writes that were
// attempted from writes that are durably verified. Retry-safe: retrying a
// failed write cannot produce duplicate index, synthesis, or continuation
// state. All functions are pure — no I/O, no side effects.

// Three terminal persistence states for each write unit.
const PERSISTENCE_STATES = Object.freeze({
  ATTEMPTED: 'attempted',
  DURABLY_VERIFIED: 'durably-verified',
  FAILED: 'failed',
})

// Write-unit types that are tracked for retry-safe persistence.
const PERSIST_UNIT_TYPES = Object.freeze({
  FEATURE_SHARD: 'feature-shard',
  PROJECT_INDEX: 'project-index',
  SYNTHESIS_VIEW: 'synthesis-view',
  CONTINUATION_ACK: 'continuation-ack',
})

// Initialize empty persistence tracker.
function createPersistenceTracker() {
  return {
    writes: {},
    history: [],
  }
}

// Record an attempted write. Idempotent: recording the same key twice does
// not duplicate state — it updates the timestamp of the existing attempt.
// A durably verified write cannot be demoted back to attempted.
function recordAttemptedWrite(tracker, key, unitType) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('recordAttemptedWrite: tracker must be an object')
  }
  if (!key) throw new Error('recordAttemptedWrite: key is required')

  var existing = tracker.writes[key]
  if (existing && existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Durably verified writes are never demoted — retry safety.
    return tracker
  }

  var entry = {
    key: key,
    unitType: unitType || (existing ? existing.unitType : PERSIST_UNIT_TYPES.FEATURE_SHARD),
    state: PERSISTENCE_STATES.ATTEMPTED,
    attempts: existing ? existing.attempts + 1 : 1,
  }

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'attempted',
    attemptNumber: entry.attempts,
  }])

  return { writes: writes, history: history }
}

// Verify a write as durably completed. Once verified, the write is permanent —
// retrying cannot change its state (no duplicate state on retry).
function verifyDurableWrite(tracker, key) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('verifyDurableWrite: tracker must be an object')
  }
  if (!key) throw new Error('verifyDurableWrite: key is required')

  var existing = tracker.writes[key]
  if (!existing) {
    throw new Error('verifyDurableWrite: no attempted write for key ' + key)
  }
  if (existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Already verified — idempotent, no state change
    return tracker
  }

  var entry = Object.assign({}, existing, {
    state: PERSISTENCE_STATES.DURABLY_VERIFIED,
  })

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'verified',
    attemptNumber: existing.attempts,
  }])

  return { writes: writes, history: history }
}

// Mark a write as failed. The write remains in the tracker so retry logic
// can inspect its attempt count and reason. Failed writes can be retried.
function failWrite(tracker, key, reason) {
  if (!tracker || typeof tracker !== 'object') {
    throw new Error('failWrite: tracker must be an object')
  }
  if (!key) throw new Error('failWrite: key is required')

  var existing = tracker.writes[key]
  if (existing && existing.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
    // Durably verified writes cannot be failed — they are permanent
    return tracker
  }

  var attempts = existing ? existing.attempts : 0
  var entry = {
    key: key,
    unitType: existing ? existing.unitType : PERSIST_UNIT_TYPES.FEATURE_SHARD,
    state: PERSISTENCE_STATES.FAILED,
    attempts: attempts,
    failReason: reason || 'unknown',
  }

  var writes = Object.assign({}, tracker.writes)
  writes[key] = entry

  var history = tracker.history.concat([{
    key: key,
    action: 'failed',
    attemptNumber: attempts,
    reason: reason || 'unknown',
  }])

  return { writes: writes, history: history }
}

// Check if retrying a write is safe — it is safe only if the write is NOT
// already durably verified (which would risk duplicating state on retry).
function isRetrySafe(tracker, key) {
  if (!tracker || !tracker.writes[key]) return true
  return tracker.writes[key].state !== PERSISTENCE_STATES.DURABLY_VERIFIED
}

// Check if a specific write is durably verified.
function isDurablyVerified(tracker, key) {
  if (!tracker || !tracker.writes[key]) return false
  return tracker.writes[key].state === PERSISTENCE_STATES.DURABLY_VERIFIED
}

// Generate a report of persistence status for handoff and status surfaces.
// Distinguishes attempted from durably verified, counts failures, and
// exposes per-unit-type breakdowns.
function persistenceReport(tracker) {
  if (!tracker) {
    return { attempted: 0, verified: 0, failed: 0, total: 0, byType: {} }
  }

  var writes = tracker.writes || {}
  var report = {
    attempted: 0,
    verified: 0,
    failed: 0,
    total: 0,
    byType: {},
  }

  for (var key of Object.keys(writes)) {
    var w = writes[key]
    report.total++
    var typeBucket = w.unitType || 'unknown'
    if (!report.byType[typeBucket]) report.byType[typeBucket] = { attempted: 0, verified: 0, failed: 0 }
    report.byType[typeBucket].total = (report.byType[typeBucket].total || 0) + 1

    if (w.state === PERSISTENCE_STATES.ATTEMPTED) {
      report.attempted++
      report.byType[typeBucket].attempted++
    } else if (w.state === PERSISTENCE_STATES.DURABLY_VERIFIED) {
      report.verified++
      report.byType[typeBucket].verified++
    } else if (w.state === PERSISTENCE_STATES.FAILED) {
      report.failed++
      report.byType[typeBucket].failed++
    }
  }

  return report
}

// Truthful readiness derivation and status projection: the command handoff
// and read-only status surface report the same immutable projection for
// denominator, lifecycle outcomes, revisions, budgets, failures, readiness
// proof, and continuation command. extractReady is true only when every
// condition is genuinely met. All functions are pure — no I/O, no side effects.

// Readiness failure reasons — each maps to a specific unmet condition.
const READINESS_REASONS = Object.freeze({
  DISCOVERY_INCOMPLETE: 'discovery-not-exhausted',
  GRAPH_INVALID: 'graph-invalid',
  FEATURES_INCOMPLETE: 'features-incomplete',
  SYNTHESIS_STALE: 'synthesis-stale',
  ARTIFACTS_STALE: 'artifacts-stale',
  ALL_MET: 'all-conditions-met',
})

// Derive truthful extract readiness from a comprehensive project state.
//
// projectState: {
//   discoveryExhausted: boolean,
//   graphValid: boolean,
//   features: [{ id, lifecycle, skipReason?, policyEvidence? }],
//   synthesisCurrent: boolean,
//   artifactsCurrent: boolean,
// }
//
// Returns: { ready, reason, checks, counts }
// ready is true ONLY when ALL conditions are met.
function deriveExtractReadiness(projectState) {
  if (!projectState || typeof projectState !== 'object') {
    return {
      ready: false,
      reason: READINESS_REASONS.FEATURES_INCOMPLETE,
      checks: { discoveryExhausted: false, graphValid: false, featuresComplete: false, synthesisCurrent: false, artifactsCurrent: false },
      counts: null,
    }
  }

  var features = projectState.features || []
  var counts = countLifecycleStates(features)
  var incompleteStates = ['runnable', 'deferred', 'in-progress', 'blocked', 'failed']
  var incompleteCount = 0
  var skippedIncomplete = 0

  for (var i = 0; i < features.length; i++) {
    var f = features[i]
    if (incompleteStates.indexOf(f.lifecycle) !== -1) {
      incompleteCount++
    }
    if (f.lifecycle === 'skipped') {
      // Only policy-disabled-optional with evidence may count as complete
      if (f.skipReason !== 'policy-disabled-optional' || !f.policyEvidence) {
        skippedIncomplete++
      }
    }
  }

  var discoveryOk = !!projectState.discoveryExhausted
  var graphOk = !!projectState.graphValid
  var featuresOk = incompleteCount === 0 && skippedIncomplete === 0
  var synthesisOk = !!projectState.synthesisCurrent
  var artifactsOk = !!projectState.artifactsCurrent

  var checks = {
    discoveryExhausted: discoveryOk,
    graphValid: graphOk,
    featuresComplete: featuresOk,
    synthesisCurrent: synthesisOk,
    artifactsCurrent: artifactsOk,
  }

  var ready = discoveryOk && graphOk && featuresOk && synthesisOk && artifactsOk

  var reason = READINESS_REASONS.ALL_MET
  if (!discoveryOk) reason = READINESS_REASONS.DISCOVERY_INCOMPLETE
  else if (!graphOk) reason = READINESS_REASONS.GRAPH_INVALID
  else if (!featuresOk) reason = READINESS_REASONS.FEATURES_INCOMPLETE
  else if (!synthesisOk) reason = READINESS_REASONS.SYNTHESIS_STALE
  else if (!artifactsOk) reason = READINESS_REASONS.ARTIFACTS_STALE

  return {
    ready: ready,
    reason: reason,
    checks: checks,
    counts: counts,
    incompleteCount: incompleteCount + skippedIncomplete,
  }
}

// Count features by lifecycle state. Pure helper.
function countLifecycleStates(features) {
  var counts = {
    runnable: 0,
    deferred: 0,
    'in-progress': 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    excluded: 0,
    completed: 0,
  }
  for (var i = 0; i < features.length; i++) {
    var lc = features[i].lifecycle
    if (counts[lc] !== undefined) counts[lc]++
  }
  counts.denominator = features.length - counts.excluded
  return counts
}

// Produce an immutable status projection from the full project state.
// This is the SINGLE source of truth shared by command handoff and
// read-only status — they MUST report identical data.
//
// projectState: {
//   discoveryExhausted, graphValid, features, synthesisCurrent,
//   artifactsCurrent, revisions, budget, failures, continuation,
//   planDir, scopeManifestPath,
// }
function projectStatusProjection(projectState) {
  if (!projectState || typeof projectState !== 'object') {
    return projectEmptyProjection()
  }

  var readiness = deriveExtractReadiness(projectState)
  var features = projectState.features || []
  var counts = readiness.counts || countLifecycleStates(features)

  // Immutable projection — frozen so handoff and status share the exact same object
  var projection = {
    planDir: projectState.planDir || null,
    scopeManifestPath: projectState.scopeManifestPath || null,
    ready: readiness.ready,
    readyReason: readiness.reason,
    checks: readiness.checks,
    denominator: counts.denominator || 0,
    lifecycleOutcomes: {
      completed: counts.completed || 0,
      deferred: counts.deferred || 0,
      blocked: counts.blocked || 0,
      failed: counts.failed || 0,
      skipped: counts.skipped || 0,
      excluded: counts.excluded || 0,
      'in-progress': counts['in-progress'] || 0,
      runnable: counts.runnable || 0,
    },
    revisions: projectState.revisions || null,
    budget: projectState.budget || null,
    failures: projectState.failures || [],
    continuation: projectState.continuation || null,
    incompleteCount: readiness.incompleteCount || 0,
  }

  return Object.freeze(projection)
}

// Empty projection for null/invalid state.
function projectEmptyProjection() {
  return Object.freeze({
    planDir: null,
    scopeManifestPath: null,
    ready: false,
    readyReason: READINESS_REASONS.FEATURES_INCOMPLETE,
    checks: {
      discoveryExhausted: false,
      graphValid: false,
      featuresComplete: false,
      synthesisCurrent: false,
      artifactsCurrent: false,
    },
    denominator: 0,
    lifecycleOutcomes: {
      completed: 0, deferred: 0, blocked: 0, failed: 0,
      skipped: 0, excluded: 0, 'in-progress': 0, runnable: 0,
    },
    revisions: null,
    budget: null,
    failures: [],
    continuation: null,
    incompleteCount: 0,
  })
}

// Design readiness failure reasons — each maps to a specific hidden degradation.
const DESIGN_READINESS_REASONS = Object.freeze({
  FAIL_FORWARD_REVIEW: 'fail-forward-review',
  FORCE_ACCEPTED_BLOCKERS: 'force-accepted-plan-with-blockers',
  UNRESOLVED_RECONCILE: 'unresolved-reconcile-conflicts',
  ALL_CLEAR: 'all-degradation-checks-clear',
})

// Derive truthful design readiness from design-mode result state.
// designReady must be true ONLY when no review was fail-forwarded,
// no plan carries force-accepted blockers, and reconcile conflicts are resolved.
// Pure: no I/O, no side effects.
function deriveDesignReadiness(result) {
  if (!result || typeof result !== 'object') {
    return { ready: false, reason: DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW, degradation: [] }
  }
  var degradation = []
  // Check fail-forward review flags (F4)
  var forcedReviews = []
  if (result._reviewedRequirementsForced) forcedReviews.push('Requirements')
  if (result._reviewedArchForced) forcedReviews.push('Architecture')
  if (result._reviewedDesignForced) forcedReviews.push('Detailed Design')
  if (forcedReviews.length) {
    degradation.push({ type: DESIGN_READINESS_REASONS.FAIL_FORWARD_REVIEW, gates: forcedReviews })
  }
  // Check force-accepted plan with carried blockers (F5)
  if (result.forceAccepted && result.carriedBlockers && result.carriedBlockers.length) {
    degradation.push({ type: DESIGN_READINESS_REASONS.FORCE_ACCEPTED_BLOCKERS, count: result.carriedBlockers.length })
  }
  // Check unresolved reconcile conflicts (F6)
  if (result.reconcile && result.reconcile.consistent === false && (result.reconcile.conflicts || []).length > 0) {
    degradation.push({ type: DESIGN_READINESS_REASONS.UNRESOLVED_RECONCILE, conflicts: result.reconcile.conflicts.length })
  }
  var ready = degradation.length === 0
  var reason = ready ? DESIGN_READINESS_REASONS.ALL_CLEAR : degradation[0].type
  return { ready: ready, reason: reason, degradation: degradation }
}

// Verify two projections are identical. Used to enforce the invariant that
// handoff and status report the same data.
function projectionsMatch(a, b) {
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

// Human-readable readiness summary for status reporting.
function readinessSummary(projection) {
  if (!projection) return 'No projection available.'
  var lines = []
  lines.push('Readiness: ' + (projection.ready ? 'READY' : 'NOT READY') + ' (' + projection.readyReason + ')')
  lines.push('Denominator: ' + projection.denominator)
  lines.push('Completed: ' + projection.lifecycleOutcomes.completed)
  if (projection.incompleteCount > 0) {
    lines.push('Incomplete: ' + projection.incompleteCount)
  }
  var checks = projection.checks || {}
  lines.push('Checks:')
  for (var key of Object.keys(checks)) {
    lines.push('  ' + (checks[key] ? '[x]' : '[ ]') + ' ' + key)
  }
  return lines.join('\n')
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
  // A pending stage-boundary edit request (user answer from the design-approval
  // checkpoint) steers the re-chunk; consumed on success so it applies exactly once.
  const editHint = result && result._stageEditRequest
    ? `\n\nUSER STAGE-BOUNDARY EDITS (a human reviewed the previous stage split and requested these changes — apply them when decomposing):\n${result._stageEditRequest}`
    : ''
  const chunk = await safeAgent(
    `You are the plan-chunker agent. Decompose the plan at ${planPath} into smaller, dependency-aware
execution stages so each stage fits one implement pass. Write each stage as a separate stageNN.md file
under ${planDir} (stage01.md, stage02.md, ... in dependency order). Update ${planPath} with TODO
references pointing to the created stage files (do not duplicate the stage bodies in the plan).

Task:
${task}

${laneHint}${editHint}

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
    if (result && result._stageEditRequest) result._stageEditRequest = null
    plogFromResult(result, `plan-chunker: ${chunk.stages.length} stage(s) written under ${planDir}`)
    return chunk.stages
  }
  // Degrade to a single implicit stage covering the whole plan (preserves single-executor behavior).
  // DCHUNK-01: record the degradation so the design terminal can surface it as an explicit outcome.
  plogFromResult(result, 'plan-chunker: returned no stages — degrading to single implicit stage01')
  if (result) {
    result._chunkerDegraded = true
    result._chunkerDegradationReason = 'plan-chunker returned no stages — single implicit stage01'
  }
  return [{
    id: 'stage01',
    file: planDir + 'stage01.md',
    name: 'Whole plan',
    status: 'pending',
    files: (lanes || []).flatMap((l) => l.files || []),
  }]
}

// Blocking subset of code-review findings: only blocker/high severity blocks the run
// (medium/low findings are informational and never gate).
function selectBlockingFindings(blockers) {
  return (Array.isArray(blockers) ? blockers : []).filter(
    (b) => b && (b.severity === 'blocker' || b.severity === 'high')
  )
}

// The issues-handoff directive shown when upstream-rooted findings were recorded for
// /tune-feature. `from` names the source gate (goalkeeper loop-back or code-review
// blockers) — single source of truth for the /tune-feature hint text.
function buildIssuesHandoff(planDir, upstreamCount, from) {
  return {
    from: 'implement',
    message: upstreamCount > 0
      ? `Upstream defect found by ${from} (${upstreamCount} upstream issue(s) written to ${planDir}issues-and-improvements.md). Run: /tune-feature ${planDir}`
      : `Upstream-flagged defect recorded by ${from} but none classified upstream. Review the findings; re-run /implement-feature ${planDir} after fixing, or /tune-feature ${planDir} to revisit design.`,
    nextMode: 'tune',
    planDir,
    upstreamCount,
  }
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
    const ack = await safeAgent(
      `You are a file-writer agent. APPEND the markdown section below to ${issuesPath}.
If the file does not exist, create it with a "# Issues & Improvements" header first, then the section.
Do NOT overwrite existing content — append only. Return ok=true and totalBytes = the file's total
size in bytes AFTER appending.

${section}`,
      { label: 'file-writer(issues)', phase: 'Goalkeeper', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
    )
    result.issuesPath = issuesPath
    // EN-4: the tune handoff depends on this trail — verify the append grew it.
    const growth = verifyAppendGrowth(result, issuesPath, ack)
    if (growth && growth.ok === false) plogFromResult(result, `issue-classifier: issues-and-improvements.md DID NOT grow (possible overwrite): ${issuesPath} ${growth.prev}->${growth.now}`)
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
    await safeAgent(
      `You are a file-writer agent. APPEND the status note below to the stage file at ${stage.file}.
If the file does not exist, create it with a "# Stage ${stage.id}: ${stage.name}" header first.
Do NOT overwrite existing content — append only. Return ok=true.

${entry}`,
      { label: `stage-tick:${stage.id}`, phase: 'Execute', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
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
  const scopeKnown = touched.size > 0
  let reset = 0
  for (const stage of result.stages) {
    if (stage.status !== 'done') continue
    if (preserve.has(stage.id)) continue
    const stageFiles = (stage.files || []).map((f) => String(f))
    if (!scopeKnown || stageFiles.some((f) => touched.has(f))) {
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

// ---- Extract mode (reverse design extraction) helpers ----------------------

// seedExtractQueue: build the resumable slice queue from the confirmed scope. PURE.
// Single coherent scope (or decomposition disabled) -> one entry whose planDir IS the
// parent planDir (artifacts land flat, no slices/ nesting). Wide scope -> one entry per
// slice under <parentPlanDir>slices/<slice-id>/. `selectedSlices` (--slices) filters by id;
// `maxSlices` caps the run — excess entries are kept with status 'skipped' so the index
// stays complete and a later run can resume them. Slices are ordered so dependencies
// (dependsOn) come first; on a cycle the given order is kept (stable).
function seedExtractQueue(scope, slices, parentPlanDir, maxSlices, selectedSlices) {
  const parent = String(parentPlanDir || '').replace(/\/$/, '') + '/'
  if (!slices || !slices.length) {
    return [{
      id: 'main',
      name: 'whole scope',
      planDir: parent,
      files: (scope && scope.files) || [],
      entryPoints: (scope && scope.entryPoints) || [],
      status: 'pending',
      artifacts: {},
    }]
  }
  // Stable dependency ordering: repeatedly take slices whose dependsOn are all placed.
  // A cycle (or dangling dependsOn) falls back to the given order for the remainder.
  const remaining = slices.slice()
  const ordered = []
  const placed = new Set()
  while (remaining.length) {
    const idx = remaining.findIndex((s) => (s.dependsOn || []).every((d) => placed.has(d) || !slices.some((o) => o.id === d)))
    const next = idx === -1 ? remaining.shift() : remaining.splice(idx, 1)[0]
    ordered.push(next)
    placed.add(next.id)
  }
  const selected = new Set((selectedSlices || []).map(String))
  const cap = Number.isFinite(maxSlices) && maxSlices > 0 ? maxSlices : ordered.length
  let active = 0
  return ordered.map((s) => {
    const id = categorizeSlug(s.id || s.name) || 'slice'
    const deselected = selected.size > 0 && !selected.has(s.id) && !selected.has(id)
    const overCap = active >= cap
    const status = deselected || overCap ? 'skipped' : 'pending'
    if (status === 'pending') active++
    return {
      id,
      name: s.name || id,
      planDir: `${parent}slices/${id}/`,
      files: s.files || [],
      entryPoints: s.entryPoints || [],
      status,
      artifacts: {},
    }
  })
}

// nextPendingSlice: first queue entry still pending. PURE.
function nextPendingSlice(queue) {
  return (queue || []).find((s) => s.status === 'pending') || null
}

// resolveScope (extract Gate X0): code-explorer resolves the hybrid input (free text /
// paths / globs / entry points) into a concrete scope manifest. Blocking — no scope means
// nothing to extract. Ambiguities are recorded to open-questions.md, not blocked on.
async function resolveScope({ task, planDir, result }) {
  const scopePath = planDir + 'scope-manifest.md'
  return flexibleAgent(
    `You are the code-explorer agent. Resolve the extraction input below into a CONCRETE code scope
and write a scope manifest to ${scopePath}. The input may be free text describing a feature/subsystem,
explicit paths/globs, entry points (API routes, CLI commands, exported functions), or any mix.
Use Serena tools (activate the project, list_dir, find_symbol, find_referencing_symbols,
search_for_pattern) to locate the code — do NOT guess paths.

IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT available.
Record anything needing user judgment in the ambiguities array instead of asking.

Extraction input:
${task}

Write to the manifest (and return in the verdict):
- files: every concrete file path in scope (resolved, existing files only)
- entryPoints: observable entry points into this code (routes, commands, handlers, exports)
- symbols: the key classes/functions anchoring the scope
- confidence: high|medium|low that this scope matches the input's intent
- wide: true ONLY if the scope spans multiple coherent subsystems that deserve separate design
  docs (e.g. a whole repo or a large multi-module directory); a single feature = wide:false
- suggestedSlices: when wide, candidate subsystem slices ({id, name, files, entryPoints, reason})
- ambiguities: unclear boundaries or intent questions (recorded, not blocking)

Do NOT modify any code. Do NOT commit. Return scopePath set to ${scopePath}.`,
    { label: 'code-explorer(scope)', phase: 'Extract Scope', schema: SCOPE_VERDICT, model: gm('scopeResolver') },
    result
  )
}

// auditExtractedDesign (extract Gate X7): critical-reviewer as an AS-IS design auditor.
// It audits the EXTRACTED docs (and the code they describe) for design debt, gaps, and
// doc<->code inconsistencies — it does NOT reject the docs. Findings append to
// <sliceDir>/issues-and-improvements.md in the exact section format the tune planner
// consumes (mirrors classifyAndRecordIssue), so /tune-feature <sliceDir> becomes the FIX
// flow for audit findings. Non-blocking.
async function auditExtractedDesign({ slicePlanDir, sliceState, task, result }) {
  const auditPath = slicePlanDir + 'design-audit.md'
  const docs = [
    sliceState.designPath ? `detailed design: ${sliceState.designPath}` : null,
    sliceState.archPath ? `architecture: ${sliceState.archPath}` : null,
    sliceState.useCasePath ? `e2e use cases: ${sliceState.useCasePath}` : null,
    sliceState.requirementsPath ? `requirements: ${sliceState.requirementsPath}` : null,
    sliceState.factsPath ? `codebase facts: ${sliceState.factsPath}` : null,
  ].filter(Boolean).join('\n')
  const verdict = await safeAgent(
    `You are the critical-reviewer agent acting as an AS-IS DESIGN AUDITOR. The design docs below were
EXTRACTED from existing code — they describe what the code does today. Do NOT reject or rewrite them.
Instead, audit the design they reveal for:
- design debt (wrong boundaries, leaky abstractions, tangled dependencies, missing seams)
- gaps (unhandled errors/edge cases, missing validation, absent tests for critical paths)
- cross-artifact inconsistencies (docs contradicting each other or the code)
Cite file:line evidence from the CODE for every finding. Write the audit report to ${auditPath}.

Extracted docs:
${docs}

Task context: ${task}

For each finding set: severity (blocker|high|medium|low), gate = the design doc that would have to
change to fix it (requirements|architecture|design|plan|tests|none), the finding phrased for a
design-doc author, a concrete suggestedFix, and evidence. Do NOT modify code or docs. Do NOT commit.`,
    { label: 'critical-reviewer(audit)', phase: 'Design Audit', schema: AUDIT_VERDICT, model: gm('audit') },
    result
  )
  if (!verdict || !verdict.auditPath) {
    plogFromResult(result, 'Design Audit: auditor returned no report (non-blocking) — skipping')
    return null
  }
  sliceState.auditPath = verdict.auditPath
  const upstream = (verdict.findings || []).filter((f) => f.gate && f.gate !== 'none')
  if (upstream.length) {
    const issuesPath = slicePlanDir.replace(/\/$/, '') + '/issues-and-improvements.md'
    const sections = upstream.map((f) => [
      `## Upstream issue — gate: ${f.gate}`,
      '',
      `**Severity:** ${f.severity || '(unspecified)'}`,
      `**Finding:** ${f.finding || '(unspecified)'}`,
      `**Suggested fix:** ${f.suggestedFix || '(none)'}`,
      '',
      '---',
      '',
    ].join('\n')).join('\n')
    try {
      const ack = await safeAgent(
        `You are a file-writer agent. APPEND the markdown sections below to ${issuesPath}.
If the file does not exist, create it with a "# Issues & Improvements" header first, then the sections.
Do NOT overwrite existing content — append only. Return ok=true and totalBytes = the file's total
size in bytes AFTER appending.

${sections}`,
        { label: 'file-writer(audit-issues)', phase: 'Design Audit', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
        result
      )
      sliceState.issuesPath = issuesPath
      const growth = verifyAppendGrowth(result, issuesPath, ack)
      if (growth && growth.ok === false) plogFromResult(result, `Design Audit: issues-and-improvements.md DID NOT grow (possible overwrite): ${issuesPath} ${growth.prev}->${growth.now}`)
      plogFromResult(result, `Design Audit: ${upstream.length} finding(s) recorded to ${issuesPath} (tune-consumable)`)
    } catch (e) {
      plogFromResult(result, `Design Audit: issues append failed (non-blocking): ${String(e)}`)
    }
  }
  plogFromResult(result, `Design Audit: report at ${verdict.auditPath}; findings=${(verdict.findings || []).length} (${upstream.length} upstream)`)
  return verdict
}

// ---- Pending-confirmation protocol (extract D0) ----------------------------

// Durable paths for the pending checkpoint and permanent locator.
const PENDING_DIR = 'docs/extract/.pending/'
const PENDING_LOCATOR_PATH = 'docs/extract/.pending-locator.json'

// File-reader result schemas (local — not exported).
const PENDING_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['record'],
  properties: {
    record: { type: ['object', 'null'], description: 'Parsed pending record, or null if the file does not exist' },
  },
}

const LOCATOR_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: { type: 'array', items: { type: 'object' }, description: 'Locator entries (empty if file does not exist)' },
  },
}

// generatePendingId: deterministic 16-hex pending id from task text + timestamp.
// Uses djb2 hash — sandbox-safe (no RNG or wall-clock dependency). PURE.
function generatePendingId(task, timestamp) {
  var raw = String(task || '') + '|' + String(timestamp || '')
  return computeDigest(raw).padStart(16, '0').slice(0, 16)
}

// buildPendingRecord: construct the PENDING-shaped record from preflight parts. PURE.
function buildPendingRecord(pendingId, task, verdict, createdAt) {
  return {
    pendingId: pendingId,
    task: String(task || ''),
    verdict: verdict,
    state: 'PENDING',
    createdAt: String(createdAt || ''),
  }
}

// isPendingExpired: check whether a pending record's bulky payload is past the TTL.
// Elapsed-time comparison via Date.parse; the caller supplies the current timestamp. PURE.
function isPendingExpired(record, maxAgeDays, nowTimestamp) {
  if (!record || !record.createdAt) return true
  if (record.state === 'EXPIRED') return true
  var createdMs = Date.parse(record.createdAt)
  var nowMs = Date.parse(nowTimestamp)
  if (isNaN(createdMs) || isNaN(nowMs)) return false
  var ageMs = nowMs - createdMs
  var maxMs = (maxAgeDays || 30) * 24 * 60 * 60 * 1000
  return ageMs > maxMs
}

// resolveLocatorEntry: pure lookup in a locator array. Returns the entry or null.
function resolveLocatorEntry(locator, pendingId) {
  if (!Array.isArray(locator)) return null
  for (var i = 0; i < locator.length; i++) {
    if (locator[i] && locator[i].pendingId === pendingId) return locator[i]
  }
  return null
}

// ---- Deterministic identity + hashing (Phase 13 / D1.1) --------------------

// normalizeToPosix: convert a path to repo-relative POSIX form.
// Replaces backslashes, strips leading ./ and /. PURE.
function normalizeToPosix(path) {
  var p = String(path || '').replace(/\\/g, '/')
  // strip leading ./ repeatedly (e.g. ././src -> src)
  while (p.startsWith('./')) p = p.slice(2)
  // strip a single leading /
  if (p.startsWith('/')) p = p.slice(1)
  return p
}

// validateHashes: fail-closed validation of per-file contentSha256 + scopeDigest.
// Returns { valid: true } only when every hash is 64-lowercase-hex and the arrays
// are well-formed; otherwise { valid: false, reason }. PURE.
var HEX64 = /^[0-9a-f]{64}$/
function validateHashes(fileHashes, scopeDigest) {
  if (!Array.isArray(fileHashes) || fileHashes.length === 0) {
    return { valid: false, reason: 'fileHashes is empty or not an array' }
  }
  for (var i = 0; i < fileHashes.length; i++) {
    var fh = fileHashes[i]
    if (!fh || typeof fh !== 'object') {
      return { valid: false, reason: 'fileHashes[' + i + '] is not an object' }
    }
    if (typeof fh.path !== 'string' || !fh.path) {
      return { valid: false, reason: 'fileHashes[' + i + '].path missing' }
    }
    if (typeof fh.contentSha256 !== 'string' || !HEX64.test(fh.contentSha256)) {
      return { valid: false, reason: 'fileHashes[' + i + '].contentSha256 is not 64-lowercase-hex' }
    }
  }
  if (typeof scopeDigest !== 'string' || !HEX64.test(scopeDigest)) {
    return { valid: false, reason: 'scopeDigest is not 64-lowercase-hex' }
  }
  return { valid: true }
}

// deriveFeatureFolder: deterministic folder derivation from file hashes + scopeDigest.
// No agent calls, no LLM. Returns { area, primarySlug, scopeId16, featureId, planDir, anchorPath }.
// PURE.
function deriveFeatureFolder(arg) {
  var fileHashes = arg && arg.fileHashes
  var scopeDigest = arg && arg.scopeDigest
  var entryPoints = (arg && arg.entryPoints) || []
  var entrySet = new Set(entryPoints.map(normalizeToPosix))
  // Normalize all paths to POSIX for deterministic sorting.
  var allPaths = (fileHashes || []).map(function (fh) {
    return normalizeToPosix(fh.path)
  })
  // Exclude entry points from anchor candidates; fallback to full set if all are entries.
  var candidates = allPaths.filter(function (p) { return !entrySet.has(p) })
  if (!candidates.length) candidates = allPaths.slice()
  candidates.sort()
  var anchorPath = candidates[0] || ''
  var segments = anchorPath.split('/').filter(Boolean)
  var area = segments.length >= 2 ? segments[0] + '/' + segments[1] : 'uncategorized'
  var basename = segments.length > 0 ? segments[segments.length - 1] : 'feature'
  var primarySlug = categorizeSlug(basename)
  var scopeId16 = String(scopeDigest || '').slice(0, 16)
  var featureId = primarySlug + '-' + scopeId16
  var planDir = 'docs/extract/' + area + '/' + featureId + '/'
  return { area: area, primarySlug: primarySlug, scopeId16: scopeId16, featureId: featureId, planDir: planDir, anchorPath: anchorPath }
}

// hashSources: agent-mediated SHA-256 computation. The engine NEVER computes SHA-256.
// The agent reads each file, computes per-file contentSha256 using Node's crypto,
// then frames sorted [path, hash] pairs as JSON and SHA-256s that to produce scopeDigest.
async function hashSources(arg) {
  var files = arg && arg.files
  var result = arg && arg.result
  if (!files || !files.length) return null
  var fileList = files.map(normalizeToPosix).join('\n')
  return safeAgent(
    'You are a hash-sources agent. For each file path listed below, READ the file content and\n' +
    'compute its SHA-256 hash using Node.js crypto (available to you via shell or scripts).\n' +
    'Then compute a combined scopeDigest:\n' +
    '1. Sort all (path, contentSha256) pairs by path ascending (lexicographic).\n' +
    '2. Frame as a JSON array of [path, contentSha256] pairs: e.g. [["src/a.ts","abc..."],["src/b.ts","def..."]]\n' +
    '3. Compute SHA-256 of JSON.stringify(that array) — this is scopeDigest.\n\n' +
    'All hashes must be 64 lowercase hex characters. Return the per-file hashes and scopeDigest.\n\n' +
    'Files to hash:\n' + fileList + '\n\n' +
    'Do NOT modify any files. Do NOT commit.',
    { label: 'hash-sources', phase: 'Hash Sources', schema: HASH_SOURCES_VERDICT, model: gm('todo') },
    result
  )
}

// resolveScopePreflight: resolve the extraction scope WITHOUT writing any files.
// Wraps the code-explorer agent call — captures the verdict in-memory for the
// pending checkpoint. Returns { pendingId, task, verdict, state:'PENDING', createdAt }
// or null if scope resolution fails. WRITES NOTHING TO DISK.
async function resolveScopePreflight(arg) {
  var task = arg && arg.task
  var result = arg && arg.result
  var timestamp = arg && arg.timestamp
  var pendingId = generatePendingId(task, timestamp)
  var verdict = await flexibleAgent(
    'You are the code-explorer agent. Resolve the extraction input below into a CONCRETE code scope.\n' +
    'DO NOT WRITE ANY FILES — just resolve the scope and return the verdict fields.\n' +
    'Use Serena tools (activate the project, list_dir, find_symbol, find_referencing_symbols,\n' +
    'search_for_pattern) to locate the code — do NOT guess paths.\n\n' +
    'IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT available.\n' +
    'Record anything needing user judgment in the ambiguities array instead of asking.\n\n' +
    'Extraction input:\n' + (task || '') + '\n\n' +
    'Return in the verdict:\n' +
    '- files: every concrete file path in scope (resolved, existing files only)\n' +
    '- entryPoints: observable entry points into this code (routes, commands, handlers, exports)\n' +
    '- symbols: the key classes/functions anchoring the scope\n' +
    '- confidence: high|medium|low\n' +
    '- wide: true ONLY if the scope spans multiple coherent subsystems\n' +
    '- suggestedSlices: when wide, candidate subsystem slices\n' +
    '- ambiguities: unclear boundaries or intent questions (recorded, not blocking)\n' +
    '- scopePath: set to "pending" (the manifest is written later after confirmation)\n' +
    '- summary: one-line scope summary\n\n' +
    'Do NOT modify any code. Do NOT commit. Do NOT write any files.',
    { label: 'code-explorer(scope-preflight)', phase: 'Pending Confirm', schema: SCOPE_VERDICT, model: gm('scopeResolver') },
    result
  )
  if (!verdict || !verdict.files || !verdict.files.length) return null

  // Phase 13: hash sources + validate + derive deterministic folder.
  // The engine NEVER computes SHA-256 — hashSources delegates to an agent.
  var hashResult = await hashSources({ files: verdict.files, result: result })
  if (!hashResult || !hashResult.files || !hashResult.scopeDigest) {
    // Blocked: can't hash — return null so the caller writes a blocked handoff.
    return null
  }
  var validation = validateHashes(hashResult.files, hashResult.scopeDigest)
  if (!validation.valid) {
    // Fail-closed: return a blocked preflight with the hash error reason.
    return {
      pendingId: pendingId,
      task: String(task || ''),
      verdict: verdict,
      state: 'PENDING',
      createdAt: String(timestamp || ''),
      hashError: validation.reason,
    }
  }
  // Derive the deterministic folder from validated hashes.
  var entryPoints = (verdict.entryPoints || []).map(normalizeToPosix)
  var folder = deriveFeatureFolder({
    fileHashes: hashResult.files,
    scopeDigest: hashResult.scopeDigest,
    entryPoints: entryPoints,
  })
  return {
    pendingId: pendingId,
    task: String(task || ''),
    verdict: verdict,
    state: 'PENDING',
    createdAt: String(timestamp || ''),
    fileHashes: hashResult.files,
    scopeDigest: hashResult.scopeDigest,
    featureId: folder.featureId,
    derivedPlanDir: folder.planDir,
    area: folder.area,
    scopeId16: folder.scopeId16,
    primarySlug: folder.primarySlug,
    anchorPath: folder.anchorPath,
  }
}

// writePendingRecord: persist the pending record JSON to <pendingDir><pendingId>.json
// via a file-writer agent (temp-then-rename pattern).
async function writePendingRecord(pendingDir, record, result) {
  var filePath = pendingDir + record.pendingId + '.json'
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + filePath + ' using a\n' +
    'temp-then-rename pattern (write to a .tmp file first, then rename to the target).\n' +
    'Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + filePath + '.\n\nJSON:\n' + JSON.stringify(record, null, 2),
    { label: 'file-writer(pending-record)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// readPendingRecord: read + parse a pending record via a file-reader agent.
// Returns the record object or null if the file does not exist.
async function readPendingRecord(pendingDir, pendingId, result) {
  var filePath = pendingDir + pendingId + '.json'
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + filePath + ' and return its full JSON content parsed\n' +
    'as an object in the "record" field. If the file does not exist, return record=null.',
    { label: 'file-reader(pending-record)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: PENDING_READ_RESULT, model: gm('todo') },
    result
  )
  return loaded
}

// appendLocatorEntry: append a permanent locator entry to the locator JSON file.
// Reads the existing array (or starts fresh), appends, writes atomically.
async function appendLocatorEntry(locatorPath, entry, result) {
  var existing = await safeAgent(
    'You are a file-reader agent. Read ' + locatorPath + ' and return its JSON content as an\n' +
    'array in the "entries" field. If the file does not exist, return entries=[].',
    { label: 'file-reader(locator)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: LOCATOR_READ_RESULT, model: gm('todo') },
    result
  )
  var entries = (existing && Array.isArray(existing.entries)) ? existing.entries : []
  entries.push(entry)
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON array to ' + locatorPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + locatorPath + '.\n\nJSON:\n' + JSON.stringify(entries, null, 2),
    { label: 'file-writer(locator)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// resolveLocator: look up a pendingId in the locator file via a file-reader agent.
// Returns { featureId, planDir, promotedAt } or null.
async function resolveLocator(locatorPath, pendingId, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + locatorPath + ' and return its JSON content as an\n' +
    'array in the "entries" field. If the file does not exist, return entries=[].',
    { label: 'file-reader(locator-lookup)', phase: 'Pending Confirm', agentType: nsAgent('file-writer'), schema: LOCATOR_READ_RESULT, model: gm('todo') },
    result
  )
  var entries = (loaded && Array.isArray(loaded.entries)) ? loaded.entries : []
  return resolveLocatorEntry(entries, pendingId)
}

// writeScopeManifestFromVerdict: serialize a scope verdict to scope-manifest.md
// and write via a file-writer agent (temp-then-rename).
async function writeScopeManifestFromVerdict(scopeManifestPath, verdict, result) {
  var files = (verdict && verdict.files) || []
  var entryPoints = (verdict && verdict.entryPoints) || []
  var symbols = (verdict && verdict.symbols) || []
  var confidence = (verdict && verdict.confidence) || 'unspecified'
  var ambiguities = (verdict && verdict.ambiguities) || []
  var summary = (verdict && verdict.summary) || ''
  var lines = ['# Scope Manifest', '', '**Confidence:** ' + confidence, '', '## Files in scope']
  for (var i = 0; i < files.length; i++) lines.push('- ' + files[i])
  if (entryPoints.length) { lines.push('', '## Entry points'); for (var j = 0; j < entryPoints.length; j++) lines.push('- ' + entryPoints[j]) }
  if (symbols.length) { lines.push('', '## Key symbols'); for (var k = 0; k < symbols.length; k++) lines.push('- ' + symbols[k]) }
  if (summary) lines.push('', '## Summary', '', summary)
  if (ambiguities.length) { lines.push('', '## Ambiguities'); for (var m = 0; m < ambiguities.length; m++) lines.push('- ' + ambiguities[m]) }
  var md = lines.join('\n') + '\n'
  return safeAgent(
    'You are a file-writer agent. Write the following markdown to ' + scopeManifestPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + scopeManifestPath + '.\n\nContent:\n' + md,
    { label: 'file-writer(scope-manifest)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
}

// writeIdentityStub: write the D0 .identity.json placeholder. Ownership digest
// is null — Phase 13 fills it in with the real deterministic hash.
async function writeIdentity(arg) {
  var identityPath = arg.identityPath
  var featureId = arg.featureId
  var planDir = arg.planDir
  var scopeDigest = arg.scopeDigest
  var area = arg.area
  var scopeId16 = arg.scopeId16
  var createdAt = String(arg.createdAt || '')
  var result = arg.result
  var identity = {
    featureId: featureId,
    planDir: planDir,
    ownershipScopeDigest: scopeDigest,
    area: area,
    scopeId16: scopeId16,
    createdAt: createdAt,
  }
  return safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + identityPath + ' using\n' +
    'temp-then-rename. Create the directory if it does not exist.\n\n' +
    'Return ok=true and path=' + identityPath + '.\n\nJSON:\n' + JSON.stringify(identity, null, 2),
    { label: 'file-writer(identity)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
}

// promotePendingRecord: atomically promote a PENDING record to PROMOTED.
// NEW-feature branch: create folder + scope-manifest.md + .identity.json stub,
//   then root-last pipeline-state.json via flushPipelineState.
// EXISTING-feature branch: update scope-manifest.md only (do NOT overwrite identity).
// Both branches: update pending record state + append permanent locator entry.
async function promotePendingRecord(arg) {
  var pendingDir = arg && arg.pendingDir
  var record = arg && arg.record
  var planDir = arg && arg.planDir
  var result = arg && arg.result
  var config = arg && arg.config
  var timestamp = arg && arg.timestamp
  var identityFields = arg && arg.identityFields
  var identityPath = planDir + '.identity.json'
  var scopeManifestPath = planDir + 'scope-manifest.md'

  // Check if pipeline-state.json already exists at planDir (EXISTING vs NEW).
  var existingCheck = await safeAgent(
    'You are a file-reader agent. Check if ' + planDir + 'pipeline-state.json exists.\n' +
    'Return exists=true and sizeBytes if it exists; exists=false if not.',
    { label: 'file-reader(promotion-check)', phase: 'Promote', agentType: nsAgent('file-writer'), schema: ARTIFACT_CHECK, model: gm('todo') },
    result
  )
  var isExisting = existingCheck && existingCheck.exists === true

  if (!isExisting) {
    // NEW feature — create scope-manifest.md + .identity.json (root-last: state after)
    await writeScopeManifestFromVerdict(scopeManifestPath, record.verdict, result)
    // Write real identity with the actual ownershipScopeDigest (not null stub).
    await writeIdentity({
      identityPath: identityPath,
      featureId: (identityFields && identityFields.featureId) || (planDir.split('/').filter(Boolean).pop() || planDir),
      planDir: planDir,
      scopeDigest: (identityFields && identityFields.scopeDigest) || '',
      area: (identityFields && identityFields.area) || 'uncategorized',
      scopeId16: (identityFields && identityFields.scopeId16) || '',
      createdAt: String(timestamp || ''),
      result: result,
    })
    // Root-last: pipeline-state.json only after identity + manifest exist
    await flushPipelineState(planDir, result, config)
  } else {
    // EXISTING feature — revision, NOT a new identity.
    // Do NOT create folder, do NOT overwrite .identity.json.
    // Update scope-manifest.md with the new scope verdict.
    await writeScopeManifestFromVerdict(scopeManifestPath, record.verdict, result)
    // pipeline-state.json already exists — preserved; updated later by the extract flow
  }

  // Update pending record to PROMOTED (durable — survives crash on replay)
  var promotedRecord = Object.assign({}, record, {
    state: 'PROMOTED',
    promotedAt: String(timestamp || ''),
    planDir: planDir,
  })
  await writePendingRecord(pendingDir, promotedRecord, result)

  // Append permanent compact locator entry (retained indefinitely)
  await appendLocatorEntry(PENDING_LOCATOR_PATH, {
    pendingId: record.pendingId,
    featureId: (identityFields && identityFields.featureId) || (planDir.split('/').filter(Boolean).pop() || planDir),
    planDir: planDir,
    promotedAt: String(timestamp || ''),
  }, result)

  if (result && Array.isArray(result.logLines)) {
    result.logLines.push('Promote: ' + record.pendingId + ' → ' + planDir + ' (' + (isExisting ? 'EXISTING' : 'NEW') + ')')
  }
  return { promoted: true, record: promotedRecord, isNew: !isExisting }
}

// ---- Feature-identity registry (Phase 14 / D1.2-D1.4) -----------------------

// Registry path — the single JSON index of all extracted features.
const REGISTRY_PATH = 'docs/extract/.registry.json'

// File-reader result schemas for registry + sidecar reads (local — not exported).
var REGISTRY_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['registry'],
  properties: {
    registry: { type: ['object', 'null'], description: 'Parsed registry object, or null if the file does not exist or is corrupt' },
  },
}

var IDENTITY_READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['identity'],
  properties: {
    identity: { type: ['object', 'null'], description: 'Parsed identity record, or null if the file does not exist' },
  },
}

var PIPELINE_STATE_FOR_RECOVERY = {
  type: 'object',
  additionalProperties: false,
  required: ['state'],
  properties: {
    state: { type: ['object', 'null'], description: 'Parsed pipeline-state.json, or null if missing' },
  },
}

// findFeature: rename-resilient feature lookup. PURE — no agent calls, no I/O.
// Determines whether a current scope reuses an existing feature folder, creates a
// new one, or is ambiguous/blocked. A file matches by path OR contentSha256
// (survives full rename). Strong = anchor match OR majority of min(counts).
function findFeature(arg) {
  var currentFiles = (arg && arg.currentFiles) || []
  var currentAnchor = (arg && arg.currentAnchor) || ''
  var registryFeatures = (arg && arg.registryFeatures) || []

  // Empty input — nothing to match against.
  if (!currentFiles.length) {
    return { decision: 'blocked', reason: 'empty-current-files' }
  }

  // Build current path and hash lookup sets.
  var currentPathSet = new Set()
  var currentHashSet = new Set()
  for (var i = 0; i < currentFiles.length; i++) {
    var cf = currentFiles[i]
    if (cf && cf.path) currentPathSet.add(cf.path)
    if (cf && cf.contentSha256) currentHashSet.add(cf.contentSha256)
  }

  var strongCandidates = []
  var weakMatches = []

  for (var j = 0; j < registryFeatures.length; j++) {
    var feat = registryFeatures[j]
    if (!feat || !feat.files) continue

    var featPathSet = new Set()
    var featHashSet = new Set()
    for (var k = 0; k < feat.files.length; k++) {
      var ff = feat.files[k]
      if (ff && ff.path) featPathSet.add(ff.path)
      if (ff && ff.contentSha256) featHashSet.add(ff.contentSha256)
    }

    // Count current files matching by path OR hash (dedup: a file matching both counts once).
    var totalMatches = 0
    for (var m = 0; m < currentFiles.length; m++) {
      var cur = currentFiles[m]
      var matchByPath = cur && cur.path && featPathSet.has(cur.path)
      var matchByHash = cur && cur.contentSha256 && featHashSet.has(cur.contentSha256)
      if (matchByPath || matchByHash) totalMatches++
    }

    var anchorMatch = currentAnchor && feat.anchorPath && currentAnchor === feat.anchorPath
    var minCount = Math.min(currentFiles.length, feat.files.length)
    var majority = Math.floor(minCount / 2) + 1
    var isStrong = anchorMatch || totalMatches >= majority

    if (isStrong) {
      strongCandidates.push({
        featureId: feat.featureId,
        matchCount: totalMatches,
        anchorMatch: !!anchorMatch,
      })
    } else if (totalMatches > 0) {
      weakMatches.push({ featureId: feat.featureId, matchCount: totalMatches })
    }
  }

  // Decision logic:
  // Zero strong → new (if no weak) or blocked weak-only (if some overlap).
  // One strong → reuse (trivially strictly-highest).
  // Two+ strong → find strictly-highest; tie at top → blocked ambiguous.
  if (!strongCandidates.length) {
    if (weakMatches.length) {
      return { decision: 'blocked', reason: 'weak-only-match', weakMatches: weakMatches }
    }
    return { decision: 'new' }
  }

  if (strongCandidates.length === 1) {
    return {
      decision: 'reuse',
      featureId: strongCandidates[0].featureId,
      matchCount: strongCandidates[0].matchCount,
    }
  }

  // Two+ strong candidates — find the strictly-highest match count.
  strongCandidates.sort(function (a, b) { return b.matchCount - a.matchCount })
  var topCount = strongCandidates[0].matchCount
  var tied = strongCandidates.filter(function (c) { return c.matchCount === topCount })

  if (tied.length === 1) {
    return {
      decision: 'reuse',
      featureId: tied[0].featureId,
      matchCount: tied[0].matchCount,
    }
  }

  return {
    decision: 'blocked',
    reason: 'ambiguous-match',
    candidates: tied.map(function (c) { return { featureId: c.featureId, matchCount: c.matchCount } }),
  }
}

// upsertRegistryEntry: insert or replace a feature entry in the registry. PURE —
// does NOT mutate the input registry; returns a shallow copy with the entry set.
function upsertRegistryEntry(registry, entry) {
  var base = registry && registry.features ? registry : { features: {} }
  var updated = { features: Object.assign({}, base.features) }
  updated.features[entry.featureId] = entry
  return updated
}

// readRegistry: load the registry JSON via a file-reader agent.
// Returns { features: {} } if the file does not exist; null if corrupt JSON.
async function readRegistry(registryPath, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + registryPath + ' and return its full JSON content parsed\\n' +
    'as an object in the "registry" field. If the file does not exist, return registry=null.\\n' +
    'If the file exists but contains invalid JSON, return registry=null.',
    { label: 'file-reader(registry)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: REGISTRY_READ_RESULT, model: gm('todo') },
    result
  )
  if (!loaded || loaded.registry === null || loaded.registry === undefined) {
    // Distinguish "file not found" from "corrupt" — safeAgent returns the parsed
    // object. null registry means either not-found or corrupt; caller treats both
    // as "no valid registry" and falls through to empty or recovery.
    return null
  }
  return loaded.registry
}

// writeRegistry: atomically persist the registry JSON via temp-then-rename.
async function writeRegistry(registryPath, registry, result) {
  var json = JSON.stringify(registry, null, 2)
  var ack = await safeAgent(
    'You are a file-writer agent. Write the following JSON to ' + registryPath + ' using a\\n' +
    'temp-then-rename pattern (write to a .tmp file first, then rename to the target).\\n' +
    'Create the directory if it does not exist.\\n\\n' +
    'Return ok=true and path=' + registryPath + '.\\n\\nJSON:\\n' + json,
    { label: 'file-writer(registry)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
    result
  )
  return ack
}

// readIdentitySidecar: load <planDir>/.identity.json via a file-reader agent.
// Returns the identity object or null if the file does not exist.
async function readIdentitySidecar(identityPath, result) {
  var loaded = await safeAgent(
    'You are a file-reader agent. Read ' + identityPath + ' and return its full JSON content\\n' +
    'parsed as an object in the "identity" field. If the file does not exist, return identity=null.',
    { label: 'file-reader(identity-sidecar)', phase: 'Registry Lookup', agentType: nsAgent('file-writer'), schema: IDENTITY_READ_RESULT, model: gm('todo') },
    result
  )
  if (!loaded) return null
  return loaded.identity
}

// checkFolderCollision: guard against overwriting another feature's folder on
// NEW-feature creation. Compares the requester's full ownershipScopeDigest
// against the existing .identity.json at the target planDir.
async function checkFolderCollision(arg) {
  var planDir = arg && arg.planDir
  var requesterDigest = arg && arg.requesterDigest
  var result = arg && arg.result
  var identityPath = planDir + '.identity.json'

  var identity = await readIdentitySidecar(identityPath, result)
  if (!identity) {
    // No existing identity — safe to create.
    return { collision: false }
  }

  // Compare FULL 64-hex ownership digest (not truncated featureId).
  if (identity.ownershipScopeDigest === requesterDigest) {
    return { collision: false, idempotent: true }
  }

  return {
    collision: true,
    existingFeatureId: identity.featureId || '(unknown)',
  }
}

// recoverRegistry: startup recovery — reconcile 'extracting' entries from
// current pipeline-state + sidecars. Immutable ownership fields always come from
// .identity.json sidecars (never from the potentially-stale registry). Mutable
// fields (files, status) are rebuilt from current pipeline-state. Fail-closed
// if evidence is missing.
async function recoverRegistry(arg) {
  var registryPath = arg && arg.registryPath
  var result = arg && arg.result

  var registry = await readRegistry(registryPath, result)

  // Corrupt or missing registry — try to rebuild from sidecars.
  if (!registry) {
    // Scan for .identity.json sidecars under docs/extract/ to rebuild.
    var scanResult = await safeAgent(
      'You are a file-reader agent. Search for all .identity.json files under docs/extract/\\n' +
      '(excluding docs/extract/.pending/ and docs/extract/slices/). For each found, read and\\n' +
      'return its JSON content. Return an array of identity objects in the "identities" field.\\n' +
      'If none found, return identities=[].',
      { label: 'file-reader(registry-rebuild)', phase: 'Registry Recovery', agentType: nsAgent('file-writer'), schema: { type: 'object', additionalProperties: false, required: ['identities'], properties: { identities: { type: 'array', items: { type: 'object' } } } }, model: gm('todo') },
      result
    )
    var identities = (scanResult && scanResult.identities) || []
    if (!identities.length) {
      // No sidecars — nothing to rebuild; return empty registry.
      return { recovered: 0, failed: 0, registry: { features: {} }, failClosed: true }
    }
    // Rebuild registry from sidecar identities. Mutable fields are unknown
    // without pipeline-state — mark all as 'stale' (fail-closed).
    var rebuilt = { features: {} }
    for (var ri = 0; ri < identities.length; ri++) {
      var id = identities[ri]
      if (!id || !id.featureId) continue
      rebuilt.features[id.featureId] = {
        featureId: id.featureId,
        planDir: id.planDir,
        ownershipScopeDigest: id.ownershipScopeDigest,
        scopeId16: id.scopeId16 || '',
        files: [],
        anchorPath: '',
        status: 'stale',
        updatedAt: '',
        recoveryError: 'corrupt-registry-rebuild',
      }
    }
    await writeRegistry(registryPath, rebuilt, result)
    return { recovered: 0, failed: identities.length, registry: rebuilt }
  }

  // Registry exists — reconcile each 'extracting' entry.
  var features = (registry && registry.features) || {}
  var featureIds = Object.keys(features)
  if (!featureIds.length) {
    return { recovered: 0, failed: 0, registry: registry }
  }

  var recovered = 0
  var failed = 0
  var updatedRegistry = { features: Object.assign({}, features) }

  for (var fi = 0; fi < featureIds.length; fi++) {
    var fid = featureIds[fi]
    var entry = features[fid]
    if (!entry) continue

    // Verify .identity.json still exists (immutable ownership source).
    var identityPath = entry.planDir + '.identity.json'
    var identity = await readIdentitySidecar(identityPath, result)

    if (!identity) {
      // Missing identity — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'missing-identity',
      })
      failed++
      continue
    }

    // Always source immutable fields from the sidecar (not the stale registry).
    entry.featureId = identity.featureId
    entry.planDir = identity.planDir
    entry.ownershipScopeDigest = identity.ownershipScopeDigest
    entry.scopeId16 = identity.scopeId16 || entry.scopeId16

    if (entry.status !== 'extracting') {
      // Non-extracting entries keep their status; immutable fields refreshed.
      updatedRegistry.features[fid] = entry
      continue
    }

    // Extracting entry — rebuild mutable fields from current pipeline-state.
    var statePath = entry.planDir + 'pipeline-state.json'
    var stateResult = await safeAgent(
      'You are a file-reader agent. Read ' + statePath + ' and return its JSON content\\n' +
      'parsed as an object in the "state" field. If the file does not exist, return state=null.',
      { label: 'file-reader(recovery-state)', phase: 'Registry Recovery', agentType: nsAgent('file-writer'), schema: PIPELINE_STATE_FOR_RECOVERY, model: gm('todo') },
      result
    )
    var pipelineState = (stateResult && stateResult.state) || null

    if (!pipelineState) {
      // Missing pipeline-state — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'missing-pipeline-state',
      })
      failed++
      continue
    }

    // Check for durable extraction evidence (gate checkpoints or extractReady).
    var hasEvidence = (pipelineState.result && (
      (pipelineState.result._gateCheckpoints && Object.keys(pipelineState.result._gateCheckpoints).length > 0) ||
      pipelineState.result.extractReady === true
    ))

    if (!hasEvidence) {
      // Incomplete extraction — fail-closed: mark stale.
      updatedRegistry.features[fid] = Object.assign({}, entry, {
        status: 'stale',
        recoveryError: 'incomplete-pipeline-state',
      })
      failed++
      continue
    }

    // Rebuild mutable files from pipeline-state if available.
    var rebuiltFiles = []
    if (pipelineState.result && pipelineState.result._sourceDigest && pipelineState.result._sourceDigest.files) {
      rebuiltFiles = pipelineState.result._sourceDigest.files
    } else if (pipelineState.result && pipelineState.result.extractScope && pipelineState.result.extractScope.files) {
      // Fallback: derive file list from the scope verdict (paths only — no hashes).
      var scopeFiles = pipelineState.result.extractScope.files || []
      rebuiltFiles = scopeFiles.map(function (p) {
        return { path: normalizeToPosix(p), contentSha256: '' }
      })
    }

    updatedRegistry.features[fid] = Object.assign({}, entry, {
      files: rebuiltFiles,
      status: pipelineState.result.extractReady ? 'current' : 'stale',
      recoveryError: pipelineState.result.extractReady ? undefined : 'extraction-incomplete',
    })

    if (pipelineState.result.extractReady) {
      recovered++
    } else {
      failed++
    }
  }

  // Write recovered registry atomically.
  await writeRegistry(registryPath, updatedRegistry, result)
  return { recovered: recovered, failed: failed, registry: updatedRegistry }
}

// ---- Review mode (standalone design-docset audit) ---------------------------
// Review is the INSPECT flow: it reads an existing planDir docset (forward-designed,
// extracted, or tuned), fans out one reviewer per review dimension (lens), dedups the
// union (also against issues already recorded), adversarially verifies each merged
// finding, writes <planDir>/design-review.md, and appends the confirmed gate-mapped
// findings to issues-and-improvements.md — the same handoff /tune-feature consumes.
// It never mutates the docset: no artifact edits, no designReady/stage changes.

// The fixed review dimensions. Each lens is a SEPARATE reviewer agent so one concern
// cannot crowd out another in a single pass; the merge gate reconciles overlaps.
const REVIEW_LENSES = [
  {
    key: 'consistency',
    focus: 'Cross-artifact consistency: contradictions between requirements, architecture, detailed design, e2e use cases, plan, and stage files (names, interfaces, data shapes, behaviors, constraints that disagree across docs).',
  },
  {
    key: 'completeness',
    focus: 'Completeness: requirements or task-definition objectives with no architecture/design/plan coverage; unhandled error paths and edge cases; missing NFRs (performance, security, migration, rollback); undefined interfaces the plan depends on.',
  },
  {
    key: 'feasibility',
    focus: 'Feasibility against the codebase: design decisions that contradict the recorded codebase facts or the actual code (wrong assumptions about existing modules, APIs, data models, or constraints); integration seams the design ignores.',
  },
  {
    key: 'testability',
    focus: 'Testability: pass gates that are not objectively verifiable; e2e use cases that do not cover the plan\'s behavior changes; TDD gates with vague RED tests or missing GREEN exit criteria; designs with no observable seam to assert on.',
  },
  {
    key: 'scope',
    focus: 'Scope discipline: YAGNI violations (speculative abstractions, unused generality) and the inverse — under-specified areas where the plan hand-waves real complexity; stage splits whose size or dependencies look unexecutable.',
  },
]

// Severity ordering shared by the --min-severity filter. Higher = more severe.
const SEVERITY_RANK = { blocker: 3, high: 2, medium: 1, low: 0 }
function meetsMinSeverity(severity, min) {
  const s = SEVERITY_RANK[severity]
  const m = SEVERITY_RANK[min]
  return (s === undefined ? 0 : s) >= (m === undefined ? 0 : m)
}
// Normalize the --min-severity arg; unknown values fall back to 'low' (record everything).
function resolveMinSeverity(val) {
  return SEVERITY_RANK[val] !== undefined ? val : 'low'
}
// Normalize the --lenses arg to known lens keys; empty/invalid => all lenses.
function resolveReviewLenses(list) {
  const known = new Set(REVIEW_LENSES.map((l) => l.key))
  const picked = (Array.isArray(list) ? list : []).filter((k) => known.has(k))
  return picked.length ? REVIEW_LENSES.filter((l) => picked.includes(l.key)) : REVIEW_LENSES
}

// Inventory of reviewable artifacts from the hydrated result. Pure: paths only, existence
// is judged by the reviewers (a stale path is itself a finding). Stage files are included
// so reviewers see the executable split, not just the plan prose.
function collectReviewDocs(result, planPath) {
  const r = result || {}
  const docs = [
    { kind: 'task definition', path: r.definitionPath },
    { kind: 'requirements', path: r.requirementsPath },
    { kind: 'architecture', path: r.archPath },
    { kind: 'detailed design', path: r.designPath },
    { kind: 'e2e use cases', path: r.useCasePath },
    { kind: 'codebase facts', path: r.factsPath },
    // planPath is planDir math (set before plan.md exists), so only a written plan
    // counts — extract baselines have no plan and must not review a phantom one.
    { kind: 'plan', path: (r.planned || r.planAccepted) ? planPath : null },
  ].filter((d) => typeof d.path === 'string' && d.path)
  for (const stage of Array.isArray(r.stages) ? r.stages : []) {
    if (stage && typeof stage.file === 'string' && stage.file) docs.push({ kind: `stage ${stage.id || ''}`.trim(), path: stage.file })
  }
  return docs
}

// One issues-file section per finding — MUST stay byte-compatible with the format
// classifyAndRecordIssue and auditExtractedDesign write, because the tune planner
// parses these sections to derive its gate-revisit plan.
function reviewIssueSection(f) {
  return [
    `## Upstream issue — gate: ${f.gate}`,
    '',
    `**Severity:** ${f.severity || '(unspecified)'}`,
    `**Finding:** ${f.finding || '(unspecified)'}`,
    `**Suggested fix:** ${f.suggestedFix || '(none)'}`,
    '',
    '---',
    '',
  ].join('\n')
}

// Compose the design-review.md report body deterministically from the verified findings
// (no extra agent call, and the report can never disagree with what was recorded).
function buildReviewReport({ task, docs, lenses, findings, recordedCount, droppedDuplicates, refutedCount, minSeverity }) {
  const bySeverity = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++
  const lines = [
    '# Design Review',
    '',
    `**Task:** ${task}`,
    `**Lenses:** ${lenses.map((l) => l.key).join(', ')}`,
    `**Docs reviewed:** ${docs.length}`,
    docs.map((d) => `- ${d.kind}: ${d.path}`).join('\n'),
    '',
    `**Findings:** ${findings.length} confirmed (blocker=${bySeverity.blocker}, high=${bySeverity.high}, medium=${bySeverity.medium}, low=${bySeverity.low}); ${refutedCount} refuted by verification; ${droppedDuplicates} duplicate(s) merged.`,
    `**Recorded to issues-and-improvements.md:** ${recordedCount} (gate != none, severity >= ${minSeverity}).`,
    '',
  ]
  for (const f of findings) {
    lines.push(
      `## [${f.severity}] gate: ${f.gate}${f.lenses && f.lenses.length ? ` (lens: ${f.lenses.join(', ')})` : ''}`,
      '',
      `**Finding:** ${f.finding}`,
      `**Suggested fix:** ${f.suggestedFix || '(none)'}`,
      `**Evidence:** ${f.evidence || '(none)'}`,
      f.verification ? `**Verification:** ${f.verification}` : '',
      '',
    )
  }
  return lines.join('\n')
}

// Gate R1: one reviewer per lens over the whole docset. A barrier (parallel) is correct
// here — the merge gate needs EVERY lens's findings at once to dedup across them.
// Lens keys are attached in-code (not trusted from the agent) so merge attribution is exact.
async function runReviewLenses({ lenses, docs, task, planDir, result }) {
  const docList = docs.map((d) => `- ${d.kind}: ${d.path}`).join('\n')
  const noAsk = `IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT
available. Record open questions as findings instead of asking.`
  const runs = await parallel(lenses.map((lens) => () =>
    safeAgent(
      `You are the critical-reviewer agent performing a DESIGN-DOCSET REVIEW through ONE lens.
Read EVERY design artifact listed below (they live under ${planDir}) and report ONLY findings that
belong to your lens. Do NOT reject or rewrite the docs — you are collecting issues, not fixing them.

Your lens — ${lens.key}:
${lens.focus}

Design artifacts:
${docList}

Task context: ${task}

${noAsk}

For each finding set: severity (blocker|high|medium|low), gate = the design doc that would have to
change to fix it (requirements|architecture|design|plan|tests|none), the finding phrased for a
design-doc author, a concrete suggestedFix, and evidence (doc file:line or section). A missing or
unreadable artifact is itself a finding. Do NOT modify any file. Do NOT commit.`,
      { label: `design-review:${lens.key}`, phase: 'Design Review', schema: REVIEW_FINDINGS_VERDICT, model: gm('reviewLens') },
      result
    ).then((v) => (v ? { lens: lens.key, findings: Array.isArray(v.findings) ? v.findings : [] } : null))
  ))
  return (runs || []).filter(Boolean)
}

// Gate R2: dedup/merge the union of lens findings — against each other AND against the
// issues already in issues-and-improvements.md, so re-running /review-design is additive,
// never duplicating. Fail-open: a merge failure falls back to the raw union (over-report
// rather than silently drop, mirroring the issue-classifier's upstream bias).
async function mergeReviewFindings({ rawFindings, existingIssuesText, task, result }) {
  const merged = await safeAgent(
    `You are a review-findings merge agent. Below is the raw union of design-review findings from
several independent reviewers (each tagged with its lens), plus the issues ALREADY recorded in
issues-and-improvements.md. Merge duplicates: findings that describe the same underlying defect
(even in different words or from different lenses) become ONE finding keeping the clearest wording,
the highest severity, the most specific gate/evidence, and the union of lens tags. DROP findings
already covered by the previously recorded issues. Do NOT invent new findings and do NOT soften or
re-judge severities beyond picking the max among duplicates.

Raw findings:
${JSON.stringify(rawFindings, null, 2)}

Previously recorded issues (issues-and-improvements.md):
${existingIssuesText || '(none)'}

Task context: ${task}`,
    { label: 'design-review:merge', phase: 'Design Review', schema: REVIEW_MERGE_VERDICT, model: gm('reviewMerge') },
    result
  )
  if (!merged || !Array.isArray(merged.findings)) {
    plogFromResult(result, 'Design Review: merge unavailable — falling back to the raw findings union (may contain duplicates)')
    return { findings: rawFindings, droppedDuplicates: 0 }
  }
  return { findings: merged.findings, droppedDuplicates: merged.droppedDuplicates || 0 }
}

// Gate R3: adversarial verification — an independent reviewer tries to REFUTE each merged
// finding against the actual docs. Refuted findings are dropped (a false positive here
// sends /tune-feature revising healthy docs); an unavailable verdict KEEPS the finding
// (over-report bias) marked unverified. Verifications run concurrently per finding.
async function verifyReviewFindings({ findings, docs, task, result }) {
  const docList = docs.map((d) => `- ${d.kind}: ${d.path}`).join('\n')
  const verdicts = await parallel(findings.map((f, i) => () =>
    safeAgent(
      `You are the critical-reviewer agent acting as an ADVERSARIAL VERIFIER. Another reviewer
claims the design docset below has this defect. Actively try to REFUTE the claim by reading the
docs: is the "defect" actually addressed somewhere, based on a misreading, out of scope for these
docs, or too vague to act on? Confirm it ONLY if it survives your refutation attempt. If it is real
but mis-rated, return adjustedSeverity.

Claimed finding:
${JSON.stringify(f, null, 2)}

Design artifacts:
${docList}

Task context: ${task}

Do NOT modify any file. Do NOT commit.`,
      { label: `design-review:verify#${i + 1}`, phase: 'Design Review', schema: REVIEW_VERIFY_VERDICT, model: gm('reviewVerify') },
      result
    )
  ))
  const confirmed = []
  let refuted = 0
  findings.forEach((f, i) => {
    const v = verdicts[i]
    if (v && v.confirmed === false) {
      refuted++
      plogFromResult(result, `Design Review: finding refuted by verifier — ${String(f.finding || '').slice(0, 120)}`)
      return
    }
    const out = { ...f }
    if (v && v.adjustedSeverity && SEVERITY_RANK[v.adjustedSeverity] !== undefined) out.severity = v.adjustedSeverity
    out.verification = v ? (v.reasoning || 'confirmed') : 'unverified (verifier unavailable — kept, over-report bias)'
    confirmed.push(out)
  })
  return { confirmed, refuted }
}

// Append the recordable findings to issues-and-improvements.md in the tune-consumable
// section format (same append-only + growth-verified discipline as the audit/classifier).
// Returns the count actually persisted (0 on a failed/absent ack) and sets
// result.issuesPath ONLY on success — the review handoff routes to /tune-feature based on
// this return value, so a failed append must not claim findings were recorded (tune would
// dead-end at tune-no-issues).
async function recordReviewIssues({ findings, planDir, result }) {
  if (!findings.length) return 0
  const issuesPath = planDir.replace(/\/$/, '') + '/issues-and-improvements.md'
  const sections = findings.map(reviewIssueSection).join('\n')
  try {
    const ack = await safeAgent(
      `You are a file-writer agent. APPEND the markdown sections below to ${issuesPath}.
If the file does not exist, create it with a "# Issues & Improvements" header first, then the sections.
Do NOT overwrite existing content — append only. Return ok=true and totalBytes = the file's total
size in bytes AFTER appending.

${sections}`,
      { label: 'file-writer(review-issues)', phase: 'Design Review', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
    )
    if (!ack || ack.ok === false) {
      plogFromResult(result, `Design Review: issues append FAILED (file-writer returned ${ack ? 'ok=false' : 'null'}) — findings NOT recorded`)
      return 0
    }
    result.issuesPath = issuesPath
    const growth = verifyAppendGrowth(result, issuesPath, ack)
    if (growth && growth.ok === false) plogFromResult(result, `Design Review: issues-and-improvements.md DID NOT grow (possible overwrite): ${issuesPath} ${growth.prev}->${growth.now}`)
    plogFromResult(result, `Design Review: ${findings.length} finding(s) recorded to ${issuesPath} (tune-consumable)`)
    return findings.length
  } catch (e) {
    plogFromResult(result, `Design Review: issues append failed: ${String(e)} — findings NOT recorded`)
    return 0
  }
}

// Per-gate durable checkpoint: persist slice state after each material gate so an
// interrupted leaf resumes at the first incomplete gate without repeating verified
// work. Uses the same flushPipelineState pattern as the top-level, writing to the
// slice's own planDir. Agent-mediated I/O — no direct filesystem access.
let _checkpointSeq = 0
async function checkpointSlice(slice, sliceState, gateName, result) {
  if (!sliceState._gateCheckpoints) sliceState._gateCheckpoints = {}
  _checkpointSeq++
  const artifactKey = {
    'extract-facts': 'factsPath',
    'extract-e2e': 'useCasePath',
    'extract-design': 'designPath',
    'extract-arch': 'archPath',
    'extract-requirements': 'requirementsPath',
    'extract-audit': 'auditPath',
  }[gateName]
  sliceState._gateCheckpoints[gateName] = {
    seq: _checkpointSeq,
    acknowledged: true,
    artifactPath: artifactKey ? (sliceState[artifactKey] || null) : null,
  }
  plogFromResult(result, `Extract [${slice.id}]: checkpoint acknowledged at gate '${gateName}'`)
  try {
    await flushPipelineState(slice.planDir, sliceState, {
      mode: 'extract-slice',
      profile: 'checkpoint',
      useChunker: false,
    })
  } catch (e) {
    plogFromResult(result, `Extract [${slice.id}]: checkpoint flush failed at '${gateName}' (non-blocking) — ${String(e)}`)
  }
}


// extractSlice: run the per-slice extraction cycle (facts -> e2e use cases -> detailed
// design -> architecture [-> fidelity reviews] [-> requirements] [-> audit]) writing all
// artifacts under slice.planDir. `sliceState` receives the artifact paths — it is the main
// `result` for a single-slice run, or a synthesized design-shaped result (flushed to a
// slice-local pipeline-state.json by the caller) for a multi-slice run. Sub-gates skip when
// their artifact path is already set, so an interrupted slice resumes mid-cycle. Returns
// {status: 'done'|'blocked', gate?} — a blocked slice never kills the whole queue.
async function extractSlice({ slice, task, result, sliceState, config, retryBudget, refineSubcap, decisionCap }) {
  const dir = slice.planDir
  const scopeHint = [
    slice.files && slice.files.length ? `Files in scope:\n${slice.files.join('\n')}` : '',
    slice.entryPoints && slice.entryPoints.length ? `Entry points:\n${slice.entryPoints.join('\n')}` : '',
  ].filter(Boolean).join('\n')
  const noAsk = `IMPORTANT: You are running inside an automated workflow pipeline. AskUserQuestion is NOT
available. Record anything needing user judgment in the openQuestions/ambiguities field instead.`

  // X2: code facts (deep, scoped). The extraction foundation — blocking for this slice.
  if (!sliceState.factsPath) {
    phase('Extract Slice')
    plogFromResult(result, `Extract [${slice.id}]: gathering deep code facts`)
    const facts = await safeAgent(
      `You are the code-explorer agent. Explore ONLY the code scope below and write exhaustive
STRUCTURE FACTS to ${dir}codebase-facts.md. Use Serena tools (activate the project, read_file,
get_symbols_overview, find_referencing_symbols, search_for_pattern). This is a REVERSE-ENGINEERING
pass: capture EVERY public interface, data carrier, integration point, and invariant in scope —
deeper than a task-scoped exploration.

${noAsk}

Slice: ${slice.name}
${scopeHint}
Task context: ${task}

Capture with file:line evidence: relevantFiles, patterns (conventions/invariants the code follows),
callSites (how this code is wired into the rest of the system). Do NOT propose changes or commit.
Return factsPath set to ${dir}codebase-facts.md.`,
      { label: `code-explorer(extract:${slice.id})`, phase: 'Extract Slice', schema: CODEBASE_FACTS_VERDICT, model: gm('explorer') },
      result
    )
    if (!facts || !facts.factsPath) return { status: 'blocked', gate: 'extract-facts' }
    sliceState.factsPath = facts.factsPath
    sliceState._facts = facts
    await checkpointSlice(slice, sliceState, 'extract-facts', result)
  }

  // X3: behavioral e2e use cases (early — they anchor intent for the design extraction).
  if (config.useE2eUsecase && !sliceState.useCasePath) {
    phase('Extract Slice')
    plogFromResult(result, `Extract [${slice.id}]: extracting observable e2e use cases`)
    const useCases = await flexibleAgent(
      `You are the e2e-usecase-extractor agent. Extract the end-to-end use cases this code OBSERVABLY
implements TODAY — from its entry points, tests, and CLI/API surfaces — and write them to
${dir}e2e-use-cases.md. Document AS-IS behavior, not aspirations: happy paths, alternative flows,
edge cases, and error behaviors the code actually handles. Consume the code facts at
${sliceState.factsPath}.

${noAsk}

Slice: ${slice.name}
${scopeHint}
Task context: ${task}

Do NOT commit. Return useCasePath set to ${dir}e2e-use-cases.md.`,
      { label: `e2e-usecase-extractor(extract:${slice.id})`, phase: 'Extract Slice', schema: E2E_USECASE_VERDICT, model: gm('e2eUsecase') },
      result
    )
    // Same alternative-envelope normalization as the forward e2e gate.
    if (useCases && !useCases.useCasePath) {
      const candidate = useCases.file || useCases.path
      if (candidate) {
        useCases.useCasePath = candidate
        useCases.summary = useCases.summary || '(e2e use cases written)'
      }
    }
    if (!useCases || !useCases.useCasePath) return { status: 'blocked', gate: 'extract-e2e' }
    sliceState.useCasePath = useCases.useCasePath
    sliceState._e2e = useCases
    if ((useCases.openQuestions || []).length) {
      await writeOpenQuestions(dir, useCases.openQuestions.map((q) => ({ gate: 'Extract E2E', text: q, severity: 'unspecified' })), result)
    }
    await checkpointSlice(slice, sliceState, 'extract-e2e', result)
  }

  // X4: detailed design reverse-engineered from the code.
  if (config.useDetailedDesign && !sliceState.designPath) {
    phase('Extract Slice')
    plogFromResult(result, `Extract [${slice.id}]: reverse-engineering the detailed design`)
    const design = await flexibleAgent(
      `You are the detailed-design-architect agent. REVERSE-ENGINEER the implementation-level design
AS IT EXISTS from the code in scope, and write it to ${dir}detailed-design.md. This is extraction,
not design: describe what IS, citing file:line evidence throughout. Consume the code facts at
${sliceState.factsPath}${sliceState.useCasePath ? ` and the observed use cases at ${sliceState.useCasePath}` : ''}.

${noAsk}

Slice: ${slice.name}
${scopeHint}
Task context: ${task}

Cover: component breakdown, interfaces, data models, control flow, error handling, edge cases the
code handles, and configuration — as implemented. Do NOT propose changes; record improvement
candidates as neutral notes (a separate audit gate evaluates them). Do NOT commit.
Return designPath set to ${dir}detailed-design.md.`,
      { label: `detailed-design-architect(extract:${slice.id})`, phase: 'Extract Slice', schema: DETAILED_DESIGN_VERDICT, model: gm('detailedDesign') },
      result
    )
    if (!design || !design.designPath) return { status: 'blocked', gate: 'extract-design' }
    sliceState.designPath = design.designPath
    sliceState._design = design
    await checkpointSlice(slice, sliceState, 'extract-design', result)
  }

  // X5: high-level architecture abstracted from the detailed design + facts.
  if (config.useArchDesign && !sliceState.archPath) {
    phase('Extract Slice')
    plogFromResult(result, `Extract [${slice.id}]: abstracting the high-level architecture`)
    const arch = await flexibleAgent(
      `You are the arch-design-orchestrator agent. ABSTRACT the high-level architecture of this
existing code and write it to ${dir}architecture.md. This is extraction from a brownfield system:
describe the architecture AS BUILT — module boundaries, dependency directions, integration points,
and the NFR posture the code actually achieves (performance, reliability, security as implemented).
Consume the detailed design at ${sliceState.designPath || '(none)'} and the code facts at
${sliceState.factsPath}.

${noAsk}

Slice: ${slice.name}
Task context: ${task}

Do NOT redesign or propose changes. Do NOT commit. Return archPath set to ${dir}architecture.md.`,
      { label: `arch-design-orchestrator(extract:${slice.id})`, phase: 'Extract Slice', schema: ARCH_VERDICT, model: gm('archDesign') },
      result
    )
    if (!arch || !arch.archPath) return { status: 'blocked', gate: 'extract-arch' }
    sliceState.archPath = arch.archPath
    sliceState._arch = arch
    await checkpointSlice(slice, sliceState, 'extract-arch', result)
  }

  // X5.5: fidelity reviews (optional) — does each doc faithfully describe the code?
  if (config.useExtractReview && !sliceState._reviewedDesign) {
    for (const target of [
      { path: sliceState.designPath, name: 'detailed-design', label: 'Detailed Design Review' },
      { path: sliceState.archPath, name: 'architecture', label: 'Arch Review' },
    ]) {
      if (!target.path) continue
      const review = await reviewLoop({
        phaseLabel: target.label,
        artifactPath: target.path,
        artifactName: target.name,
        reviewerPrompt:
          `You are the critical-reviewer agent. This ${target.name} doc at ${target.path} was EXTRACTED from
existing code (facts: ${sliceState.factsPath}). Review it for FIDELITY ONLY: does it faithfully and
completely describe the code as it exists? Reject on: components/interfaces present in the code but
missing from the doc, described behavior contradicting the code, or missing file:line evidence.
Do NOT reject because the underlying design could be better — design debt belongs to the audit gate.
Task:\n${task}`,
        reviserPrompt: (rev) =>
          `You are the design-reviser agent. Address these fidelity findings on the extracted ${target.name}
at ${target.path}. Correct the doc to match the CODE (the code is the source of truth here). Write the
revised doc to ${target.path} (in place).
Findings:\n${JSON.stringify({ blockers: (rev && rev.blockers) || [], gaps: (rev && rev.gaps) || [], findings: (rev && rev.findings) || [] }, null, 2)}`,
        reviewerModel: gm('reviewDesign'),
        reviserModel: gm('revise'),
        result, retryBudget, refineSubcap, spendRetry, planDir: dir,
        useEnhancer: config.useEnhancer, useQuickDecider: config.useQuickDecider, decisionCap,
      })
      plogFromResult(result, `Extract [${slice.id}]: ${target.name} fidelity review ${review && review.accepted ? 'accepted' : 'fail-forward'} after ${review ? review.iterations : 0} iteration(s)`)
    }
    sliceState._reviewedDesign = true
    sliceState._reviewedArch = true
    await checkpointSlice(slice, sliceState, 'extract-review', result)
  }

  // X6: reverse-derived requirements (optional; highest abstraction, extracted last).
  if (config.useExtractRequirements && !sliceState.requirementsPath) {
    phase('Extract Slice')
    plogFromResult(result, `Extract [${slice.id}]: reverse-deriving requirements`)
    const requirements = await safeAgent(
      `You are the requirements-collector agent. REVERSE-DERIVE the functional and non-functional
requirements this code DEMONSTRABLY satisfies, from the observed use cases at
${sliceState.useCasePath || '(none)'} and the architecture at ${sliceState.archPath || '(none)'}.
Write them to ${dir}requirements.md. Mark every requirement with the [extracted] prefix so readers
know it was derived from code, not stakeholders.

${noAsk}

Slice: ${slice.name}
Task context: ${task}

Only include requirements with evidence in the code/docs — do not invent aspirational requirements.
Do NOT commit. Return requirementsPath set to ${dir}requirements.md.`,
      { label: `requirements-collector(extract:${slice.id})`, phase: 'Extract Slice', schema: REQUIREMENTS_VERDICT, model: gm('requirements') },
      result
    )
    if (requirements && requirements.requirementsPath) {
      sliceState.requirementsPath = requirements.requirementsPath
      sliceState._requirements = requirements
      if ((requirements.openQuestions || []).length) {
        await writeOpenQuestions(dir, requirements.openQuestions.map((q) => ({ gate: 'Extract Requirements', text: q, severity: 'unspecified' })), result)
      }
      await checkpointSlice(slice, sliceState, 'extract-requirements', result)
    } else {
      plogFromResult(result, `Extract [${slice.id}]: requirements extraction returned no path (non-blocking) — continuing`)
    }
  }

  // X7: as-is design audit (optional, non-blocking).
  if (config.useAudit && !sliceState.auditPath) {
    phase('Design Audit')
    await auditExtractedDesign({ slicePlanDir: dir, sliceState, task, result })
    await checkpointSlice(slice, sliceState, 'extract-audit', result)
  }

  return { status: 'done' }
}

// writeSystemOverview (extract Gate X8, multi-slice only): synthesize the per-slice
// architecture docs into <parentPlanDir>/system-overview.md with a slice index table.
// Non-blocking.
async function writeSystemOverview({ parentPlanDir, queue, task, result }) {
  const overviewPath = parentPlanDir + 'system-overview.md'
  const sliceLines = (queue || []).map((s) =>
    `- ${s.id} (${s.name}) — status: ${s.status}; planDir: ${s.planDir}; architecture: ${(s.artifacts && s.artifacts.archPath) || '(none)'}`
  ).join('\n')
  try {
    const verdict = await safeAgent(
      `You are the arch-design-orchestrator agent. Synthesize a SYSTEM OVERVIEW from the per-slice
architecture docs listed below and write it to ${overviewPath}. Cover: the system's module map
(one paragraph per slice), cross-slice dependencies and integration points, and shared conventions.
Include a slice index table (id, name, status, planDir) so readers can navigate to each slice's
full design docs.

Slices:
${sliceLines}

Task context: ${task}

Do NOT redesign anything — describe the system as extracted. Do NOT commit.
Return overviewPath set to ${overviewPath}.`,
      { label: 'arch-design-orchestrator(overview)', phase: 'System Overview', schema: OVERVIEW_VERDICT, model: gm('overview') },
      result
    )
    if (verdict && verdict.overviewPath) {
      result.overviewPath = verdict.overviewPath
      plogFromResult(result, `System Overview: written to ${verdict.overviewPath}`)
    } else {
      plogFromResult(result, 'System Overview: synthesizer returned no path (non-blocking)')
    }
  } catch (e) {
    plogFromResult(result, 'System Overview: failed (non-blocking) — ' + String(e))
  }
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
    const verdict = await safeAgent(
      `You are the knowledge-persist agent. Persist the findings from this feature-pipeline run into
CLAUDE.md and Serena memory as durable rules/gotchas. Only persist genuinely reusable knowledge
(non-obvious gotchas, recurring rules, edge cases) — do NOT persist one-off task detail.

Findings (JSON):
${JSON.stringify(findings, null, 2)}

Read CLAUDE.md first; append rules, do not duplicate existing ones. Do NOT commit.`,
      { label: 'knowledge-persist', phase: 'Persist', schema: PERSIST_VERDICT, model: gm('persist') },
      r
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
    const published = await safeAgent(
      `You are the docs-architecture-publisher agent. Publish/organize the plan and architecture
design for this task into the project documentation. Source artifacts: plan at ${planPath},
architecture at ${r.archPath || '(none)'}, detailed design at ${r.designPath || '(none)'}.
Update the relevant docs (e.g. an architecture index / docs tree) so the design is discoverable.
Read mem:core and mem:conventions first. Do NOT commit; just write the docs.

Task:
${task || r.task || '(none)'}`,
      { label: 'docs-architecture-publisher', phase: 'Publish', schema: PUBLISH_VERDICT, model: gm('publish') },
      r
    )
    r.published = published || { published: false, summary: 'publisher agent returned null' }
    plogFromResult(r, `Publish: published=${r.published.published}; paths=${(r.published.paths || []).length}`)
  } catch (e) {
    r.published = { published: false, summary: 'publish failed: ' + String(e) }
    plogFromResult(r, 'Publish: failed (non-blocking) — ' + String(e))
  }
}

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

// Bounded backoff retry for transient provider/network errors. A transient error
// (network timeout, 429, 503, connection reset) is inherently retryable — treating
// it as immediately fatal hard-blocks every blocking design gate on a single
// blip. These constants bound the retry loop so it cannot spin indefinitely.
const TRANSIENT_RETRY_MAX = 3
const TRANSIENT_BACKOFF_BASE_MS = 500

// Classify an agent error message as transient, schema, or fatal.
// Transient errors are retryable (network/provider). Schema errors use the
// existing plain-text JSON fallback path. Fatal errors are non-retryable.
// Pure: no side effects, deterministic for the same input.
function classifyAgentError(errorMsg) {
  const msg = String(errorMsg || '')
  if (/StructuredOutput|schema|valid output/i.test(msg)) return 'schema'
  if (/network|timeout|connection|ECONNRESET|ENOTFOUND|ETIMEDOUT|429|503|502|rate.?limit|overloaded|service.unavailable|temporarily/i.test(msg)) return 'transient'
  return 'fatal'
}

// Retry a failed agent call with bounded exponential backoff. Only called when
// classifyAgentError returns 'transient'. Returns the raw output from
// callAgentWithWatchdog on success, or null if all retries are exhausted.
// Each attempt is journaled via recordDegradationEvent for durable inspection.
async function retryTransientError(prompt, opts, result, originalError) {
  for (let attempt = 1; attempt <= TRANSIENT_RETRY_MAX; attempt++) {
    const delayMs = TRANSIENT_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} for "${opts && opts.label}" after ${delayMs}ms backoff`)
    }
    bumpGateTelemetry(result, opts, 'retry')
    recordDegradationEvent(result, 'retry', opts && opts.phase, opts && opts.label, `transient error retry ${attempt}/${TRANSIENT_RETRY_MAX}: ${originalError}`)
    try {
      const out = await callAgentWithWatchdog(prompt, opts, result)
      if (out) {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} succeeded for "${opts && opts.label}"`)
        }
        return out
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e)
      const errorClass = classifyAgentError(msg)
      if (errorClass !== 'transient') {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`Transient retry ${attempt}/${TRANSIENT_RETRY_MAX} stopped for "${opts && opts.label}": error reclassified as ${errorClass}`)
        }
        return null
      }
    }
  }
  return null
}


// agent() contract: returns null on user-skip or terminal API error. But a StructuredOutput
// retry-cap throw (TelemetrySafeError) escapes that contract and propagates uncaught — killing
// the workflow. safeAgent converts ANY throw into a null + log line so gate logic's existing
// null-handling (convergence gate, fail-forward) degrades gracefully instead of crashing.
// Use for the critical-path schema-gated calls whose throw would otherwise escape main().
async function safeAgent(prompt, opts, result) {
  return flexibleAgent(prompt, opts, result)
}

// Some non-standard providers fail to satisfy a forced-StructuredOutput schema with certain
// custom subagent types (e.g. task-definition-architect), even though the emitted JSON is
// syntactically valid. flexibleAgent tries the schema path first; on a schema-specific failure
// it falls back to a plain-text agent call with explicit JSON-only instructions and parses the
// response ourselves. This keeps the gate-enforcing pipeline intact on providers where forced
// tool-use is unreliable.
async function flexibleAgent(prompt, opts, result) {
  const callOpts = escalateAgentOpts(opts, result)
  if (agentCircuitOpen(callOpts, result)) {
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`WARNING: agent "${callOpts && callOpts.label}" skipped because circuit is open`)
    }
    return fallbackForAgent(callOpts)
  }
  bumpGateTelemetry(result, callOpts, 'call', callOpts && callOpts.model)
  if (callOpts && callOpts.escalatedFrom) bumpGateTelemetry(result, callOpts, 'escalation')
  const effectivePrompt = hardenForModel(prompt, callOpts && callOpts.schema, callOpts && callOpts.model)
  let out = null
  let schemaFailed = false
  let originalError = ''
  try {
    out = await callAgentWithWatchdog(effectivePrompt, callOpts, result)
  } catch (e) {
    originalError = String(e && e.message ? e.message : e)
    schemaFailed = /StructuredOutput|schema|valid output/i.test(originalError)
    if (!schemaFailed) {
      const errorClass = classifyAgentError(originalError)
      if (errorClass === 'transient') {
        const recovered = await retryTransientError(effectivePrompt, callOpts, result, originalError)
        if (recovered !== null) {
          out = recovered
        } else {
          if (result && Array.isArray(result.logLines)) {
            result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (transient retries exhausted): ${originalError}`)
          }
          log(`Agent "${opts && opts.label}" threw — transient retries exhausted, converting to null: ${originalError}`)
          return null
        }
      } else {
        if (result && Array.isArray(result.logLines)) {
          result.logLines.push(`WARNING: agent "${opts && opts.label}" threw (caught): ${originalError}`)
        }
        log(`Agent "${opts && opts.label}" threw — converting to null (graceful degradation): ${originalError}`)
        return null
      }
    } else {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
      }
      log(`Schema path failed for "${opts && opts.label}" (${originalError}); trying plain-text JSON fallback`)
    }
  }
  if (out) {
    if (typeof out === 'object') {
      const normalized = normalizeAgentOutput(callOpts, out, result)
      if (normalized) return normalized
    }
    const parsed = extractJson(out)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      }
      log(`Parsed JSON object from plain-text agent output for "${opts && opts.label}"`)
      const normalized = normalizeAgentOutput(callOpts, parsed, result)
      if (normalized) return normalized
    }
    // Not a valid object response — fall through to JSON-only retry.
  }

  const jsonPrompt = `${effectivePrompt}\n\nIMPORTANT: Return ONLY a single JSON object matching the expected structure. Do NOT include markdown fences, explanations, or prose. The JSON must be parseable by JSON.parse().`
  bumpGateTelemetry(result, callOpts, 'retry')
  try {
    // Strip the schema property entirely so the fallback call is treated as plain text.
    const { schema: _unused, ...plainOpts } = callOpts
    const raw = await callAgentWithWatchdog(jsonPrompt, plainOpts, result)
    const parsed = extractJson(raw)
    if (parsed && typeof parsed === 'object') {
      if (result && Array.isArray(result.logLines)) {
        result.logLines.push(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      }
      log(`Plain-text JSON fallback succeeded for "${opts && opts.label}"`)
      return normalizeAgentOutput(callOpts, parsed, result)
    }
  } catch (e2) {
    const msg2 = String(e2 && e2.message ? e2.message : e2)
    if (result && Array.isArray(result.logLines)) {
      result.logLines.push(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
    }
    log(`Plain-text JSON fallback also failed for "${opts && opts.label}": ${msg2}`)
  }
  recordAgentFailure(result, callOpts, 'unavailable verdict')
  return fallbackForAgent(callOpts)
}

function normalizeAgentOutput(opts, value, result) {
  const normalized = normalizeVerdict(opts && opts.schema, value)
  if (outputLanguageViolation(normalized)) {
    recordAgentFailure(result, opts, 'non-English verdict')
    return null
  }
  const contradiction = verdictContradiction(normalized)
  if (!contradiction) return normalized
  if (result && Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" returned contradictory verdict: ${contradiction}`)
  }
  log(`Agent "${opts && opts.label}" returned contradictory verdict — rejecting: ${contradiction}`)
  recordAgentFailure(result, opts, contradiction)
  return null
}

function fallbackForAgent(opts) {
  const label = String(opts && opts.label || '')
  const key = Object.keys(GATE_FALLBACKS).find((candidate) => label.includes(candidate))
  const fallback = key ? GATE_FALLBACKS[key] : null
  if (!fallback || typeof fallback !== 'object') return fallback
  return JSON.parse(JSON.stringify(fallback))
}

function escalateAgentOpts(opts, result) {
  if (!opts || !result || !result.agentFailures) return opts
  const key = agentFailureKey(opts)
  const failures = result.agentFailures[key]
  if (!failures || failures.count < 2) return opts
  const model = String(opts.model || '').toLowerCase()
  if (model === 'opus' || model.includes('claude-opus')) return opts
  return { ...opts, model: 'opus', escalatedFrom: opts.model || '(default)' }
}

function agentCircuitOpen(opts, result) {
  if (!opts || !result || !result.agentFailures) return false
  const failures = result.agentFailures[agentFailureKey(opts)]
  return !!(failures && failures.circuitOpen)
}

// Record a degradation event into the durable journal (DHIST-01).
// Types: 'fail-forward' | 'retry' | 'escalation' | 'fallback'.
// Each entry is sequentially numbered for inspection through handoff/status.
function recordDegradationEvent(result, type, gate, label, reason) {
  if (!result || typeof result !== 'object') return
  if (!result._degradationLog) result._degradationLog = []
  var seq = result._degradationLog.length + 1
  result._degradationLog.push({ seq: seq, type: type, gate: gate || 'unknown', label: label || 'agent', reason: reason || '' })
}

// Summarize the degradation log for handoff/status display. Pure helper.
function degradationLogSummary(log) {
  if (!log || !log.length) return ''
  var byType = {}
  for (var i = 0; i < log.length; i++) {
    var t = log[i].type
    byType[t] = (byType[t] || 0) + 1
  }
  return Object.keys(byType).map(function (t) { return t + '=' + byType[t] }).join(', ')
}

function recordAgentFailure(result, opts, reason) {
  if (!result) return 0
  const key = agentFailureKey(opts)
  if (!result.agentFailures) result.agentFailures = {}
  const current = result.agentFailures[key] || { count: 0, reason: '', circuitOpen: false }
  current.count += 1
  current.reason = reason
  current.circuitOpen = current.count >= IDENTICAL_FAILURE_LIMIT
  result.agentFailures[key] = current
  if (!result.degradationTelemetry) result.degradationTelemetry = { fallbacks: 0, escalations: 0, languageViolations: 0, circuitBreakers: 0 }
  result.degradationTelemetry.fallbacks += 1
  bumpGateTelemetry(result, opts, 'fallback')
  // Journal each degradation event for durable attempt-history inspection (DHIST-01)
  recordDegradationEvent(result, 'fallback', opts && opts.phase, opts && opts.label, reason)
  if (reason === 'non-English verdict') result.degradationTelemetry.languageViolations += 1
  if (current.count === 2) {
    result.degradationTelemetry.escalations += 1
    recordDegradationEvent(result, 'escalation', opts && opts.phase, opts && opts.label, 'model escalated after 2 failures')
  }
  if (current.circuitOpen) result.degradationTelemetry.circuitBreakers += 1
  if (Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" failure ${current.count}/${IDENTICAL_FAILURE_LIMIT}: ${reason}${current.circuitOpen ? ' (circuit open)' : ''}`)
  }
  return current.count
}

function agentFailureKey(opts) {
  return `${(opts && opts.phase) || 'unknown'}:${(opts && opts.label) || 'agent'}`
}

// Per-gate telemetry: counts agent calls, plain-JSON retries, model escalations, and
// fallback verdicts under the gate (opts.phase) that made the call, plus a per-model call
// histogram. Turns "the pipeline is slow/expensive" into per-gate data. Buckets are created
// lazily so results hydrated from older pipeline-state.json files (no gateTelemetry field)
// pick up counting mid-run without a migration.
function bumpGateTelemetry(result, opts, event, model) {
  if (!result) return
  if (!result.gateTelemetry || typeof result.gateTelemetry !== 'object') result.gateTelemetry = {}
  const gate = (opts && opts.phase) || 'unknown'
  const bucket = result.gateTelemetry[gate] || { calls: 0, retries: 0, escalations: 0, fallbacks: 0, models: {} }
  if (event === 'call') {
    bucket.calls += 1
    const modelName = String(model || '(default)')
    if (!bucket.models || typeof bucket.models !== 'object') bucket.models = {}
    bucket.models[modelName] = (bucket.models[modelName] || 0) + 1
  } else if (event === 'retry') {
    bucket.retries += 1
  } else if (event === 'escalation') {
    bucket.escalations += 1
  } else if (event === 'fallback') {
    bucket.fallbacks += 1
  }
  result.gateTelemetry[gate] = bucket
}

// Render per-gate telemetry as log lines plus a degradation trailer (degradationTelemetry
// counters were previously recorded but never surfaced). Returns [] when nothing was
// recorded so call sites can print unconditionally.
function renderTelemetrySummary(gateTelemetry, degradationTelemetry) {
  const lines = []
  const gates = Object.keys(gateTelemetry || {})
  if (gates.length) {
    lines.push('Telemetry (per gate):')
    for (const gate of gates) {
      const b = gateTelemetry[gate] || {}
      const models = Object.keys(b.models || {}).map((m) => `${m} x${b.models[m]}`).join(', ') || '(default)'
      lines.push(`  ${gate}: calls=${b.calls || 0} retries=${b.retries || 0} escalations=${b.escalations || 0} fallbacks=${b.fallbacks || 0} models=[${models}]`)
    }
  }
  const d = degradationTelemetry
  if (d && ((d.fallbacks || 0) + (d.escalations || 0) + (d.languageViolations || 0) + (d.circuitBreakers || 0) > 0)) {
    lines.push(`Degradations: fallbacks=${d.fallbacks || 0} escalations=${d.escalations || 0} languageViolations=${d.languageViolations || 0} circuitBreakers=${d.circuitBreakers || 0}`)
  }
  return lines
}

function outputLanguageViolation(value) {
  if (!value || typeof value !== 'object') return false
  const text = JSON.stringify(value)
  const lang = detectNonEnglish(text)
  return lang.ratio > 0.30
}

async function callAgentWithWatchdog(prompt, opts, result) {
  const timeoutMs = Number(opts && opts.timeoutMs) || AGENT_TIMEOUT_MS_DEFAULT
  const maxOutputChars = Number(opts && opts.maxOutputChars) || AGENT_MAX_OUTPUT_CHARS_DEFAULT
  const timeoutSentinel = { __agentTimeout: true }
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeoutSentinel), timeoutMs)
  })
  try {
    const out = await Promise.race([agent(prompt, opts), timeout])
    if (out === timeoutSentinel) {
      recordAgentWatchdog(result, 'timeouts', opts, `timed out after ${timeoutMs}ms`)
      return null
    }
    if (typeof out === 'string' && out.length > maxOutputChars) {
      recordAgentWatchdog(result, 'oversized', opts, `returned ${out.length} chars (limit ${maxOutputChars})`)
      return null
    }
    return out
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function recordAgentWatchdog(result, key, opts, detail) {
  if (!result) return
  if (!result.agentWatchdog) result.agentWatchdog = { timeouts: 0, oversized: 0 }
  result.agentWatchdog[key] = (result.agentWatchdog[key] || 0) + 1
  if (Array.isArray(result.logLines)) {
    result.logLines.push(`WARNING: agent "${opts && opts.label}" ${detail}`)
  }
}

function hardenForModel(prompt, schema, model) {
  if (!schema) return prompt
  const modelName = String(model || '').toLowerCase()
  const isStrong = modelName === 'opus' || modelName.includes('claude-opus')
  if (isStrong) return prompt
  if (String(prompt).includes('WEAK-MODEL OUTPUT CONTRACT')) return prompt
  return `${prompt}

WEAK-MODEL OUTPUT CONTRACT:
- Return English only.
- Return one JSON object only: no markdown fences, no prose, no comments.
- Use the exact field names and primitive types from this example.
- If a field is unknown, use the schema-safe empty value shown by the example.

Example JSON:
${JSON.stringify(schemaExample(schema), null, 2)}`
}

function schemaExample(schema) {
  if (!schema) return null
  if (schema.enum && schema.enum.length) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== 'null') : schema.type
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return 0
  if (type === 'array') return []
  if (type === 'object') {
    const out = {}
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      out[key] = schemaExample(propSchema)
    }
    return out
  }
  return ''
}

function normalizeVerdict(schema, value) {
  if (!schema || value == null) return value
  if (schema.type === 'array') {
    const values = Array.isArray(value) ? value : [value]
    return values.map((item) => normalizeVerdict(schema.items || {}, item))
  }
  if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    const normalized = { ...value }
    const properties = schema.properties || {}
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = normalizeVerdict(propSchema, normalized[key])
      }
    }
    return normalized
  }
  if (schema.type === 'object' && typeof value === 'string') {
    return { text: value }
  }
  if (schema.enum && typeof value === 'string') {
    const mapped = normalizeEnum(value)
    const match = schema.enum.find((item) => String(item).toLowerCase() === mapped)
    return match === undefined ? value : match
  }
  if (schema.type === 'boolean') {
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase()
      if (lowered === 'true' || lowered === 'yes' || lowered === '1') return true
      if (lowered === 'false' || lowered === 'no' || lowered === '0') return false
    }
    if (value === 1) return true
    if (value === 0) return false
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return schema.type === 'integer' ? Math.trunc(numeric) : numeric
  }
  return value
}

function normalizeEnum(value) {
  const lowered = value.trim().toLowerCase()
  const synonyms = {
    critical: 'blocker',
    warn: 'low',
    warning: 'low',
    ok: 'accepted',
    approve: 'accepted',
    approved: 'accepted',
    retrying: 'retry',
    halt: 'stop',
  }
  return synonyms[lowered] || lowered
}

function verdictContradiction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const blockers = countItems(value.blockers) + countItems(value.gaps)
  if (value.accepted === true && blockers > 0) return 'accepted=true with blockers/gaps'
  if (value.accepted === false && blockers === 0) return 'accepted=false with no blockers/gaps'
  const files = countItems(value.files)
  if (value.completed === true && Number(value.stepsDone || 0) === 0 && files === 0) {
    return 'completed=true with no stepsDone and no files'
  }
  if (value.completed === true && files === 0 && /no changes|nothing (to )?(change|do|modify)|unchanged/i.test(String(value.summary || ''))) {
    return 'completed=true while summary says no work was done'
  }
  if (value.passed === true && /(failed|failures|error|exit\s*1|exit status\s*1|non-zero)/i.test(String(value.summary || value.command || ''))) {
    return 'passed=true while test summary/command reports failure'
  }
  if (value.fixed === true && !value.summary && !value.changeSummary && countItems(value.files) === 0) {
    return 'fixed=true without summary, changeSummary, or files'
  }
  if (value.decision === 'retry' && reasoningSaysStop(String(value.reasoning || ''))) {
    return 'decision=retry while reasoning says stop'
  }
  return ''
}

function countItems(value) {
  return Array.isArray(value) ? value.length : 0
}

function reasoningSaysStop(text) {
  const lowered = String(text || '').toLowerCase()
  const stopPattern = /\b(stop|halt|cancel|give up)\b/g
  let stopMatch
  while ((stopMatch = stopPattern.exec(lowered)) !== null) {
    const before = lowered.slice(0, stopMatch.index)
    const clauseStart = Math.max(
      before.lastIndexOf('.'),
      before.lastIndexOf(';'),
      before.lastIndexOf(':'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
      before.lastIndexOf(','),
      before.lastIndexOf('\n')
    )
    const clauseBeforeStop = before.slice(clauseStart + 1)
    const negated = /\b(do\s+not|don't|dont|never|should\s+not|must\s+not|not\s+to|will\s+not|won't|cannot|can't|can\s+not)\b/.test(clauseBeforeStop)
    if (!negated) return true
  }
  return false
}

function extractJson(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  for (const candidate of jsonCandidates(text)) {
    const parsed = parseJsonCandidate(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

function parseJsonCandidate(candidate) {
  const variants = [candidate, repairJsonText(candidate)]
  for (const variant of variants) {
    try { return JSON.parse(variant) } catch (_) { /* continue */ }
  }
  return null
}

function jsonCandidates(text) {
  const candidates = [text]
  const fenceRegex = /```(?:json)?\s*([\s\S]+?)```/gi
  let fenceMatch
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    candidates.push(fenceMatch[1].trim())
  }
  candidates.push(...braceCandidates(text))
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index)
}

function braceCandidates(text) {
  const candidates = []
  const stack = []
  let start = -1
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== '{' && char !== '[' && char !== '}' && char !== ']') continue
    if (char === '{' || char === '[') {
      if (stack.length === 0) start = i
      stack.push(char)
      continue
    }
    const opener = stack[stack.length - 1]
    if ((char === '}' && opener === '{') || (char === ']' && opener === '[')) {
      stack.pop()
      if (stack.length === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  if (start >= 0 && stack.length) {
    const closers = stack.reverse().map((char) => char === '{' ? '}' : ']').join('')
    candidates.push(text.slice(start) + closers)
  }
  return candidates
}

function repairJsonText(text) {
  let repaired = String(text).trim()
  repaired = stripTrailingCommasOutsideStrings(repaired)
  repaired = replacePythonLiteralsOutsideStrings(repaired)
  repaired = normalizeSingleQuotedStrings(repaired)
  repaired = quoteBareKeysOutsideStrings(repaired)
  const openCurly = (repaired.match(/{/g) || []).length
  const closeCurly = (repaired.match(/}/g) || []).length
  const openSquare = (repaired.match(/\[/g) || []).length
  const closeSquare = (repaired.match(/]/g) || []).length
  if (openSquare > closeSquare) repaired += ']'.repeat(openSquare - closeSquare)
  if (openCurly > closeCurly) repaired += '}'.repeat(openCurly - closeCurly)
  return repaired
}

function stripTrailingCommasOutsideStrings(text) {
  let out = ''
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      out += char
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (/\s/.test(text[j] || '')) j += 1
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += char
  }
  return out
}

function replacePythonLiteralsOutsideStrings(text) {
  return rewriteOutsideStrings(text, (segment) =>
    segment.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
  )
}

function quoteBareKeysOutsideStrings(text) {
  return rewriteOutsideStrings(text, (segment) =>
    segment.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
  )
}

function normalizeSingleQuotedStrings(text) {
  let out = ''
  let doubleQuote = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (doubleQuote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        doubleQuote = false
      }
      continue
    }
    if (char === '"') {
      doubleQuote = true
      out += char
      continue
    }
    if (char !== "'") {
      out += char
      continue
    }
    let value = ''
    i += 1
    for (; i < text.length; i++) {
      const inner = text[i]
      if (inner === '\\' && i + 1 < text.length) {
        const escapedChar = text[i + 1]
        value += (escapedChar === "'" || escapedChar === '"') ? escapedChar : `\\${escapedChar}`
        i += 1
      } else if (inner === "'") {
        break
      } else {
        value += inner
      }
    }
    out += JSON.stringify(value)
  }
  return out
}

function rewriteOutsideStrings(text, rewriteSegment) {
  let out = ''
  let segment = ''
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      out += rewriteSegment(segment)
      segment = ''
      quote = char
      out += char
      continue
    }
    segment += char
  }
  return out + rewriteSegment(segment)
}

// Append a review verdict to <planDir>/review-history.md (Phase C2 persistence). Non-blocking.
// Writes one compact markdown section per iteration so resume + audit have the full review trail.
// Uses APPEND (never overwrite) so the history accumulates across iterations + gates.
async function appendReviewHistory(planDir, phaseLabel, iteration, verdict, acceptancePath, result) {
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
    const ack = await safeAgent(
      `You are a file-writer agent. APPEND the section below to the file at ${historyPath}.
Create the file (and parent dirs) if it does not exist. Do NOT overwrite existing content — append only.
Return ok=true and totalBytes = the file's total size in bytes AFTER appending.

${section}`,
      { label: `review-history(${phaseLabel}#${iteration})`, phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
    )
    // EN-4: verify the append-only trail actually grew (writer reports totalBytes).
    const growth = verifyAppendGrowth(result, historyPath, ack)
    if (growth && growth.ok === false) log(`review-history append DID NOT grow (possible overwrite): ${historyPath} ${growth.prev}->${growth.now}`)
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
    await appendReviewHistory(planDir, phaseLabel, iterations, review, null, result)
    if (!review) {
      // Reviewer agent failed — fail-forward (treat as accepted) so a flaky reviewer doesn't block.
      plogFromResult(result, `${phaseLabel}: reviewer returned null — fail-forward (accepted)`)
      await appendReviewHistory(planDir, phaseLabel, iterations, null, 'fail-forward (reviewer-null)', result)
      recordDegradationEvent(result, 'fail-forward', phaseLabel, 'critical-reviewer', 'reviewer returned null')
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
      await appendReviewHistory(planDir, phaseLabel, iterations, review, acceptTag, result)
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
        failureContext: `${phaseLabel} review iteration ${iterations}: prior revision did not satisfy the reviewer. Outstanding blockers: ${compactList(review.blockers, 8)}; gaps: ${compactList(review.gaps, 8)}`,
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
      await appendReviewHistory(planDir, phaseLabel, iterations, review, 'fail-forward (reviser-null)', result)
      recordDegradationEvent(result, 'fail-forward', phaseLabel, 'design-reviser', 'reviser returned null')
      return { accepted: true, iterations, lastVerdict: review, failForward: true, acceptancePath: 'fail-forward (reviser-null)' }
    }
    plogFromResult(result, `${phaseLabel}: revised (${(revise.changesApplied || []).length} changes)`)
  }
  // Sub-cap exhausted without acceptance — fail-forward (non-terminal like the plan convergence gate).
  plogFromResult(result, `${phaseLabel}: sub-cap (${refineSubcap}) reached without acceptance — fail-forward`)
  await appendReviewHistory(planDir, phaseLabel, iterations, lastVerdict, 'fail-forward (sub-cap)', result)
  recordDegradationEvent(result, 'fail-forward', phaseLabel, 'review-loop', 'sub-cap reached without acceptance')
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
    const enhanced = await safeAgent(
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
      { label: `prompt-enhancer(${gateKey})`, phase: 'Enhance', schema: ENHANCER_VERDICT, model: gm('enhancer') },
      result
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
        await safeAgent(
          `You are a file-writer agent. APPEND the entry below to ${result.enhancedPromptsPath}.
Create the file if absent. Do NOT overwrite. Return ok=true.

${entry}`,
          { label: `enhanced-prompts(${gateKey})`, phase: 'Enhance', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
          result
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
Carried blockers (from force-accept):
${compactList(result.carriedBlockers || [], 8)}
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
    const ack = await safeAgent(
      `You are a file-writer agent. APPEND the markdown entry below to ${path}.
If the file does not exist, create it with a "# Decision Log" header first, then the entry.
Do NOT overwrite existing content. Return ok=true and totalBytes = the file's total size in
bytes AFTER appending. Entry to append:

${entry}`,
      { label: 'file-writer(decisions)', phase: 'Goalkeeper', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
    )
    if (result) result.decisionsPath = path
    // EN-4: verify the append-only decision log grew and was not overwritten.
    const growth = verifyAppendGrowth(result, path, ack)
    if (growth && growth.ok === false) log(`decisions.md append DID NOT grow (possible overwrite): ${path} ${growth.prev}->${growth.now}`)
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
    await safeAgent(
      `You are a file-writer agent. APPEND the open-questions list below to ${path}.
If the file does not exist, create it with a "# Open Questions" header first, then the list.
Do NOT overwrite existing content — append only. List to append:

${body}`,
      { label: 'file-writer(open-questions)', phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      result
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
    await safeAgent(
      `You are a file-writer agent. Write (overwrite) the markdown below to the file at ${path}.
Create the parent directory if it does not exist. Content:

${body}`,
      { label: 'file-writer(failed-launch)', phase: 'Checkpoint', agentType: nsAgent('file-writer'), schema: FILE_ACK, model: gm('todo') },
      null
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
  execute: ['executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack'],
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

// Canonicalize a user-supplied --from-gate target onto a LOOPBACK_FLAG_MAP key.
// Accepts common shorthands; returns null for anything unknown so the caller can
// reject with the valid-key list instead of silently clearing nothing.
function normalizeGateTarget(name) {
  const raw = String(name || '').trim().toLowerCase()
  if (!raw) return null
  const aliases = { arch: 'architecture', test: 'tests', 'detailed-design': 'design', exec: 'execute' }
  const key = aliases[raw] || raw
  return LOOPBACK_FLAG_MAP[key] ? key : null
}

// Re-arm ONE stage for re-execution (--stage): flip it back to pending and clear the
// post-execute result flags — a re-run of any stage stales the whole-run test/review/
// goalkeeper verdicts, which must be re-earned over the fresh diff. Other stages keep
// their done status (the execute loop skips them). Returns false on an unknown stage id.
function resetStageForRerun(result, stageId) {
  if (!result || !Array.isArray(result.stages)) return false
  const target = result.stages.find((st) => st && st.id === stageId)
  if (!target) return false
  target.status = 'pending'
  for (const flag of ['executed', 'testsPassed', 'ready', 'codeReview', '_goalkeeper', '_loopBack']) {
    if (flag in result) result[flag] = null
  }
  result.ready = false
  result.testsPassed = false
  return true
}

// Apply a user's design-approval decision. Workflow subagents cannot use AskUserQuestion,
// so the engine only STOPS at the approval checkpoint; the /design-feature command (a
// top-level prompt, which can ask the user) collects the decision and re-invokes with
// approveDesign / stageEdits / rejectToPlan. This helper mutates only the approval fields;
// the caller performs the impure follow-ups (gate clearing, chunker re-run). Returns the
// action the caller must take, or null when no decision was supplied. Idempotent: a repeat
// approve on an already-approved result is harmless.
function applyApprovalDecision(result, decision) {
  if (!result || !decision) return null
  if (decision.approve) {
    result.designApproved = { approved: true, by: 'user', seq: (result._state && result._state.seq) || 0 }
    result.approvalPending = false
    return 'approved'
  }
  if (decision.rejectToPlan) {
    result.designApproved = null
    result.approvalPending = false
    return 'rerun-plan'
  }
  if (decision.stageEdits) {
    result.designApproved = null
    result.approvalPending = false
    return 'edit-stages'
  }
  return null
}

// EN-4: append-only audit trail guard. The audit files (review-history.md, decisions.md,
// issues-and-improvements.md) are appended through an LLM file-writer told "do NOT
// overwrite". One agent mistake wipes the whole trail. We can't stat on the host, so the
// writer reports the file's post-append size (FILE_ACK.totalBytes) and we assert it grew
// vs the last size we recorded for that path. Pure: mutates result._appendSizes + returns
// {ok, shrank, prev, now, unknown}. A non-growing size ⇒ the append was really an
// overwrite (or a no-op) — recorded as a warning so the run surfaces the lost trail.
function verifyAppendGrowth(result, path, ack) {
  if (!result) return { ok: true, unknown: true }
  if (!result._appendSizes) result._appendSizes = {}
  // Digest-based comparison is authoritative when content is available — a
  // writer-reported byte count can be hallucinated, but a content digest
  // deterministically reflects what was actually written.
  if (ack && ack.content != null) {
    if (!result._appendDigests) result._appendDigests = {}
    const currentDigest = computeContentDigest(ack.content)
    const prevDigest = result._appendDigests[path] || null
    result._appendDigests[path] = currentDigest
    if (prevDigest == null) return { ok: true, prev: null, now: currentDigest, reason: 'digest-first-write' }
    const ok = currentDigest !== prevDigest
    const outcome = { ok, shrank: !ok, prev: prevDigest, now: currentDigest, reason: ok ? 'digest-grew' : 'digest-unchanged' }
    if (!ok) {
      if (!result.appendWarnings) result.appendWarnings = []
      result.appendWarnings.push(`append-only file content unchanged (possible overwrite): ${path}`)
    }
    return outcome
  }
  // Fall back to byte-count comparison when no content is available
  const now = ack && Number.isFinite(ack.totalBytes) ? ack.totalBytes : null
  if (now == null) return { ok: true, unknown: true }
  const prev = Number.isFinite(result._appendSizes[path]) ? result._appendSizes[path] : null
  result._appendSizes[path] = now
  if (prev == null) return { ok: true, prev: null, now }
  const ok = now > prev
  const outcome = { ok, shrank: now < prev, prev, now }
  if (!ok) {
    if (!result.appendWarnings) result.appendWarnings = []
    result.appendWarnings.push(`append-only file did not grow (possible overwrite): ${path} (${prev} -> ${now} bytes)`)
  }
  return outcome
}

// Canonicalize a file path for comparison. Declared plan paths and an LLM executor's
// self-reported touched paths routinely differ in PURELY COSMETIC ways (leading "./",
// repeated or trailing slashes, backslashes on Windows-style output). We normalize only
// those — never anything that changes WHICH file is referenced. In particular we do NOT
// strip leading "../": `../a.js` is a genuinely different file from `a.js`, so collapsing
// it would miss real out-of-lane touches and falsely merge two distinct files under one
// key. Conservative on case too: we DON'T lowercase, because the pipeline can run on a
// case-sensitive FS where "Foo.js" and "foo.js" are genuinely different. Pure + testable.
function normalizePath(p) {
  let s = String(p == null ? '' : p).trim().replace(/\\/g, '/')
  s = s.replace(/\/{2,}/g, '/')          // collapse repeated slashes
  s = s.replace(/^\.\//, '')             // drop a single leading ./ (same file)
  s = s.replace(/\/+$/, '')              // drop trailing slashes
  return s
}

// EN-5: lane/stage file-ownership enforcement AFTER execute. Disjointness is checked only
// on DECLARED lane files pre-fanout; parallel executors can still clobber each other or
// stray outside their lane. Given each work unit's declared owned files and the files it
// actually reported touching, return the violations. Both sides are normalizePath'd first
// so surface-form differences don't fabricate violations. Pure + testable.
//   units: [{ name, owned: string[], touched: string[] }]
//   -> { outOfLane: [{unit,file}], crossOverlap: [{file, units:[...]}] }
// A unit with an empty `owned` set is skipped for outOfLane (no ownership declared to
// enforce), but its touches still count toward crossOverlap detection.
function detectOwnershipViolations(units) {
  const outOfLane = []
  const touchedBy = new Map()
  for (const u of units || []) {
    const owned = new Set((u.owned || []).map(normalizePath))
    for (const f of (u.touched || []).map(normalizePath)) {
      if (owned.size && !owned.has(f)) outOfLane.push({ unit: u.name, file: f })
      const seen = touchedBy.get(f) || []
      if (!seen.includes(u.name)) seen.push(u.name)
      touchedBy.set(f, seen)
    }
  }
  const crossOverlap = []
  for (const [file, names] of touchedBy) {
    if (names.length > 1) crossOverlap.push({ file, units: names })
  }
  return { outOfLane, crossOverlap }
}

// IM-3: prompt-size hygiene. Gate prompts interpolate raw, growing JSON blobs
// (carriedBlockers, findings, blockers) into every downstream prompt. The on-disk
// artifacts are the real payload; the prompt only needs a compact reference. compactList
// renders at most `max` items (stringified) with a "+K more" tail so a long blocker list
// can't balloon a prompt. Pure + testable.
function compactList(items, max = 5) {
  const arr = Array.isArray(items) ? items : (items == null ? [] : [items])
  const shown = arr.slice(0, max).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  const extra = arr.length - shown.length
  const body = shown.map((s) => `- ${s}`).join('\n')
  return extra > 0 ? `${body}\n- (+${extra} more — see the on-disk artifact)` : (body || '- (none)')
}

// Design-mode per-gate/per-run call/token budget enforcement (DBUDGET-01).
// Wraps the Phase 5 budget-admission primitive with per-gate tracking so design
// runs enforce real budgets instead of merely observing via gateTelemetry.
// Non-spendable reserve for state flush/handoff is carved out and never consumed
// by gate work. All functions are pure and deterministic — no I/O, no side effects.

// Default budget caps derived from gateTelemetry characterization, not guessed.
// callPerGate: max agent calls a single design gate may consume.
// callPerRun: max total agent calls across the entire design run.
// tokenPerGate/tokenPerRun: 0 = uncharacterized (call-only enforcement).
const DESIGN_BUDGET_DEFAULTS = Object.freeze({
  callPerGate: 8,
  callPerRun: 200,
  tokenPerGate: 0,
  tokenPerRun: 0,
})

// Non-spendable reserve for state persistence and handoff — never consumed by gate work.
const DESIGN_RESERVE_CALLS = 10

// Create a design-mode budget accountant wrapping the Phase 5 pattern with per-gate tracking.
// opts can override defaults (from args.designCallPerGate / args.designCallPerRun).
function createDesignBudget(opts) {
  const o = opts || {}
  const limits = createBudgetLimits({
    callCeiling: o.callPerRun || DESIGN_BUDGET_DEFAULTS.callPerRun,
    tokenCeiling: o.tokenPerRun || DESIGN_BUDGET_DEFAULTS.tokenPerRun,
  })
  let accountant = createBudgetAccountant(limits)
  accountant = setReserve(accountant, RESERVE_TYPES.HANDOFF, DESIGN_RESERVE_CALLS)
  return {
    accountant,
    gateSpend: {},
    caps: {
      callPerGate: o.callPerGate || DESIGN_BUDGET_DEFAULTS.callPerGate,
      tokenPerGate: o.tokenPerGate || DESIGN_BUDGET_DEFAULTS.tokenPerGate,
    },
  }
}

// Record actual spend for a design gate. Pure: returns a new budget object.
function spendDesignGate(budget, gateName, calls, tokens) {
  const prev = (budget.gateSpend && budget.gateSpend[gateName]) || { calls: 0, tokens: 0 }
  return {
    accountant: spendBudget(budget.accountant, calls, tokens),
    gateSpend: {
      ...budget.gateSpend,
      [gateName]: {
        calls: prev.calls + (calls || 0),
        tokens: prev.tokens + (tokens || 0),
      },
    },
    caps: { ...budget.caps },
  }
}

// Remaining calls for a specific gate (per-gate cap minus spent).
function gateCallsRemaining(budget, gateName) {
  const spent = (budget.gateSpend && budget.gateSpend[gateName]) || { calls: 0 }
  return Math.max(0, budget.caps.callPerGate - spent.calls)
}

// Check if a gate can be admitted within its per-gate cap AND the per-run ceiling.
// estimatedCost: { calls, tokens } the gate is expected to consume.
function canAdmitDesignGate(budget, gateName, estimatedCost) {
  const gateCalls = gateCallsRemaining(budget, gateName)
  const runCalls = callsRemaining(budget.accountant)
  const neededCalls = (estimatedCost && estimatedCost.calls) || 0
  if (neededCalls > gateCalls) {
    return { admitted: false, reason: 'per-gate-cap', remaining: { gate: gateCalls, run: runCalls } }
  }
  if (neededCalls > runCalls) {
    return { admitted: false, reason: 'per-run-cap', remaining: { gate: gateCalls, run: runCalls } }
  }
  return { admitted: true, remaining: { gate: gateCalls, run: runCalls } }
}

// Budget summary for handoff/status reporting. Merges the Phase 5 budgetSummary
// with per-gate spend detail and the caps in effect.
function designBudgetSummary(budget) {
  const base = budgetSummary(budget.accountant)
  const gateSpendCopy = {}
  for (const name of Object.keys(budget.gateSpend)) {
    gateSpendCopy[name] = { ...budget.gateSpend[name] }
  }
  return {
    ...base,
    gateSpend: gateSpendCopy,
    caps: { ...budget.caps },
  }
}

// Remaining tokens for a specific gate (per-gate token cap minus spent).
// Returns Infinity when tokenPerGate is 0 (uncharacterized — see note below).
function gateTokensRemaining(budget, gateName) {
  const cap = budget.caps.tokenPerGate || 0
  if (!cap) return Infinity
  const spent = (budget.gateSpend && budget.gateSpend[gateName]) || { tokens: 0 }
  return Math.max(0, cap - spent.tokens)
}

// Post-gate token spend recording. Called after a gate's agent calls complete to
// record actual token consumption. This is the measurement hook for D3: the
// mechanism exists so a dogfood run can collect real per-gate token data and
// feed it back into characterized tokenPerGate/tokenPerRun caps. Until then,
// designBudgetGate always records 0 tokens and only the call ceiling is enforced.
// Pure: returns a new budget object.
function recordGateTokenSpend(budget, gateName, tokens) {
  return spendDesignGate(budget, gateName, 0, tokens)
}

// Per-loop sub-budget tracker for design review/refine loops (DLOOP-01).
//
// Each design review/refine loop (refine, reconcile, debug, escalation) gets its
// OWN bounded sub-budget so early-loop spend cannot starve later gates or
// escalation. This replaces the F12 defect where all four loops drew from the
// single shared retryState counter. The shared retryState remains as a secondary
// runaway guard, but the PRIMARY iteration limit for each loop is its own cap.
//
// All functions are pure and deterministic — no I/O, no side effects.

// Create per-loop budget tracker. Each loop gets its own {used, cap} pool.
// config overrides come from args (maxRefineIterations, maxReconcileIterations,
// maxDebugRetries, maxEscalationRetries).
function createLoopBudgets(config) {
  const c = config || {}
  return {
    refine: { used: 0, cap: c.refineCap || REFINE_SUBCAP_DEFAULT },
    reconcile: { used: 0, cap: c.reconcileCap || RECONCILE_SUBCAP_DEFAULT },
    debug: { used: 0, cap: c.debugCap || DEBUG_SUBCAP_DEFAULT },
    escalation: { used: 0, cap: c.escalationCap || ESCALATION_RETRIES_DEFAULT },
  }
}

// Increment a single loop's used counter. Pure: returns a new budgets object.
function spendLoop(budgets, loopName) {
  const b = budgets && budgets[loopName]
  if (!b) return budgets
  return {
    ...budgets,
    [loopName]: { used: b.used + 1, cap: b.cap },
  }
}

// Check if a specific loop has exhausted its own sub-budget.
function loopBudgetExhausted(budgets, loopName) {
  const b = budgets && budgets[loopName]
  if (!b) return true
  return b.used >= b.cap
}

// Summary of all loop budgets for handoff/status reporting.
function loopBudgetSummary(budgets) {
  if (!budgets) return {}
  const out = {}
  for (const name of Object.keys(budgets)) {
    const b = budgets[name]
    out[name] = { used: b.used, cap: b.cap, remaining: Math.max(0, b.cap - b.used) }
  }
  return out
}

// extractSliceMain: the leaf entry point for the fp-extract-slice workflow.
//
// The top-level pipeline spawns this leaf to process exactly one admitted feature.
// The leaf owns only the per-feature extraction gates; it performs no discovery,
// scheduling, reconciliation, synthesis, continuation, or readiness computation —
// those remain the top-level pipeline's authority.
//
// The sandbox provides `args` as a global (same contract as the top-level main()).
// The caller passes { slice, task, config, sliceState?, retryBudget?, ... }.
// Returns { mode, sliceId, status, gate?, lifecycle, sliceState, logLines, gateCheckpoints }.
async function extractSliceMain() {
  // Coerce args to object (sandbox sometimes delivers a JSON string).
  if (args !== null && typeof args === 'string') {
    try { args = JSON.parse(args) } catch (e) { args = {} }
  } else if (args == null) {
    args = {}
  }

  const slice = args.slice
  if (!slice || !slice.id || !slice.planDir) {
    return {
      mode: 'extract-slice',
      status: 'blocked',
      blockedAt: 'missing-slice',
      logLines: ['extractSliceMain: invoked without a valid slice spec (requires slice.id and slice.planDir)'],
    }
  }

  const task = args.task || ''
  const config = args.config || {}
  const result = { logLines: [], gateLog: [], telemetry: {} }
  const sliceState = args.sliceState || {}

  // Initialize lifecycle state if not already set by the top-level orchestrator.
  // The leaf transitions the feature through the shared lifecycle reducer so
  // readiness derivation stays consistent across the top-level and leaf.
  if (!sliceState.lifecycle) {
    sliceState.lifecycle = LIFECYCLE_STATES.IN_PROGRESS
  }

  const outcome = await extractSlice({
    slice,
    task,
    result,
    sliceState,
    config,
    retryBudget: args.retryBudget || RETRY_BUDGET_DEFAULT,
    refineSubcap: args.refineSubcap || REFINE_SUBCAP_DEFAULT,
    decisionCap: args.decisionCap || DECISION_CAP_DEFAULT,
  })

  // Apply lifecycle transitions via the shared reducer. On 'done', transition
  // to 'completed'. On 'blocked', the feature stays 'in-progress' (resumable,
  // not terminal). The top-level orchestrator retains scheduling/readiness
  // authority — the leaf only reports its own feature's lifecycle.
  if (outcome.status === 'done') {
    try {
      const transitioned = applyLifecycleEvent(
        { lifecycle: sliceState.lifecycle },
        { type: 'complete' }
      )
      sliceState.lifecycle = transitioned.lifecycle
    } catch (e) {
      // If already completed or illegal transition, keep current state
      result.logLines.push(`extractSliceMain: lifecycle transition to complete failed — ${String(e)}`)
    }
  }

  return {
    mode: 'extract-slice',
    sliceId: slice.id,
    status: outcome.status,
    gate: outcome.gate,
    lifecycle: sliceState.lifecycle,
    sliceState,
    logLines: result.logLines,
    gateCheckpoints: sliceState._gateCheckpoints || {},
  }
}

const final = await extractSliceMain()
return final
