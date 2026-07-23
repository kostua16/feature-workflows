---
phase: 15
slug: slice-ownership-reconciliation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
validated: 2026-07-24
---

# Phase 15 — Validation Strategy

> Nyquist validation for Phase 15 (OWN-01 / D2.1 — pure `reconcileSlices` ownership reconciliation).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in test runner) |
| **Config file** | package.json `test` script |
| **Quick run command** | `node --test tests/slice-ownership-reconciliation.test.mjs tests/slice-ownership-reconciliation-nyquist.test.mjs` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~14 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/slice-ownership-reconciliation.test.mjs tests/slice-ownership-reconciliation-nyquist.test.mjs`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 14 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01 | 15-PLAN | 1 | OWN-01 (pure reconcile) | LLM/flag hint contamination | No flags/hints; pure (persistedSlices, currentFiles) | unit + source-assertion | `node --test tests/slice-ownership-reconciliation.test.mjs` | YES | COVERED |
| 15-02 | 15-PLAN | 1 | OWN-01 (prefix score) | False-positive assignment | Max-prefix-score + lex-smallest tie-break | unit | `node --test tests/slice-ownership-reconciliation.test.mjs` | YES | COVERED |
| 15-03 | 15-PLAN | 1 | OWN-01 (clustering) | Too many/few slices | Union-find on 2-seg dir; singleton fallback | unit | `node --test tests/slice-ownership-reconciliation.test.mjs` | YES | COVERED |
| 15-04 | 15-PLAN | 1 | OWN-01 (move detection) | False move on duplicate content | Unique content match required; dup → ADD | unit + integration | both test files | YES | COVERED |
| 15-05 | 15-PLAN | 1 | OWN-01 (partition) | Silent ownership loss/gain | validatePartition throws on violation | unit + source-assertion | both test files | YES | COVERED |

---

## Validation Dimensions

### Dimension 1 — Permutation Invariance of sliceIds

| Scenario | Expected | Test ID |
|----------|----------|---------|
| 5 input shuffles with 3 new slices | identical sliceIds + full output | NYQ-PERM-1 |
| Permutation with moves present | identical output across shuffles | NYQ-PERM-2 |
| Reorder only persistedSlices | identical output | NYQ-PERM-3 |
| Reorder only currentFiles | identical output | NYQ-PERM-4 |
| Delta arrays canonical-sorted | sorted by path/sliceId | NYQ-PERM-5 |
| Cluster file order inside newSlices sorted | sorted by path | NYQ-PERM-6 |
| clusterByTwoSegDir reorder | same groupings | (existing test) |

### Dimension 2 — Exactly-One-Owner Partition Invariant

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Unchanged scenario | partition holds | NYQ-PART-1 |
| Mixed add+remove+move+new | partition holds | NYQ-PART-2 |
| Multiple new slices different dirs | partition holds | NYQ-PART-3 |
| Empty currentFiles (vacuous) | partition holds | NYQ-PART-4 |
| Duplicate content | partition holds | NYQ-PART-5 |
| All slices removed except new | partition holds | NYQ-PART-6 |
| Move across slices | partition holds | NYQ-PART-7 |
| Synthetic overlap (defense-in-depth) | validatePartition throws | NYQ-PART-8 |
| Removed slice in partition check | skipped (no false positive) | NYQ-PART-9 |

### Dimension 3 — Duplicate-Content Conservative Add

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Cross-slice duplicate (2 slices) | ADD not MOVE | NYQ-DUP-1 |
| 3 old files share digest | ADD not MOVE; all 3 removed | NYQ-DUP-2 |
| Old path still present + copy | ADD (not move) | NYQ-DUP-3 |
| Simultaneous unique-move + dup-add | unique moves, dup adds | NYQ-DUP-4 |
| detectMoves boundary: >=2 old paths | ADD returned | NYQ-DUP-5 |

### Dimension 4 — Empty→Removed Terminal State Machine

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Emptied slice status exactly 'removed' | terminal | NYQ-TERM-1 |
| Emptied slice in removedSlices | recorded | NYQ-TERM-2 |
| All files moved away (to new paths) | NOT removed (moves preserve owner) | NYQ-TERM-3 |
| Partial loss (some kept) | pending, not removed | NYQ-TERM-4 |
| Previously-removed slice stays removed | carries through | NYQ-TERM-5 |
| Multiple slices emptied | all removed + sorted | NYQ-TERM-6 |
| Content-modified slice | pending (not removed) | NYQ-TERM-7 |

### Dimension 5 — Overlap Lex-Smallest Resolution (Defense-in-Depth)

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Normal unchanged scenario | overlaps empty | NYQ-OVER-1 |
| Mixed scenario | overlaps empty | NYQ-OVER-2 |
| Shared directory prefix (tie-break) | overlaps empty | NYQ-OVER-3 |
| Source: lex-smallest sort in resolution | owners.sort() + owners[0] | NYQ-OVER-4 |
| Source: loser files filtered | filter + indexOf | NYQ-OVER-5 |
| Schema shape for overlaps items | additionalProperties:false | NYQ-OVER-6 |

### Dimension 6 — Schema Deep Validation + Boundary Robustness

| Scenario | Expected | Test ID |
|----------|----------|---------|
| RECONCILE_FILE 2 required props | path, contentSha256 | NYQ-SCHEMA-1 |
| RECONCILE_DELTA 6 required keys | all categories | NYQ-SCHEMA-2 |
| All item schemas additionalProperties:false | enforced | NYQ-SCHEMA-3 |
| added items required fields | path+contentSha256+sliceId | NYQ-SCHEMA-4 |
| moved items required fields | old+new+hash+sliceId | NYQ-SCHEMA-5 |
| overlaps items required fields | path+winner+loser | NYQ-SCHEMA-6 |
| newSlices files use RECONCILE_FILE | shared shape | NYQ-SCHEMA-7 |
| removedSlices is string[] | type assertion | NYQ-SCHEMA-8 |
| null/null inputs | empty output, no throw | NYQ-EDGE-1 |
| []/[] inputs | empty output | NYQ-EDGE-2 |
| undefined inputs | empty output | NYQ-EDGE-3 |
| Slice missing files array | treated as empty | NYQ-EDGE-4 |
| Slice with empty files array | removed | NYQ-EDGE-5 |
| Duplicate current paths | collapses to one owner | NYQ-EDGE-6 |
| All persisted slices removed | new slices only | NYQ-EDGE-7 |
| computePrefixScore empty inputs | score 0 | NYQ-EDGE-8/9 |
| clusterByTwoSegDir empty input | [] | NYQ-EDGE-10 |
| detectMoves empty input | empty result | NYQ-EDGE-11 |
| Move + content changed | NOT a move (hash mismatch) | NYQ-EDGE-12 |

### Dimension 7 — Idempotency + Canonical Output Form

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Reconcile output again → empty delta | steady state | NYQ-IDEM-1 |
| Idempotency on complex mixed scenario | empty delta + partition | NYQ-IDEM-2 |
| outputSlices sorted by sliceId | canonical | NYQ-CANON-1 |
| Files inside slices sorted by path | canonical | NYQ-CANON-2 |
| delta.added sorted by path | canonical | NYQ-CANON-3 |
| delta.removed sorted by path | canonical | NYQ-CANON-4 |
| delta.moved sorted by newPath | canonical | NYQ-CANON-5 |
| delta.newSlices sorted by sliceId | canonical | NYQ-CANON-6 |

### Dimension 8 — Source Assertions (Purity + Structure)

| Scenario | Expected | Test ID |
|----------|----------|---------|
| No I/O/agent/randomness in reconcile block | pure | NYQ-SRC-1 |
| validatePartition called before return | guard enforced | NYQ-SRC-2 |
| Canonical sort block (>=7 sorts) | permutation-invariant | NYQ-SRC-3 |
| detectMoves early-continue on known paths | no double-classification | NYQ-SRC-4 |
| Prefix-score slices pre-sorted by sliceId | lex-smallest tie-break | NYQ-SRC-5 |
| deriveClusterSliceId uses sorted hashes | permutation-invariant base | NYQ-SRC-6 |
| Collision probe deterministic ascending | counter from 1 | NYQ-SRC-7 |
| RECONCILE_FILE/DELTA exported | schema export | NYQ-SRC-8 |

---

## Manual-Only

None. All OWN-01 requirements have automated verification.

---

## Sign-Off

- **Nyquist compliant:** YES
- **Total tests (this phase):** 128 (59 baseline + 69 Nyquist characterization)
- **Full suite:** 2055 pass / 0 fail
- **Build drift:** None (dist up to date, 33 modules / 362 top-level names)
- **Validated by:** autonomous `/gsd-validate-phase 15 --auto` (2026-07-24)

---

## Validation Audit 2026-07-24

| Metric | Count |
|--------|-------|
| Gaps found | 6 (5 focus areas + schema/boundary) |
| Gaps filled | 69 characterization tests |
| Defects found | 0 (algorithm correct; overlap detection is defense-in-depth dead code by design — algorithm prevents any path from appearing in multiple slices) |
| Escalated | 0 |

### Key findings

1. **Overlap detection is defense-in-depth dead code.** The algorithm builds `ownerByPath` as a `Map<path, sliceId>` (one owner per path), so no path can ever appear in multiple output slices. The overlap resolution block (lex-smallest wins, loser files filtered) is a safety net that never fires under normal operation. Characterized by NYQ-OVER-1..6.

2. **Move detection is conservative by design.** Any content ambiguity (≥2 old paths share a digest) routes to ADD, not MOVE. The `detectMoves` early-continue on `oldPathMap.has(path)` prevents double-classification. Characterized by NYQ-DUP-1..5 and NYQ-EDGE-12.

3. **Permutation invariance is structural.** The final sort block (7+ `.sort()` calls on every delta array and outputSlices) guarantees canonical output regardless of input order. Verified across 5+ shuffles with moves and multiple new slices.

4. **Idempotency holds.** Reconciling the output with the same `currentFiles` yields an empty delta (steady state), even for complex mixed scenarios.
