import { FILE_ACK, DESIGN_REVISE_VERDICT, DESIGN_REVIEW_VERDICT, ENHANCER_VERDICT } from './schemas.mjs'
import { nsAgent, budgetExhausted, spendRetry, gm } from './config.mjs'
import { safeAgent } from './agent-core.mjs'
import { runQuickDecider, verifyAppendGrowth } from './decisions.mjs'


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
        failureContext: `${phaseLabel} review iteration ${iterations}: prior revision did not satisfy the reviewer. Outstanding blockers: ${JSON.stringify(review.blockers).slice(0, 600)}; gaps: ${JSON.stringify(review.gaps).slice(0, 400)}`,
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
      return { accepted: true, iterations, lastVerdict: review, failForward: true, acceptancePath: 'fail-forward (reviser-null)' }
    }
    plogFromResult(result, `${phaseLabel}: revised (${(revise.changesApplied || []).length} changes)`)
  }
  // Sub-cap exhausted without acceptance — fail-forward (non-terminal like the plan convergence gate).
  plogFromResult(result, `${phaseLabel}: sub-cap (${refineSubcap}) reached without acceptance — fail-forward`)
  await appendReviewHistory(planDir, phaseLabel, iterations, lastVerdict, 'fail-forward (sub-cap)', result)
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

export { appendReviewHistory, reviewLoop, plogFromResult, enhancePrompt }
