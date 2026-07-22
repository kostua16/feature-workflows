import { RETRY_BUDGET_DEFAULT, REFINE_SUBCAP_DEFAULT, DECISION_CAP_DEFAULT } from './config.mjs'
import { extractSlice } from './extract-slice.mjs'
import { applyLifecycleEvent, LIFECYCLE_STATES } from './lifecycle.mjs'


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

export { extractSliceMain }
