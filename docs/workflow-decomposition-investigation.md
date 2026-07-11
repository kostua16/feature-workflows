# Investigation: splitting `feature-pipeline.js` into smaller composed workflows

_Date: 2026-07-11. Engine at v1.4.0 (6,777 lines, six modes). Status: investigation only — no
engine changes made._

## Question

Can the monolithic dynamic-workflow engine be restructured into smaller workflows that call each
other (via `workflow()` composition / per-mode scripts), and is it worth it?

## Verdict

**Yes — feasible, with hard runtime constraints that dictate the architecture.** The engine's own
design (externalized `pipeline-state.json`, idempotent gates, JSON-serializable `result`) is
exactly what makes a split possible. The two real costs are (1) the runtime's **one-level
`workflow()` nesting limit** and (2) **no code sharing between workflow scripts**, which forces a
build step to avoid duplicating ~2.8k lines of shared helpers into every child.

## Runtime facts that govern the design

Verified against the Workflow runtime contract and `docs/dynamic-workflows.md`:

| Capability | Detail | Consequence |
|---|---|---|
| `workflow(nameOrRef, args)` | Runs another saved workflow inline; returns its return value | Composition primitive exists |
| Name resolution | Same registry as `Workflow({name})` — the project's `.claude/workflows/` (where `/setup` already installs); `{scriptPath}` also accepted | Children ship alongside the engine; `/setup` copies N files instead of 1 |
| **Nesting: exactly ONE level** | `workflow()` inside a child **throws** | Architecture is strictly two-tier: top-level script → leaf children. No child may itself compose |
| Shared execution context | Child shares the parent run's concurrency cap, 1000-agent counter, abort signal, token budget; shows as a `▸ name` group in `/workflows` | No extra cost or cap per child; observability improves |
| Args / return | Plain JSON both ways (child sees parent's value as `args`) | All cross-workflow state must be serializable — it already is (resume contract) |
| No module system | Scripts are self-contained; no `import` between workflow scripts | Shared helpers must be duplicated **or** bundled at build time |
| `meta` per script | Pure literal, `name`/`description` required; every `phase('X')` needs a matching `meta.phases` entry | Invariant #6 (phase-label validation) becomes per-file |
| Sandbox limits | No FS/shell, no `Date.now()`/`Math.random()` — identical in children | No new constraints introduced by splitting |

Note on terminology: the `pipeline()` builtin fans **items** through stages *inside one script*;
composing **workflows** is `workflow()`. "Call each other via pipeline" maps to
`workflow()` (parent→child); `pipeline()` stays what it is today (intra-script fan-out).

## Current engine anatomy (the seams)

`plugins/feature-workflows/workflows/feature-pipeline.js`, 6,777 lines:

| Region | Lines | Content |
|---|---|---|
| Verdict schemas | ~69–1043 | ~45 JSON-Schema consts (`DEFINE_VERDICT` … `OVERVIEW_VERDICT`) |
| Config & pure helpers | ~1044–1290 | model tiers, profiles, budgets, mode resolution |
| Shared infrastructure | ~1292–3867 | state persist/hydrate/validate, `consolidate`, `flexibleAgent` hardening stack (escalation, telemetry, JSON repair, watchdog, circuit breaker), `reviewLoop`, decision agents, tune/extract/review helpers |
| `main()` | 3870–6776 | ONE ~2,900-line function: config resolution, state hydration, then all six mode branches (`status` early-exit at ~3893, `extract` branch at ~4128, design/implement/tune/review share the full-path body) |

Cross-mode coupling is **already externalized**: modes communicate only through
`<planDir>/pipeline-state.json` + the `handoff` field (`design → implement → tune → implement`,
`extract → tune`). The in-memory couplings that a split must thread through args/returns are all
fields of `result` (hence serializable): `retryUsed` (global retry budget), `decisionUsed`
(decisionCap), `gateTelemetry` (merge in parent), `_enhancedPrompts`, `logLines`, carried
blockers. Module-level counters (`retryState`, `decisionState`) do NOT span scripts and must be
seeded from args in each child — the existing `hydrateBudget()` already does exactly this pattern
for resume.

## Decomposition options

### Option A — split by MODE (no `workflow()` needed)

Six sibling top-level workflows: `fp-design`, `fp-implement`, `fp-tune`, `fp-extract`,
`fp-review`, `fp-status`. Each slash command already selects exactly one mode, so each command
invokes its own workflow directly; `pipeline-state.json` remains the inter-run contract
(unchanged — it already is).

- Removes the mode dispatch and ~5 dead branches from every run's script.
- Zero new runtime risk: no nesting involved, checkpoints (`awaiting-approval`,
  `tune-awaiting-confirm`, `awaiting-scope-confirm`) keep their stop/re-invoke shape verbatim.
- Requires the shared-helper build step (below) — this is the whole cost.
- Each mode script stays large-ish (design ≈ helpers + design gates) but single-purpose.

### Option B — orchestrator + PHASE children via `workflow()`

A thin parent per entry point composes leaf children:

- design: `fp-context` (Gates -2→0.75: categorize/translate/define/knowledge/facts/e2e/requirements)
  → `fp-design-docs` (0.5–0.6 + review loops) → `fp-plan` (1–2: plan/tdd/reconcile/review-refine/chunker)
- implement: `fp-execute` (test-writer + per-stage executors) → `fp-verify` (test/debug/code-review/goalkeeper)
  → `fp-finalize` (publish/persist/commit)

Parent owns: config/profile resolution, state hydration + final consolidate, budget threading,
telemetry merge, and — the big win — **cross-phase loop-backs become parent control flow**
(goalkeeper `loop-back`, `--from-gate` rewinds = "re-invoke child N"; gates are already
idempotent so this is a natural fit). Checkpoint returns bubble: child returns `handoff` →
parent returns immediately → command layer re-invokes with the one-shot args.

Hard limitation: because nesting is one level, a child can never compose further. If `extract`
were itself a child, its per-slice cycle could not reuse `fp-design-docs`.

### Recommended: A first, then B selectively (hybrid)

Per-mode top-level workflows (A) each keep the full one-level `workflow()` allowance for their
own children (B). Concretely valuable second-step children:

1. **`fp-extract` → per-slice child.** `extractSlice()` (engine ~2354–2559) is the cleanest
   candidate in the codebase: self-contained cycle, slice-local state file, resumable queue —
   one `workflow('fp-extract-slice', {slice, …})` per queue entry, giving per-slice progress
   groups and per-slice restartability for free.
2. **`fp-design-docs` shared by design AND tune AND extract.** Tune's `tuneRevisitGate` and
   extract's as-built design steps re-derive the same artifacts; a parameterized child
   (`{mode: 'forward'|'refine'|'as-built'}`) de-duplicates the flow only if all three callers
   are top-level (which A guarantees).
3. `fp-review-lenses` is NOT worth a child — it's already a clean `parallel()` fan-out of
   agents inside one phase.

## The build-step prerequisite (shared code)

Every gate depends on the `flexibleAgent` stack + state helpers (~2.8k lines). Since workflow
scripts can't import each other, the split only stays maintainable with a source→dist build:

```
workflows/src/schemas.mjs, agent-core.mjs, state.mjs, review-loop.mjs, modes/*.mjs
  --(npm run build:workflows: concat + per-file meta injection)-->
workflows/dist/fp-design.js … fp-status.js   (self-contained, checked into the plugin)
```

- The repo already has the tooling shape for this (`scripts/*.mjs`, npm scripts, CI ESM check).
- `tests/harness.mjs` gets **simpler**: it currently text-strips the sandbox tail to import pure
  functions; with real ESM source modules it imports them directly, and a small build-output
  test asserts dist ≡ concat(src).
- Must extend: `validate-plugin-versions.mjs` (lockstep across all dist scripts),
  `/setup` (copy + version-check N files, per-file sandbox-`sed` ESM check), phase-label
  validation per file.

## Risks / open questions

- **Runtime-level resume (`resumeFromRunId`) across `workflow()` children is unverified** — but
  the engine doesn't rely on it: `--resume` via `pipeline-state.json` + idempotent gates is the
  real mechanism and it *improves* under the split (re-run one child instead of replaying one
  giant script's agent prefix).
- `workflow()` **throws** on unknown name / child syntax error → parents must wrap children in
  try/catch and map to `blockedAt` (extend the existing `uncaught-throw` safety net).
- Child scripts each need their own `meta.phases`; the `/workflows` tree becomes
  `parent ▸ child ▸ phase` — verify the display depth is acceptable before committing to fine
  granularity.
- Setup/versioning drift: six dist files that must move in lockstep is a new failure mode —
  the version validator must hard-fail on any mismatch, and the setup preflight in each command
  should check the file *it* launches.
- Migration compatibility: persisted `pipeline-state.json` from v1.4.0 must hydrate unchanged in
  the split engine (state schema is versioned via `validatePipelineState` — keep it identical).

## Suggested staging

1. **Modularize source, build to the SAME single dist engine** (pure refactor, no behavior
   change; harness switches to importing src modules). Ship as a patch release.
2. **Option A**: emit six per-mode dist workflows; commands point at their own; retire the mode
   dispatch. `pipeline-state.json` contract untouched.
3. **Option B selectively**: extract-slice child first (best-shaped seam), then evaluate a shared
   `fp-design-docs` child for design/tune/extract reuse.

Each stage is independently shippable and `--resume`-compatible.
