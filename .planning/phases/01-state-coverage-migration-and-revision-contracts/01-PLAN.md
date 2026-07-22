# Phase 1: State, Coverage, Migration, and Revision Contracts — Plan

**Phase:** 1
**Requirements:** CONTRACT-01, STATE-01, REV-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Nothing (first phase)

## Overview

Establish the foundational state contracts: pure lifecycle/readiness reducers, sharded
per-feature state with root-last migration, and selective revision invalidation. These
are pure-function modules with no I/O — they feed later phases that wire them into the
workflow engine's extract pipeline.

## Canonical References

- `docs/project-scale-extract-design-architecture.md` — milestone architecture
- `plugins/feature-workflows/workflows/src/state.mjs` — current state management (364 LOC)
- `plugins/feature-workflows/workflows/src/extract-scope.mjs` — current extract queue (180 LOC)
- `tests/harness.mjs` — test harness (CANDIDATES array for export injection)
- `tests/config-and-state.test.mjs` — existing state validation tests
- `tests/pure-functions.test.mjs` — existing pure function tests

---

## Task 1: RED — Lifecycle reducer table tests (CONTRACT-01)

**Files to create:**
- `tests/lifecycle-reducers.test.mjs`

**Instructions:**

Write characterization tests that MUST FAIL because the functions they import do not exist yet.
The test file imports from the harness and tests these functions: `LIFECYCLE_STATES`,
`SKIP_REASONS`, `applyLifecycleEvent`, `deriveReadiness`, `isTerminal`, `isIncomplete`.

Test cases (all must initially fail on import or assertion):

1. **Illegal transition rejected:** `applyLifecycleEvent({lifecycle:'completed'}, {type:'start'})` must throw or return an error state — `completed` cannot transition to `in-progress`.
2. **Byte-stable replay:** Replaying the same ordered event stream twice produces deep-equal lifecycle projections.
3. **No input mutation:** `applyLifecycleEvent(state, event)` does not mutate `state` (deep-equal before and after).
4. **Incomplete coverage not ready:** A project manifest with any `deferred`, `blocked`, `in-progress`, or `failed` features has `deriveReadiness() === {ready: false}`.
5. **Feature-level skipped is incomplete:** `isIncomplete('skipped')` with skip-reason `feature-level` returns `true`. `deriveReadiness` treats it as not-ready.
6. **Policy-disabled optional-gate skip may complete:** A feature with lifecycle `skipped`, skip-reason `policy-disabled-optional`, and recorded policy evidence may transition to `completed`. `deriveReadiness` counts it as complete.
7. **Required-gate skip blocks completion:** A feature with lifecycle `skipped`, skip-reason `required-gate` cannot transition to `completed`. `deriveReadiness` blocks.
8. **Excluded is outside denominator:** `deriveReadiness` does not count `excluded` features in the coverage denominator.
9. **All terminal states recognized:** `isTerminal('completed')`, `isTerminal('failed')`, `isTerminal('excluded')` all return `true`. Non-terminal states return `false`.
10. **All incomplete states recognized:** `isIncomplete('deferred')`, `isIncomplete('blocked')`, `isIncomplete('in-progress')`, `isIncomplete('skipped')` (feature-level) all return `true`.

Add `LIFECYCLE_STATES`, `SKIP_REASONS`, `applyLifecycleEvent`, `deriveReadiness`, `isTerminal`, `isIncomplete` to the harness CANDIDATES array.

**RED evidence:** `npm test` fails because harness cannot find these declarations in the engine source.

---

## Task 2: RED — Migration fault-injection tests (CONTRACT-01)

**Files to create:**
- `tests/migration.test.mjs`

**Instructions:**

Write characterization tests that MUST FAIL because the migration functions do not exist yet.
Tests import: `migrateLegacyState`, `deriveFeatureId`, `validateMigrationBoundary`.

Test cases:

1. **Root acknowledged before children durable:** `validateMigrationBoundary` with phase `'before-root'` and unvalidated children returns `{ok: false}`.
2. **Root acknowledged after all children validated:** `validateMigrationBoundary` with phase `'after-children'` and all children validated returns `{ok: true}`.
3. **Interruption at child write boundary resumes idempotently:** Calling `migrateLegacyState` twice with the same interrupted input produces the same output (idempotent).
4. **Mixed-version ready state never observable:** After partial migration, `deriveReadiness` on the partially-migrated state returns `{ready: false}`.
5. **Feature ID derivation is deterministic:** `deriveFeatureId` on the same legacy slice input produces the same canonical ID across calls.
6. **Legacy slice queue converts to sharded lifecycle:** `migrateLegacyState` converts legacy `'pending'` slices to `'deferred'` and `'skipped'` (cap-exceeded) to `'deferred'` with recorded rationale.
7. **Legacy completed artifacts re-verified:** Migration includes a revision-check step for completed features (initially fails because revision check does not exist).

