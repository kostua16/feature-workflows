---
phase: 15
slug: slice-ownership-reconciliation
status: verified
verdict: MET
verified_at: 2026-07-24
verified_by: autonomous-uat
method: goal-backward UAT
tests_pass: 2055
tests_fail: 0
---

# Phase 15 — UAT Verification

> Goal-backward UAT of Phase 15 (OWN-01 / D2.1 — pure `reconcileSlices` ownership reconciliation).
> Autonomously verified; no human interaction required.

## Goal

> When scope membership changes, each current file is owned by exactly one slice
> via a pure deterministic algorithm.

**Success Criteria**: (1) every add/remove/move/empty/new-slice/overlap case
deterministic; (2) exactly-one-owner holds; (3) ids permutation-invariant.

## Verdict: MET

All three success criteria verified against delivered source with passing tests,
an empirical goal-backward UAT probe (29 checks), and source-level purity
assertions (15 checks).

## Verification Method

Goal-backward UAT — each goal component was decomposed backward into observable
properties, then verified three ways:

1. **Empirical UAT probe** — a standalone script that imports `reconcileSlices`
   from the shipped dist and exercises every algorithm case with real inputs,
   checking the partition invariant, delta correctness, permutation invariance,
   determinism, and edge-case handling directly (29 checks, all pass).
2. **Source assertions** — regex/structural checks on the dist source confirming
   purity (no agent/LLM/I/O/randomness), exact 2-param signature, partition
   guard, and canonical sort block (15 checks, all pass).
3. **Test suite** — 128 Phase 15 tests (59 baseline + 69 Nyquist characterization)
   plus 2055 full-suite tests, all green; build drift-free.

## Goal Decomposition (backward)

### 1. "pure deterministic algorithm" — OWN-01 (purity + determinism) — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| `reconcileSlices(persistedSlices, currentFiles)` — exactly 2 params, no flags/hints | `extract-scope.mjs:1103` — `function reconcileSlices(persistedSlices, currentFiles)` | RED-2, UAT-source |
| No agent calls / async / I/O | No `safeAgent`/`flexibleAgent`/`async`/`require(` in reconcile block (extract-scope.mjs:988-1290) | RED-3, 53, NYQ-SRC-1 |
| No `Math.random` / `Date.now` / `crypto` / `createHash` | Source assertion — all absent from the helper+reconcile block | RED-3, 59, NYQ-SRC-1 |
| All helpers pure (computePrefixScore, clusterByTwoSegDir, deriveClusterSliceId, detectMoves, validatePartition) | extract-scope.mjs:990,1009,1040,1052,1080 — plain functions, no agent calls | 54, NYQ-SRC-1 |
| Deterministic — same inputs → identical outputs | UAT probe: `JSON.stringify(reconcileSlices(p,a))===JSON.stringify(reconcileSlices(clone,a))` | UAT-probe determinism |
| Hashes consumed, never computed (no new `crypto` import) | extract-scope.mjs export block — `reconcileSlices` absent from hashing code; hashes read from agent-provided input | 59, NYQ-SRC-8 |

### 2. "each current file owned by exactly one slice" — SC-2 (partition invariant) — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| `validatePartition` throws on no-owner | `extract-scope.mjs:1092-1093` — `if (count === 0) throw` | 43, NYQ-PART-* |
| `validatePartition` throws on multi-owner | `extract-scope.mjs:1094` — `if (count > 1) throw` | 44, NYQ-PART-8 |
| `validatePartition` called before return | `extract-scope.mjs:1283` — `validatePartition(outputSlices, current)` before sort+return | 45, NYQ-SRC-2 |
| Removed slices skipped in partition check | `extract-scope.mjs:1086` — `if (s.status === 'removed') continue` | 46, NYQ-PART-9 |
| Partition holds across all scenarios | UAT probe: `validatePartitionCheck` on all 7 scenarios + edges (29/29) | UAT-probe all |

### 3. "every add/remove/move/empty/new-slice/overlap case deterministic" — SC-1 — MET

| Case | Evidence | UAT Probe |
|------|----------|-----------|
| **Unchanged** — empty delta | extract-scope.mjs:1196 `if (!hasChanges) status = orig.status` | S1: delta.added/removed/moved/newSlices all 0 |
| **Added (prefix-score)** — assigned to highest-scoring non-removed slice | extract-scope.mjs:1130-1144 `computePrefixScore` loop, best score > 0 → assign | S2: `src/auth/logout.ts` → slice-aaa1 |
| **Zero-score new slice (2-seg-dir clustering)** — union-find groups by first-2-seg dir | extract-scope.mjs:1009-1038 union-find; 1150-1160 cluster → new slice | S3: 2 files in `lib/db/` → 1 new slice |
| **Move (unique content match, old path gone)** — new path to old owner | extract-scope.mjs:1052-1078 `detectMoves` — `oldPaths.length === 1 && !currentPathSet.has(oldPath)` → move | S4: login.ts → login-renamed.ts, delta.moved |
| **Duplicate content → conservative add (NOT move)** — ≥2 old paths share digest | extract-scope.mjs:1069 `else { adds.push(cf) }` (length !== 1) | S5: 2 old files share digest → NOT move, both removed |
| **Empty slice → removed terminal** | extract-scope.mjs:1191-1193 `if (owned.length === 0) { status = 'removed'; delta.removedSlices.push(...) }` | S6: empty slice → removed |
| **Removed slice excluded** — never an assignment candidate | extract-scope.mjs:1116 `if (sl.status !== 'removed') nonRemovedSlices.push(sl)` | S7: added file → slice-bbb2, never slice-aaa1 (removed) |
| **Overlap → lex-smallest wins** | extract-scope.mjs:1255-1273 `owners.sort(); winner = owners[0]`; losers logged | NYQ-OVER-1..6 |

