# feature-pipeline — High-Level Architecture

> Engine-internal architecture doc for the **3-mode feature pipeline**
> (`design` / `implement` / `tune`). Source of truth:
> `plugins/feature-workflows/workflows/feature-pipeline.js` in the plugin repo (ES module;
> resolved at run time via the user-level symlink `~/.claude/workflows/feature-pipeline.js`,
> auto-created by the pipeline commands). This doc describes
> what the engine *actually does* — including caveats, hidden limits, and failure modes
> — so future maintainers can extend it without re-deriving the design from the code.

---

## 1. TL;DR

One workflow engine, three pipelines, selected by a single `args.mode` flag:

```
/design-feature  <task>            mode=design   → THINK docs + plan + stageNN.md, STOP pre-execute
/implement-feature <dir>          mode=implement → DO: stages → test → review → commit (or issues-handoff)
/tune-feature    <dir>            mode=tune     → FIX: read issues → refine mapped gates → re-enable designReady
/feature-pipeline <task>           alias         → design (STOP); --auto-implement chains into implement
```

The **single structural seam** is `gateModeActive(gateGroup, mode)` — 5 lines that decide
which gates run. Everything else (schemas, `reviewLoop`, `safeAgent`, `consolidate`,
resume substrate, decision budgets) is shared verbatim across the three modes. This is
why "1 engine + 3 modes" was chosen over three physical files (the alternative would
copy ~2000 lines of shared helpers into each).

**The durable cycle** (replacing the old Phase-E in-memory loop-back state machine):

```
design ──designReady──▶ implement ──(upstream defect)──▶ issues-and-improvements.md
   ▲                        │                                   │
   │                        │                                   ▼
   └──designReady (re-set)──┘                              tune (refine mapped gates)
                                   ↑                              │
                                   └────resume──── implement ─────┘ (re-run invalidated stages)
```

Human checkpoints at every arrow. No mode rewinds into another mode in-process.

---

## 2. Why the split exists (the problem it solves)

Before the split, `feature-pipeline` was one monolithic gate chain: THINK gates
(define → … → plan → review) flowed into DO gates (execute → test → … → commit), with an
**in-memory, cap-bounded loop-back** (Phase E): the goalkeeper could `loop-back → design`
and a `do/while` rewound, clearing downstream gate markers.

Three problems:

1. **Ephemeral loop-back.** It lived only in the process's memory — kill the session, lose
   the rewind. Bounded by `decisionCap` (default 50), so a churning loop could burn the
   whole budget re-running design-heavy gates on every implement attempt.
2. **No human checkpoint.** Design re-ran silently inside implement. The user never got to
   review the revised plan before code re-executed.
3. **Forced re-runs.** Every implement attempt re-ran all design gates, even when only one
   doc needed a tweak.

The split replaces the ephemeral loop-back with a **durable, human-checkpointed cycle**:
implement *cannot* rewind into design — an upstream defect is written to
`issues-and-improvements.md` and the run stops. Tune reads that file, refines *only the
affected gates*, preserves completed plan stages, and re-enables `designReady`.

---

## 3. The three modes

### 3.1 `design` — `/design-feature` (THINK, stops pre-execute)

Runs the THINK gates (Gates -2 → 2.1): categorize → translate → define (+ interview) →
knowledge → codebase-facts → e2e → requirements → arch (+review) → design (+review) →
requirements-review → plan → tdd-enforce → reconcile → review/refine → **plan-chunker →
stageNN.md**. Then:

- Sets `result.designReady = true`
- Calls `consolidate()` (writes `pipeline-state.json` + todo-store + `pipeline.log`)
- **Returns. No code executes.**

`result.handoff.message` tells the user: `/implement-feature <planDir>`.

**Key guard:** `if (isDesignMode) { … designReady=true; consolidate; return }` (L3027-3042).
This is the human checkpoint — design stops *before* Gate 3 (execute).

**Hidden behavior:** the gsd-quick fast-path is skipped in design mode (gsd-quick is an
*executor* — it belongs to implement). A design-mode run that would have recommended
gsd-quick still produces design docs + stages; the fast-path only fires in implement.

### 3.2 `implement` — `/implement-feature <planDir>` (DO; positional planDir required)

