---
phase: 2
slug: bounded-discovery-validated-graph-and-schedulability
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-22
last_audited: 2026-07-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test` + `node:assert`) |
| **Config file** | `package.json` scripts.test |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 02 | 1 | INV-01 | unit | `npm test` | tests/inventory.test.mjs | green |
| 2-01-02 | 02 | 1 | DISC-01 | unit | `npm test` | tests/discovery.test.mjs | green |
| 2-01-03 | 02 | 1 | GRAPH-01 | unit | `npm test` | tests/graph-validation.test.mjs | green |
| 2-01-04 | 02 | 1 | QUEUE-01 | unit | `npm test` | tests/queue-semantics.test.mjs | green |
| 2-01-05 | 02 | 1 | DEPCTX-01 | unit | `npm test` | tests/schedulability.test.mjs | green |
| 2-01-06 | 02 | 1 | ALL | integration | `npm test && npm run validate:build` | build + drift | green |

---

## Requirement Coverage

### INV-01: Deterministic inventory

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/inventory.test.mjs | 26 | Path classification (included/generated/vendor/ignored/excluded), deterministic digest, reordered-traversal stability, oversized area refinement, error handling |
| tests/phase02-nyquist-validation.test.mjs | 9 (shared) | Custom policy overrides (generatedSegments, ignoreSegments, generatedExtensions), include-pattern evidence, ignore-over-generated precedence, all-5-verdict inventory, evidence string on every entry, empty-string path edge case, exact-limit refinement |

**Status:** COVERED — deterministic inventory classification and digest verified across custom policies and all verdict types.

### DISC-01: Durable paginated discovery

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/discovery.test.mjs | 24 | Cursor creation, page advancement, stale-aware resume, exhaustion check, allPages, pageDigest, feature extraction |
| tests/phase02-nyquist-validation.test.mjs | 4 (shared) | 5-page resume without gaps/duplicates, all-excluded cursor exhaustion, empty-pages extraction, page-content independence from page size |

**Status:** COVERED — cursor-based pagination verified across multi-page interruptions and all-excluded inventories.

### GRAPH-01: Validated feature graph

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/graph-validation.test.mjs | 27 | Identity collision disambiguation, cycle detection (simple/self-loop/three-node/diamond/complex), classifyCycle (supported/unsupported), validateGraph (collision/dangling/cycle/ownership-gap/overlap), graphDigest determinism |
| tests/phase02-nyquist-validation.test.mjs | 11 (shared) | Multiple simultaneous errors, canonicalizeIdentity edge cases (empty/non-array), detectCycle non-array input, partial policy cycle classification, null inputs, null digest stability, unexplained path overlap detection, explained overlap via ownershipMap, disjoint-paths no-overlap |

**Status:** COVERED — all rejection types (collision, dangling, cycle, ownership gap, ownership overlap) verified individually and in combination.

### QUEUE-01: Truthful queue semantics

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/queue-semantics.test.mjs | 22 | Cap enforcement, selector application, deferred promotion, exact 23-feature/cap-8 progression (3 segments), queueDenominator, segmentProgression, idempotency, no-mutation |
| tests/phase02-nyquist-validation.test.mjs | 7 (shared) | Mixed lifecycle cap (deferred+runnable), combined include+exclude selector, failed-feature promotion isolation, excluded-feature promotion prevention, exactly-one-state proof, exclusion-never-completion invariant, zero-feature progression |

**Status:** COVERED — exactly-one-state guarantee verified across cap, selector, promotion, exclusion, and failure scenarios.

### DEPCTX-01: Schedulability and dependency context

| Test File | Tests | Coverage |
|-----------|-------|----------|
| tests/schedulability.test.mjs | 15 | Wave computation (independent/linear/diamond/cap-limited/cycle/no-progress), bounded dependency context (direct/transitive/visited/paths+digest), schedulabilityDecision (schedulable/cycle/no-progress) |
| tests/phase02-nyquist-validation.test.mjs | 7 (shared) | Unknown feature context, default maxDepth bounding, missing featureId throw, empty-features schedulability, cap-0 unlimited waves, edges-to-nonexistent filtered, no-edges empty context |

**Status:** COVERED — prerequisite waves, bounded dependency context, and schedulability decisions verified across edge cases.

---

## E2E Matrix Coverage (Phase 2 rows)

| E2E ID | Test Location | Status |
|--------|---------------|--------|
| E2E-DISC-01 | tests/phase02-nyquist-validation.test.mjs (reordered traversal → identical inventory/pages/features/digest) | green |
| E2E-GRAPH-01 | tests/phase02-nyquist-validation.test.mjs (all 5 rejection types + supported cycle) + tests/graph-validation.test.mjs | green |
| E2E-QUEUE-01 | tests/phase02-nyquist-validation.test.mjs (cap + selector + exclusion → exactly-one-state + exclusion-not-completion) | green |
| E2E-DEFER-01 | tests/phase02-nyquist-validation.test.mjs (full 3-segment flow, 23 features, cap 8, no double-processing) + tests/queue-semantics.test.mjs | green |

---

## Nyquist Gap Analysis Audit

### Audit Date: 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 8 |
| Resolved | 8 |
| Escalated | 0 |

### Gaps Identified and Filled

1. **INV-01 custom policy overrides** (MISSING → COVERED)
   - Gap: No tests for custom generatedSegments, ignoreSegments, or generatedExtensions overrides.
   - Fix: Added 3 tests verifying custom overrides change classification behavior; added include-pattern evidence test and ignore-over-generated precedence test.

2. **GRAPH-01 ownership overlap detection** (DEAD CODE → FIXED + COVERED)
   - Gap: `validateGraph` had dead code for ownership-overlap detection — `Object.entries(ownershipMap)` cannot produce duplicate keys, so `pathOwners.has(path)` was always false. The real overlap scenario (two features claiming the same path in their `paths` arrays) was never checked.
   - Fix: Rewrote the overlap detection in `graph-validation.mjs` to build a `pathClaims` map from features' `paths` arrays and detect when a path appears in multiple features. Unexplained overlap → error; ownershipMap-resolved overlap → warning. Updated the weak existing test (which accepted either verdict) to properly assert both unexplained-rejected and explained-allowed behavior.

3. **GRAPH-01 multiple simultaneous errors** (MISSING → COVERED)
   - Gap: No test exercised a graph with collision + dangling + overlap all at once.
   - Fix: Added test verifying all three error types are reported simultaneously.

4. **GRAPH-01 edge-case inputs** (PARTIAL → COVERED)
   - Gap: Missing tests for empty array, non-array input, null inputs, partial cycle policy.
   - Fix: Added 5 tests for canonicalizeIdentity empty/non-array, detectCycle non-array, classifyCycle partial policy, validateGraph null inputs, graphDigest null stability.

5. **QUEUE-01 mixed lifecycle and promotion edge cases** (PARTIAL → COVERED)
   - Gap: Missing tests for mixed deferred+runnable cap application, combined include+exclude selector, failed-feature promotion isolation, excluded-feature promotion prevention, and exactly-one-state proof.
   - Fix: Added 6 tests covering all these scenarios plus exclusion-never-completion and zero-feature progression.

6. **DEPCTX-01 edge cases** (PARTIAL → COVERED)
   - Gap: Missing tests for unknown feature context, default maxDepth behavior, missing featureId, empty features, cap-0 unlimited, and edges to non-existent features.
   - Fix: Added 7 tests covering all these edge cases.

7. **E2E-DISC-01 full pipeline determinism** (MISSING → COVERED)
   - Gap: No end-to-end test chaining paths → buildInventory → createCursor → allPages → extractFeaturesFromPages → graphDigest across reordered input.
   - Fix: Added comprehensive E2E test verifying identical inventory digest, pages, features, and coverage digest across reordered traversal with mixed path types.

8. **E2E-DEFER-01 full progression flow** (PARTIAL → COVERED)
   - Gap: Existing tests verified segments individually but not as one continuous 3-segment flow with explicit double-processing prevention.
   - Fix: Added test exercising the complete 23-feature/cap-8 three-segment flow with `processedEver` set tracking, verifying no feature is processed twice and all 23 are covered.

---

## Defect Fixed During Validation

### Defect: Dead ownership-overlap detection in `validateGraph`

**File:** `plugins/feature-workflows/workflows/src/graph-validation.mjs`

**Root cause:** The overlap detection iterated over `Object.entries(ownershipMap)`, which never produces duplicate keys for a standard JS object. The `pathOwners.has(path)` check was unreachable dead code. The actual overlap scenario — two features both listing the same path in their `paths` arrays — was not checked at all.

**Fix:** Replaced the dead intra-ownershipMap check with a `pathClaims` map built from features' `paths` arrays. When a path appears in multiple features, the overlap is either explained (ownershipMap resolves it to one claimant → warning) or unexplained (no ownershipMap or unresolved → error). Also preserved the ownership-gap check (ownershipMap referencing unknown features) and the ownership-unassigned warning.

---

## Success Criteria Verification

1. ✅ **Deterministic discovery:** Reordered traversal produces identical inventory pages, feature identities, coverage denominator, and graph digest (inventory.test.mjs + phase02-nyquist-validation.test.mjs E2E-DISC-01)
2. ✅ **Graph validation rejects unsafe graphs:** Identity collisions, ownership gaps/overlap, dangling edges, and unsupported cycles all produce explicit errors (graph-validation.test.mjs + phase02-nyquist-validation.test.mjs E2E-GRAPH-01)
3. ✅ **23-feature/cap-8 progression:** Segments report exactly 8/15, 16/7, 23/0 with every feature promoted exactly once (queue-semantics.test.mjs + phase02-nyquist-validation.test.mjs E2E-DEFER-01)
4. ✅ **Exactly-one-state + bounded context:** Every feature has one lifecycle state; scheduled leaves receive bounded verified dependency context (queue-semantics.test.mjs + schedulability.test.mjs + phase02-nyquist-validation.test.mjs)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] All MISSING references covered by gap-filling tests
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Build drift: `npm run build` + `npm run validate:build` clean (33 modules, 314 top-level names)
- [x] One real defect fixed (dead overlap detection code)

**Approval:** approved 2026-07-22

**Test totals after validation:** 883 pass / 0 fail (836 pre-validation + 46 new validation tests + 1 test split from existing overlap test)