### 4. "ids permutation-invariant" — SC-3 — MET

| Sub-goal | Evidence | Tests |
|----------|----------|-------|
| `deriveClusterSliceId` uses sorted hashes | `extract-scope.mjs:1041` — `hashes.sort()` before picking `[0]` | 16, NYQ-SRC-6 |
| Prefix-score candidates pre-sorted by sliceId | `extract-scope.mjs:1126-1128` — `sortedNonRemoved = nonRemovedSlices.slice().sort(...)` | NYQ-SRC-5 |
| Collision probe deterministic ascending | `extract-scope.mjs:1044` — `n = 1; while (...) n++` | 17, NYQ-SRC-7 |
| Canonical sort block (7+ sorts before return) | extract-scope.mjs:1286-1296 — delta.added, removed, moved, newSlices, removedSlices, overlaps, outputSlices all sorted | 37, NYQ-SRC-3, UAT-source |
| Full output identical across input shuffles | UAT probe: reversed + shuffle2 → `JSON.stringify` deep-equal | UAT-probe SC3 |

## RED Gate Verification (all must fail before implementation — confirmed fixed)

| RED Gate | Status | Evidence |
|----------|--------|----------|
| Ownership must not depend on LLM/flag | PASS | 2-param signature; no agent calls in block; UAT-source 15/15 |
| Removed slices must not receive new files | PASS | extract-scope.mjs:1116 excludes removed from candidates; UAT-probe S7 |
| Moves must not false-positive on duplicate content | PASS | detectMoves length===1 check; UAT-probe S5 (2 dups → add, not move) |

## Schema Verification

| Schema | Evidence | Tests |
|--------|----------|-------|
| `RECONCILE_FILE` — 2 required props, additionalProperties:false | `schemas.mjs:1145-1153` | NYQ-SCHEMA-1, 55 |
| `RECONCILE_DELTA` — 6 required keys, additionalProperties:false | `schemas.mjs:1156-1234` | NYQ-SCHEMA-2, 55 |
| Both exported from schemas.mjs | `schemas.mjs:1238` export block | 57-59 |
| Meta phases include `Reconcile Slices` | `meta/feature-pipeline.meta.mjs:48` | 57 |

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| slice-ownership-reconciliation.test.mjs | 59 | 59 | 0 |
| slice-ownership-reconciliation-nyquist.test.mjs | 69 | 69 | 0 |
| **Phase 15 subtotal** | **128** | **128** | **0** |
| **Full suite** | **2055** | **2055** | **0** |

Build drift: clean — both dist files up to date (33 modules, 362 top-level names each).

## UAT Probe Summary (29/29 pass)

Autonomous goal-backward probe exercising `reconcileSlices` with real scenarios:

- S1 Unchanged — empty delta, partition holds
- S2 Added via prefix-score — assigned to existing slice, no new slices
- S3 Zero-score new slice — 2 files in `lib/db/` clustered into 1 new slice
- S4 Move detection — unique content match, old path gone → move logged
- S5 Duplicate content — 2 old files share digest → add (NOT move), both removed
- S6 Empty slice → removed terminal
- S7 Removed slice excluded — added file never assigned to removed slice
- SC-3 Permutation invariance — reversed + shuffle2 → identical JSON output
- Determinism — same inputs → identical outputs
- Edge cases — null/null, []/[], undefined/undefined all safe
- Idempotency — second pass yields empty delta

## Scope Boundary Confirmation

Phase 15 implements ONLY D2.1 (pure ownership reconciliation). The following are
NOT in scope and correctly absent from the delivered code:

- D2.2 (change detection — full-digest comparison) — Phase 16
- D2.3 (invalidation chain — `invalidateSliceChain`, `onSliceRemoved`) — Phase 17
- D3 (upsert entrypoints — `--update`, `--force`) — Phase 18
- D4 (migration/adopt — `--adopt`) — Phase 18
- Integration of `reconcileSlices` into the extract-mode update flow — Phase 16/17

## Commits Verified

- `dccf14c` — docs(15): plan slice ownership reconciliation (D2.1)
- `727db85` — feat(extract): add pure reconcileSlices ownership reconciliation (D2.1)
- `20afe3f` — test(phase-15): Nyquist validation — 69 characterization tests fill coverage gaps

## Notes

- Overlap resolution (lex-smallest wins, loser files filtered) is defense-in-depth
  dead code by design — the algorithm builds `ownerByPath` as a `Map<path,
  sliceId>` (one owner per path), so no path can ever appear in multiple output
  slices under normal operation. Characterized by NYQ-OVER-1..6 (always empty in
  real scenarios; source assertions confirm the resolution logic exists).
- The 15-VALIDATION.md count of 128 tests (59 baseline + 69 Nyquist) matches
  the actual test run exactly. Full-suite count matches (2055).

## Conclusion

Phase 15 goal is **MET**. The pure `reconcileSlices` function delivers all OWN-01
requirements: prefix-score assignment (removed slices excluded as candidates),
2-segment-directory union-find clustering with permutation-invariant sliceIds,
content-fingerprint move detection (duplicate content → conservative remove+add),
empty-slice → removed terminal state, overlap lex-smallest resolution
(defense-in-depth), and the exactly-one-owner partition invariant (validated
before return). No defects found.
