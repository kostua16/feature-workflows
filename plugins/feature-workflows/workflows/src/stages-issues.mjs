import { FILE_ACK, STAGE_PLAN_VERDICT, ISSUE_CLASSIFY_VERDICT, TUNE_PLAN_VERDICT } from './schemas.mjs'
import { nsAgent, gm } from './config.mjs'
import { writeChunkedFile } from './state.mjs'
import { safeAgent } from './agent-core.mjs'
import { plogFromResult } from './review-loop.mjs'
import { verifyAppendGrowth } from './decisions.mjs'


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
  plogFromResult(result, 'plan-chunker: returned no stages — degrading to single implicit stage01')
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

export { chunkPlanIntoStages, selectBlockingFindings, buildIssuesHandoff, classifyAndRecordIssue, tickStageFile, readIssuesFile, planTuneFromIssues, invalidateStages }
