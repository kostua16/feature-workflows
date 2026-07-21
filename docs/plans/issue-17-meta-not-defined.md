# Plan: Fix sandbox ReferenceError — `meta is not defined` (Issue #17)

**Task Slug:** issue-17-meta-not-defined
**Created:** 2026-07-22
**Status:** READY (GO-WITH-FIXES applied from critical review)
**Complexity:** Medium
**GitHub Issue:** https://github.com/kostua16/feature-workflows/issues/17
**Canonical copy:** `docs/plans/issue-17-meta-not-defined.md`  
**Planning copy:** `.planning/user-plans/issue-17-meta-not-defined/plan.md`
**Review:** GO-WITH-FIXES — locked single injection approach; forbid `\bmeta\.` only; require resume-skew test; register `ENGINE_VERSION` in builder `seen`

## Objective

Eliminate the Claude Code Workflow sandbox failure `uncaught-throw: meta is not defined` that aborts `/feature-workflows:extract-design` (and any other mode that consolidates) while preserving the `engineVersion` stamp on `pipeline-state.json` and the `--resume` engine-version skew warning.

**Why:** Commit `ee93964` introduced runtime uses of the identifier `meta` (`meta.version`) in `state.mjs` / `main.mjs`. Under Node ESM (and the test harness) `export const meta` binds `meta` in module scope, so tests pass. The Workflow sandbox requires `export const meta` for UI/progress metadata but appears to evaluate the script body **without** leaving a runtime binding named `meta` — hence a mid-pipeline `ReferenceError` at the first `flushPipelineState()` that stamps `engineVersion`. Extract mode surfaces this after successful scope resolution because consolidate only flushes when `result.planPath` is set.

## Success Criteria

- [ ] Running extract (or any consolidating mode) no longer throws `meta is not defined` / `uncaught-throw: meta is not defined`
- [ ] `flushPipelineState` still stamps `engineVersion` equal to the dist `// engine-version:` header (and `plugin.json` version)
- [ ] `--resume` skew check still compares saved `engineVersion` to the running engine version and sets `result._resumeEngineSkew` + log warning when they differ
- [ ] `export const meta = { … version, phases, … }` remains in the dist for sandbox metadata / phase labels
- [ ] Emitted dist has **no** runtime `meta.` property access (`/\bmeta\./` — whole-dist scan is enough; `export const meta =` does not match)
- [ ] Build self-check fails if a future edit reintroduces `\bmeta\.` in the assembled dist (do **not** ban bare `\bmeta\b` — comments already contain the word, e.g. `run meta showed`)
- [ ] `npm test`, `npm run validate:build`, and `npm run validate:versions` all pass
- [ ] Three-way lockstep still holds: `plugin.json` / `// engine-version:` / `meta.version` (literal inside `export const meta`)
- [ ] Brief docs note records the sandbox constraint (do not rely on `meta` as a runtime binding)
- [ ] Memories written: `mem:issue-17-meta-not-defined-architecture`, `mem:issue-17-meta-not-defined-gotchas`

## Guiding Principles

- **TDD:** Add/extend failing regression coverage for “dist must not reference runtime `meta.`” and keep the existing `flushPipelineState` stamp assertion green **before** considering the fix complete. Prefer a build-time self-check (fails at `npm run build` / `validate:build`) plus a unit/integration test that asserts the assembled / committed dist property.
- **YAGNI:** Do not rewrite the Workflow sandbox, invent a meta polyfill, change consolidate timing, remove `engineVersion`, or redesign version lockstep. Only replace the unsafe runtime identifier with a build-injected constant.

## Scope

### In Scope

- Introduce build-injected `ENGINE_VERSION` string constant (literal from `plugin.json`), same injection path as header / `meta.version`
- Replace `meta.version` in `state.mjs` and `main.mjs` with `ENGINE_VERSION`
- Remove unused `import { meta }` from those two modules
- Add post-emit build self-check forbidding `\bmeta\.` only
- Tests: dist `\bmeta\.` ban + `ENGINE_VERSION` presence, existing stamp test, **required** resume-skew harness/unit test; optional VM sandbox simulation
- Rebuild committed dist (`feature-pipeline.js`)
- Brief documentation note (engine docs and/or README conventions)
- Patch version bump recommendation for release (fix ships as patch)

