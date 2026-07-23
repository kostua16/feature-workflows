# Phase 16: Change Detection — Summary

**Phase:** 16
**Completed:** 2026-07-24
**Requirements:** CHANGE-01
**Commit:** 6c0ae80 (feat) · 4c933fc (Nyquist characterization, 22 tests filling sampling gaps)

## What was built

1. **Pure `frameSliceDigest(fileHashes)`** — sorts a slice's per-file hashes by
   path ascending and JSON-stringifies them as `[path, contentSha256]` pairs.
   Deterministic and permutation-invariant; the pair structure guarantees
   framed distinctness (`["ab","c"]` ≠ `["a","bc"]`). No crypto in the body.
2. **Pure `validateDigest64Hex(digest)`** — `{valid: true}` only for
   64-lowercase-hex strings; rejects empty/non-string/uppercase/wrong-length.
3. **Pure fail-closed `detectSliceChanges(persistedDigests, currentDigests)`**
   — six decision reasons: `digest-match` (unchanged), `digest-mismatch`,
   `new-slice`, `slice-removed`, `current-invalid`, `persisted-invalid`. Any
   missing/malformed/invalid digest is classified `changed` (never skip).
   `current-invalid` takes precedence when both sides are bad.
4. **Agent-mediated `computeSliceDigests`** — single agent call (label
   `slice-digest`, phase `Change Detection`, `SLICE_DIGEST_RESULT` schema)
   computes SHA-256 over each slice's framed string; the engine never hashes.
5. **Agent-mediated persistence** — `writeSliceDigestFile` validates the digest
   via `validateDigest64Hex` BEFORE the agent write (fail-closed: returns null
   on invalid); `readSliceDigestFile` returns the stored `{files, digest}` +
   validity flag (null when the file is absent).
6. **Orchestrator `runChangeDetection`** — partitions file hashes by slice,
   frames, hashes, validates, reads persisted digests, compares, and persists
   new digests. `force=true` overrides every decision to `changed/forced`;
   `result._sourceDigest` is set from the Phase 13 `scopeDigest`;
   `extractReady=false` when any slice is `current-invalid`. Does NOT call
   `invalidateSliceChain` (Phase 17 scope).
7. **Schemas + meta** — `SLICE_DIGEST`, `SLICE_DIGEST_RESULT`
   (`additionalProperties: false`); `Change Detection` meta phase declared;
   new functions registered in the harness CANDIDATES.

## Test results

- 2187/2187 full suite green (2055 baseline + 132 Phase 16).
- Framed distinctness, fail-closed matrix, and 5-/10-file permutation
  invariance (120 and 50 shuffles) all verified.
