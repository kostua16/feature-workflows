---
phase: 14
slug: feature-identity-registry-lookup-integrity
status: pending
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 14 — Validation Strategy

> Nyquist validation for Phase 14 (REGISTRY-01, MATCH-01, COLLISION-01, INTEGRITY-01 / D1.2–D1.4).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js built-in test runner) |
| **Config file** | package.json `test` script |
| **Quick run command** | `node --test tests/feature-identity-registry.test.mjs tests/registry-integrity-recovery.test.mjs` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~16 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/feature-identity-registry.test.mjs tests/registry-integrity-recovery.test.mjs`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 16 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01 | 14-PLAN | 1 | REGISTRY-01 | Registry corrupt/missing | readRegistry fail-closed; writeRegistry atomic temp-then-rename | unit + source-assertion | `node --test tests/feature-identity-registry.test.mjs` | NO | PENDING |
| 14-02 | 14-PLAN | 1 | MATCH-01 | Ambiguous/weak match silently mismerges | findFeature defensible threshold; weak/tie blocked | unit + source-assertion | `node --test tests/feature-identity-registry.test.mjs` | NO | PENDING |
| 14-03 | 14-PLAN | 1 | COLLISION-01 | Folder overwrite across features | checkFolderCollision full-digest comparison; abort on mismatch | unit + source-assertion | `node --test tests/feature-identity-registry.test.mjs` | NO | PENDING |
| 14-04 | 14-PLAN | 1 | INTEGRITY-01 | Torn JSON / stale recovery / missing evidence | atomic writes; root-last readiness; recoverRegistry fail-closed | unit + source-assertion | `node --test tests/registry-integrity-recovery.test.mjs` | NO | PENDING |

---

## Validation Dimensions

### Dimension 1 — Boundary Conditions (findFeature)

| Scenario | Expected Decision | Test ID |
|----------|-------------------|---------|
| Full rename (all paths changed, same hashes) | reuse (content match) | 5 |
| Anchor match only (paths changed, anchor preserved) | reuse | 5 |
| Majority match (>= majority of min counts) | reuse | 6 |
| Zero strong candidates | new | 7 |
| Tie — two candidates, equal match counts | blocked (ambiguous) | 9 |
| Weak-only (shared config, no anchor, no majority) | blocked (weak-only) | 10 |
| Shared file that is majority for small but not large feature | uses min() correctly | 11 |
| Empty registry | new | 12 |
| Empty currentFiles | blocked | 13 |
| Path+hash dual match deduplication | counts once | 14, 60 |

### Dimension 2 — Schema Deep Validation

| Schema | Property | Constraint | Test ID |
|--------|----------|------------|---------|
| REGISTRY_ENTRY | additionalProperties | false | 28 |
| REGISTRY_ENTRY | required fields | 7 required | 29 |
| REGISTRY_FILE | features | object with additionalProperties | 30 |
| REGISTRY_ENTRY | status enum | extracting/current/stale | 31 |
| REGISTRY_ENTRY | files items | additionalProperties false | 32 |

### Dimension 3 — Collision Guard Boundaries

| Scenario | Expected | Test ID |
|----------|----------|---------|
| No existing identity | no collision | 24 |
| Same ownershipScopeDigest | no collision (idempotent) | 25 |
| Different ownershipScopeDigest | collision (abort) | 26 |
| Full 64-hex comparison (not truncated) | source assertion | 27 |

### Dimension 4 — Recovery Scenarios

| Scenario | Expected | Test ID |
|----------|----------|---------|
| Complete pipeline-state → rebuild files, status current | recovered | 45 |
| Missing pipeline-state → stale, recoveryError | fail-closed | 46 |
| Missing identity sidecar → stale, recoveryError | fail-closed | 47 |
| Immutable from sidecar (not stale registry) | source assertion | 48 |
| Mutable from current pipeline-state (not creation-time) | source assertion | 49 |
| Corrupt registry → scan sidecars | rebuilt | 50 |
| Corrupt registry, no sidecars | fail-closed | 51 |
| Empty registry → no-op | no error | 52 |
| Multiple extracting entries → independent recovery | each recovered | 53 |

### Dimension 5 — Atomicity + Ordering

| Property | Assertion | Test ID |
|----------|-----------|---------|
| writeRegistry uses temp-then-rename | source assertion | 19, 42 |
| Authority order documented | source assertion | 43 |
| Root-last: status commit is final write | source assertion | 44 |
| Registry entry starts 'extracting' | source assertion | 38 |
| Root-last updates to 'current' | source assertion | 39 |

### Dimension 6 — Integration Wiring (main.mjs)

| Integration Point | Assertion | Test ID |
|-------------------|-----------|---------|
| findFeature called after preflight | source assertion | 33 |
| 'reuse' → uses reused planDir | source assertion | 34 |
| 'new' → collision guard before promotion | source assertion | 35 |
| 'blocked' → blocked handoff, no promotion | source assertion | 36 |
| Registry updated after promotion | source assertion | 37 |

### Dimension 7 — Cross-cutting Invariants

| Invariant | Assertion | Test ID |
|-----------|-----------|---------|
| findFeature is pure (no agent calls) | source assertion | 54 |
| upsertRegistryEntry is pure | source assertion | 55 |
| No Math.random/Date.now in pure functions | source assertion | 56 |
| Meta phases declared | source assertion | 57 |
| Registry path is docs/extract/.registry.json | source assertion | 58 |
| readIdentitySidecar validates IDENTITY_RECORD | source assertion | 59 |

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have automated verify
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 16s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending implementation
