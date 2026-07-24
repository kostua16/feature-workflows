# Phase 12: Pending-Confirmation Protocol & Promotion — Summary

**Phase:** 12
**Completed:** 2026-07-23
**Requirements:** PROMO-01, PROMO-02, LOCATOR-01
**Commit:** 21b8796 (feat) · c8cc972 (Nyquist characterization, 107 tests)

## What was built

1. **Write-free preflight (`resolveScopePreflight`)** — resolves scope via the
   code-explorer agent but captures the verdict in-memory, returning
   `{ pendingId, task, verdict, state: 'PENDING', createdAt }` and writing zero
   files. `generatePendingId(task, timestamp)` is SHA-256-based (no
   `Math.random`/`Date.now`).
2. **`--confirm <pendingId>` handler (main.mjs)** — new entrypoint leg that
   reads `docs/extract/.pending/<pendingId>.json`, promotes PENDING records,
   redirects PROMOTED/EXPIRED records to `--resume <planDir>`, and returns a
   blocked handoff for unknown IDs. The fresh-run path now writes the pending
   record and hands back the `pendingId` instead of the `planDir`.
3. **Atomic, crash-idempotent promotion (`promotePendingRecord`)** — NEW branch
   creates folder + `.identity.json` stub + `scope-manifest.md` +
   `pipeline-state.json` (root-last); EXISTING branch loads and updates state
   without touching identity/ownership. Each write is temp-then-rename;
   replay after PROMOTED redirects rather than re-promoting.
4. **Permanent compact locator + 30-day payload TTL** —
   `docs/extract/.pending-locator.json` indexes `pendingId → planDir` so
   `--confirm` always resolves (even after the bulky `.pending/<id>.json`
   payload expires). `appendLocatorEntry`/`resolveLocatorEntry`/`isPendingExpired`
   are pure helpers; TTL is strict `>` 30 days.
5. **Schemas + meta + docs** — `PREFLIGHT_VERDICT`, `PENDING_RECORD`,
   `LOCATOR_ENTRY` (all `additionalProperties: false`); `Pending Confirm` and
   `Promote` meta phases declared; `extract-design.md` documents the
   `--confirm` protocol, TTL, and primary-vs-fallback paths.

## Test results

- 1628/1628 full suite green (1470 baseline + 158 Phase 12).
- Build drift-free; six-mode compatibility preserved (`--confirm` only active
  in extract mode; `scopeConfirmed` fallback retained).