Add `migrateLegacyState`, `deriveFeatureId`, `validateMigrationBoundary` to harness CANDIDATES.

**RED evidence:** `npm test` fails on missing declarations.

---

## Task 3: RED — Revision invalidation tests (REV-01)

**Files to create:**
- `tests/revision-invalidation.test.mjs`

**Instructions:**

Write characterization tests that MUST FAIL because revision functions do not exist yet.
Tests import: `computeDigest`, `compareRevisions`, `selectiveInvalidate`, `retainValidEvidence`.

Test cases:

1. **Digest is deterministic:** `computeDigest` on the same input string returns the same digest across calls.
2. **Digest is content-sensitive:** Different inputs produce different digests.
3. **Revision comparison detects changes:** `compareRevisions` with changed source returns the affected feature IDs.
4. **Revision comparison preserves unchanged:** `compareRevisions` with no changes returns empty affected set.
5. **Selective invalidation targets only affected gates:** `selectiveInvalidate` with a source-digest change invalidates only the code-facts and architecture gates (which depend on source), not the plan or tests gates.
6. **Independent evidence retained:** After selective invalidation, gates whose inputs did not change remain valid.
7. **Artifact revision change invalidates only that artifact's gate:** Changing one artifact's digest invalidates its owning gate only.

Add `computeDigest`, `compareRevisions`, `selectiveInvalidate`, `retainValidEvidence` to harness CANDIDATES.

**RED evidence:** `npm test` fails on missing declarations.

---

## Task 4: GREEN — Implement lifecycle reducers (CONTRACT-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/lifecycle.mjs`

**Instructions:**

Implement the pure lifecycle reducer module. All functions are pure, deterministic, no I/O.

1. **`LIFECYCLE_STATES`** — frozen object:
   ```
   RUNNABLE: 'runnable', DEFERRED: 'deferred', IN_PROGRESS: 'in-progress',
   BLOCKED: 'blocked', FAILED: 'failed', SKIPPED: 'skipped',
   EXCLUDED: 'excluded', COMPLETED: 'completed'
   ```

2. **`SKIP_REASONS`** — frozen object:
   ```
   FEATURE_LEVEL: 'feature-level',
   POLICY_DISABLED_OPTIONAL: 'policy-disabled-optional',
   REQUIRED_GATE: 'required-gate'
   ```

3. **`applyLifecycleEvent(state, event)`** — pure transition reducer:
   - Takes `{lifecycle, skipReason?, policyEvidence?}` and `{type, payload?}`
   - Event types: `'admit'`, `'start'`, `'block'`, `'fail'`, `'skip'`, `'exclude'`, `'complete'`
   - Returns new state object (does NOT mutate input)
   - Throws on illegal transitions (e.g., `completed → in-progress`)
   - Skip events require `skipReason` in payload
   - `complete` events check skip-reason: `required-gate` blocks, `policy-disabled-optional` requires `policyEvidence`, `feature-level` blocks

4. **`deriveReadiness(projectManifest)`** — pure readiness derivation:
   - Takes `{features: [{id, lifecycle, skipReason?, policyEvidence?}], schemaVersion}`
   - Returns `{ready: boolean, denominator: number, completed: number, remaining: number, blocked: number, failed: number, skipped: number, excluded: number}`
   - `ready = completed == denominator AND no incomplete features`
   - `excluded` features are outside the denominator
   - Feature-level `skipped` is incomplete; `policy-disabled-optional` with evidence may be completed; `required-gate` skipped blocks

5. **`isTerminal(lifecycleState)`** — `true` for `completed`, `failed`, `excluded`

6. **`isIncomplete(lifecycleState)`** — `true` for `deferred`, `blocked`, `in-progress`, `skipped` (feature-level)

Add `lifecycle.mjs` to the build meta module list at `src/meta/feature-pipeline.meta.mjs` if needed.

**GREEN evidence:** `npm test` passes all lifecycle reducer tests (Task 1). `npm run build` produces valid dist.

---

## Task 5: GREEN — Implement root-last migration (CONTRACT-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/migration.mjs`

**Instructions:**

