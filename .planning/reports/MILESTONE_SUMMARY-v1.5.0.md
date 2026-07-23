# Milestone v1.5.0 — Project Summary

**Milestone:** v1.5.0 — Project-Scale Extract Design
**Status:** COMPLETE — shipped, Nyquist-validated, UAT-verified (11/11 phases, all requirements met)
**Generated:** 2026-07-23
**Purpose:** Team onboarding and project review

---

## 1. Project Overview

`feature-workflows` is a Claude Code / Codex **plugin marketplace package** that ships a gate-enforced,
dynamic-workflow-driven feature pipeline. It guides users through design, implementation, tuning,
reverse design extraction, design review, and status reporting with specialized agents and durable
cross-run state.

**Core value:** *One user command must drive a trustworthy feature workflow from intent to durable,
verifiable artifacts — without silently losing work or overstating completion.*

**What v1.5.0 delivered:** Turned the shipped v1.4.5 extract flow into **trustworthy whole-project
extraction** — one `/feature-workflows:extract-design` command automatically processes an entire large
project through bounded, durable, resumable per-feature segments while reporting coverage and completion
truthfully. It then **extended the same durability, truthfulness, and bounded-execution contracts to
`/design-feature` and the shared engine** wherever an identical defect was proven.

The user experience stays one command; internal segmentation exists only to respect the one-level
workflow-composition model and the shared call/concurrency/token ceiling. Every segment is durable and
manually resumable even when automatic continuation is unavailable.

---

## 2. Architecture & Technical Decisions

The engine is a **dependency-free generated Node/ESM bundle** with **agent-mediated JSON persistence** —
no database, daemon, queue, bundler, or direct workflow filesystem/shell access. Workflow nesting is
exactly **one level**: a top-level orchestrator invokes leaf children; leaves compose nothing.

Key decisions (rationale grounded in `PROJECT.md` Key Decisions + phase artifacts):

- **One user command, automatic bounded segments** — preserves a simple command surface while respecting
  finite runtime capacity; any number of features can be processed safely. *(user-accepted)*
- **One leaf extraction workflow (`fp-extract-slice`) per feature beneath a top-level orchestrator** — fits
  the one-level nesting limit, isolates failures, creates a natural durable progress unit. *(user-accepted)*
- **Pure deterministic reducers for lifecycle transitions & readiness** — byte-stable replayable projections,
  no input mutation; the foundation for truthful status. *(Phase 1)*
- **Root-last v1.4.5 migration** — child shards are durable and validated *before* the compact root
  manifest is acknowledged, so a mixed-version ready state is impossible. *(Phase 1)*
- **Selective revision invalidation via durable digests** — a source/scope/graph/dependency/artifact change
  invalidates only affected gates/views; independent verified evidence is retained. *(Phase 1)*
- **Generated multi-entry build with N-surface version lockstep** — the top-level entry and the leaf are
  built, installed, versioned, and drift-validated together as one unit. *(Phase 3)*
- **Durable gate-level checkpoints + last-good snapshot recovery** — state persists after every material
  gate; a truncated/partial write auto-recovers on resume instead of hard-blocking. *(Phases 4 & 8)*
- **Transactional continuation** — monotonic segment IDs + idempotency keys make duplicate, lost, or
  out-of-order launches converge to one outcome, with an exact manual resume fallback always preserved. *(Phase 5)*
- **Truthful readiness derivation** — `extractReady`/`designReady` is true only when every condition is
  genuinely met; handoff and read-only status share one immutable projection. *(Phases 6 & 9)*
- **Enforced budgets with non-spendable reserve + per-loop sub-budgets** — capacity for checkpoint/handoff
  is never spent by gate work; early review/refine loops cannot starve later gates. *(Phases 5 & 10)*
- **Transient-error classification + bounded backoff retry in the shared agent core** — a transient
  provider/network error no longer hard-blocks on the first failure. *(Phase 11)*
- **Deterministic artifact verification via the digest contract** — replaces trusted LLM self-reports; a
  hallucinated existence claim can neither pass a missing artifact nor false-block a present one. *(Phase 11)*
- **Extend v1.5.0 with design-mode phases rather than open v1.6.0** — GSD tracks one active milestone; the
  design-mode findings adopt the same primitives phases 1–7 build. *(user-accepted)*

---

## 3. Phases Delivered

All 11 phases complete. Execution order is strictly numeric (1 → 11) because each builds on prior primitives.

