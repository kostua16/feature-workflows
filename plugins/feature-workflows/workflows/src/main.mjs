import { ENGINE_VERSION } from './engine-version.mjs'
import { DEFINE_VERDICT, TRANSLATOR_VERDICT, CATEGORY_VERDICT, PLAN_VERDICT, REVIEW_VERDICT, REFINE_VERDICT, EXECUTE_VERDICT, TEST_AUTHORING_VERDICT, COMMIT_VERDICT, GSD_RUN_VERDICT, DEBUG_VERDICT, ESCALATION_REVIEW, ARCH_VERDICT, DETAILED_DESIGN_VERDICT, TDD_VERDICT, KNOWLEDGE_VERDICT, INTERVIEW_VERDICT, E2E_USECASE_VERDICT, CODEBASE_FACTS_VERDICT, REQUIREMENTS_VERDICT, RECONCILE_VERDICT, TUNE_PLAN_VERDICT, SCOPE_VERDICT, DECOMPOSE_VERDICT } from './schemas.mjs'
import { RETRY_BUDGET_DEFAULT, REFINE_SUBCAP_DEFAULT, DEBUG_SUBCAP_DEFAULT, RECONCILE_SUBCAP_DEFAULT, ESCALATION_RETRIES_DEFAULT, DECISION_CAP_DEFAULT, resolveProfile, resolveConfigFlag, profileDefault, resolveUseTestWriter, retryState, budgetExhausted, spendRetry, hydrateBudget, decisionState, decisionBudgetExhausted, gm, resolveMode, gateModeActive } from './config.mjs'
import { taskSlug, categorizeSlug, jiraIdFromTask, detectNonEnglish } from './text-utils.mjs'
import { consolidate, writeChunkedFile, validatePipelineState, renderStatusReport, flushPipelineState, flushPipelineStateWithSnapshot, loadPipelineState, loadPipelineStateWithRecovery, verifyArtifactPresence, repairResumeArtifactFlags, detectResumeEngineSkew } from './state.mjs'
import { computeContentDigest } from './revision.mjs'
import { chunkPlanIntoStages, selectBlockingFindings, buildIssuesHandoff, classifyAndRecordIssue, tickStageFile, readIssuesFile, planTuneFromIssues, invalidateStages } from './stages-issues.mjs'
import { tuneRevisitGate } from './tune.mjs'
import { seedExtractQueue, nextPendingSlice, resolveScope } from './extract-scope.mjs'
import { meetsMinSeverity, resolveMinSeverity, resolveReviewLenses, collectReviewDocs, buildReviewReport, runReviewLenses, mergeReviewFindings, verifyReviewFindings, recordReviewIssues } from './review-mode.mjs'
import { extractSlice, writeSystemOverview } from './extract-slice.mjs'
import { persistFindings, publishDesign } from './publish-persist.mjs'
import { runTests } from './test-run.mjs'
import { safeAgent, flexibleAgent, renderTelemetrySummary, recordDegradationEvent, degradationLogSummary } from './agent-core.mjs'
import { reviewLoop, enhancePrompt } from './review-loop.mjs'
import { runQuickDecider, runGoalkeeper, appendDecisionLog, writeOpenQuestions, writeFailedLaunch, LOOPBACK_FLAG_MAP, clearGateAndDownstream, normalizeGateTarget, resetStageForRerun, applyApprovalDecision, detectOwnershipViolations, compactList } from './decisions.mjs'
import { createBudgetLimits, createBudgetAccountant, setReserve, callsRemaining, admitSegment, spendBudget, canFinishNextGate, budgetSummary, RESERVE_TYPES } from './budget-admission.mjs'
import { createRetryPolicy, createAttemptHistory, recordAttempt, isTerminalFailure, terminalReason, attemptSummary, ATTEMPT_OUTCOMES } from './retry-policy.mjs'
import { isolateFailure, shouldContinueAfterFailure, segmentOutcome, eligibleIndependents } from './failure-isolation.mjs'
import { createContinuationState, nextSegmentId, idempotencyKey, createSegmentIntent, acknowledgeSegment, resolveConvergence, shouldContinue, resumeCommand, continuationSummary, canAutoRelaunch } from './continuation.mjs'
import { createSynthesisState, synthesizeProjectViews, isSynthesisCurrent, invalidateStaleViews, synthesisSummary } from './synthesis.mjs'
import { createPersistenceTracker, recordAttemptedWrite, verifyDurableWrite, failWrite, isRetrySafe, persistenceReport } from './observe-persist.mjs'
import { deriveExtractReadiness, projectStatusProjection, readinessSummary, deriveDesignReadiness, DESIGN_READINESS_REASONS } from './status-truth.mjs'
import { createDesignBudget, spendDesignGate, gateCallsRemaining, canAdmitDesignGate, designBudgetSummary, DESIGN_BUDGET_DEFAULTS } from './design-budget.mjs'
import { createLoopBudgets, spendLoop, loopBudgetExhausted, loopBudgetSummary } from './design-loops.mjs'


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

  // Status mode: read-only inspection of a persisted run. Loads + validates the state,
  // renders a report, and returns WITHOUT consolidate/stateCheckpoint/failed-launch
  // writes — a status query must never mutate (or even touch) the run it inspects.
  // Only an explicit args.mode can select it (status is never persisted into config).
  if (args && args.mode === 'status') {
    if (!resumeArg) {
      return {
        mode: 'status',
        ready: false,
        blockedAt: 'missing-plan-dir',
        statusReport: 'status mode requires a <planDir>. Usage: /pipeline-status <planDir>',
        logLines: ['main: status mode invoked without a planDir'],
      }
    }
    const statusDir = resumeArg.replace(/(^|\/)plan\.md$/, '$1').replace(/\/$/, '') + '/'
    const loaded = await loadPipelineState(statusDir)
    const state = loaded && loaded.state
    if (!state) {
      return {
        mode: 'status',
        planDir: statusDir,
        ready: false,
        blockedAt: 'resume-no-state',
        statusReport: `No pipeline-state.json at ${statusDir} — nothing to report. Run /design-feature to start a run.`,
        logLines: [`main: status mode found no pipeline-state.json at ${statusDir}`],
      }
    }
    const validation = validatePipelineState(state)
    var statusReportStr = renderStatusReport(state, validation)
    // Phase 6: augment status with truthful readiness projection if the state
    // includes one (added by Phase 6 extract terminal). This is read-only — status
    // mode never writes, and the projection is the same immutable object the handoff used.
    if (state.result && state.result.statusProjection) {
      statusReportStr += '\n\n' + readinessSummary(state.result.statusProjection)
    }
    return {
      mode: 'status',
      planDir: statusDir,
      ready: true,
      statusReport: statusReportStr,
      logLines: [`main: status report rendered for ${statusDir}${validation.ok ? '' : ' (state failed validation — best-effort)'}`],
    }
  }

  // An explicit --plan is authoritative on fresh runs only. On resume the planDir comes
  // from args.resume itself; --plan is ignored on resume.
  let resumed = null
  let explicitPlanPath = (args && args.planPath) || null

  if (resumeArg) {
    // resumeArg is a planDir (or a plan.md path); normalize to a dir.
    const resumeDir = resumeArg.replace(/(^|\/)plan\.md$/, '$1').replace(/\/$/, '') + '/'
    const loaded = await loadPipelineStateWithRecovery(resumeDir)
    resumed = loaded && loaded.state
    if (loaded && loaded.recovered) {
      log(`main: --resume auto-recovered from pipeline-state.last-good.json at ${resumeDir} (primary was corrupt/truncated)`)
    }
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
    // EN-2: validate the hydrated state BEFORE trusting it into 25+ result flags. A
    // corrupt/truncated pipeline-state.json (a failed chunked write, IM-1) that still
    // parses as JSON must block with a clear message rather than hydrate garbage. Same
    // pre-try-block constraint as above: return a clean blocked result, never throw.
    const validation = validatePipelineState(resumed)
    if (!validation.ok) {
      const detail = validation.errors.join('; ')
      log(`main: --resume state failed validation at ${resumeDir}: ${detail}`)
      await writeFailedLaunch(resumeDir.replace(/[\/]+$/, '').split(/[\/]/).pop(), 'resume-invalid-state', detail, Object.keys(args || {}))
      return {
        task: (resumed && resumed.task) || '',
        mode: resolveMode(args, (resumed && resumed.config) || {}, resumed),
        planDir: resumeDir,
        ready: false,
        blockedAt: 'resume-invalid-state',
        handoff: {
          from: resolveMode(args, (resumed && resumed.config) || {}, resumed),
          message: `pipeline-state.json at ${resumeDir} is invalid or corrupt (${detail}). It may be a truncated write — inspect the file, or run /design-feature to start fresh.`,
          nextMode: 'design',
          planDir: resumeDir,
        },
        logLines: [`main: resume blocked — invalid pipeline-state.json at ${resumeDir}: ${detail}`],
      }
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
  const escalationCap = (args && args.maxEscalationRetries) || ESCALATION_RETRIES_DEFAULT
  const decisionCap = (args && args.decisionCap) || DECISION_CAP_DEFAULT
  // DLOOP-01: per-loop sub-budgets so early-loop spend cannot starve later loops.
  // The shared retryState remains as a secondary runaway guard.
  let loopBudgets = createLoopBudgets({
    refineCap: refineSubcap,
    reconcileCap: reconcileSubcap,
    debugCap: debugSubcap,
    escalationCap: escalationCap,
  })
  // DBUDGET-01: per-gate/per-run call/token budget enforcement with non-spendable
  // reserve for state flush/handoff (wraps the Phase 5 budget-admission pattern).
  let designBudget = createDesignBudget({
    callPerGate: args && args.designCallPerGate,
    callPerRun: args && args.designCallPerRun,
  })
  const autoCommit = !!(args && args.autoCommit)
  const testTarget = (args && args.testTarget) || '' // empty => whole suite
  // IM-4: stack-agnostic test gate. --test-cmd pins an exact command; --test-framework
  // selects a mapped template (pytest/npm/go/cargo/…). Neither set => runner auto-detects.
  const testCmd = (args && args.testCmd) || ''
  const testFramework = (args && args.testFramework) || ''

  // GSD integration options.
  const gsdQuick = !!(args && args.gsdQuick) // force the gsd-quick fast-path
  const useGsdDebug = args && args.useGsdDebug === false ? false : true // default true

  // IM-5: profile presets supply the DEFAULT for each gate-control flag. `pdef` returns
  // the profile's value for a flag if the profile sets it, else the historical default
  // (true). Profiles are a fresh-run convenience only: cfgFlag prefers an explicit arg,
  // then the persisted value, then this default — so --resume is unaffected and any
  // individual --no-* flag still overrides the profile.
  const profile = resolveProfile(args && args.profile)
  const pdef = (key, dflt) => profileDefault(profile, key, dflt)

  // Resolve the full config ONCE so every consolidate() boundary (success + each
  // hard-block exit) can flush pipeline-state.json with the run's flag set. On
  // --resume the persisted config is the base; an explicit disabling arg still
  // wins, otherwise the persisted value (if any) is honored.
  const persistedConfig = resumed && resumed.config ? resumed.config : {}
  const cfgFlag = resolveConfigFlag
  const config = {
    profile: (args && args.profile) || persistedConfig.profile || 'full',
    useTranslator: cfgFlag(args && args.useTranslator, persistedConfig.useTranslator, pdef('useTranslator', true)),
    useCategorizer: cfgFlag(args && args.useCategorizer, persistedConfig.useCategorizer, pdef('useCategorizer', true)),
    useEnhancer: cfgFlag(args && args.useEnhancer, persistedConfig.useEnhancer, pdef('useEnhancer', true)),
    useExplorer: cfgFlag(args && args.useExplorer, persistedConfig.useExplorer, pdef('useExplorer', true)),
    useRequirements: cfgFlag(args && args.useRequirements, persistedConfig.useRequirements, pdef('useRequirements', true)),
    useArchDesign: cfgFlag(args && args.useArchDesign, persistedConfig.useArchDesign, pdef('useArchDesign', true)),
    useDetailedDesign: cfgFlag(args && args.useDetailedDesign, persistedConfig.useDetailedDesign, pdef('useDetailedDesign', true)),
    useTddEnforce: cfgFlag(args && args.useTddEnforce, persistedConfig.useTddEnforce, pdef('useTddEnforce', true)),
    useKnowledgePersist: cfgFlag(args && args.useKnowledgePersist, persistedConfig.useKnowledgePersist, pdef('useKnowledgePersist', true)),
    useE2eUsecase: cfgFlag(args && args.useE2eUsecase, persistedConfig.useE2eUsecase, pdef('useE2eUsecase', true)),
    useKnowledgeConsult: cfgFlag(args && args.useKnowledgeConsult, persistedConfig.useKnowledgeConsult, pdef('useKnowledgeConsult', true)),
    useReconcile: cfgFlag(args && args.useReconcile, persistedConfig.useReconcile, pdef('useReconcile', true)),
    usePublish: cfgFlag(args && args.usePublish, persistedConfig.usePublish, pdef('usePublish', true)),
    useInterview: cfgFlag(args && args.useInterview, persistedConfig.useInterview, pdef('useInterview', true)),
    useGoalkeeper: cfgFlag(args && args.useGoalkeeper, persistedConfig.useGoalkeeper, pdef('useGoalkeeper', true)),
    useQuickDecider: cfgFlag(args && args.useQuickDecider, persistedConfig.useQuickDecider, pdef('useQuickDecider', true)),
    useTestWriter: resolveUseTestWriter(args, persistedConfig),
    decisionCap: decisionCap,
    allowParallelExecute: cfgFlag(args && args.allowParallelExecute, persistedConfig.allowParallelExecute, pdef('allowParallelExecute', true)),
    gsdQuick,
    useGsdDebug,
    retryBudget,
    refineSubcap,
    reconcileSubcap,
    debugSubcap,
    autoCommit,
    testTarget,
    testCmd,
    testFramework,
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
    // Phase J: tune confirmation checkpoint. --no-confirm runs the derived plan directly.
    useTuneConfirm: cfgFlag(args && args.useTuneConfirm, persistedConfig.useTuneConfirm, true),
    // Human design-approval checkpoint at the design-stop. Opt-in (--approval); persisted
    // so the implement run of an approval-gated design honors it too.
    useApproval: cfgFlag(args && args.useApproval, persistedConfig.useApproval, false),
    // Extract mode (reverse design extraction) gate flags + slice controls. The scope
    // confirmation itself is a pause-and-resume checkpoint (subagents cannot AskUserQuestion):
    // the engine returns handoff.status='awaiting-scope-confirm' and the command layer re-invokes
    // with the transient args.scopeConfirmed/args.scopeFiles/args.slices confirmation payload.
    useScopeConfirm: cfgFlag(args && args.useScopeConfirm, persistedConfig.useScopeConfirm, pdef('useScopeConfirm', true)),
    useDecompose: cfgFlag(args && args.useDecompose, persistedConfig.useDecompose, pdef('useDecompose', true)),
    useAudit: cfgFlag(args && args.useAudit, persistedConfig.useAudit, pdef('useAudit', true)),
    useExtractRequirements: cfgFlag(args && args.useExtractRequirements, persistedConfig.useExtractRequirements, pdef('useExtractRequirements', true)),
    useExtractReview: cfgFlag(args && args.useExtractReview, persistedConfig.useExtractReview, pdef('useExtractReview', true)),
    maxSlices: (args && Number.isFinite(args.maxSlices) && args.maxSlices > 0)
      ? args.maxSlices
      : (Number.isFinite(persistedConfig.maxSlices) && persistedConfig.maxSlices > 0 ? persistedConfig.maxSlices : 8),
    slices: (args && Array.isArray(args.slices) && args.slices.length)
      ? args.slices
      : (Array.isArray(persistedConfig.slices) ? persistedConfig.slices : []),
    // Review mode (standalone design-docset audit). minSeverity filters what gets RECORDED
    // to issues-and-improvements.md (the design-review.md report always carries every
    // confirmed finding); reviewLenses narrows the dimension fan-out ([] = all lenses);
    // useReviewVerify gates the adversarial-verification pass.
    useReviewVerify: cfgFlag(args && args.useReviewVerify, persistedConfig.useReviewVerify, pdef('useReviewVerify', true)),
    minSeverity: resolveMinSeverity((args && args.minSeverity) || persistedConfig.minSeverity || 'low'),
    reviewLenses: (args && Array.isArray(args.reviewLenses) && args.reviewLenses.length)
      ? args.reviewLenses
      : (Array.isArray(persistedConfig.reviewLenses) ? persistedConfig.reviewLenses : []),
  }

  // Profile presets tune the FORWARD design flow (skip designing arch/e2e for a small task).
  // In extract mode those gates ARE the product being extracted — a profile silently dropping
  // them would leave a 'light' run emitting only codebase-facts.md. Re-derive the three core
  // extraction gates with profile-independent defaults; an explicit --no-arch/--no-design/
  // --no-e2e (or a persisted per-run flag) still wins via the same cfgFlag precedence.
  if (config.mode === 'extract') {
    config.useArchDesign = cfgFlag(args && args.useArchDesign, persistedConfig.useArchDesign, true)
    config.useDetailedDesign = cfgFlag(args && args.useDetailedDesign, persistedConfig.useDetailedDesign, true)
    config.useE2eUsecase = cfgFlag(args && args.useE2eUsecase, persistedConfig.useE2eUsecase, true)
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
  const useTestWriter = config.useTestWriter
  const allowParallelExecute = config.allowParallelExecute
  // Phase F-K: pipeline-split modes + their sub-flags.
  const mode = config.mode
  const useChunker = config.useChunker
  const useIssues = config.useIssues
  const useTuneConfirm = config.useTuneConfirm
  const useApproval = config.useApproval
  const useScopeConfirm = config.useScopeConfirm
  const useDecompose = config.useDecompose
  const isDesignMode = mode === 'design'
  const isImplementMode = mode === 'implement'
  const isTuneMode = mode === 'tune'
  const isExtractMode = mode === 'extract'
  const isReviewMode = mode === 'review'

  // Review mode audits an EXISTING run. Without a hydrated resume there is nothing to
  // review — and the planDir derivation below would leave planPath undefined for review
  // mode (a raw pre-try-block throw). Same constraint as missing-task: return a clean
  // blocked result, never throw.
  if (isReviewMode && !resumed) {
    log('main: review mode invoked without a resumable planDir; returning blocked result')
    await writeFailedLaunch(slug, 'review-requires-plandir', 'review mode without resume/pipeline-state.json', Object.keys(args || {}))
    return {
      task: task || '',
      mode: 'review',
      ready: false,
      blockedAt: 'review-requires-plandir',
      handoff: {
        from: 'review',
        message: 'Review mode audits an existing run. Usage: /review-design <planDir> where <planDir> has a pipeline-state.json (written by /design-feature, /extract-design, or /tune-feature).',
        nextMode: 'review',
      },
      logLines: ['main: review-requires-plandir — no resumable state'],
    }
  }

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
  } else if (gateModeActive('design', mode) || isExtractMode) {
    // Fresh run with no explicit --plan → derive dynamically. Extract runs share the
    // categorizer but land under a mode-specific path segment (extract/ instead of feature/)
    // so as-is extraction docsets are distinguishable from forward feature designs.
    const kindSeg = isExtractMode ? 'extract' : 'feature'
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
        planPath = `docs/${catSeg}/${subSeg}/${kindSeg}/${shortLeaf}/plan.md`
        log(`Categorized → ${catSeg}/${subSeg}/${shortLeaf}; planDir = ${planPath.replace(/plan\.md$/, '')}`)
      } else {
        planPath = `docs/uncategorized/${kindSeg}/${leafId}/plan.md`
        log(`Categorizer unavailable (null) — falling back to docs/uncategorized/${kindSeg}/<leaf>/`)
      }
    } else {
      planPath = `docs/uncategorized/${kindSeg}/${leafId}/plan.md`
      log(`Categorizer disabled (--no-categorizer) — using docs/uncategorized/${kindSeg}/<leaf>/`)
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
    // IM-2: carry the retry + decision budgets used so far across resume so a run that
    // hard-blocked on a spinning loop cannot be resumed straight back into the same spin
    // with a full fresh budget. --fresh-budget opts back into the old reset-to-zero.
    const seededBudget = hydrateBudget(resumed.result, args)
    retryState.used = seededBudget.retryUsed
    decisionState.used = seededBudget.decisionUsed
    plog(`--resume: seeded budgets retryUsed=${retryState.used} decisionUsed=${decisionState.used}${args && args.freshBudget ? ' (--fresh-budget)' : ''}`)
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
    if (result.designApproved === undefined) result.designApproved = null
    if (result.approvalPending === undefined) result.approvalPending = false
    if (!result.logLines) result.logLines = []
    // Backfill extract-mode fields on pre-extract state.
    if (result.extractScope === undefined) result.extractScope = null
    if (result.scopeManifestPath === undefined) result.scopeManifestPath = null
    if (result.scopeConfirmed === undefined) result.scopeConfirmed = false
    if (!result.extractQueue) result.extractQueue = []
    if (result.overviewPath === undefined) result.overviewPath = null
    if (result.extractReady === undefined) result.extractReady = false
    // Phase 5: backfill bounded scheduler state on pre-v1.5 resume.
    if (result.continuationState === undefined) result.continuationState = null
    if (result.budgetAccountant === undefined) result.budgetAccountant = null
    if (result.attemptHistory === undefined) result.attemptHistory = null
    // Phase 6: backfill synthesis, persistence, and status-truth state.
    if (result.synthesisState === undefined) result.synthesisState = null
    if (result.persistenceTracker === undefined) result.persistenceTracker = null
    if (result.statusProjection === undefined) result.statusProjection = null
    if (result.auditPath === undefined) result.auditPath = null
    plog(`--resume: hydrated state for slug "${slug}" (mode=${mode}, priorLastGate=${(resumed.result._state && resumed.result._state.lastGate) || 'none'})`)
    // The user-level install is a symlink that tracks the plugin, so a resume after a
    // plugin update runs a newer engine than the one that wrote this state. Surface the
    // skew without blocking; pre-1.5.0 state files lack engineVersion and stay silent.
    // Use ENGINE_VERSION (not the meta export binding) — sandbox does not bind meta (issue #17).
    const skew = detectResumeEngineSkew(resumed.engineVersion, ENGINE_VERSION)
    if (skew) {
      result._resumeEngineSkew = skew
      plog(`--resume: engine version skew — state written by ${skew.saved}, running ${skew.current}; artifacts/gate contracts may differ`)
    }
    const resumeRepairs = await repairResumeArtifactFlags(result)
    for (const repair of resumeRepairs) {
      plog(`resume-repair: cleared ${repair} because artifact verification failed`)
    }
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
      _designCheckpoints: {}, // gate-name -> { acknowledged, artifactPath }
      _artifactDigests: {}, // pathKey -> content digest recorded at checkpoint time
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
      testsWritten: false,
      testWriterSummary: null,
      _testWriter: null,
      debugRetries: 0,
      testsPassed: false,
      testSummary: null,
      codeReview: null,
      persist: null,
      ready: false,
      committed: false,
      commitHash: null,
      blockedAt: null,
      gateTelemetry: {}, // per-gate agent-call counters {gate: {calls,retries,escalations,fallbacks,models}}
      logLines: [], // R5: in-memory pipeline log; flushed to <planDir>/pipeline.log at consolidate points
      // Phase F-K (pipeline split): the 3-mode shared contract. All optional/default so
      // pre-split pipeline-state.json hydrates without breakage (backward-compat).
      mode: mode, // design | implement | tune | extract | review — which pipeline wrote this result
      stages: [], // design-tail chunker output: [{id,file,name,status,files}]; implement ticks status
      designReady: false, // design sets true on exit; implement asserts it; tune re-sets after revisit
      issuesPath: null, // implement sets on upstream-defect handoff; tune consumes
      tunePlan: null, // tune: derived minimal gate-revisit plan (TUNE_PLAN_VERDICT)
      handoff: null, // handoff directive shown to user at mode boundaries (design->implement, implement->tune)
      designApproved: null, // human sign-off {approved,by,seq} recorded at the design-approval checkpoint
      approvalPending: false, // design stopped awaiting the human decision (--approval)
      // Extract mode (reverse design extraction) state. All default so pre-extract
      // pipeline-state.json hydrates without breakage (mirrors the F-K backward-compat rule).
      extractScope: null, // SCOPE_VERDICT from Gate X0
      scopeManifestPath: null, // <planDir>/scope-manifest.md
      scopeConfirmed: false, // set via the pause-and-resume confirmation leg (args.scopeConfirmed)
      extractQueue: [], // resumable slice queue: [{id,name,planDir,files,entryPoints,status,artifacts}]
      overviewPath: null, // <planDir>/system-overview.md (multi-slice only)
      extractReady: false, // extract terminal: all pending slices processed
      auditPath: null, // <planDir>/design-audit.md (single-slice; per-slice audits live on queue entries)
      // Phase 5: bounded scheduler and transactional automatic continuation state.
      continuationState: null, // monotonic segment tracking + idempotency keys
      budgetAccountant: null, // characterized budget admission with non-spendable reserve
      attemptHistory: null, // per-gate/per-feature retry attempt journal
      _degradationLog: [], // DHIST-01: durable journal of fail-forward/retry/escalation/fallback events
      // Phase 6: synthesis, persistence tracking, and truthful status projection.
      synthesisState: null, // incremental project views with selective revision invalidation
      persistenceTracker: null, // attempted-vs-durable write lifecycle tracking
      statusProjection: null, // immutable projection shared by handoff and status
      // Review mode (standalone design-docset audit) state. Defaults keep older
      // pipeline-state.json hydrating without breakage (same backward-compat rule).
      reviewPath: null, // <planDir>/design-review.md report
      designReview: null, // review summary {lenses, docsReviewed, raw, confirmed, refuted, droppedDuplicates, recorded, minSeverity}
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

  // checkpointDesign: durably persist the in-memory result after each material
  // design gate so an interrupted run resumes at the first incomplete gate
  // without repeating verified work. Adopts the Phase 4 checkpointSlice pattern:
  // record gate completion + artifact digest, then flush state to disk via the
  // snapshot-retaining writer. Non-blocking — a flush failure only warns.
  const checkpointDesign = async (gateName, artifactPathKey) => {
    if (!result._designCheckpoints) result._designCheckpoints = {}
    if (!result._artifactDigests) result._artifactDigests = {}
    result._designCheckpoints[gateName] = {
      acknowledged: true,
      artifactPath: artifactPathKey ? (result[artifactPathKey] || null) : null,
    }
    if (artifactPathKey && result[artifactPathKey]) {
      const dataKey = '_' + artifactPathKey.replace('Path', '')
      result._artifactDigests[artifactPathKey] = computeContentDigest(result[dataKey] || result[artifactPathKey])
    }
    plog(`checkpointDesign: durable flush at gate '${gateName}'`)
    try {
      await flushPipelineStateWithSnapshot(planDir, result, config)
    } catch (e) {
      plog(`checkpointDesign: flush failed at '${gateName}' (non-blocking) — ${String(e)}`)
    }
  }

  // Surface the per-gate agent-call telemetry at terminal exits so users can see where a
  // run spent its calls/retries/escalations (and how much rode on fallbacks) without
  // reading raw pipeline-state.json.
  const logTelemetrySummary = () => {
    for (const line of renderTelemetrySummary(result.gateTelemetry, result.degradationTelemetry)) plog(line)
  }

  // Deterministic user-driven rewinds. Both are ONE-SHOT args — read from args only,
  // never persisted into config — so a later plain --resume cannot silently re-clear.
  //  - --from-gate: clear a gate + its downstream completion flags (same machinery as
  //    the goalkeeper loop-back) so those gates re-run on this invocation.
  //  - --stage: re-arm exactly one done stage (implement mode) after a manual edit.
  // Invalid values block WITHOUT consolidate: nothing ran, so the persisted state must
  // stay untouched.
  const fromGateArg = (args && args.fromGate) || ''
  if (fromGateArg) {
    const target = normalizeGateTarget(fromGateArg)
    const isDesignTarget = target === 'requirements' || target === 'architecture' || target === 'design' || target === 'plan'
    if (!target) {
      const valid = Object.keys(LOOPBACK_FLAG_MAP).join(', ')
      plog(`--from-gate: unknown gate "${fromGateArg}" (valid: ${valid}) — nothing cleared, blocking`)
      result.blockedAt = 'bad-args'
      result.handoff = { from: mode, message: `--from-gate=${fromGateArg} is not a valid gate. Valid targets: ${valid}.`, nextMode: mode, planDir }
      return result
    }
    if (isDesignTarget && isImplementMode) {
      plog(`--from-gate=${target}: design-gate rewinds are not valid in implement mode — blocking`)
      result.blockedAt = 'bad-args'
      result.handoff = { from: mode, message: `--from-gate=${target} targets a design gate. Use /design-feature --resume ${planDir} --from-gate=${target} (or /tune-feature) — implement mode cannot re-run design gates.`, nextMode: 'design', planDir }
      return result
    }
    clearGateAndDownstream(result, target)
    if (isDesignTarget) result.designReady = false // the design-stop must be re-earned
    plog(`--from-gate=${target}: cleared gate + downstream completion flags (deterministic rewind)`)
  }
  const stageArg = (args && args.stage) || ''
  if (stageArg) {
    if (!isImplementMode) {
      plog(`--stage is only valid in implement mode (mode=${mode}) — blocking`)
      result.blockedAt = 'bad-args'
      result.handoff = { from: mode, message: `--stage=${stageArg} is only valid with /implement-feature <planDir>.`, nextMode: 'implement', planDir }
      return result
    }
    if (!resetStageForRerun(result, stageArg)) {
      const known = (Array.isArray(result.stages) ? result.stages : []).map((st) => st && st.id).filter(Boolean).join(', ') || '(none)'
      plog(`--stage: unknown stage id "${stageArg}" (known: ${known}) — blocking`)
      result.blockedAt = 'bad-args'
      result.handoff = { from: mode, message: `--stage=${stageArg} does not match a stage. Known stage ids: ${known}.`, nextMode: 'implement', planDir }
      return result
    }
    plog(`--stage=${stageArg}: stage re-armed (pending); post-execute verdicts cleared — tests/review/goalkeeper re-run over the fresh diff`)
  }

  // Design-approval decision args (one-shot). Supplied by the /design-feature command after
  // it asked the user — the engine's awaiting-approval stop carries the re-invoke recipes.
  if (isDesignMode) {
    const approvalAction = applyApprovalDecision(result, {
      approve: !!(args && args.approveDesign),
      rejectToPlan: !!(args && args.rejectToPlan),
      stageEdits: (args && args.stageEdits) || '',
    })
    if (approvalAction === 'approved') {
      plog('Design approval: user approved the staged design')
    } else if (approvalAction === 'rerun-plan') {
      clearGateAndDownstream(result, 'plan')
      result.stages = [] // the stage split derives from the plan — re-chunk after re-planning
      result.designReady = false
      plog('Design approval: user rejected back to Plan — plan + downstream gates and the stage split will re-run')
    } else if (approvalAction === 'edit-stages') {
      result._stageEditRequest = String(args.stageEdits)
      result.stages = []
      result.designReady = false
      plog('Design approval: user requested stage-boundary edits — plan-chunker re-runs with the edit request')
    }
  }

  // Tune-confirmation decision args (one-shot). Supplied by the /tune-feature command
  // after it asked the user at the tune-awaiting-confirm stop.
  if (isTuneMode && args && args.cancelTune) {
    result.blockedAt = 'tune-cancelled'
    result.handoff = {
      from: 'tune',
      message: `Tune cancelled by user. Re-run /tune-feature ${planDir} when ready.`,
      nextMode: 'tune',
      planDir,
    }
    plog('Tune: user cancelled the revisit plan — stopping')
    stateCheckpoint('Tune', 'cancelled')
    await consolidate(slug, result, config)
    return result
  }
  if (isTuneMode && args && args.confirmTune) {
    result.tuneConfirmed = true
    const finalGates = Array.isArray(args.finalGates)
      ? args.finalGates.filter((g) => LOOPBACK_FLAG_MAP[g] && g !== 'tests' && g !== 'execute')
      : []
    if (finalGates.length && result.tunePlan) result.tunePlan.planGates = finalGates
    plog(`Tune: user confirmed the revisit plan${finalGates.length ? ` (finalGates=[${finalGates.join(', ')}])` : ''}`)
  }

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

      // Confirm the derived plan with the user, unless disabled or already confirmed.
      // Workflow subagents cannot use AskUserQuestion, so the engine STOPS here with the
      // re-invoke recipes; the /tune-feature command asks the user and re-invokes with
      // confirmTune (optionally finalGates) or cancelTune — applied pre-gate in main().
      // useTuneConfirm default ON (--no-confirm runs directly). On resume with
      // result.tuneConfirmed set we skip re-confirming.
      if (useTuneConfirm && !result.tuneConfirmed) {
        result.blockedAt = 'tune-awaiting-confirm'
        result.handoff = {
          from: 'tune',
          message: `Tune plan derived — awaiting your confirmation. Gates to revisit (in order): [${gatesList}]; issue refs: ${(tunePlan.issueRefs || []).join('; ') || '(none)'}; stages preserved: ${(tunePlan.preserveStages || []).join(', ') || '(none)'}. Options: run as-is → Workflow({name:'feature-pipeline', args:{mode:'tune', resume:'${planDir}', confirmTune:true}}); run an edited gate set → Workflow({name:'feature-pipeline', args:{mode:'tune', resume:'${planDir}', confirmTune:true, finalGates:['requirements'|'architecture'|'design'|'plan', …]}}); cancel → Workflow({name:'feature-pipeline', args:{mode:'tune', resume:'${planDir}', cancelTune:true}}).`,
          nextMode: 'tune',
          planDir,
          planGates: tunePlan.planGates || [],
          preserveStages: tunePlan.preserveStages || [],
        }
        plog('Tune: awaiting user confirmation of the revisit plan — stopping (re-invoke with confirmTune/cancelTune)')
        stateCheckpoint('Tune', 'awaiting-confirm')
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
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
        result.reconcile = reconcile || result.reconcile || {
          consistent: true,
          conflicts: [],
          summary: 'tune reconcile unavailable; no new conflicts reported',
        }
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
      logTelemetrySummary()
      await consolidate(slug, result, config)
      return result
    }

    // ===== Phase L: review-mode design-docset audit branch =====================
    // Review is the INSPECT flow: it collects design issues from an EXISTING docset
    // (forward-designed, extracted, or tuned) without mutating anything — no artifact
    // edits, no designReady/stage changes; fixing stays in /tune-feature. Gates:
    //   R1 lens fan-out (one reviewer per dimension, whole docset each)
    //   R2 dedup/merge (across lenses AND against already-recorded issues)
    //   R3 adversarial verify (refuted findings dropped; unavailable verdict = keep)
    //   -> design-review.md report + tune-consumable issues-and-improvements.md append.
    if (isReviewMode) {
      phase('Design Review')
      const docs = collectReviewDocs(result, planPath)
      if (!docs.length) {
        result.blockedAt = 'review-no-artifacts'
        result.handoff = {
          from: 'review',
          message: `Nothing to review — the state at ${planDir} records no design artifacts. Run /design-feature --resume ${planDir} (or /extract-design) to produce the docset first.`,
          nextMode: 'design',
          planDir,
        }
        plog('Review: state records no design artifacts — blocking')
        stateCheckpoint('Design Review', 'blocked')
        await consolidate(slug, result, config)
        return result
      }
      const lenses = resolveReviewLenses(config.reviewLenses)
      plog(`Review mode: ${docs.length} artifact(s); lenses=[${lenses.map((l) => l.key).join(', ')}]; minSeverity=${config.minSeverity}; verify=${config.useReviewVerify}`)

      // R1 — the barrier is deliberate: R2 dedups ACROSS lenses, so it needs them all.
      const lensRuns = await runReviewLenses({ lenses, docs, task, planDir, result })
      if (!lensRuns.length) {
        result.blockedAt = 'design-review'
        result.handoff = {
          from: 'review',
          message: `Design review failed — no lens reviewer returned a verdict. Re-run: /review-design ${planDir}`,
          nextMode: 'review',
          planDir,
        }
        plog('Review: every lens reviewer failed — blocking (resumable)')
        stateCheckpoint('Design Review', 'blocked')
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
      }
      const rawFindings = lensRuns.flatMap((r) => r.findings.map((f) => ({ ...f, lenses: [r.lens] })))
      plog(`Review: ${rawFindings.length} raw finding(s) from ${lensRuns.length}/${lenses.length} lens(es)`)

      // R2 + R3 only have work when something was found.
      let findings = []
      let droppedDuplicates = 0
      let refuted = 0
      if (rawFindings.length) {
        const existingIssuesText = await readIssuesFile(planDir, result)
        const merged = await mergeReviewFindings({ rawFindings, existingIssuesText, task, result })
        findings = merged.findings
        droppedDuplicates = merged.droppedDuplicates
        plog(`Review: ${findings.length} finding(s) after merge (${droppedDuplicates} duplicate(s) dropped)`)
        if (config.useReviewVerify && findings.length) {
          const verified = await verifyReviewFindings({ findings, docs, task, result })
          findings = verified.confirmed
          refuted = verified.refuted
          plog(`Review: ${findings.length} finding(s) confirmed by adversarial verification (${refuted} refuted)`)
        }
      }

      // Record the actionable subset first — gate-mapped (a "none" gate has no tune
      // target) and above the severity floor — so the report's recorded count is the
      // PERSISTED truth, not the intent (a failed append must not read as "recorded").
      const recordable = findings.filter((f) => f.gate && f.gate !== 'none' && meetsMinSeverity(f.severity, config.minSeverity))
      const recorded = await recordReviewIssues({ findings: recordable, planDir, result })
      const reviewPath = planDir + 'design-review.md'
      const reportBody = buildReviewReport({
        task, docs, lenses, findings,
        recordedCount: recorded, droppedDuplicates, refutedCount: refuted,
        minSeverity: config.minSeverity,
      })
      await writeChunkedFile(reviewPath, reportBody, 'file-writer:design-review', result,
        (n, max) => `design-review.md written in ${n} chunks (>${max} chars)`)
      result.reviewPath = reviewPath
      result.designReview = {
        lenses: lenses.map((l) => l.key),
        docsReviewed: docs.length,
        raw: rawFindings.length,
        confirmed: findings.length,
        refuted,
        droppedDuplicates,
        recorded,
        minSeverity: config.minSeverity,
      }
      // Actionable findings that could NOT be persisted: routing to tune would dead-end
      // at tune-no-issues, so block resumable at the review command instead (re-running
      // review is safe — the merge gate dedups against whatever did land in the file).
      if (recordable.length && !recorded) {
        result.blockedAt = 'review-record-failed'
        result.handoff = {
          from: 'review',
          message: `Design review found ${recordable.length} actionable finding(s) but the issues-and-improvements.md append failed — nothing was recorded for tune. Report: ${reviewPath}. Re-run: /review-design ${planDir} (re-runs are dedup-safe).`,
          nextMode: 'review',
          planDir,
          recorded: 0,
        }
        plog(`Review: issues append failed for ${recordable.length} actionable finding(s) — blocking (resumable)`)
        stateCheckpoint('Design Review', 'blocked')
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
      }
      result.handoff = recorded
        ? {
          from: 'review',
          message: `Design review complete — ${findings.length} confirmed finding(s); ${recorded} recorded to ${result.issuesPath}. Report: ${reviewPath}. Fix them with: /tune-feature ${planDir}`,
          nextMode: 'tune',
          planDir,
          recorded,
        }
        : {
          from: 'review',
          message: `Design review complete — nothing actionable recorded (${findings.length} confirmed finding(s), all gate=none or below minSeverity=${config.minSeverity}). Report: ${reviewPath}. The docset stands as-is${result.designReady ? ` — proceed with /implement-feature ${planDir}` : ''}.`,
          nextMode: result.designReady ? 'implement' : 'design',
          planDir,
          recorded: 0,
        }
      stateCheckpoint('Design Review', 'done')
      plog(`Review: complete — confirmed=${findings.length}; recorded=${recorded}; report=${reviewPath}`)
      logTelemetrySummary()
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

    // ===== Extract mode: reverse design extraction branch ======================
    // Extract climbs the abstraction ladder in reverse, per feature/subsystem slice:
    // scope -> [confirm] -> [decompose] -> per slice (facts -> e2e -> detailed design ->
    // architecture [-> fidelity review] [-> requirements] [-> audit]) -> [overview] ->
    // publish/persist -> extractReady. Artifacts reuse the forward-pipeline names so the
    // output is a /tune-feature- and /design-feature-compatible baseline. Runs AFTER
    // Translate (free-text scope input benefits from translation), never enters E4.
    if (isExtractMode) {
      // Gate X0: scope resolution — hybrid input -> concrete scope manifest. Blocking.
      if (result.scopeManifestPath) {
        plog('resume: skip Extract Scope (scopeManifestPath set)')
      } else {
        phase('Extract Scope')
        plog('Resolving extraction input into a scope manifest')
        const scope = await resolveScope({ task, planDir, result })
        if (!scope || !scope.scopePath || !(scope.files || []).length) {
          result.blockedAt = 'extract-scope'
          result.handoff = {
            from: 'extract',
            message: `Could not resolve the extraction input into a concrete code scope. Re-run /extract-design with more specific input (paths, globs, or entry points), or --resume ${planDir} after inspecting scope-manifest.md.`,
            nextMode: 'extract',
            planDir,
          }
          plog('Extract Scope: no scope resolved — blocking')
          stateCheckpoint('Extract Scope', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        result.extractScope = scope
        result.scopeManifestPath = scope.scopePath
        plog(`Extract Scope: ${scope.files.length} file(s), ${(scope.entryPoints || []).length} entry point(s), confidence=${scope.confidence || 'unspecified'}, wide=${!!scope.wide}`)
        if ((scope.ambiguities || []).length) {
          await writeOpenQuestions(planDir, scope.ambiguities.map((q) => ({ gate: 'Extract Scope', text: q, severity: 'unspecified' })), result)
        }
        stateCheckpoint('Extract Scope', 'done')
      }

      // Gate X0.5: scope confirmation — pause-and-resume checkpoint, NO agent involved.
      // Subagents spawned by the workflow cannot AskUserQuestion, so the engine returns a
      // deliberate awaiting-scope-confirm handoff (not a blockedAt error); the command layer
      // asks the user in the main session and re-invokes with the transient confirmation args
      // (scopeConfirmed / scopeFiles / slices). --no-confirm skips the pause entirely.
      if (!result.scopeConfirmed && args && args.scopeConfirmed === false) {
        result.blockedAt = 'extract-cancelled'
        result.handoff = {
          from: 'extract',
          message: `Extraction cancelled at scope confirmation. Re-run /extract-design when ready (or --resume ${planDir} to revisit this scope).`,
          nextMode: 'extract',
          planDir,
        }
        plog('Extract: user rejected the resolved scope — stopping')
        stateCheckpoint('Extract Scope', 'cancelled')
        await consolidate(slug, result, config)
        return result
      }
      if (!result.scopeConfirmed && args && args.scopeConfirmed === true) {
        if (Array.isArray(args.scopeFiles) && args.scopeFiles.length && result.extractScope) {
          result.extractScope.files = args.scopeFiles
          plog(`Extract: scope files adjusted by user (${args.scopeFiles.length} file(s))`)
        }
        result.scopeConfirmed = true
        plog('Extract: scope confirmed by user')
      }
      if (useScopeConfirm && !result.scopeConfirmed) {
        const scope = result.extractScope || {}
        result.handoff = {
          from: 'extract',
          status: 'awaiting-scope-confirm',
          message: `Scope resolved to ${(scope.files || []).length} file(s) (see ${result.scopeManifestPath}). Confirm the scope, then resume: /extract-design --resume ${planDir}`,
          nextMode: 'extract',
          planDir,
          scopeSummary: {
            files: scope.files || [],
            entryPoints: scope.entryPoints || [],
            confidence: scope.confidence || 'unspecified',
            wide: !!scope.wide,
            suggestedSlices: scope.suggestedSlices || [],
          },
        }
        plog('Extract: awaiting scope confirmation (pause-and-resume checkpoint) — returning')
        stateCheckpoint('Extract Scope', 'awaiting-confirm')
        await consolidate(slug, result, config)
        return result
      }

      // Gate X1: decompose a wide scope into slices + seed the resumable queue.
      if (!result.extractQueue.length) {
        const scope = result.extractScope || {}
        let slices = null
        if (scope.wide && useDecompose) {
          phase('Decompose')
          plog('Wide scope — decomposing into feature/subsystem slices')
          const decomposed = await safeAgent(
            `You are the arch-design-orchestrator agent. Decompose the code scope below into coherent
feature/subsystem SLICES for design extraction — each slice gets its own full design docset, so a
slice must be a unit a reader would want documented together (a feature, a subsystem, a layer).
Assign every in-scope file to exactly one slice. Note inter-slice dependencies (dependsOn) so
foundational slices are extracted first.

Scope manifest: ${result.scopeManifestPath}
Files:
${(scope.files || []).join('\n')}
${(scope.suggestedSlices || []).length ? `Suggested slices from scope resolution (validate/refine these):\n${JSON.stringify(scope.suggestedSlices, null, 2)}` : ''}

Task context: ${task}

Return slices with kebab-case ids. Do NOT modify code. Do NOT commit.`,
            { label: 'subsystem-decomposer', phase: 'Decompose', schema: DECOMPOSE_VERDICT, model: gm('decomposer') },
            result
          )
          if (decomposed && (decomposed.slices || []).length) {
            slices = decomposed.slices
            plog(`Decompose: ${slices.length} slice(s) — ${slices.map((s) => s.id).join(', ')}`)
          } else if ((scope.suggestedSlices || []).length) {
            slices = scope.suggestedSlices
            plog('Decompose: decomposer unavailable — falling back to scope-resolver suggested slices')
          } else {
            plog('Decompose: no slices derived — extracting the whole scope as one slice')
          }
          stateCheckpoint('Decompose', 'done')
        }
        result.extractQueue = seedExtractQueue(scope, slices, planDir, config.maxSlices, config.slices)
        const pending = result.extractQueue.filter((s) => s.status === 'pending').length
        const skipped = result.extractQueue.length - pending
        plog(`Extract queue seeded: ${result.extractQueue.length} slice(s), ${pending} pending${skipped ? `, ${skipped} skipped (--slices/--max-slices)` : ''}`)
        await flushPipelineState(planDir, result, config)
      }

      // A slice left 'in-progress' by an interrupted run resumes as pending — its completed
      // sub-gates are skipped via the artifact paths recorded on the queue entry.
      for (const entry of result.extractQueue) {
        if (entry.status === 'in-progress') entry.status = 'pending'
      }

      const multiSlice = result.extractQueue.length > 1
        || (result.extractQueue[0] && result.extractQueue[0].planDir !== planDir)

      // Phase 5: initialize bounded scheduler state on first entry (not on resume).
      // Budget accountant reserves non-spendable capacity for checkpoint, reconciliation,
      // synthesis, and handoff so gate work cannot starve system-critical operations.
      // Continuation state tracks monotonic segment IDs and idempotency keys.
      // Attempt history journals every retry with a terminal reason.
      if (!result.continuationState) {
        result.continuationState = createContinuationState()
      }
      if (!result.budgetAccountant) {
        const limits = createBudgetLimits({
          callCeiling: 1000,
          retryPerGate: 3,
          retryPerFeature: 10,
        })
        let acct = createBudgetAccountant(limits)
        // Reserve non-spendable capacity for each system-critical category.
        // These reserves ensure checkpoint/synthesis/handoff can always complete
        // even when gate work approaches the shared call ceiling.
        acct = setReserve(acct, RESERVE_TYPES.CHECKPOINT, 5)
        acct = setReserve(acct, RESERVE_TYPES.RECONCILIATION, 5)
        acct = setReserve(acct, RESERVE_TYPES.SYNTHESIS, 5)
        acct = setReserve(acct, RESERVE_TYPES.HANDOFF, 5)
        result.budgetAccountant = acct
      }
      if (!result.attemptHistory) {
        result.attemptHistory = createAttemptHistory()
      }
      // Phase 6: initialize synthesis and persistence tracking on first entry.
      // Synthesis state holds incrementally built project views with revision tracking.
      // Persistence tracker distinguishes attempted from durably verified writes.
      if (!result.synthesisState) {
        result.synthesisState = createSynthesisState()
      }
      if (!result.persistenceTracker) {
        result.persistenceTracker = createPersistenceTracker()
      }
      // Allocate a monotonic segment ID and declare intent for this batch.
      var segAlloc = nextSegmentId(result.continuationState)
      result.continuationState = segAlloc.state
      var currentSegmentId = segAlloc.segmentId
      var segmentFeatureIds = result.extractQueue
        .filter(function (s) { return s.status === 'pending' })
        .map(function (s) { return s.id })
      var segIntent = createSegmentIntent(
        result.continuationState, currentSegmentId, segmentFeatureIds, result.scopeManifestPath
      )
      result.continuationState = segIntent.state

      // Slice loop: one full extraction cycle per pending slice, state flushed after each
      // slice so a kill/resume continues mid-queue. A blocked slice logs and the queue moves
      // on (one slice failing to extract is information, not a reason to abandon the rest).
      let slice
      while ((slice = nextPendingSlice(result.extractQueue))) {
        if (budgetExhausted(retryBudget)) {
          result.blockedAt = 'extract-budget'
          var budgetResume = resumeCommand(planDir, currentSegmentId, result.continuationState)
          result.handoff = {
            from: 'extract',
            message: `Retry budget exhausted mid-queue (${retryState.used}/${retryBudget}). Completed slices are preserved; resume the rest: /extract-design --resume ${planDir}`,
            nextMode: 'extract',
            planDir,
            segmentId: currentSegmentId,
            segmentCounts: budgetResume.counts,
          }
          plog(`Extract: retry budget exhausted with ${result.extractQueue.filter((s) => s.status === 'pending').length} slice(s) pending — blocking (resumable)`)
          stateCheckpoint('Extract Slice', 'blocked')
          result.persistenceTracker = recordAttemptedWrite(
            result.persistenceTracker, 'extract:blocked-budget:' + planDir, 'project-index'
          )
          await consolidate(slug, result, config)
          result.persistenceTracker = verifyDurableWrite(
            result.persistenceTracker, 'extract:blocked-budget:' + planDir
          )
          return result
        }
        // Budget admission: verify the next slice can complete its gates without
        // crossing the characterized call ceiling or spending non-spendable reserve.
        var nextGateCost = { calls: 20 }
        if (!canFinishNextGate(result.budgetAccountant, nextGateCost)) {
          var adm = admitSegment(result.budgetAccountant, nextGateCost)
          result.blockedAt = 'extract-budget-ceiling'
          var ceilingResume = resumeCommand(planDir, currentSegmentId, result.continuationState)
          result.handoff = {
            from: 'extract',
            message: `Budget ceiling reached. Remaining calls: ${callsRemaining(result.budgetAccountant)} (reserve preserved). Resume: /extract-design --resume ${planDir}`,
            nextMode: 'extract',
            planDir,
            segmentId: currentSegmentId,
            segmentCounts: ceilingResume.counts,
            budget: budgetSummary(result.budgetAccountant),
          }
          plog(`Extract: budget ceiling — admission denied (${adm.reason}), blocking (resumable)`)
          stateCheckpoint('Extract Slice', 'blocked')
          result.persistenceTracker = recordAttemptedWrite(
            result.persistenceTracker, 'extract:blocked-ceiling:' + planDir, 'project-index'
          )
          await consolidate(slug, result, config)
          result.persistenceTracker = verifyDurableWrite(
            result.persistenceTracker, 'extract:blocked-ceiling:' + planDir
          )
          return result
        }
        slice.status = 'in-progress'
        const single = slice.planDir === planDir
        plog(`Extract: slice ${slice.id} (${slice.name}) — ${single ? 'flat layout' : slice.planDir}`)
        const sliceState = single ? result : {
          task: `${task} — slice: ${slice.name}`,
          slug: `${slug}-${slice.id}`,
          planPath: slice.planDir + 'plan.md',
          planDir: slice.planDir,
          mode: 'design',
          stages: [],
          designReady: false,
          issuesPath: null,
          handoff: null,
          blockedAt: null,
          logLines: [],
          _state: { seq: 0, lastGate: 'Extract', status: null },
          factsPath: (slice.artifacts && slice.artifacts.factsPath) || null,
          useCasePath: (slice.artifacts && slice.artifacts.useCasePath) || null,
          designPath: (slice.artifacts && slice.artifacts.designPath) || null,
          archPath: (slice.artifacts && slice.artifacts.archPath) || null,
          requirementsPath: (slice.artifacts && slice.artifacts.requirementsPath) || null,
          auditPath: (slice.artifacts && slice.artifacts.auditPath) || null,
          _reviewedDesign: !!(slice.artifacts && slice.artifacts.reviewed),
          _reviewedArch: !!(slice.artifacts && slice.artifacts.reviewed),
          lifecycle: 'in-progress',
          _gateCheckpoints: {},
        }
        let outcome
        try {
          // For multi-slice runs, spawn the leaf via Workflow() composition (one level,
          // no recursion). The leaf processes exactly one feature in its own sandbox;
          // the top-level retains all scheduling/readiness authority. Fallback to direct
          // call for single-slice runs or when Workflow is unavailable (test harness).
          if (typeof Workflow === 'function' && !single && Workflow.name !== '') {
            const leafResult = await Workflow({
              name: 'fp-extract-slice',
              args: { slice, task, config, sliceState, retryBudget, refineSubcap, decisionCap },
            })
            if (leafResult && leafResult.status) {
              outcome = { status: leafResult.status, gate: leafResult.gate }
              if (leafResult.sliceState) Object.assign(sliceState, leafResult.sliceState)
              if (leafResult.logLines) for (const line of leafResult.logLines) plog(line)
            } else {
              outcome = await extractSlice({ slice, task, result, sliceState, config, retryBudget, refineSubcap, decisionCap })
            }
          } else {
            outcome = await extractSlice({ slice, task, result, sliceState, config, retryBudget, refineSubcap, decisionCap })
          }
        } catch (e) {
          outcome = { status: 'blocked', gate: 'uncaught-throw' }
          plog(`Extract: slice ${slice.id} threw (${String(e)}) — marking blocked and continuing`)
        }
        slice.artifacts = {
          factsPath: sliceState.factsPath || null,
          useCasePath: sliceState.useCasePath || null,
          designPath: sliceState.designPath || null,
          archPath: sliceState.archPath || null,
          requirementsPath: sliceState.requirementsPath || null,
          auditPath: sliceState.auditPath || null,
          issuesPath: sliceState.issuesPath || null,
          reviewed: !!sliceState._reviewedDesign,
        }
        slice.status = outcome.status === 'done' ? 'done' : 'blocked'
        // Phase 5: record the attempt in the durable history journal.
        // Success records a terminal-success entry; failure records the outcome
        // and reason so exhausted retries are never reclassified as completed.
        var attemptOutcome = outcome.status === 'done'
          ? ATTEMPT_OUTCOMES.SUCCESS
          : (outcome.gate === 'uncaught-throw' ? ATTEMPT_OUTCOMES.RETRYABLE_FAILURE : ATTEMPT_OUTCOMES.INVALID_OUTPUT)
        result.attemptHistory = recordAttempt(
          result.attemptHistory, slice.id, outcome.gate || 'extract', attemptOutcome, outcome.status !== 'done' ? ('blocked at ' + outcome.gate) : null
        )
        // Phase 5: spend budget for the completed gate work.
        result.budgetAccountant = spendBudget(result.budgetAccountant, 10, 0)
        if (outcome.status !== 'done') {
          slice.blockedGate = outcome.gate
          // Isolate the failure: only this slice is affected; independent work continues.
          result.extractQueue = isolateFailure(result.extractQueue, slice.id, 'blocked')
          plog(`Extract: slice ${slice.id} blocked at ${outcome.gate} — isolated; continuing with remaining slices`)
        } else {
          plog(`Extract: slice ${slice.id} done`)
        }
        if (!single) {
          // Slice-local pipeline-state.json: a design-shaped result so /tune-feature <sliceDir>
          // and /design-feature --resume <sliceDir> can consume the slice as a baseline.
          sliceState.designReady = outcome.status === 'done'
          await flushPipelineState(slice.planDir, sliceState, {
            mode: 'design',
            profile: config.profile,
            useChunker: false,
          })
        }
        stateCheckpoint('Extract Slice', slice.status)
        await flushPipelineState(planDir, result, config)
      }

      // Phase 5: acknowledge the segment completion with exact counts.
      // The monotonic segment ID plus idempotency key ensures duplicate, lost,
      // or out-of-order launches converge to one durable outcome.
      var segCounts = segmentOutcome(result.extractQueue)
      var segKey = idempotencyKey(currentSegmentId, segmentFeatureIds, result.scopeManifestPath)
      var segAck = acknowledgeSegment(
        result.continuationState, currentSegmentId, segKey,
        segCounts.completed > 0 ? 'partial' : 'no-progress', segCounts
      )
      result.continuationState = segAck.state

      // Phase 6: synthesize project views from verified feature summaries.
      // Incremental: only changed inputs trigger view rebuilds; idempotent.
      var featureSummaries = result.extractQueue.map(function (s) {
        return {
          id: s.id,
          name: s.name,
          lifecycle: s.status === 'done' ? 'completed' : (s.status === 'blocked' ? 'blocked' : 'deferred'),
          artifacts: s.artifacts || {},
          dependencies: s.dependencies || [],
          crossCuttingConcerns: s.crossCuttingConcerns || [],
        }
      })
      result.synthesisState = synthesizeProjectViews(
        featureSummaries, result.synthesisState,
        { scope: result.scopeManifestPath || null, graph: result.scopeManifestPath || null }
      )
      plog('Extract: synthesis — ' + (result.synthesisState.synthesized ? 'views rebuilt' : 'no change') +
        ', coverage denominator: ' + (result.synthesisState.views.coverageIndex ? result.synthesisState.views.coverageIndex.denominator : 0))

      // Gate X8: system overview (multi-slice only, non-blocking).
      if (multiSlice && !result.overviewPath) {
        phase('System Overview')
        await writeSystemOverview({ parentPlanDir: planDir, queue: result.extractQueue, task, result })
        stateCheckpoint('System Overview', 'done')
      }

      // Publish + persist tails (reuse the design-terminal pattern; both non-blocking).
      try {
        if (usePublish && !result.published) {
          phase('Publish')
          plog('Extract: publishing extracted design docs')
          await publishDesign(result, result.overviewPath || result.archPath || result.scopeManifestPath, task)
          stateCheckpoint('Publish', 'done')
        }
        if (useKnowledgePersist && !result.persist) {
          phase('Persist')
          plog('Extract: persisting findings')
          await persistFindings(result)
          stateCheckpoint('Persist', 'done')
        }
      } catch (e) {
        plog('Extract: non-blocking Publish/Persist threw — caught, continuing to terminal. ' + String(e))
      }

      // Extract terminal: verify each done slice's mandated artifacts actually exist, then
      // advertise extractReady. designReady is set ONLY for a single-slice run (the parent
      // state must not claim one design for N slices — slice-local states carry per-slice
      // designReady for the multi-slice layout).
      const doneSlices = result.extractQueue.filter((s) => s.status === 'done')
      const failedArtifactChecks = []
      for (const entry of doneSlices) {
        const mandated = [
          { key: 'codebase-facts', path: entry.artifacts && entry.artifacts.factsPath, flag: true },
          { key: 'e2e-use-cases', path: entry.artifacts && entry.artifacts.useCasePath, flag: config.useE2eUsecase },
          { key: 'detailed-design', path: entry.artifacts && entry.artifacts.designPath, flag: config.useDetailedDesign },
          { key: 'architecture', path: entry.artifacts && entry.artifacts.archPath, flag: config.useArchDesign },
        ]
        for (const artifact of mandated.filter((a) => a.flag && a.path)) {
          const checked = await verifyArtifactPresence({ path: artifact.path, gate: `Extract:${entry.id}`, expectedHeadings: ['#'], result })
          if (!checked.exists || checked.sizeBytes <= 0 || checked.hasExpectedHeadings === false) {
            failedArtifactChecks.push({ slice: entry.id, key: artifact.key, path: artifact.path, summary: checked.summary })
          }
        }
        const missing = mandated.filter((a) => a.flag && !a.path)
        for (const artifact of missing) {
          failedArtifactChecks.push({ slice: entry.id, key: artifact.key, path: null, summary: 'gate produced no path' })
        }
      }
      if (failedArtifactChecks.length || !doneSlices.length) {
        result.blockedAt = 'artifact-missing'
        result.artifactChecks = failedArtifactChecks
        result.handoff = {
          from: 'extract',
          message: doneSlices.length
            ? `Extraction artifact verification failed for ${failedArtifactChecks.length} artifact(s). Inspect them, then resume: /extract-design --resume ${planDir}`
            : `No slice completed extraction (${result.extractQueue.filter((s) => s.status === 'blocked').length} blocked). Inspect pipeline.log, then resume: /extract-design --resume ${planDir}`,
          nextMode: 'extract',
          planDir,
        }
        plog(`Extract: terminal verification failed — doneSlices=${doneSlices.length}; failedChecks=${failedArtifactChecks.length}`)
        stateCheckpoint('Extract', 'blocked')
        result.persistenceTracker = recordAttemptedWrite(
          result.persistenceTracker, 'extract:artifact-missing:' + planDir, 'project-index'
        )
        await consolidate(slug, result, config)
        result.persistenceTracker = verifyDurableWrite(
          result.persistenceTracker, 'extract:artifact-missing:' + planDir
        )
        return result
      }

      // Phase 6: truthful readiness derivation. extractReady is true ONLY when
      // discovery is exhausted, graph is valid, every in-scope feature is verified
      // complete, synthesis is current, and required artifacts are current.
      phase('Extract')
      var extractProjectState = {
        discoveryExhausted: true,
        graphValid: !failedArtifactChecks.length,
        features: result.extractQueue.map(function (s) {
          return {
            id: s.id,
            lifecycle: s.status === 'done' ? 'completed' : (s.status === 'blocked' ? 'blocked' : 'deferred'),
          }
        }),
        synthesisCurrent: isSynthesisCurrent(result.synthesisState, {
          scope: result.scopeManifestPath || null,
          graph: result.scopeManifestPath || null,
        }),
        artifactsCurrent: !failedArtifactChecks.length,
      }
      var readiness = deriveExtractReadiness(extractProjectState)
      result.extractReady = readiness.ready
      result.readinessReason = readiness.reason
      if (!multiSlice) result.designReady = readiness.ready
      const blockedCount = result.extractQueue.filter((s) => s.status === 'blocked').length
      const skippedCount = result.extractQueue.filter((s) => s.status === 'skipped').length

      // Phase 6: build the immutable status projection shared by handoff and status.
      // Both surfaces report identical denominator, lifecycle outcomes, revisions,
      // budgets, failures, readiness proof, and continuation evidence.
      result.statusProjection = projectStatusProjection({
        planDir: planDir,
        scopeManifestPath: result.scopeManifestPath || null,
        discoveryExhausted: extractProjectState.discoveryExhausted,
        graphValid: extractProjectState.graphValid,
        features: extractProjectState.features,
        synthesisCurrent: extractProjectState.synthesisCurrent,
        artifactsCurrent: extractProjectState.artifactsCurrent,
        revisions: { scope: result.scopeManifestPath || null },
        budget: budgetSummary(result.budgetAccountant),
        failures: (result.attemptHistory && result.attemptHistory.entries
          ? result.attemptHistory.entries.filter(function (e) { return e.outcome !== 'success' })
          : []),
        continuation: continuationSummary(result.continuationState),
      })

      result.handoff = {
        from: 'extract',
        nextMode: 'tune',
        planDir,
        slices: result.extractQueue.map((s) => ({ id: s.id, name: s.name, planDir: s.planDir, status: s.status })),
        segments: continuationSummary(result.continuationState),
        budget: budgetSummary(result.budgetAccountant),
        persistence: persistenceReport(result.persistenceTracker),
        readiness: readinessSummary(result.statusProjection),
        message: multiSlice
          ? `Extraction complete: ${doneSlices.length} slice(s) documented under ${planDir}slices/ (overview: ${result.overviewPath || '(none)'})${blockedCount ? `; ${blockedCount} blocked` : ''}${skippedCount ? `; ${skippedCount} skipped — resume later with --slices` : ''}. Per slice: audit findings are in issues-and-improvements.md — run /tune-feature <sliceDir> to fix, or /design-feature --resume <sliceDir> to build on the baseline.`
          : `Extraction complete. As-is design docs are in ${planDir}. Audit findings (if any) are in issues-and-improvements.md — run /tune-feature ${planDir} to fix them, or /design-feature --resume ${planDir} to build on the baseline.`,
      }
      stateCheckpoint('Extract', 'done')
      plog(`Extract: extractReady=${readiness.ready} (${readiness.reason}) — ${doneSlices.length} done, ${blockedCount} blocked, ${skippedCount} skipped`)

      // Phase 6: track the durable consolidate write through the persistence tracker.
      result.persistenceTracker = recordAttemptedWrite(
        result.persistenceTracker, 'extract:consolidate:' + planDir, 'project-index'
      )
      await consolidate(slug, result, config)
      result.persistenceTracker = verifyDurableWrite(
        result.persistenceTracker, 'extract:consolidate:' + planDir
      )
      return result
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

    if (gateModeActive('design', mode)) {
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
    await checkpointDesign('define', 'definitionPath')

    }

  // Decide execution path: explicit gsdQuick arg wins, else honor the define
  // recommendation persisted on result (so resume routes the same way).
  // Phase F-K: gsd-quick is an ALTERNATE EXECUTOR, so it belongs to implement mode only.
  // In design/tune mode the fast-path is suppressed (design stops pre-execute; tune never
  // executes). A define recommendation of gsd-quick is remembered on result so implement
  // mode (which runs later via /implement-feature) can still take it.
  const useQuickPath = isImplementMode && (gsdQuick || result.recommendedPath === 'gsd-quick')

  {
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
      await checkpointDesign('knowledge')
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
      await checkpointDesign('codebase-facts', 'factsPath')
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
      await checkpointDesign('e2e-use-cases', 'useCasePath')
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
      await checkpointDesign('requirements', 'requirementsPath')
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
      await checkpointDesign('requirements-review')
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
        await checkpointDesign('arch-review')
      }
      stateCheckpoint('Architecture', 'done')
      await checkpointDesign('architecture', 'archPath')
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
      await checkpointDesign('detailed-design', 'designPath')
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
      await checkpointDesign('design-review')
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
      // Restore result.planPath if a resume repair nulled it (missing plan file): consolidate
      // gates its state/log flush on result.planPath, so leaving it null would silently stop
      // persistence for the rest of the run.
      if (!result.planPath) result.planPath = plan.planPath || planPath
      plog(`Plan: plan written to ${plan.planPath}; lanes=${(plan.lanes || []).length}`)
    }
    stateCheckpoint('Plan', 'done')
    await checkpointDesign('plan', 'planPath')

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
      await checkpointDesign('tdd-enforce')
    }

    // Gate 1.7: Reconcile design vs plan (adopted agent, NON-BLOCKING) ------
    // Compares the plan against the arch/detailed-design/e2e artifacts. Conflicts
    // are surfaced to the review gate and to persist, but reconcile never blocks:
    // a gap is information, not a hard error.
    let reconcileContext = ''
    if (result.reconcile) {
      plog('resume: skip Reconcile (reconcile set)')
      reconcileContext = result.reconcile.conflicts && result.reconcile.conflicts.length
        ? `Reconcile conflicts to re-check: ${compactList(result.reconcile.conflicts, 8)}\n`
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
        ? `Reconcile conflicts (address in review): ${compactList(result.reconcile.conflicts, 8)}\n`
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
             && reconcileIterations < reconcileSubcap && !loopBudgetExhausted(loopBudgets, 'reconcile')) {
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
              lastFailure: `Reconcile design-fix loop still flags the DESIGN at fault after ${reconcileIterations} fix iteration(s). Remaining design defects: ${compactList(result.reconcile.designFixes || [], 8)}`,
            },
          })
          if (decide === 'stop') {
            plog('Reconcile: quick-decider said stop — carrying design conflict forward into review')
            break
          }
        }
        loopBudgets = spendLoop(loopBudgets, 'reconcile')
        reconcileIterations += 1
        plog(`Reconcile: design at fault — fixing architecture (${result.reconcile.designFixes.length} defect(s); fix ${reconcileIterations}/${reconcileSubcap}, loop budget ${loopBudgets.reconcile.used}/${loopBudgets.reconcile.cap})`)
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
            failureContext: `Reconcile design-fix iteration ${reconcileIterations}: prior architecture fix did not resolve conflicts. Remaining design defects: ${compactList(result.reconcile.designFixes, 8)}`,
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
          ? `Reconcile conflicts (address in review): ${compactList(result.reconcile.conflicts, 8)}\n`
          : ''
        plog(`Reconcile: re-check consistent=${result.reconcile.consistent}; designAtFault=${!!result.reconcile.designAtFault}`)
        if (result.reconcile.consistent) break
      }
      if (result.reconcile.designAtFault) {
        const reason = loopBudgetExhausted(loopBudgets, 'reconcile')
          ? `reconcile loop budget exhausted (${loopBudgets.reconcile.used}/${loopBudgets.reconcile.cap})`
          : `reconcile sub-cap reached (${reconcileIterations}/${reconcileSubcap})`
        plog(`Reconcile: design-fix loop stopped — ${reason}; carrying conflict forward`)
      }
      stateCheckpoint('Reconcile', 'done')
      await checkpointDesign('reconcile')
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
      while (!reviewState.accepted && refineCount < refineSubcap && !loopBudgetExhausted(loopBudgets, 'refine')) {
        phase('Review/Refine')
        plog(`Review iteration ${refineCount + 1} (refine loop budget ${loopBudgets.refine.used}/${loopBudgets.refine.cap})`)
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
        loopBudgets = spendLoop(loopBudgets, 'refine')
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
              lastFailure: `Plan review rejected after ${refineCount} refine iteration(s). Outstanding blockers: ${compactList(review.blockers || [], 8)}`,
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
${compactList(review.blockers, 8)}`
        if (refineCount > 0) {
          refinePrompt = await enhancePrompt({
            gateKey: 'plan-refine',
            basePrompt: refinePrompt,
            failureContext: `Prior refine iteration still rejected; review blockers not fully addressed. Review blockers: ${compactList(review.blockers, 8)}`,
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
        if (loopBudgetExhausted(loopBudgets, 'escalation')) {
          result.blockedAt = 'review'
          result.retryUsed = retryState.used
          stateCheckpoint('Review/Refine', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        phase('Review/Refine')
        plog('Refine sub-cap reached — escalating to final reviewer')
        // Escalation agent: retry up to escalationCap times with a hardened prompt before
        // giving up. A schema/JSON throw (safeAgent -> null) on the final plan-review gate must NOT
        // silently force-accept an unreviewed plan — exhaust retries, then hard-block (resumable).
        // DLOOP-01: escalationCap is configurable via args.maxEscalationRetries (was hardcoded 5).
        // DYAGNI-01: ensure BLOCKER-severity YAGNI findings reach the escalation reviewer
        // even when reconcile was disabled (TDD Enforce routes them into reconcile.conflicts).
        var yagniBlockerContext = ''
        if (result.reconcile && result.reconcile.conflicts) {
          var yagniBlockers = result.reconcile.conflicts.filter(function (c) { return /\[YAGNI BLOCKER\]/.test(String(c)) })
          if (yagniBlockers.length) yagniBlockerContext = `\nYAGNI BLOCKER findings (must be addressed):\n${compactList(yagniBlockers, 8)}\n`
        }
        const escalatePrompt = (attempt) => `You are the FINAL escalation reviewer. Prior review rounds rejected this plan; the blockers they
raised are below. Reclassify EACH: is it a TRUE plan defect (missing scope/spec/ordering/risk) or an
IMPLEMENTATION-DETAIL (call-site wiring, individual yield/construction sites, mechanics that belong to
the executor)? Only TRUE defects block a plan; implementation-detail is an implementer note carried to
the executor.

Plan: ${planPath}
Definition: ${result.definitionPath}
Task: ${task}

Prior blockers:
${compactList((reviewState && reviewState.blockers) || [], 8)}${yagniBlockerContext}

Set accepted=true if no TRUE defects remain. Set forceAcceptable=true if every remaining blocker is
implementation-detail. List trueDefects (genuine plan defects) and implNotes (implementer-detail) separately.${
          attempt > 1
            ? `

IMPORTANT (retry ${attempt}/${escalationCap}): A prior response failed JSON/schema validation.
Respond with STRICT valid JSON ONLY — no markdown, no code fences, no commentary. Keep every array and
object well-formed and within the schema. If unsure, return accepted=false with empty arrays rather than
malformed output.`
            : ''
        }`
        let escalation = null
        for (let attempt = 1; attempt <= escalationCap; attempt++) {
          // Phase E2: on schema-recovery retries (attempt > 1, prior escalation returned null),
          // ask quick-decider whether more JSON-format retries are worth it. 'stop' bails to the
          // hard-block path below (escalation stays null). null -> stop.
          if (useQuickDecider && attempt > 1) {
            const decide = await runQuickDecider({
              result, planDir, model: gm('quickDecider'), decisionCap,
              opts: {
                loopName: 'escalation',
                iterations: attempt - 1,
                subcap: escalationCap,
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
              failureContext: `Escalation agent returned malformed JSON / null on prior attempt (attempt ${attempt}/${escalationCap}). Need strict valid JSON conforming to ESCALATION_REVIEW schema.`,
              intent: 'tighten-format',
              result, planDir, useEnhancer,
            })
          }
          escalation = await safeAgent(
            attemptPrompt,
            { label: 'critical-reviewer(escalation)', phase: 'Review/Refine', schema: ESCALATION_REVIEW, model: gm('reviewEscalation') }, result
          )
          loopBudgets = spendLoop(loopBudgets, 'escalation')
          if (escalation != null) break
          plog(`Escalation agent failed (attempt ${attempt}/${escalationCap}) — retrying with hardened prompt`)
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
          plog(`Escalation failed after ${escalationCap} retries — hard-block (resumable via --resume)`)
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
          recordDegradationEvent(result, 'fail-forward', 'Review/Refine', 'escalation', 'force-accepted plan with ' + result.carriedBlockers.length + ' carried blocker(s)')
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
    await checkpointDesign('review-refine')

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
        await checkpointDesign('chunk-plan')
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
          // DTERM-01: distinguish attempted from durably verified publish outcome.
          result._publishVerified = !!(result.published && result.published.published)
          stateCheckpoint('Publish', 'done')
        }
        if (useKnowledgePersist && !result.persist) {
          phase('Persist')
          plog('Design mode: persisting findings before design-stop')
          await persistFindings(result)
          // DTERM-01: distinguish attempted from durably verified persist outcome.
          result._persistVerified = !!(result.persist && result.persist.persisted)
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
        { key: 'idea', path: result.definitionPath, gate: 'Define', flag: true, expectedHeadings: ['#'] },
        { key: 'requirements', path: result.requirementsPath, gate: 'Requirements', flag: useRequirements, expectedHeadings: ['#'] },
        { key: 'architecture', path: result.archPath, gate: 'Architecture', flag: useArchDesign, expectedHeadings: ['#'] },
        { key: 'detailed-design', path: result.designPath, gate: 'Detailed Design', flag: useDetailedDesign, expectedHeadings: ['#'] },
        { key: 'plan', path: result.planPath, gate: 'Plan', flag: true, expectedHeadings: ['#', 'Stage', 'TODO'] },
        { key: 'stages', path: (result.stages || []).length ? 'present' : null, gate: 'Chunk Plan', flag: useChunker },
      ]
      const missingArtifacts = mandatedArtifacts.filter((a) => a.flag && !a.path)
      const failedArtifactChecks = []
      for (const artifact of mandatedArtifacts.filter((a) => a.flag && a.path && a.path !== 'present')) {
        const checked = await verifyArtifactPresence({
          path: artifact.path,
          gate: artifact.gate,
          expectedHeadings: artifact.expectedHeadings || [],
          result,
        })
        if (!checked.exists || checked.sizeBytes <= 0 || checked.hasExpectedHeadings === false) {
          failedArtifactChecks.push({ artifact, checked })
        }
      }
      if (missingArtifacts.length) {
        const msg = `designWarnings: ${missingArtifacts.length} mandated artifact(s) produced no path: ${missingArtifacts.map((a) => `${a.key}(${a.gate})`).join(', ')}`
        plog(msg)
        result.designWarnings.push(msg)
      }
      if (missingArtifacts.length || failedArtifactChecks.length) {
        result.blockedAt = 'artifact-missing'
        result.artifactChecks = failedArtifactChecks.map(({ artifact, checked }) => ({
          key: artifact.key,
          path: artifact.path,
          gate: artifact.gate,
          exists: checked.exists,
          sizeBytes: checked.sizeBytes,
          hasExpectedHeadings: checked.hasExpectedHeadings,
          summary: checked.summary,
        }))
        plog(`Design mode: artifact verification failed — missing=${missingArtifacts.length}; invalid=${failedArtifactChecks.length}`)
        stateCheckpoint('Design', 'blocked')
        await consolidate(slug, result, config)
        return result
      }

      // Human design-approval checkpoint (--approval). Workflow subagents cannot use
      // AskUserQuestion, so the engine stops here with the literal re-invoke recipes;
      // the /design-feature command asks the user and re-invokes with the decision.
      // No budget is spent on approval round-trips.
      if (useApproval && !(result.designApproved && result.designApproved.approved)) {
        phase('Design')
        result._designBudget = designBudgetSummary(designBudget)
        result._loopBudgets = loopBudgetSummary(loopBudgets)
        result.designReady = true // the artifacts ARE ready; only the human sign-off is pending
        result.approvalPending = true
        result.blockedAt = 'awaiting-approval'
        const stageList = (result.stages || []).map((st) => `${st.id}: ${st.name}`).join('; ') || '(no stages)'
        result.handoff = {
          from: 'design',
          message: `Design ready — awaiting your approval. Stages: ${stageList}. Options: approve as-is → Workflow({name:'feature-pipeline', args:{mode:'design', resume:'${planDir}', approveDesign:true}}); edit stage boundaries → Workflow({name:'feature-pipeline', args:{mode:'design', resume:'${planDir}', stageEdits:'<describe the boundary changes>'}}); reject back to Plan → Workflow({name:'feature-pipeline', args:{mode:'design', resume:'${planDir}', rejectToPlan:true}}).`,
          nextMode: 'design',
          planDir,
          approvalOptions: ['approve', 'edit-stages', 'reject-to-plan'],
          stages: (result.stages || []).map((st) => ({ id: st.id, name: st.name })),
        }
        stateCheckpoint('Design', 'awaiting-approval')
        plog('Design mode: awaiting human approval (designReady=true, approvalPending=true) — stopping')
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
      }

      phase('Design')
      // DREADY-01: truthful design readiness — designReady must reflect actual gate outcomes.
      // Check for hidden degradation (fail-forwarded reviews, force-accepted blockers,
      // unresolved reconcile conflicts) before advertising readiness.
      var designReadiness = deriveDesignReadiness(result)
      // DQUEST-01: unresolved open questions block completion unless explicitly deferred.
      if (result.openQuestionsPath && !(result._openQuestionsDeferred || []).length) {
        designReadiness = {
          ready: false,
          reason: 'unresolved-open-questions',
          degradation: (designReadiness.degradation || []).concat([{ type: 'unresolved-open-questions', path: result.openQuestionsPath }]),
        }
      }
      if (!designReadiness.ready) {
        result.designReady = false
        result.designReadinessBlocker = designReadiness.reason
        result.designReadinessDegradation = designReadiness.degradation
        var degrSummary = designReadiness.degradation.map(function (d) { return d.type }).join(', ')
        result.handoff = {
          from: 'design',
          message: `Design NOT ready — degraded: ${degrSummary}. Resolve the flagged issues and re-run: /design-feature --resume ${planDir}`,
          nextMode: 'design',
          planDir,
          degradationDetail: designReadiness.degradation,
          degradationLog: result._degradationLog || [],
        }
        stateCheckpoint('Design', 'degraded')
        plog(`Design mode: NOT ready — ${degrSummary}`)
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
      }
      result.designReady = true
      // DBUDGET-01 / DLOOP-01: record budget summaries for handoff/status inspection.
      result._designBudget = designBudgetSummary(designBudget)
      result._loopBudgets = loopBudgetSummary(loopBudgets)
      // DCHUNK-01: surface chunker degradation as an explicit acknowledged outcome.
      var chunkerWarning = result._chunkerDegraded && !result._chunkerDegradationAcknowledged
        ? ' WARNING: plan chunker degraded to a single stage — stage-level parallelism and resumability are lost.'
        : ''
      // DHIST-01: include degradation log summary in handoff for inspection.
      var degrLogSummary = degradationLogSummary(result._degradationLog)
      var degrLine = degrLogSummary ? ` Degradation events: ${degrLogSummary}.` : ''
      result.handoff = {
        from: 'design',
        message: `Design ready${result.designApproved && result.designApproved.approved ? ' (user-approved)' : ''}. Plan + artifacts are in ${planDir}. Review them, then run: /implement-feature ${planDir}.${chunkerWarning}${degrLine}`,
        nextMode: 'implement',
        planDir,
        degradationLog: result._degradationLog || [],
        chunkerDegraded: !!result._chunkerDegraded,
      }
      stateCheckpoint('Design', 'done')
      plog(`Design mode: designReady=true — stopping pre-execute (stages=${result.stages.length})`)
      logTelemetrySummary()
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
    // Approval-gated designs (config.useApproval persisted from the design run) must be
    // signed off before implement executes. Absent fields (state from a run without the
    // approval checkpoint) leave this guard a no-op.
    if (isImplementMode && useApproval && result.approvalPending) {
      result.blockedAt = 'design-not-approved'
      result.handoff = {
        from: 'implement',
        message: `Design awaits your approval. Run /design-feature --resume ${planDir} to answer the approval question (approve / edit stages / reject to plan), then re-run /implement-feature ${planDir}.`,
        nextMode: 'design',
        planDir,
      }
      plog('Implement mode: approvalPending=true — blocking (complete the design approval first)')
      stateCheckpoint('Execute', 'blocked')
      await consolidate(slug, result, config)
      return result
    }

    if (isImplementMode && useTestWriter) {
      if (result.testsWritten) {
        plog('resume: skip Test Authoring (testsWritten set)')
      } else {
        phase('Test Authoring')
        plog('Authoring tests before implementation')
        const authored = await safeAgent(
          `You are the test-writer agent. Write the RED/coverage tests required before implementation.

Task:
${task}

Artifacts:
- Definition: ${result.definitionPath || '(none)'}
- Requirements: ${result.requirementsPath || '(none)'}
- E2E use cases: ${result.useCasePath || '(none)'}
- Architecture: ${result.archPath || '(none)'}
- Detailed design: ${result.designPath || '(none)'}
- Plan: ${planPath}
- Stages: ${compactList((result.stages || []).map((stage) => `${stage.id}: ${stage.file}`), 12)}

Use the target project's existing test framework and conventions. Prefer RED tests that fail for the
missing behavior; if equivalent coverage already exists, report it as evidence instead of duplicating.
Do NOT weaken, skip, or delete existing tests. Do NOT commit. Return written=true only when the needed
tests were created or existing coverage was verified.`,
          { label: 'test-writer', phase: 'Test Authoring', schema: TEST_AUTHORING_VERDICT, model: gm('testWriter') },
          result
        )
        if (!authored || !authored.written) {
          result.blockedAt = 'test-authoring'
          result._testWriter = authored
          result.testWriterSummary = authored && authored.summary
          stateCheckpoint('Test Authoring', 'blocked')
          await consolidate(slug, result, config)
          return result
        }
        result.testsWritten = true
        result._testWriter = authored
        result.testWriterSummary = authored.summary
        plog(`Test Authoring: written=${authored.written}; files=${(authored.files || []).length}; summary=${authored.summary || '(none)'}`)
      }
      stateCheckpoint('Test Authoring', 'done')
      await checkpointDesign('test-authoring')
    } else if (isImplementMode && !useTestWriter) {
      stateCheckpoint('Test Authoring', 'skipped')
    }

    // Gate 3: Execute (plan-driven stages — parallel when file-disjoint) ----
    // Phase I: stages are the progress unit. We execute each non-done stage in dependency order,
    // ticking stageNN.md status (pending -> in-progress -> done) + result.stages[i].status. Intra-stage
    // parallelism reuses the lane fan-out, scoped to ONE stage's files. Design mode never reaches here
    // (its terminal gate returned pre-execute). On resume, done stages are skipped via their status.
    // A single implicit stage (--no-chunker, or pre-chunker runs) keeps the legacy whole-plan execute.
    if (useQuickPath) {
      result.gsdQuick = true
      result.planAccepted = true
      if (result.executed) {
        plog('resume: skip gsd-quick fast-path (executed set)')
      } else {
        phase('Execute')
        plog('gsd-quick fast-path: implementing via gsd-quick skill')
        const gsdRun = await safeAgent(
          `You are running inside feature-pipeline. Invoke the "gsd-quick" skill via your Skill tool
to implement this task end-to-end (plan + execute + test):

Task:
${task}

Definition doc: ${result.definitionPath || definitionPath}
Plan dir: ${planPath.replace(/plan\.md$/, '')}

Adhere to the pass gates in the definition doc. Do NOT commit. Do NOT weaken tests.
If the gsd-quick skill or the Skill tool is unavailable, implement directly following
the definition pass gates and set usedFallback=true. Report what was implemented and the
test outcome you observed.`,
          { label: 'gsd-quick', phase: 'Execute', schema: GSD_RUN_VERDICT, model: gm('gsdQuick') },
          result
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
    } else if (gateDone('executed')) {
      // skip — executed already set
    } else {
      phase('Execute')
      const stages = result.stages && result.stages.length
        ? result.stages
        : [{ id: 'stage01', file: planDir + 'stage01.md', name: 'Whole plan', status: 'pending', files: (result.lanes || []).flatMap((l) => l.files || []) }]
      // BF-4: when falling back to the implicit single stage, assign it back so stage
      // status is persisted (the result.stages[si] syncs below aren't silently skipped).
      if (!result.stages || !result.stages.length) result.stages = stages
      // IM-3: compact the (potentially long) carried-blocker list instead of dumping the
      // full JSON into every executor prompt. The on-disk decisions.md holds the full record.
      const carriedBlockersLine = result.carriedBlockers && result.carriedBlockers.length
        ? `Carried-forward blockers from force-accept (address specifically):\n${compactList(result.carriedBlockers, 8)}`
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
            safeAgent(
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
              { label: `plan-executor:${stage.id}:${lane.name}`, phase: 'Execute', schema: EXECUTE_VERDICT, model: gm('execute') },
              result
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
        // EN-5: enforce lane/stage ownership on ACTUAL touched files (not just declared
        // disjointness). Build the work units — parallel lanes if fanned out, else the whole
        // stage — from the files each unit reported touching vs the files it owns, and record
        // any strays (touched outside ownership) or cross-lane clobbers. Non-blocking: the
        // executor's file list is self-reported, so we surface overlaps as warnings rather than
        // hard-fail (a git-status-backed hard gate is deferred — see RB-8).
        const ownershipUnits = useLanes
          ? scopedLanes.map((lane) => {
              const outcome = (exec._laneVerdicts || []).find((o) => o.lane === lane.name)
              return { name: `${stage.id}:${lane.name}`, owned: lane.files || [], touched: (outcome && outcome.files) || [] }
            })
          : [{ name: stage.id, owned: stage.files || [], touched: exec.files || [] }]
        const violations = detectOwnershipViolations(ownershipUnits)
        if (violations.outOfLane.length || violations.crossOverlap.length) {
          if (!result.ownershipWarnings) result.ownershipWarnings = []
          for (const v of violations.outOfLane) result.ownershipWarnings.push(`stage ${stage.id}: unit ${v.unit} touched out-of-lane file ${v.file}`)
          for (const v of violations.crossOverlap) result.ownershipWarnings.push(`stage ${stage.id}: file ${v.file} touched by ${v.units.join(' + ')} (clobber risk)`)
          plog(`Execute: stage ${stage.id} — OWNERSHIP WARNING: ${violations.outOfLane.length} out-of-lane, ${violations.crossOverlap.length} cross-lane overlap(s)`)
        }
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
    await checkpointDesign('execute')

  } // end full-path branch — Gate 4+ run at main() level for BOTH paths

  // Gate 4: Test (with optional gsd-debug recovery) -----------------------
  phase('Test')
  if (result.testsPassed) {
    plog('resume: skip Test (testsPassed set)')
  } else {
    let test = await runTests(testTarget, testCmd, testFramework)
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
      const dbg = await safeAgent(
        debugPrompt,
        { label: 'gsd-debug', phase: 'Debug', schema: DEBUG_VERDICT, model: gm('gsdDebug') },
        result
      )
      result._debug = dbg
      if (!dbg || !dbg.fixed) {
        break // gsd-debug could not fix -> stop retrying
      }
      phase('Test')
      test = await runTests(testTarget, testCmd, testFramework)
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
  await checkpointDesign('test')

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
      logTelemetrySummary()
      await consolidate(slug, result, config)
      return result
    }
    result.codeReview = {
      blockers: codeReview.blockers,
      issues: codeReview.issues,
      summary: codeReview.summary,
    }
    plog(`Code Review: issues=${codeReview.issues || 0}, blockers=${(codeReview.blockers || []).length}`)
    const blocking = selectBlockingFindings(codeReview.blockers)
    if (blocking.length) {
      // Classify blocker findings so upstream-rooted ones flow to /tune-feature via the
      // issues handoff instead of dead-ending in a plain block. Classification failure,
      // --no-issues, and zero upstream findings all land on the legacy hard-block — a
      // blocker NEVER lets the run proceed past code review.
      let upstreamCount = 0
      if (useIssues && isImplementMode) {
        plog(`Code Review: ${blocking.length} blocker(s) — classifying for the issues handoff`)
        for (const finding of blocking) {
          const classified = await classifyAndRecordIssue({ finding, planDir, result })
          if (classified && classified.isUpstream) upstreamCount += 1
        }
      }
      if (upstreamCount > 0) {
        result.blockedAt = 'issues-handoff'
        result.retryUsed = retryState.used
        result.handoff = buildIssuesHandoff(planDir, upstreamCount, 'code-review')
        if (useKnowledgePersist) await persistFindings(result)
        plog(`Code Review: issues-handoff — ${upstreamCount} upstream issue(s); blocking for tune`)
        stateCheckpoint('Code Review', 'issues-handoff')
        logTelemetrySummary()
        await consolidate(slug, result, config)
        return result
      }
      result.blockedAt = 'code-review'
      result.retryUsed = retryState.used
      if (useKnowledgePersist) await persistFindings(result)
      stateCheckpoint('Code Review', 'blocked')
      logTelemetrySummary()
      await consolidate(slug, result, config)
      return result
    }
  }
  stateCheckpoint('Code Review', 'done')
  await checkpointDesign('code-review')

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
      result.handoff = buildIssuesHandoff(planDir, upstreamCount, 'goalkeeper')
      plog(`Goalkeeper: issues-handoff — ${upstreamCount} upstream issue(s); blocking for tune`)
      stateCheckpoint('Goalkeeper', 'issues-handoff')
      logTelemetrySummary()
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
      logTelemetrySummary()
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
    // DTERM-01: distinguish attempted from durably verified publish outcome.
    result._publishVerified = !!(result.published && result.published.published)
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
    const commit = await safeAgent(
      `You are the git-ops agent. Stage and commit the current changes for this task:
${task}

Commit on the current branch (do NOT push unless already instructed).
Use a clear conventional-commit message. Return the commit hash.`,
      { label: 'git-ops', phase: 'Commit', schema: COMMIT_VERDICT, model: gm('commit') },
      result
    )
    result.committed = !!(commit && commit.committed)
    result.commitHash = commit ? commit.commitHash : null
    plog(`Commit: committed=${result.committed}; hash=${result.commitHash || '(none)'}`)
    // DTERM-01: a failed commit is never reported as terminal success.
    if (!result.committed) {
      result.blockedAt = 'commit-failed'
      recordDegradationEvent(result, 'fail-forward', 'Commit', 'git-ops', 'commit attempt failed')
      stateCheckpoint('Commit', 'blocked')
      result.retryUsed = retryState.used
      logTelemetrySummary()
      await consolidate(slug, result, config)
      return result
    }
  }

    // Reflect the true terminal gate in the persisted state and flush once more
    // so a committed run records committed=true (idempotent / resumable).
    stateCheckpoint(result.committed ? 'Commit' : 'Done', 'done')
    result.retryUsed = retryState.used
    logTelemetrySummary()
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


export { main }