1. Hydrate `pipeline-state.json`.
2. **Assert `result.designReady`** — else `blockedAt = 'design-not-ready'`, stop
   (`/design-feature` first). (L3046)
3. Run stages sequentially (Gate 3, execute per stage, lane-scoped to `stage.files`):
   tick each stage `pending → in-progress → done` via `tickStageFile` (append-only to
   `stageNN.md`). **Done stages are skipped on resume** (L3082: `if (stage.status ===
   'done') continue`).
4. Gate 4 (Test/Debug), Gate 5 (Code Review), Gate 5.1 (Goalkeeper).
5. Goalkeeper verdict routing (the Phase-I redefinition, L3346-3373):
   - `commit` → publish / persist / commit (`--auto-commit`).
   - `loop-back` + design target (`requirements|architecture|design|plan`) → **NOT a
     rewind.** Each `trueDefect` → `classifyAndRecordIssue` → if `isUpstream`, append to
     `<planDir>/issues-and-improvements.md` → `blockedAt = 'issues-handoff'` → STOP for
     `/tune-feature`.
   - `loop-back` + `tests` target → stays on the code path (debug loop / hard-block). A
     test failure is a code problem, not a design defect.
6. `--no-issues` degrades `loop-back` to a plain block (backward-compat escape hatch).

**Design gates are NOT re-run** in implement (the mode guard skips them). Only DO gates
run.

### 3.3 `tune` — `/tune-feature <planDir>` (FIX; positional planDir required)

Runs its own branch **first** (L1966: `if (isTuneMode) { … return }`), before the
translator gate — so tune bypasses the entire THINK chain AND the implement chain.

1. `planTuneFromIssues()` reads `issues-and-improvements.md` + existing design docs →
   `tunePlanner` agent → `TUNE_PLAN_VERDICT` (minimal `planGates[]`, `issueRefs[]`,
   `preserveStages[]`). Returns `null` if no issues file / no gates derivable →
   `blockedAt = 'tune-no-issues'`.
2. **Confirm** via AskUserQuestion (unless `--no-confirm` or already `tuneConfirmed`).
   Cancel → `blockedAt = 'tune-cancelled'`.
3. Re-run ONLY `planGates` in **refine mode** via `tuneRevisitGate` (critical-reviewer +
   design-reviser revise the EXISTING artifact in place through `reviewLoop` — not a
   rewrite from scratch).
4. Re-run reconcile on the touched docs.
5. `invalidateStages()`: reset to `pending` only stages whose `files` intersect the
   revised gate's scope; `preserveStages` / file-disjoint stages keep `done`.
6. `result.designReady = true` (L2071), `consolidate`, STOP.
7. `handoff.message`: re-run `/implement-feature <planDir>`.

`gateModeActive` lets tune reach the design-group gates (design gates run in design **or**
tune), but tune enters them through its own targeted-revisit path, not the full chain.

---

## 4. Core architecture primitives

### 4.1 The seam: `gateModeActive(gateGroup, mode)` (L865)

```js
function gateModeActive(gateGroup, mode) {
  if (gateGroup === 'design') return mode === 'design' || mode === 'tune'
  if (gateGroup === 'implement') return mode === 'implement'
  return true // shared front-matter gates (categorize/translate/resume) always active
}
```

Three groups: `design` (THINK gates), `implement` (DO gates), and a shared front-matter
group (categorize/translate/resume) that runs in all modes. **This is the only
structural seam.** Adding a gate means giving it a group; the routing is automatic.

> **Caveat:** the guard is a per-gate boolean check sprinkled at gate entry. It is *not*
> a central switch. A gate whose group you mis-tag will run in the wrong mode. The grep
> guard `grep -c "mode ==="` ≥ 3 catches gross mis-routing but not a single mis-tag.

### 4.2 Mode resolution: `resolveMode(args, persistedConfig, resumed)` (L853)

Precedence: **explicit `args.mode` > persisted `config.mode` > resumed `result.mode` >
`'design'` (default).** On `--resume`, if `args.mode` is absent the persisted mode
hydrates. Valid values are whitelisted (`{design, implement, tune}`); anything else falls
through to the default.

### 4.3 The durable contract: `pipeline-state.json`

