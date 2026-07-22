import { RETRY_BUDGET_DEFAULT, REFINE_SUBCAP_DEFAULT, DECISION_CAP_DEFAULT } from './config.mjs'
import { extractSlice } from './extract-slice.mjs'


// extractSliceMain: the leaf entry point for the fp-extract-slice workflow.
//
// The top-level pipeline spawns this leaf to process exactly one admitted feature.
// The leaf owns only the per-feature extraction gates; it performs no discovery,
// scheduling, reconciliation, synthesis, continuation, or readiness computation —
// those remain the top-level pipeline's authority.
//
// The sandbox provides `args` as a global (same contract as the top-level main()).
// The caller passes { slice, task, config, sliceState?, retryBudget?, ... }.
// Returns { mode, sliceId, status, gate?, sliceState, logLines }.
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

  return {
    mode: 'extract-slice',
    sliceId: slice.id,
    status: outcome.status,
    gate: outcome.gate,
    sliceState,
    logLines: result.logLines,
  }
}
