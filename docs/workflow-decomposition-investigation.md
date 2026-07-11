# Investigation: splitting `feature-pipeline.js` into smaller composed workflows

_Date: 2026-07-11. Engine at v1.4.0 (6,777 lines, six modes). Status: **stage 1 IMPLEMENTED**
(engine v1.4.1) — see "Stage-1 implementation notes" at the end; stages 2–3 remain open._

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

## Recommended `src/` layout and build design (stage-1 blueprint)

### Why hand-rolled concatenation, not a bundler

The dist file is unusual: it must start with a **pure-literal** `export const meta`, end with a
top-level `return final` (illegal ESM — standard tooling can't even re-parse the output), contain
**zero** `import`s (the sandbox has no module resolution), and stay grep-stable (`/setup` and the
command preflights grep the `// engine-version:` header). A bundler (esbuild/rollup) would be the
repo's **first npm dependency** (deliberately zero-dep today), renames/reorders symbols (noisy
dist diffs), and still needs post-processing for the meta header and the sandbox tail. A ~150-line
zero-dep concat builder in `scripts/` matches the repo's existing tooling style and gives full
control over the output shape.

### Source layout

```
plugins/feature-workflows/workflows/
  src/
    meta/feature-pipeline.meta.mjs  # export const meta = {…} (pure literal; one per entry)
    schemas.mjs        # ~45 verdict JSON-Schema consts        (today: lines 69–1043)
    config.mjs         # MODEL_DEFAULTS, PROFILES, GATE_FALLBACKS, budget/mode resolvers
    text-utils.mjs     # taskSlug, categorizeSlug, jiraIdFromTask, detectNonEnglish, …
    json-repair.mjs    # extractJson … rewriteOutsideStrings
    agent-core.mjs     # safeAgent/flexibleAgent, escalation, circuit breaker, watchdog,
                       # telemetry, hardenForModel, normalizeVerdict
    state.mjs          # consolidate, flush/load/validate pipeline state, artifact checks,
                       # resume repair, checksums
    review-loop.mjs    # reviewLoop, appendReviewHistory, enhancePrompt
    decisions.mjs      # quick-decider, goalkeeper, decision log, LOOPBACK_FLAG_MAP,
                       # clearGateAndDownstream, applyApprovalDecision
    stages.mjs         # chunkPlanIntoStages, tickStageFile, invalidateStages, resetStageForRerun
    issues.mjs         # issues handoff, classifyAndRecordIssue, readIssuesFile
    modes/design.mjs … modes/status.mjs   # one runX(ctx) per mode branch of today's main()
    main.mjs           # config resolution + state hydration + mode dispatch (slim)
  feature-pipeline.js  # BUILD OUTPUT — same path, so commands/setup/preflights are untouched
```

Source rules the builder enforces (build fails otherwise):

- Real ESM `import { x } from './y.mjs'` between src files only — Node-importable, so tests
  import modules directly. **No `node:` builtins, no npm imports anywhere in src** (dist runs in
  the FS-less sandbox; I/O stays inside `agent()` prompts, as today).
- Top level = declarations only (`const` / `function` / `async function`), globally unique names
  (the concat output is one flat namespace), no side-effectful top-level statements.
- No `export default`, no re-exports, no default/namespace imports, no dynamic `import()` —
  imports exist solely for the dependency graph and are stripped.

### Builder: `scripts/build-workflows.mjs` (zero-dep)

1. **Entries manifest** in the script: `{ entry, metaModule, out }` — one entry now
   (`main.mjs → feature-pipeline.js`); stage 2 adds the six per-mode entries.
2. **Walk the import graph** from the entry, topo-sort (deps first, refuse cycles). Only reached
   modules are emitted → module-granular tree-shaking per entry for free (e.g. `fp-status` won't
   carry the review-loop or agent-escalation stack).
3. **Transform**: drop import lines, strip the `export ` keyword; reject anything outside the
   allowed forms.
4. **Collision check**: duplicate top-level identifiers across included modules → hard fail.
5. **Emit**: `// GENERATED — edit workflows/src/, run npm run build` banner +
   `// engine-version: <plugin.json version>` (injected — see versioning below) → the `meta`
   literal with its `version` field rewritten to the same value → concatenated bodies →
   `const final = await main()` / `return final` tail.