Each `Workflow()` call is a fresh V8 isolate — **no shared memory across invocations.**
The `result` object is in-process state; `<planDir>/pipeline-state.json` is the durable
state. Shape (L668):

```jsonc
{
  "task": "...",
  "slug": "...",
  "planPath": "...",
  "planDir": "...",
  "lastGate": "...",            // most recent gate reached
  "result": { /* FULL result object verbatim, incl. new fields */ },
  "config": { /* args-derived flags, so resume re-derives without re-parsing */ }
}
```

`result` carries the split's new optional fields: `mode`, `stages[]`, `designReady`,
`issuesPath`, `tunePlan`, `handoff`. **All default** (`stages: []`, `designReady: false`,
etc.) so pre-split `pipeline-state.json` hydrates without breakage (L1867 back-fills new
fields onto old state).

**Written by `flushPipelineState` (L998)** at every `consolidate()` boundary (success +
each hard-block exit). Read by `loadPipelineState` (L1014) on `--resume`.

> **Concurrent-write guard:** pipelines are sequential by design. On resume, state is
> re-read fresh rather than trusting in-memory cache across `Workflow` calls.

### 4.4 `consolidate(slug, result, config)` (L914)

The **single durable-write funnel.** ~20 exit sites call it (every gate boundary on
success + every hard-block). It writes three things:
- `pipeline-state.json` (via `flushPipelineState`)
- `.planning/todos/<slug>.md` (via the todo-store agent — the full result object)
- `pipeline.log` (in-memory `logLines` flushed via a file-writer agent)

**Critical invariant:** every blocked exit MUST funnel through `consolidate` so the run
stays `--resume`-able. The top-level `main()` safety net (L1955) catches escaping throws
→ `blockedAt = 'uncaught-throw'` + `consolidate` → `pipeline-state.json` written even on a
crash. A new blocked path that returns without `consolidate` is a bug.

### 4.5 `safeAgent(prompt, opts, result)` (L978)

Wraps every agent call. Converts any throw (e.g. `StructuredOutput retry cap exceeded`
when the model emits malformed JSON on every retry) into a recoverable `null` + a log
line. Existing null-handling then runs: null review/refine re-loops; null escalation
hard-blocks (resumable) rather than force-accepting; null execute/code-review hard-blocks.

> **Caveat:** not every agent call goes through `safeAgent`. The grep guard tracks
> `await safeAgent(` count; a new agent call that *isn't* wrapped can still crash the
> run (mitigated, not prevented, by the `main()` safety net).

### 4.6 Decision budgets (the runaway guard)

Two budgets, distinct purposes:

| Budget | Default | Scope | On exhaustion |
|---|---|---|---|
| `retryBudget` | 20 | Shared global across refine + debug loops (the loop "stop") | exits the loop (escalate/block) |
| `decisionCap` | 50 | HARD runaway floor for `quick-decider` + `goalkeeper` calls | `blockedAt='goalkeeper'` (resumable) |

Soft per-loop sub-caps (`maxRefineIterations`=10, `maxDebugRetries`=20,
`maxReconcileIterations`=5) stop one loop monopolizing the global budget; they're
advisory, not terminal. `quick-decider` rides every loop boundary from the 2nd iteration
onward (`retry`/`stop`/null→stop) to avoid burning budget on a churning loop.

---

## 5. Stages vs lanes (two decomposition axes — the most-misunderstood part)

| Axis | Source | Unit | Parallelism |
|---|---|---|---|
| **Stages** | `plan-chunker` (design tail) | Sequential dependency-order execution unit | sequential across stages |
| **Lanes** | `plan-architect` (inside a plan) | File-disjoint work groups | parallel *within* a stage |

**Lanes collapse INTO a stage.** A stage's `files[]` are file-disjoint; if
`allowParallelExecute` AND the files split cleanly, the executor fans out one
`plan-executor` per lane, scoped to that one stage. So:

```
stage01 (files: a.py, b.py)  ──┬── lane(a.py)  ┐ parallel
                               └── lane(b.py)  ┘
stage02 (files: c.py)         ────── single lane (sequential after stage01)
```

- `--no-chunker` collapses the whole plan to one implicit `stage01` whose `files` = all
  lane files (preserves the legacy single-executor path).
