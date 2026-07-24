# Project Milestones: feature-workflows

## v1.6.0 Design-Extract Determination (Shipped: 2026-07-24)

**Phases completed:** 8 phases (12–19), 8 plans, 16 requirements

**Delivered:** Deterministic, stable folder-per-feature for `/extract-design` — one folder per feature for its lifetime (surviving full renames), fail-closed change detection, a full invalidation chain, auto-update-by-default upsert, and seamless v1.5 docset adoption.

**Key accomplishments:**

- Pending-confirmation protocol with crash-idempotent promotion + permanent locator.
- Deterministic identity (per-file content SHA-256 + scope digest, no LLM in the path).
- Feature-identity registry with rename-resilient lookup + collision guard + atomic recovery.
- Pure slice ownership reconciliation (union-find clustering, move detection, exactly-one-owner).
- Fail-closed source-change detection (full 64-hex SHA-256, never skips on hash failure).
- Full invalidation chain (publish/persist evidence, no-demote, removal parent path).
- Auto-update upsert entrypoints + v1.5 docset adoption migration.

**Quality:** 16/16 requirements delivered, all UAT-verified GOAL MET. 2443 tests, drift-free. Audit passed. 2 integration warnings found+fixed during cleanup (substring collision, `--feature` stale registry).

**Stats:** 41 commits · 74 files (+25,756 / −372) · 2026-07-23 → 2026-07-24.

**Git range:** `1ac9a33..HEAD` (branch `worktree-ver1.5.0`).

---

## v1.5.0 Project-Scale Extract Design (Shipped: 2026-07-22)

**Phases completed:** 11 phases (1–7 extract-orchestration core + 8–11 design-mode extension), 11 plans, plus a tech-debt cleanup pass

**Delivered:** Trustworthy whole-project extraction from one `/feature-workflows:extract-design` command, and the same durability/truthfulness/bounded-execution contracts extended to `/design-feature` and the shared engine.

**Key accomplishments:**

- Whole-project extraction as bounded, durable, resumable per-feature segments via a top-level orchestrator + `fp-extract-slice` leaf (one-level composition).
- Truthful foundations: pure deterministic lifecycle/readiness reducers, root-last v1.4.5 migration, digest-based selective revision invalidation.
- Bounded scheduling + transactional continuation: budgeted admission w/ non-spendable reserve, retry policy, failure isolation, monotonic/idempotent segments — never loses work or overstates completion.
- Truthful synthesis + status: incremental project views, attempted-vs-durable persistence, one immutable readiness projection shared by handoff + read-only status.
- Design-mode extension: durable checkpoints + auto-recovery, truthful `designReady`, enforced per-gate/per-loop budgets + bounded prompts, transient-error backoff, deterministic digest verification.
- Proven end-to-end: compatibility regression, 35-row E2E matrix, whole-repository dogfood scale proof; 1470 tests, build drift-free.

**Quality:** 36/36 requirements delivered, Nyquist-validated, and UAT-verified GOAL MET. 9 real defects caught across validation + UAT (all fixed). Audit status: passed.

**Stats:** 54 commits · 120 files (+38,400 / −415) · 2026-07-22 → 2026-07-23.

**Git range:** `7b2564d..HEAD` (branch `worktree-ver1.5.0`).

**Known deferred at close:** token-budget characterization numbers (plumbing in place; needs a dogfood run to measure). Milestone tag `v1.5.0` created locally (not pushed).

---

## v1.4.5 Pre-GSD Baseline (Shipped: pre-GSD baseline)

**Delivered:** A namespaced Codex plugin with a generated, gate-enforced feature workflow spanning design, implementation, tuning, reverse design extraction, design review, and status reporting.

**Phases completed:** Not tracked (shipped before the GSD planning ledger)

**Key accomplishments:**

- Shipped six workflow modes through one dynamic engine and thin namespaced commands.
- Added durable `pipeline-state.json` checkpoints, idempotent resume, and cross-mode handoffs.
- Added wide-scope extract decomposition with per-slice design docsets and a system overview.
- Added generated-distribution, version-lockstep, sandbox, and repository-native validation contracts.

**Stats:** Not tracked before GSD adoption.

**Git range:** Not recorded in the GSD ledger.

**What's next:** v1.5.0 Project-Scale Extract Design will make whole-project extraction bounded, automatically segmented, resumable, and truthful about coverage and completion.

---
