import { FILE_ACK, QUICK_DECISION_SCHEMA, GOALKEEPER_SCHEMA } from './schemas.mjs'
import { nsAgent, retryState, decisionState, decisionBudgetExhausted, spendDecision, gm } from './config.mjs'
import { consolidate } from './state.mjs'
import { safeAgent } from './agent-core.mjs'
import { plogFromResult } from './review-loop.mjs'
import { computeContentDigest } from './revision.mjs'
import { main } from './main.mjs'


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

export { runQuickDecider, runGoalkeeper, appendDecisionLog, writeOpenQuestions, writeFailedLaunch, LOOPBACK_FLAG_MAP, clearGateAndDownstream, normalizeGateTarget, resetStageForRerun, applyApprovalDecision, verifyAppendGrowth, normalizePath, detectOwnershipViolations, compactList }
