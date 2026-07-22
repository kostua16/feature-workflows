# Phase 3: Multi-Entry Build, Install, and Version Lockstep — Plan

**Phase:** 3
**Requirements:** DIST-01
**Mode:** Auto (TDD: RED first, then GREEN)
**Depends on:** Phase 2 (inventory, discovery, graph-validation, queue-semantics, schedulability)

## Overview

The source build must produce exactly two supported workflow entries: the top-level
`feature-pipeline.js` and the `fp-extract-slice.js` leaf. Both entries share version
metadata injected from plugin.json, are validated for drift in lockstep, and resolve
through both copy and symlink install paths. The version lockstep validator enforces
that plugin manifest, both generated headers, both meta.version fields, marketplace
contents, and installed entries all report one version and include both entries.

## Canonical References

- `scripts/build-workflows.mjs` — single-entry build script to extend
- `scripts/validate-plugin-versions.mjs` — 3-way lockstep to extend to both entries
- `plugins/feature-workflows/workflows/src/meta/feature-pipeline.meta.mjs` — top-level meta
- `plugins/feature-workflows/workflows/src/extract-slice.mjs` — leaf function (extractSlice)
- `plugins/feature-workflows/.claude-plugin/plugin.json` — version source of truth

## Key Insight

All `phase()` calls outside extract-slice.mjs live exclusively in main.mjs. By excluding
main.mjs from the leaf entry's module list, the leaf dist only contains `phase('Extract Slice')`
and `phase('Design Audit')`, so the leaf meta declares only those 2 phases. No module
actually calls `main()` at runtime — the import is a dead binding across all 5 importing modules.

---

## Task 1: Leaf meta and entry function

**Files to create:**
- `plugins/feature-workflows/workflows/src/meta/fp-extract-slice.meta.mjs`
- `plugins/feature-workflows/workflows/src/extract-slice-entry.mjs`

**RED:** Build fails — no second entry exists.
**GREEN:** Both files created; entry function parses args and calls extractSlice.

---

## Task 2: Multi-entry build script

**Files to modify:**
- `scripts/build-workflows.mjs`

**Changes:**
- Add per-entry `tail` field (configurable sandbox tail)
- Add second ENTRIES element for `fp-extract-slice.js`
- Leaf modules = all top-level modules except main.mjs, plus extract-slice-entry.mjs

**RED:** Build script still emits one entry.
**GREEN:** `npm run build` emits both entries with same version.

---

## Task 3: Version lockstep validator

**Files to modify:**
- `scripts/validate-plugin-versions.mjs`

**RED:** Validator only checks one dist file.
**GREEN:** Validator checks both dist files' headers and meta.version against plugin.json.

---

## Task 4: Multi-entry tests

**Files to create:**
- `tests/multi-entry-build.test.mjs`

**Coverage:**
- Both entries drift-free after clean build
- Both entries present in dist with correct structure
- Version lockstep: plugin.json, both headers, both meta.version agree
- Leaf meta declares only its 2 phases
- Leaf dist does not contain top-level main() call
- Copy/symlink install resolution simulation

---

## Success Criteria

1. Clean build emits both entries deterministically with no drift or sandbox violation
2. Both copy and symlink installs resolve both entries through production lookup
3. Plugin manifest, both generated headers/metadata, marketplace, and installed entries report one version