Implement the pure migration module. All functions are pure, deterministic, no I/O.

1. **`deriveFeatureId(legacySlice)`** — deterministic canonical identity:
   - Input: `{id, name, files, entryPoints}` from legacy extract queue
   - Output: stable kebab-case ID derived from name/files (not array index)

2. **`migrateLegacyState(legacyState)`** — pure transform from v1.4.5 to v1.5.0:
   - Input: legacy `pipeline-state.json` structure (result with slices array)
   - Output: `{schemaVersion: '1.5.0', features: [{id, lifecycle, shardRef, skipReason?, policyEvidence?}], status: 'migrating'|'migrated'}`
   - Legacy `'pending'` → `'deferred'`
   - Legacy `'skipped'` (cap-exceeded) → `'deferred'` with recorded rationale
   - Legacy `'completed'` → `'completed'` (pending re-verification via revision)
   - Idempotent: calling twice produces the same output

3. **`validateMigrationBoundary(state, phase)`** — fault-injection boundary check:
   - `phase: 'child-write'` — checks if a specific child shard is durable
   - `phase: 'before-root'` — returns `{ok: false}` if any child is not validated
   - `phase: 'after-children'` — returns `{ok: true}` if all children are validated
   - Root acknowledgement only after all children durable

**GREEN evidence:** `npm test` passes all migration tests (Task 2). `npm run build` produces valid dist.

---

## Task 6: GREEN — Implement revision/digest invalidation (REV-01)

**Files to create:**
- `plugins/feature-workflows/workflows/src/revision.mjs`

**Instructions:**

Implement the pure revision and selective invalidation module. All functions are pure, no I/O.

1. **`computeDigest(input)`** — deterministic hash:
   - Uses the same djb2 algorithm as `stateChecksum` (already in `state.mjs`) or SHA-256
   - Input: string or object (objects are `JSON.stringify`-ed with sorted keys for determinism)
   - Output: hex string

2. **`compareRevisions(oldRevisions, newRevisions)`** — diff revision sets:
   - Inputs: `{source?, scope?, graph?, deps?, artifacts: {gateName: digest}}`
   - Output: `{affectedFeatures: [...], affectedGates: [...]}` — only changed entries

3. **`selectiveInvalidate(featureShard, revisionDelta)`** — invalidate only affected gates:
   - Input: feature shard `{gates: {codeFacts: {digest, valid}, arch: {digest, valid}, ...}}` and delta
   - Output: updated shard with only affected gates marked invalid
   - Gate-dependency map: source → codeFacts, arch; scope → codeFacts; graph → arch; deps → arch; artifacts → their owning gate only

4. **`retainValidEvidence(featureShard)`** — filter to independently valid evidence:
   - Returns shard with only gates whose inputs did not change still marked valid

**GREEN evidence:** `npm test` passes all revision tests (Task 3). `npm run build` produces valid dist.

---

## Task 7: Wire modules into build and verify full suite

**Files to modify:**
- `tests/harness.mjs` — ensure all new function names are in CANDIDATES
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — add new source modules if the build requires explicit listing

**Instructions:**

1. Verify all new functions are in the harness CANDIDATES array:
   `LIFECYCLE_STATES, SKIP_REASONS, applyLifecycleEvent, deriveReadiness, isTerminal, isIncomplete, migrateLegacyState, deriveFeatureId, validateMigrationBoundary, computeDigest, compareRevisions, selectiveInvalidate, retainValidEvidence`

2. Run `npm run build` — verify no build errors

3. Run `npm run validate:build` — verify no drift

4. Run `npm test` — ALL tests pass (existing + new)

5. Verify ESM validity of new source modules

**Success Criteria:**
- All 183+ existing tests pass
- All new lifecycle, migration, and revision tests pass
- Build produces clean dist with no drift
- ESM validation passes for all new modules

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Harness CANDIDATES regex misses new declarations | Low | Use `\b(?:function\|const\|let)\s+` pattern consistently |
| Build concatenation order matters | Low | Check `meta/feature-pipeline.meta.mjs` for explicit ordering |
| Existing extract-mode tests break | Low | New modules are additive; no existing code modified |
| djb2 collision on revision digests | Very Low | Use the existing hash for consistency; upgrade path exists |

## Security Considerations

- All new modules are pure functions with no I/O — no attack surface
- Digests use djb2 (non-cryptographic) — sufficient for change detection, not security
- Migration is read-only on legacy state — no destructive operations
- No secrets, credentials, or sensitive data in any new code
