import { ARCH_VERDICT, DETAILED_DESIGN_VERDICT, E2E_USECASE_VERDICT, CODEBASE_FACTS_VERDICT, REQUIREMENTS_VERDICT, OVERVIEW_VERDICT } from './schemas.mjs'
import { spendRetry, gm } from './config.mjs'
import { auditExtractedDesign } from './extract-scope.mjs'
import { safeAgent, flexibleAgent } from './agent-core.mjs'
import { reviewLoop, plogFromResult } from './review-loop.mjs'
import { writeOpenQuestions } from './decisions.mjs'
import { main } from './main.mjs'
import { flushPipelineState } from './state.mjs'
import { applyLifecycleEvent, LIFECYCLE_STATES } from './lifecycle.mjs'
import { invalidatePersistenceEvidence } from './observe-persist.mjs'
import { markStaleForSlice } from './synthesis.mjs'


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

// Invalidate the full extraction chain for a slice: reset the queue entry to
// pending, clear all 6 artifact-path guards (so gates re-run from scratch),
// wipe caches and review flags, supersede persistence evidence, and mark parent
// aggregates stale for rebuild. PURE (operates on state/queueEntry objects) —
// calls invalidatePersistenceEvidence and markStaleForSlice.
function invalidateSliceChain(state, sliceId, queueEntry) {
  queueEntry.status = 'pending'
  queueEntry.artifacts = {}
  queueEntry._gateCheckpoints = {}

  queueEntry.factsPath = null
  queueEntry.useCasePath = null
  queueEntry.designPath = null
  queueEntry.archPath = null
  queueEntry.requirementsPath = null
  queueEntry.auditPath = null

  queueEntry._facts = undefined
  queueEntry._e2e = undefined
  queueEntry._design = undefined
  queueEntry._arch = undefined
  queueEntry._requirements = undefined

  queueEntry._reviewedDesign = false
  queueEntry._reviewedArch = false

  invalidatePersistenceEvidence(state, sliceId)

  state.synthesisState = markStaleForSlice(state.synthesisState, sliceId)
  state.overviewPath = null
  state._sourceDigest = null
  state.extractReady = false
}

export { extractSlice, writeSystemOverview, checkpointSlice, invalidateSliceChain }