| # | Phase | Status | One-liner |
|---|-------|--------|-----------|
| 1 | State, Coverage, Migration, and Revision Contracts | ✅ Complete | Versioned pure reducers, root-last migration, sharded state, and selective invalidation establish truthful foundations. |
| 2 | Bounded Discovery, Validated Graph, and Schedulability | ✅ Complete | Deterministic pages become a validated ownership/dependency graph and a durable schedulable queue. |
| 3 | Multi-Entry Build, Install, and Version Lockstep | ✅ Complete | Source, generated artifacts, copy/symlink installs, version metadata, and release contents expose both workflow entries together. |
| 4 | Checkpointed Feature Leaf | ✅ Complete | One feature runs through `fp-extract-slice` with transition-level acknowledgements and resumable gate evidence. |
| 5 | Bounded Scheduler and Transactional Automatic Continuation | ✅ Complete | Dependency-safe work advances through budgeted, isolated, monotonically acknowledged segments from one command. |
| 6 | Synthesis, Publish, Persist, and Status Truth | ✅ Complete | Bounded verified summaries produce retry-safe project views and one revision-current readiness account. |
| 7 | Compatibility and Project-Scale Proof | ✅ Complete | Continuous mode compatibility, complete E2E characterization, and whole-repository dogfooding prove the promise. |
| 8 | Design-Mode Durable Checkpoints and Revision-Aware Resume | ✅ Complete | Design (and implement/tune where proven) gains gate-level durable persistence, auto-recovering atomic writes, and digest-driven resume. |
| 9 | Design-Mode Truthful Readiness and Outcome Reporting | ✅ Complete | `designReady` and terminal commit/publish/persist outcomes are true only when genuinely earned; every degraded path is durably recorded and surfaced. |
| 10 | Design-Mode Bounded Budgets and Prompt Context | ✅ Complete | Per-gate/per-run budgets, per-loop retry sub-budgets, and bounded prompt payloads replace observational telemetry and unbounded interpolation. |
| 11 | Design-Mode Reliability, Verification, and Characterization Proof | ✅ Complete | Transient-error backoff, deterministic artifact verification, and end-to-end behavioral tests prove the extended design flow. |

Phases 1–7 are the extract-orchestration core; phases 8–11 extend the same contracts to `/design-feature`.

---

## 4. Requirements Coverage

**36/36 v1 requirements mapped, 0 orphaned, 0 duplicated**, covering all 30 approved improvement themes.
Each phase was UAT-verified **GOAL MET** (`/gsd-verify-work <id> --auto` → `VERIFICATION.md`).

| Group | Requirements | Status |
|-------|--------------|--------|
| State / Coverage / Migration / Revision | CONTRACT-01, STATE-01, REV-01 | ✅ met (Phase 1) |
| Bounded Discovery & Schedulability | INV-01, DISC-01, GRAPH-01, QUEUE-01, DEPCTX-01 | ✅ met (Phase 2) |
| Generated Multi-Entry Distribution | DIST-01 | ✅ met (Phase 3) |
| Checkpointed Feature Leaf | ORCH-01, CHECKPOINT-01 | ✅ met (Phase 4) |
| Bounded Scheduling & Continuation | BUDGET-01, RETRY-01, ISOLATE-01, CONT-01 | ✅ met (Phase 5) |
| Synthesis / Persist / Status Truth | SYNTH-01, OBSERVE-01, STATUS-01 | ✅ met (Phase 6) |
| Compatibility & Scale Proof | COMPAT-01, QUAL-01, DOGFOOD-01 | ✅ met (Phase 7) |
| Design Durability & State | DCKPT-01, DSTATE-01, DRESUME-01 | ✅ met (Phase 8) |
| Design Truthfulness | DREADY-01, DHIST-01, DTERM-01, DQUEST-01, DCHUNK-01, DYAGNI-01 | ✅ met (Phase 9) |
| Design Bounded Execution | DBUDGET-01, DLOOP-01, DPROMPT-01 | ✅ met (Phase 10) |
| Design Reliability & Proof | DTRANS-01, DVERIFY-01, DTEST-01 | ✅ met (Phase 11) |

> ⚠️ **Doc-debt:** the checkbox/status ledger inside `.planning/REQUIREMENTS.md` is **stale** — it still marks
> ~20 requirements "Pending" even though all 36 are implemented, validated, and UAT-verified. The per-phase
> sub-agents ran the GSD workflow inline and updated `STATE.md` but not the requirement checkboxes. The table
> above reflects the true status; the REQUIREMENTS.md ledger should be reconciled.

No MILESTONE-AUDIT or RETROSPECTIVE artifact exists for this milestone.

---

## 5. Quality Evidence

Beyond the implementation, two independent verification passes ran over every phase:

- **Nyquist validation** (`/gsd-validate-phase <id> --auto` → `VALIDATION.md`): +661 gap-filling tests
  (787 → 1448), and it **caught 8 real defects** (all fixed):
  - P2 — `validateGraph` overlap detection was unreachable dead code → rewrote with a pathClaims map.
  - P6 — `deriveCoverageIndex` keyed `inProgress` vs canonical `'in-progress'` (in-progress features uncounted).
  - P6 — `CONTINUUATION_ACK` typo (double-U) → correct-spelling access returned `undefined`.
  - P6 — `synthesizeProjectViews` skipped rebuild on feature removal.
  - P6 — `recordAttemptedWrite` lost `unitType` on re-attempt.
  - P8 — `checkpointDesign` dataKey `_definition` vs actual field `_define` (digest computed from path string, not content).
  - P9 — `recordDegradationEvent` threw on non-object truthy input (loose falsy guard).
  - P10 — `designBudgetSummary` shallow-spread `gateSpend` → shared refs → consumer mutation corrupted the live budget.
