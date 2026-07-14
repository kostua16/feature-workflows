import { FILE_ACK, REVIEW_FINDINGS_VERDICT, REVIEW_MERGE_VERDICT, REVIEW_VERIFY_VERDICT } from './schemas.mjs'
import { nsAgent, gm } from './config.mjs'
import { classifyAndRecordIssue } from './stages-issues.mjs'
import { auditExtractedDesign } from './extract-scope.mjs'
import { safeAgent } from './agent-core.mjs'
import { plogFromResult } from './review-loop.mjs'
import { verifyAppendGrowth } from './decisions.mjs'


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

export { REVIEW_LENSES, SEVERITY_RANK, meetsMinSeverity, resolveMinSeverity, resolveReviewLenses, collectReviewDocs, reviewIssueSection, buildReviewReport, runReviewLenses, mergeReviewFindings, verifyReviewFindings, recordReviewIssues }
