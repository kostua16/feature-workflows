import { PERSIST_VERDICT, PUBLISH_VERDICT } from './schemas.mjs'
import { gm } from './config.mjs'
import { safeAgent } from './agent-core.mjs'
import { plogFromResult } from './review-loop.mjs'


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

export { persistFindings, publishDesign }