### Out of Scope

- Changing Claude Code Workflow sandbox semantics
- Removing or redesigning `engineVersion` / resume skew
- Changing when `consolidate()` / `flushPipelineState()` run in extract mode
- Splitting or reordering the engine module graph beyond the constant injection
- Marketplace pin / full release automation (release is a follow-up after the fix merges)
- Fixing unrelated extract-mode product issues

## Dependencies and Prerequisites

### External

- None (no new packages)

### Internal

- `scripts/build-workflows.mjs` — sole dist assembler; already injects version into banner + meta literal
- `plugins/feature-workflows/.claude-plugin/plugin.json` — single version source of truth (`1.4.4` today)
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — meta literal source (unchanged shape)
- Existing tests: `tests/config-and-state.test.mjs`, `tests/build-drift.test.mjs`
- Validators: `validate:build`, `validate:versions`

### Prerequisites

- Clean understanding that Node harness ≠ Workflow sandbox binding rules (confirmed by issue #17)
- Ability to rebuild dist and commit generated `feature-pipeline.js`

## Technical Context

See:

- [`references/sandbox-meta-binding.md`](./references/sandbox-meta-binding.md) — why `meta` is missing at runtime
- [`references/engine-version-injection.md`](./references/engine-version-injection.md) — recommended `ENGINE_VERSION` injection shape

**Confirmed root cause (do not re-litigate unless contradictions appear):**

| Location | Unsafe usage |
|---|---|
| `workflows/src/state.mjs` → `flushPipelineState()` | `engineVersion: meta.version` |
| `workflows/src/main.mjs` → resume skew | `resumed.engineVersion !== meta.version` (+ log / `_resumeEngineSkew`) |

Dist is flat concatenation: banner + `export const meta = {…}` + stripped module bodies. Import stripping leaves bare `meta.version` relying on the export binding. Sandbox extracts meta for UI but does not keep `meta` in execution scope.

**Why mid-slice in extract:** `consolidate()` only calls `flushPipelineState()` when `result.planPath` is set; extract does not consolidate immediately after scope resolution.

**Version lockstep today:** header `// engine-version: 1.4.4`, `meta.version: '1.4.4'`, `plugin.json` `1.4.4`.

## Implementation Phases

## Phase 1: Regression tests (RED)

**Goal:** Lock in the sandbox-safe contract before changing production code.
**Depends on:** None

### Step 1.1: Test Preparation

- **Test files:**
  - `tests/sandbox-meta-binding.test.mjs` (new)
  - Optionally extend `tests/config-and-state.test.mjs` if placing the stamp assertion near existing engineVersion coverage is clearer — prefer a dedicated file for the dist/sandbox contract
- **Test cases:**
  - [ ] Dist `feature-pipeline.js` does **not** match `/\bmeta\./` (whole-dist scan; catches `meta.version` / future `meta.*`)
  - [ ] Dist still contains `export const meta = {` and a `version: '<semver>',` field matching the header
  - [ ] After Phase 2: dist contains `const ENGINE_VERSION = '<semver>';` matching the header (RED phase may omit this assert or expect failure until injection lands)
  - [ ] Existing: `flushPipelineState: payload stamps engineVersion matching the engine header` remains and must stay green after the fix
  - [ ] **Required:** resume-skew unit/harness test — synthetic `engineVersion: '0.0.0'` → `_resumeEngineSkew` with `current === ENGINE_VERSION` / header version; no `ReferenceError`
  - [ ] (Optional) VM/`AsyncFunction` sim without a `meta` binding — useful, not required if static ban + stamp + skew exist
- **Test type:** unit (dist static analysis) + integration (flushPipelineState + resume skew via harness)
- **Status:** PENDING

### Step 1.2: Implementation

- **Files to modify/create:** `tests/sandbox-meta-binding.test.mjs`; resume-skew coverage in that file or `tests/config-and-state.test.mjs`
- **Changes:**
  1. Read committed dist; assert `!/\bmeta\./.test(dist)` (message must cite issue #17 / sandbox binding).
  2. Assert `ENGINE_VERSION` presence once Phase 2 lands (RED: `\bmeta\.` assert fails on current dist).
  3. Add required resume-skew test (may stay RED until `main` uses `ENGINE_VERSION`, or assert current behavior under Node until swap).
- **Error handling requirements:**
  - Test failure messages must name issue #17 / sandbox binding so future regressions are actionable
- **Status:** PENDING

### Step 1.3: Validation

- **Tests to run:** `node --test tests/sandbox-meta-binding.test.mjs` (expect RED on current tree for “no runtime meta.”)
- **Expected results:** At least one assertion fails against today’s dist (`engineVersion: meta.version` present)
- **All e2e cases must pass:** No (RED phase)
- **Status:** PENDING

### Step 1.4: Documentation

- **Docs to update:** none yet (tests document intent via names/comments)
- **What to document:** N/A
- **Status:** PENDING

## Phase 2: Build injection + source fix (GREEN)

**Goal:** Inject `ENGINE_VERSION` at build time; remove all runtime `meta` identifier uses from sandbox-executed bodies.
**Depends on:** Phase 1 (tests exist; may still be RED until this phase completes)

### Step 2.1: Test Preparation

- **Test files:** same as Phase 1 (now expected GREEN)
- **Test cases:**
  - [ ] Re-run Phase 1 cases — all green after rebuild
  - [ ] `tests/config-and-state.test.mjs` stamp test green
  - [ ] `tests/build-drift.test.mjs` green after committing rebuilt dist
- **Test type:** unit + integration
- **Status:** PENDING

### Step 2.2: Implementation

**LOCKED APPROACH (only — no alternatives):** Node-only `src/engine-version.mjs` + strip its import + inject `const ENGINE_VERSION = '${version}';` after meta. Never add `engine-version.mjs` to `modules[]`. Never use `globalThis.ENGINE_VERSION`, dynamic `import()`, or a `meta` polyfill.

- **Files to modify/create:**
  1. `scripts/build-workflows.mjs`
  2. `plugins/feature-workflows/workflows/src/engine-version.mjs` (**new**, Node-only; never in `modules[]`)
  3. `plugins/feature-workflows/workflows/src/state.mjs`
  4. `plugins/feature-workflows/workflows/src/main.mjs`
  5. `plugins/feature-workflows/workflows/feature-pipeline.js` (generated via `npm run build`)

- **Changes:**

  1. **`src/engine-version.mjs` (new)**
     ```js
     import { meta } from './meta/feature-pipeline.meta.mjs'
     export const ENGINE_VERSION = meta.version
     ```
     Note in file comment: Node-only helper; must never enter `ENTRIES[].modules` (dist gets the injected literal instead). Source `meta.version` may be `0.0.0-dev`; production/tests use the **injected dist** literal.

  2. **`scripts/build-workflows.mjs`**
     - Emit after `metaSrc`, before module bodies:
       ```js
       const ENGINE_VERSION = '${version}';
       ```
     - Before scanning modules, register the injected name: `seen.set('ENGINE_VERSION', '<injected>')` so a later module `const ENGINE_VERSION` fails with a clear duplicate-name error
     - Assert `dist.includes(\`const ENGINE_VERSION = '${version}';\`)`
     - Post-emit: if `/\bmeta\./.test(dist)` throw with message citing sandbox / issue #17 (whole-dist scan; `export const meta =` does not match)
     - Keep existing checks unchanged
     - Update builder header comment to mention `ENGINE_VERSION` injection

  3. **`workflows/src/state.mjs`**
     - Replace `import { meta } …` with `import { ENGINE_VERSION } from './engine-version.mjs'`
     - `flushPipelineState`: `engineVersion: ENGINE_VERSION`

  4. **`workflows/src/main.mjs`**
     - Same import swap; resume skew uses `ENGINE_VERSION`

  5. **Rebuild:** `npm run build` and commit updated `feature-pipeline.js`

- **Error handling requirements:**
  - If `plugin.json` lacks `version`, builder already throws — keep that
  - Missing injection / `\bmeta\.` reintroduction → builder throws (issue #17 message)
  - Resume skew unchanged: warn only when `resumed.engineVersion` is present and differs; pre-1.5.0 states without the field stay silent
- **Status:** PENDING

### Step 2.3: Validation

- **Tests to run:**
  - `npm test`
  - `npm run validate:build`
  - `npm run validate:versions`
- **Expected results:** all green; dist header / meta.version / ENGINE_VERSION / plugin.json agree
- **All e2e cases must pass:** Yes — E2E-001..E2E-004 (static/harness stand-ins); dogfood E2E-005 if environment allows
- **Status:** PENDING

### Step 2.4: Documentation

- **Docs to update:**
  - `plugins/feature-workflows/workflows/docs/feature-pipeline-documentation.md` — note that runtime code must use `ENGINE_VERSION`, not `meta.*`, because the sandbox does not bind `meta`
  - Optionally one sentence in `plugins/feature-workflows/README.md` near the build/version section
  - Builder top-of-file comment in `scripts/build-workflows.mjs`
- **What to document:** sandbox binding constraint + `ENGINE_VERSION` injection; do not hand-edit dist
- **Status:** PENDING

## Phase 3: Hardening & release readiness

**Goal:** Ensure CI gates catch regressions; decide version bump / rollout.
**Depends on:** Phase 2

### Step 3.1: Test Preparation

- **Test files:** `tests/build-drift.test.mjs` (unchanged; still runs builder `--check` including new self-check)
- **Test cases:**
  - [ ] Manually confirm that temporarily adding `meta.version` back to `state.mjs` causes `npm run build` / `validate:build` to fail
  - [ ] Confirm `validate:versions` still only cares about plugin.json / header / meta.version (ENGINE_VERSION is a fourth mirror, not a fourth lockstep site — derived by build)
- **Test type:** build / CI gate
- **Status:** PENDING

### Step 3.2: Implementation

- **Files to modify/create:** none required beyond Phase 2 unless a changelog / issue close note is desired
- **Changes:**
  1. Recommend **patch release** `1.4.4` → `1.4.5` via normal release process (`npm run release` / `release-dispatch`) after merge — this is a user-facing runtime fix for installed engines
  2. Do **not** bump version inside the fix PR unless the project’s usual practice is “every main merge is a release”; default: fix PR lands at current version with rebuilt dist; release PR/dispatch bumps
- **Error handling requirements:** N/A
- **Status:** PENDING

### Step 3.3: Validation

- **Tests to run:** full suite as in Phase 2; optional dogfood `/feature-workflows:extract-design` on a small fixture repo past first slice consolidate
- **Expected results:** no `meta is not defined`; pipeline-state.json shows `engineVersion: "1.4.4"` (or new patch)
- **All e2e cases must pass:** Yes
- **Status:** PENDING

### Step 3.4: Documentation

- **Docs to update:** close-out note on issue #17; optional line in `docs/release-process.md` only if ENGINE_VERSION needs to be mentioned in lockstep prose (prefer: lockstep remains three-way; ENGINE_VERSION is build-derived)
- **What to document:** release notes should mention “fix Workflow sandbox ReferenceError: meta is not defined (#17)”
- **Status:** PENDING

## E2E Test Cases Summary

### E2E-001 — Dist has no runtime `meta.` access

- **Preconditions:** dist built from src
- **Steps:** Scan body after `export const meta` literal for `\bmeta\.`
- **Expected Result:** no matches; `ENGINE_VERSION` const present and equals header version
- **Status:** PENDING

### E2E-002 — `flushPipelineState` stamps matching engineVersion

- **Preconditions:** harness loads state module / dist helpers as today
- **Steps:** Call `flushPipelineState`; parse file-writer prompt JSON for `engineVersion`
- **Expected Result:** equals `// engine-version:` header
- **Status:** PENDING (existing test must remain green)

### E2E-003 — Resume skew warning preserved (**required**)

- **Preconditions:** synthetic resumed state with `engineVersion: '0.0.0'`
- **Steps:** Exercise skew branch via focused unit/harness coverage (none exists today — add it)
- **Expected Result:** `_resumeEngineSkew` set with `{ saved, current }`; current === `ENGINE_VERSION` / header; no ReferenceError
- **Status:** PENDING

### E2E-004 — Build + version validators green

- **Preconditions:** committed dist matches builder output
- **Steps:** `npm run validate:build` && `npm run validate:versions` && `npm test`
- **Expected Result:** exit 0; lockstep intact
- **Status:** PENDING

### E2E-005 — Dogfood extract-design past mid-slice consolidate (manual)

- **Preconditions:** plugin installed / dogfood symlink; small extractable target
- **Steps:** Run `/feature-workflows:extract-design` through scope resolution into at least one slice consolidate / state flush
- **Expected Result:** no `uncaught-throw: meta is not defined`; `pipeline-state.json` contains `engineVersion`
- **Status:** PENDING (manual / optional in CI)

## Memory Updates Required

- **mem:issue-17-meta-not-defined-architecture:** Record decision: sandbox does not bind `meta` at runtime; use build-injected `ENGINE_VERSION` for stamps/skew; keep `export const meta` for Workflow metadata only
  - **When to write:** After Phase 2 implementation
- **mem:issue-17-meta-not-defined-gotchas:** Node ESM tests bind `meta` so they miss this class of bug; always add dist self-checks for sandbox-unsafe identifiers; extract fails “mid-slice” because first flush is delayed until `planPath` exists
  - **When to write:** After all phases complete

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Node harness breaks if `ENGINE_VERSION` unbound in source modules | Medium | High | Use `engine-version.mjs` import in src (stripped in dist) + injected `const ENGINE_VERSION` in dist |
| Bare `\bmeta\b` ban false-positives on comments (e.g. `run meta showed`) | High if attempted | Medium | Hard-fail **only** `\bmeta\.` |
| Duplicate `ENGINE_VERSION` decl if module also defines it | Low | High | Do not add `engine-version.mjs` to `modules[]`; register `ENGINE_VERSION` in builder `seen` before module scan |
| Forgetting to rebuild dist | Medium | High | Existing `build-drift.test.mjs` + `validate:build` |
| Patch not released → dogfooders on old pin still hit bug | Medium | High | Ship patch release `1.4.5` after merge; note on issue #17 |
| Accidental removal of `export const meta` | Low | Critical | Existing builder requires meta literal start; phase ⊆ meta.phases check |

## Validation Gate

- [ ] All success criteria met
- [ ] All e2e test cases pass (E2E-005 optional if dogfood env unavailable — note in PR)
- [ ] All documentation updated
- [ ] All memories written
- [ ] No TODOs or placeholders remaining in implementation
- [ ] Code reviewed
- [ ] `npm test` && `npm run validate:build` && `npm run validate:versions` green

## Rollout

1. Land fix PR (src + build script + tests + rebuilt dist) against current `1.4.4` tree **or** bump to `1.4.5` in the same PR if maintainers prefer fix+release atomicity — **default recommendation: separate fix commit, then patch release `1.4.5`**.
2. Close issue #17 with verification notes (validators + optional dogfood).
3. Pin marketplace to the new tag per `docs/release-process.md`.

## Reference Documents

- [`references/sandbox-meta-binding.md`](./references/sandbox-meta-binding.md)
- [`references/engine-version-injection.md`](./references/engine-version-injection.md)