- Stages are the **progress unit** (tick `pending→in-progress→done`); lanes are the
  **parallelism unit**. `result.stages[i].status` is what resume skips on.

> **Caveat — artifact↔stage mapping is loose.** `invalidateStages` uses file-intersection
> (`stage.files` ∩ touched files). A design-gate revisit (e.g. architecture) doesn't have
> a clean file list — its scope is implicit. So plan-gate revisits derive `touchedFiles`
> from `result.lanes[].files`; non-plan-gate revisits are best-effort. A tune that revisits
> *only* architecture may under-invalidate stages (reset too few). The `preserveStages`
> list is the explicit override the user/tunePlanner can set.

### `invalidateStages(result, preserveStages, touchedFiles)` (L1213)

```js
for (const stage of result.stages) {
  if (stage.status !== 'done') continue      // only done stages can be reset
  if (preserve.has(stage.id)) continue        // explicit preserve wins
  if (stage.files.some(f => touched.has(f))) { stage.status = 'pending'; reset++ }
}
```

### `tickStageFile({stage, status, ...})` (L1131)

Append-only status note to `stageNN.md` + updates `result.stages[i].status`. The
in-memory `result.stages` is the source of truth; the file note is for human audit. A tick
failure logs and continues (non-blocking).

---

## 6. The issues-handoff redefinition (Phase I)

This is the heart of the split — what replaced the Phase-E loop-back.

### 6.1 Goalkeeper verdict routing (L3346-3373)

The goalkeeper's `loop-back` enum is **semantically split**, not removed:

```
loop-back + targetPhase ∈ {requirements, architecture, design, plan}
  → isDesignLoopback = true
  → for each trueDefect: classifyAndRecordIssue()
  → if any isUpstream → append issues-and-improvements.md → blockedAt='issues-handoff' → STOP
loop-back + targetPhase === 'tests'
  → code path → debug loop / hard-block (NOT an issues-handoff)
commit
  → publish / persist / commit
```

> **Caveat:** the goalkeeper *prompt* (L1603) still says "loop-back to an earlier phase"
> and "re-run downstream gates" — that's the Phase-E wording. The implement-mode harness
> intercepts the verdict before any rewind. So the agent's mental model (rewind) and the
> engine's behavior (issues-handoff) diverge. The prompt was kept for prompt stability;
> the routing logic is authoritative.

### 6.2 `classifyAndRecordIssue({finding, planDir, result})` (L1076)

Per-finding classification via the `issueClassifier` agent:

```jsonc
// ISSUE_CLASSIFY_VERDICT
{
  "isUpstream": true,              // true = root cause is a design-doc defect
  "gate": "architecture",          // requirements | architecture | design | plan | none
  "severity": "blocker",
  "finding": "<rephrased for a design-doc author>",
  "suggestedFix": "<concrete fix>"
}
```

- `isUpstream: false` → code-level → **not recorded** (logged, dropped).
- `isUpstream: true` → append a section to `<planDir>/issues-and-improvements.md`.

> **Over-classification by design.** The plan mandates the classifier err toward
> `isUpstream` (false-positive upstream → tune runs, cheap; a silently-dropped upstream
> defect is the failure mode). So expect some tune runs that find nothing actionable —
> that's the classifier being cautious, not broken.

### 6.3 The issues file (append-only)

```
# Issues & Improvements           ← header (created on first append)

## Upstream issue — gate: architecture
**Severity:** blocker
**Finding:** <rephrased for a design-doc author>
**Suggested fix:** <concrete fix>
---
```

