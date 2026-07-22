---
requirements-completed:
  - DIST-01
---

# Phase 3: Multi-Entry Build, Install, and Version Lockstep — Summary

**Phase:** 3
**Completed:** 2026-07-22
**Requirements:** DIST-01

## What was built

1. **Leaf meta** (`src/meta/fp-extract-slice.meta.mjs`): Minimal 2-phase meta for the
   `fp-extract-slice` leaf workflow. Declares only `Extract Slice` and `Design Audit`
   — the only phases the leaf's module set actually references.

2. **Leaf entry function** (`src/extract-slice-entry.mjs`): `extractSliceMain()` parses
   sandbox args, validates the slice spec, sets up result/sliceState, delegates to
   `extractSlice()`, and returns a structured outcome. The leaf owns only per-feature
   extraction gates; no discovery, scheduling, synthesis, continuation, or readiness.

3. **Multi-entry build script** (`scripts/build-workflows.mjs`): Extended from one entry
   to two. Added per-entry `tail` configuration (top-level calls `main()`, leaf calls
   `extractSliceMain()`). Leaf module list = all shared modules except `main.mjs` (dead
   `main` import binding never called at runtime), plus `extract-slice-entry.mjs`.

4. **Version lockstep validator** (`scripts/validate-plugin-versions.mjs`): Extended from
   3-way (plugin.json + 1 dist header + 1 meta.version) to N-surfaces (plugin.json +
   both dist headers + both meta.version fields). Reports entry count on success.

5. **Multi-entry test suite** (`tests/multi-entry-build.test.mjs`): 22 characterization
   tests covering build drift, entry structure, version lockstep, sandbox safety, ESM
   validity, leaf-specific guarantees (no main(), minimal phases, extractSliceMain tail),
   copy install resolution, symlink install resolution, and marketplace packaging.

## Key design decisions

- **Excluding main.mjs from the leaf**: All `phase()` calls outside extract-slice.mjs
  live exclusively in main.mjs. By excluding it, the leaf dist contains only 2 phase
  labels, so the leaf meta declares exactly 2 phases — clean separation of concerns.
- **Same shared module set**: The leaf includes all 23 non-main modules (schemas, config,
  state, lifecycle, migration, revision, inventory, discovery, graph-validation,
  queue-semantics, schedulability, etc.) because extractSlice's transitive dependency
  chain pulls them in. Dead code in the dist is harmless and ensures correctness.
- **Per-entry tail**: Build script now supports configurable sandbox tails per entry,
  making it straightforward to add future workflow entries if needed.

## Test coverage

22 new tests in `tests/multi-entry-build.test.mjs`:

- Build drift: both entries byte-identical to fresh build (2 tests)
- Entry structure: existence, banner, headers, meta.version, ENGINE_VERSION, tails (8 tests)
- Leaf-specific: no main(), has extractSliceMain(), 2-phase meta, correct name (4 tests)
- Sandbox safety: forbidden tokens, no CR, ESM validity (3 tests)
- Version lockstep: validator passes, all headers agree (2 tests)
- Install resolution: copy install, symlink install (2 tests)
- Packaging: both entries inside plugin subtree (1 test)

**Total test count:** 397 (375 existing + 22 new), all passing.

## Evidence

- **Build:** `npm run build` produces 2 dist files, both drift-free (`validate:build` passes)
- **Lockstep:** `validate:versions` reports "1.4.5 (2 entries)" — all surfaces agree
- **ESM:** Both entries pass `node --input-type=module --check` with neutralized tail
- **Agents:** `validate:agents` reports 31 agents OK
- **Backward compatibility:** All 375 existing tests remain green; no existing code modified

## Success Criteria Verification

1. ✅ A clean build deterministically emits both entries with no generated drift or sandbox violation
2. ✅ Both copy and symlink installs resolve both entries through the production installed-plugin lookup
3. ✅ Plugin manifest, both generated headers/metadata, and packaged contents report one version and include both entries
