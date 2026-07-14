import { spendRetry, gm } from './config.mjs'
import { reviewLoop, plogFromResult } from './review-loop.mjs'


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

export { tuneRevisitGate }