Append-only (mirrors `writeChunkedFile`). Written by the `file-writer` agent (workflow
scripts can't touch the filesystem directly). Non-blocking: an append failure logs and the
run still blocks at `issues-handoff` (the in-memory `result.issuesPath` is set optimistically).

---

## 7. Tune's gate-revisit (Phase J)

### 7.1 `planTuneFromIssues({planDir, task, result, stages})` (L1174)

`tunePlanner` agent (opus) reads `issues-and-improvements.md` + existing design docs →
`TUNE_PLAN_VERDICT`:

```jsonc
{
  "planGates": ["architecture", "plan"],   // ordered design gates to re-run in refine mode
  "issueRefs": ["issues-and-improvements.md:5"],
  "preserveStages": ["stage01"],           // completed stage ids to NOT invalidate
  "summary": "..."
}
```

Returns `null` if no issues file or no gates derivable → `blockedAt = 'tune-no-issues'`.

### 7.2 `tuneRevisitGate({gate, ...})` (L1234)

Maps a gate name → `{path, label, artifactName}` and reuses `reviewLoop` in refine mode:

```js
const GATE_MAP = {
  requirements: { path: result.requirementsPath, label: 'Requirements', artifactName: 'requirements' },
  architecture: { path: result.archPath,        label: 'Arch Review',   artifactName: 'architecture' },
  design:       { path: result.designPath,      label: 'Design Review', artifactName: 'detailed-design' },
  plan:         { path: planPath,               label: 'Plan Review',   artifactName: 'plan' },
}
```

The reviewer/reviser prompts are tune-specific ("this is a TUNE refine pass… address the
flagged upstream issues… don't block on implementer-discretion detail"). After revisit,
re-review flags are set (`_reviewedRequirements`/`_reviewedArch`/`_reviewedDesign`/
`planAccepted`) so downstream state reflects the fresh pass.

> **Caveat:** if a gate has no artifact path (e.g. `useDetailedDesign` was off in design),
> `tuneRevisitGate` logs and skips — it cannot revise a doc that doesn't exist.

### 7.3 Order canonicalization

`tunePlanner` output `planGates` is sorted into dependency order
(`['requirements','architecture','design','plan']`) before re-running, regardless of the
order the agent emitted.

---

## 8. Resume semantics

`/design-feature` and `/feature-pipeline` take a positional `<task>` and use `--resume <planDir>`
to switch into resume mode. `/implement-feature` and `/tune-feature` take the `<planDir>` as a
**mandatory positional arg** directly (they always resume — there is no fresh mode — so the
`<planDir>` *is* the resume target; no flag needed). Path-only — the categorizer is **never**
re-run on resume (its output is non-deterministic); the persisted `planPath` is reused verbatim.
A bare `plan.md` path is accepted (the `/plan.md` suffix is stripped).

| Mode | Resume requires |
|---|---|
| design | `pipeline-state.json` exists |
| implement | `pipeline-state.json` + `designReady === true` (else `design-not-ready`) |
| tune | `pipeline-state.json` + `issues-and-improvements.md` present (else `tune-no-issues`) |

A blocked implement (`issues-handoff`) is resumable: after tune updates docs + re-sets
`designReady`, `implement --resume` re-runs stages (only invalidated ones reset).

> **Caveat — stale paths on source change.** If source files changed since the original
> run, persisted artifact paths (`stageNN.md`, `issues-and-improvements.md` references)
> may be stale. The doc-level refs survive, but `invalidateStages` file-intersection can
> miss renamed/moved files.

---

## 9. All caveats, hidden limits, and failure modes

### 9.1 Sandboxing limits (hard constraints)

- **No direct filesystem access.** Workflow scripts run in a sandbox; all file I/O
  (`pipeline-state.json`, `issues-and-improvements.md`, `stageNN.md`, todo-store) goes
  through `file-writer` / `file-reader` agents. Every write is an agent round-trip.
- **No `Date.now()` / `Math.random()`.** These throw in the sandbox (they'd break resume
  determinism). Timestamps come in via `args.timestamp`; the JIRA-id leaf comes from a
  regex on task text; the slug is derived from task text. Grep guard enforces 0 of each.
- **No `import` / `require`.** The file is a self-contained ES module. All helpers are
  defined inline. This is why the engine is one file, not three.
- **`export const meta` is metadata only (issue #17).** The Workflow sandbox does not leave a
  runtime binding named `meta`. Stamp/skew code must use the build-injected
  `ENGINE_VERSION` constant. The builder fails the build if the dist contains `meta.*`
  property access.

### 9.2 Determinism limits

- **`feature-categorizer` is non-deterministic** (LLM call). It runs ONCE in design, never
  re-run on resume (the persisted `planDir` is reused). Same rule for `plan-chunker`
  (stages persisted in state).
- **`tunePlanner` is non-deterministic**, but `result.tunePlan` is persisted → resume
  reuses the derived plan. `result.tuneConfirmed` persists so resume won't re-prompt.

### 9.3 Classification limits (issues-handoff)

- **Over-classification risk.** The classifier errs toward `isUpstream`. Expect tune runs
  that refine a gate but find the original implementation was actually fine. Cheap, but
  non-zero churn.
- **Under-classification failure mode (the bad one).** If the classifier marks a real
  upstream defect as code-level, it's dropped — no issues file, the run hard-blocks, and
  the user must manually run tune. The mitigation is over-classification, not detection
  guarantees.
- **`--no-issues` silently degrades.** With it, a goalkeeper `loop-back` becomes a plain
  block with no issues file — tune then can't run (`tune-no-issues`). This is an escape
  hatch, not a recommended path.

### 9.4 Stage-invalidation limits

- **Loose artifact↔stage mapping.** Only the plan-gate revisit has a clean file list
  (from `result.lanes[].files`). Arch/design/requirements-gate revisits are best-effort.
  A tune that revisits only architecture may reset too few stages. `preserveStages` is
  the explicit override.
- **`--no-chunker` collapses to one stage.** Any tune invalidation resets the single
  `stage01`, re-running the whole plan on resume. Intentional but coarse.

### 9.5 State-continuity limits

- **Old `pipeline-state.json` (pre-split).** Hydrates as design-mode linear replay at
  `lastGate`; new fields back-filled to defaults. A pre-split state at, say, Gate 3 will
  re-run from there as design mode — but design mode stops pre-execute, so a pre-split
  in-progress implement won't auto-continue. Re-run with explicit `mode: 'implement'`.
- **Cross-process staleness.** Each `Workflow()` call re-reads `pipeline-state.json`
  fresh. But if two sessions resume the same `planDir` concurrently, the last writer wins
  (no locking). The doc says "pipelines are sequential by design" — that's a convention,
  not enforcement.

### 9.6 Goalkeeper-prompt / engine divergence

- The goalkeeper prompt still describes Phase-E rewind ("re-enter targetPhase and re-run
  downstream"). The implement-mode harness intercepts `loop-back` and routes to
  issues-handoff instead. **The routing logic is authoritative; the prompt is stale by
  design** (kept for prompt stability). Don't "fix" the prompt to match the engine and
  assume that changes behavior — it won't.

### 9.7 Convergence (non-terminal) gates

- Gates 0.5R / 0.6R / 0.75R / 2 are **convergence gates, not terminal.** On soft-sub-cap
  exhaustion they escalate/force-accept rather than killing the task. Gate 2 specifically
  force-accepts remaining blockers and carries them to code review. So a "design ready"
  result may still carry `forceAccepted === true` + `carriedBlockers[]`.

### 9.8 ESM validation trap (maintenance)

- Plain `node --check` parses as CommonJS and **silently passes invalid ESM**. Must use:
  ```bash
  sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
    | node --input-type=module --check
  ```
  The `sed` neutralizes the sandbox-only top-level `return final`. **Pair with a
  bogus-injection test** (`printf 'export const meta=...\nNOTVALID ESM !!@#' | node
  --input-type=module --check` must exit non-zero) — otherwise an empty-stdin false
  positive (valid empty module, exit 0) masks real failures.

### 9.9 Cost ceiling

- A clean full-path run is ~14-20 agent calls (design) + ~5-8 (implement). Loops (refine,
  design-fix, debug, reconcile) multiply this. `decisionCap`=50 is the hard ceiling;
  beyond it, hard-block (resumable). The gsd-quick fast-path is lighter (skips most THINK
  gates; keeps Test + Code-Review + Persist).

---

## 10. State-continuity matrix (the cross-mode contract)

`<planDir>/pipeline-state.json` → `result` fields each mode reads/writes:

| `result` field | design sets | implement reads/sets | tune reads/sets |
|---|---|---|---|
| `mode` | `design` | `implement` | `tune` |
| `designReady` | `true` (exit) | asserts `true` | re-sets `true` (exit) |
| `stages[]` | populated (chunker) | ticks `status` per stage | resets only invalidated stages |
| `planPath` / `planDir` | derived (categorizer) | reused verbatim | reused verbatim |
| `issuesPath` | — | set on handoff | consumed |
| `tunePlan` | — | — | set |
| `tuneConfirmed` | — | — | set |
| `handoff` | `{from:'design', nextMode:'implement', message}` | `{from:'implement', nextMode:'tune'}` on handoff | `{from:'tune', nextMode:'implement', revisitedGates, stagesReset}` |

---

## 11. Gate inventory (mode-routed)

```
SHARED (all modes):   -2 Categorize → -1 Translate → [resume front-matter]
DESIGN (design+tune):  0 Define → 0.1 Knowledge → 0.2 Codebase-Facts → 0.7 E2E
                       → 0.75 Requirements → 0.5 Arch(+0.5R) → 0.6 Design(+0.6R)
                       → 0.75R Reqs-Review → 1 Plan → 1.5 TDD → 1.7 Reconcile
                       → 2 Review/Refine → 2.1 Chunk-Plan
                       *** design: designReady=true, STOP ***
IMPLEMENT (implement): 3 Execute(per stage) → 4 Test/Debug → 5 Code-Review
                       → 5.1 Goalkeeper(commit | issues-handoff) → 5.4 Publish
                       → 5.5 Persist → 6 Commit
TUNE (own branch):     read issues → tunePlanner → confirm → revisit planGates(refine)
                       → re-reconcile → invalidateStages → designReady=true, STOP
```

---

## 12. Verification guards (run after any edit)

```bash
# 1. ESM validity (exit 0 required) + bogus-injection trap (must be non-zero)
cd plugins/feature-workflows/workflows   # or, on an installed setup: cd ~/.claude/workflows
sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
  | node --input-type=module --check
printf 'export const meta={name:"x"}\nNOTVALID ESM !!@#' | node --input-type=module --check

# 2. Grep guards
grep -c "mode ==="        feature-pipeline.js   # ≥ 3 (per-mode routing)
grep -c "designReady"     feature-pipeline.js   # covers set / assert / reset
grep -c "issues-and-improvements" feature-pipeline.js  # ≥ 2 (write + read)
grep -c "await safeAgent(" feature-pipeline.js  # ≥ prior + new agents
grep -c "Date.now()"      feature-pipeline.js   # 0
grep -c "Math.random()"   feature-pipeline.js   # 0

# 3. Commands resolve (they ship inside the plugin)
ls plugins/feature-workflows/commands/*.md  # setup + the 4 pipeline commands
```

---

## 13. Anti-patterns / what NOT to do

- **Don't split into 3 physical files.** The sandbox forbids `import`/`require`; you'd
  copy ~2000 lines of shared helpers. One file + `mode` flag is the architecture.
- **Don't add an inline Phase-E-style loop-back to implement.** That's the exact ephemeral
  pattern the split removed. Upstream defect → issues file → stop → tune. Always.
- **Don't trust the goalkeeper prompt's "rewind" wording.** The engine routes `loop-back`
  to issues-handoff; "fixing" the prompt doesn't change routing.
- **Don't skip `consolidate()` on a new blocked path.** Every blocked exit must funnel
  through it or the run isn't `--resume`-able.
- **Don't re-run categorizer/chunker on resume.** Both are non-deterministic; both are
  persisted. Re-running breaks the `planDir` contract.
- **Don't rely on `node --check` for ESM validation.** It silently passes invalid ESM.
  Use the `--input-type=module` recipe + bogus-injection trap.

---

## 14. Out of scope (permanently)

- **Model routing / provider / env-var configuration.** Excluded by design; env vars are
  correct. Do not propose env-var changes.
- **Splitting into 3 physical files.** Rejected (1 engine + 3 modes).
- **Auto-chaining design→implement by default.** Human checkpoint preserved; `--auto-implement`
  is opt-in only.
- **Removing the gsd-quick fast-path.** Kept; routed to implement mode.

---

## 15. References

- **Dynamic Pipelines guide** - [Dynamic Pipelines guide](/docs/dynamic-workflows.md)

---

*Source: `plugins/feature-workflows/workflows/feature-pipeline.js` (line refs current as of the
Phase F-K split, 3520 lines). When the code and this doc disagree, the code wins — update this doc.*