- **UAT verification** (`/gsd-verify-work <id> --auto` → `VERIFICATION.md`): every phase verdict GOAL MET.
  It **caught one goal-level gap** missed by both execution and unit-test validation:
  - P10 — **DBUDGET-01 was never enforced at runtime**: `spendDesignGate`/`canAdmitDesignGate` were imported
    but never called in the live design flow. UAT wired a `designBudgetGate` helper into all 12 design gates
    (+10 tests). This is the textbook case for goal-backward UAT.

All 8 validation defects were re-confirmed fixed during UAT.

---

## 6. Tech Debt & Deferred Items

**Non-blocking observations recorded across VERIFICATION.md files:**

- **`validateMigrationBoundary` (Phase 1)** — mutates state despite a "Pure: …without performing any writes"
  comment (internal accumulator pattern). Recommendation: align the comment or return a new state object.
- **Design budget accounting (Phase 10)** — `designBudgetGate` counts 1 call per gate *invocation*, not actual
  intra-gate agent calls (conservative — under-counts retries/escalations within a gate).
- **Two parallel budget systems coexist** — the Phase 5 global `retryState` and the Phase 10 `designBudget`.
  Under normal operation neither ceiling is approached; worth unifying if budgets become binding.
- **Token budgets uncharacterized by default** (`Infinity`) — only the call ceiling is enforced in production;
  token characterization requires runtime measurement.
- **Cycle-policy (Phase 2)** — the roadmap's HITL checkpoint was resolved autonomously as a *configurable*
  policy-map classification (defers the final cycle policy to config) rather than a hardcoded choice.
- **Stale requirement ledger** — `.planning/REQUIREMENTS.md` status checkboxes not kept in sync (see §4).
- **State counter quirk** — `gsd-tools state.complete-phase` mis-counted (8/11) during Phase 11; hand-corrected.
- **Leaf dist carries dead shared-module code** — accepted trade-off from the one-level build model (harmless).

**Deferred beyond v1.5.0** (from `STATE.md` / `REQUIREMENTS.md` Future):

- Project-scale sharding & automatic continuation for non-extract modes (design/implement/tune/review) where
  a future multi-item scaling need is measured.
- A generalized arbitrary-DAG orchestration platform beyond whole-project extraction.
- Dynamic mid-leaf repartitioning, unless characterization proves fixed pre-admission slices insufficient.

**Release:** the milestone is **not yet tagged/released** — the marketplace pin still points at the shipped
v1.4.5 baseline. Cutting a v1.5.0 release is a separate step.

---

## 7. Getting Started

**Run / verify:**
- `npm test` — full suite (**1458 tests, 0 failing**)
- `npm run build` — regenerate both workflow dist entries from `workflows/src/`
- `npm run validate:build` — confirm zero generated drift, sandbox-safe output, version lockstep
- `npm run validate:versions` — N-surface version agreement (manifest + both dist headers/metadata)

**Key directories:**
- `plugins/feature-workflows/workflows/src/` — engine **source modules** (the 33 compiled modules)
- `plugins/feature-workflows/workflows/feature-pipeline.js` — generated **top-level** dist entry
- `plugins/feature-workflows/workflows/fp-extract-slice.js` — generated **leaf** dist entry
- `tests/` — unit, characterization, and per-phase Nyquist/UAT test suites
- `.planning/` — GSD planning ledger (ROADMAP, REQUIREMENTS, STATE, per-phase artifacts)
- `.planning/phases/*/` — per-phase `PLAN.md`, `SUMMARY.md`, `VALIDATION.md`, `VERIFICATION.md`

**Read first (core modules):**
- `src/lifecycle.mjs` — canonical states, transition/readiness reducers
- `src/schedulability.mjs` — Kahn prerequisite waves, dependency context
- `src/status-truth.mjs` — truthful readiness derivation + immutable projection
- `src/continuation.mjs` — monotonic segments, idempotency, convergence
- `src/main.mjs` — top-level extract orchestrator (scheduling, checkpoint, synthesis, handoff)
- `src/extract-slice-entry.mjs` / `extract-slice.mjs` — the per-feature leaf

**Composition invariant to remember:** the leaf processes exactly one feature and composes no child
workflow; all scheduling, synthesis, continuation, and readiness authority stays at the top level.

---

## Stats

- **Timeline:** 2026-07-22 → 2026-07-23 (2 days)
- **Phases:** 11 / 11 complete
- **Tests:** 1458 passing / 0 failing (started at 262 in the v1.4.5 baseline; +1196 across the milestone)
- **Commits:** 44 (milestone scope, `7b2564d..HEAD`)
- **Files changed:** 114 (+37,300 / −367)
- **Contributors:** kostua16
- **Defects caught & fixed:** 9 (8 in Nyquist validation, 1 goal-gap in UAT)

---

*Generated by `/gsd-milestone-summary 1.5.0`. Source artifacts: `.planning/ROADMAP.md`, `PROJECT.md`,
`REQUIREMENTS.md`, `STATE.md`, and per-phase `SUMMARY.md` / `VALIDATION.md` / `VERIFICATION.md`.*