6. **Post-emit self-checks** (all exist today as manual/CI steps, now automatic per dist):
   the sed-neutralized `node --input-type=module --check` ESM check; phase-label validation
   (every `phase('…')` literal ∈ `meta.phases`); forbidden-token scan (`import `, `require(`,
   `Date.now`, `Math.random(`, `new Date(`).

npm scripts: `"build": "node scripts/build-workflows.mjs"` and
`"validate:build": "node scripts/build-workflows.mjs --check"` (rebuild to a temp buffer,
byte-compare against the committed dist; wire into `validate-plugin.yml` so a src edit without a
rebuild fails CI). Dist stays **committed** — users install the plugin from the repo, so the
built artifact must be in-tree.

### Versioning simplification

Today's 3-way lockstep (plugin.json / header / `meta.version`) exists because all three are
hand-edited. With the builder injecting header + `meta.version` from `plugin.json`, the manifest
becomes the **single source of truth**; `validate:versions` reduces to "dist matches manifest"
(and `validate:build` already proves dist is fresh). One bump site instead of three.

### Test-harness impact

`tests/harness.mjs` currently text-strips the sandbox tail from the monolith to import pure
functions. After the split it imports `src/*.mjs` directly and the `CANDIDATES` existence dance
disappears. Keep one build-integrity test: run the builder in-memory, assert output ≡ committed
dist, and run the neutralized syntax check.

### Migration mechanics (keeping it a pure refactor)

The monolith is already ordered in clean regions, so stage 1 is a mechanical cut along the table
in "Current engine anatomy": move regions into modules, add imports, build, and diff the dist
against the current engine — the first build should be **semantically identical** (only the
generated banner differs). The 180 existing tests plus the post-emit checks are the safety net;
`meta`, gate order, and `pipeline-state.json` handling change by zero bytes.

## Suggested staging

1. **Modularize source, build to the SAME single dist engine** (pure refactor, no behavior
   change; harness switches to importing src modules). Ship as a patch release.
2. **Option A**: emit six per-mode dist workflows; commands point at their own; retire the mode
   dispatch. `pipeline-state.json` contract untouched.
3. **Option B selectively**: extract-slice child first (best-shaped seam), then evaluate a shared
   `fp-design-docs` child for design/tune/extract reuse.

Each stage is independently shippable and `--resume`-compatible.

## Stage-1 implementation notes (engine v1.4.1)

Implemented as designed, with four pragmatic deviations from the blueprint above:

1. **Contiguous-range modules.** To make the refactor *verifiable* (rebuilt dist byte-identical
   to the v1.4.0 body), each src module is a contiguous line range of the original file. So the
   cut is `schemas / config / text-utils / state / stages-issues / tune / extract-scope /
   review-mode / extract-slice / publish-persist / test-run / agent-core / json-repair /
   review-loop / decisions / main` (16 modules + `meta/`) rather than the idealized layout —
   e.g. `normalizePath`/`compactList` live in `decisions.mjs` because that's where they sit in
   the original order. Re-homing utilities is trivial follow-up work now that the build exists.
2. **`main()` stays whole in `main.mjs` (~2.9k lines).** Carving the six mode branches out of
   the shared-closure `main()` is real behavioral surgery, not a mechanical move — it belongs to
   stage 2 (per-mode entries), where each branch becomes its own entry's `main()`.
3. **Manifest order instead of an import-graph walk.** The builder emits modules in explicit
   manifest order (the original file order), which guarantees byte-stability and keeps top-level
   const initializers safe (they may only reference earlier modules). Graph-walk reachability
   (module-level tree-shaking) becomes useful — and will be added — when stage 2 introduces
   multiple entries.
4. **The test harness still reads the DIST, not src.** Deliberate: 183 tests against the built
   artifact is a *stronger* check than testing src (it validates exactly what users install),
   and `tests/build-drift.test.mjs` + the CI `--check` step pin dist ≡ build(src). Switching the
   harness to src imports remains optional cleanup.

What shipped: `workflows/src/*.mjs` (ESM, Node-importable, smoke-imported in CI),
`scripts/build-workflows.mjs` (zero-dep builder + self-checks), `npm run build` /
`npm run validate:build`, `tests/build-drift.test.mjs`, CI dist-freshness + src-import steps,
and single-site versioning (bump `plugin.json`, build injects header + `meta.version` — the
3-way lockstep now holds by construction). The v1.4.1 dist differs from v1.4.0 only in the
header banner; the 6.7k-line body is byte-identical.
