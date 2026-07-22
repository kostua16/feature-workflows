# src → dist build mapping

The workflow dist files are **generated** — never hand-edit them. Built by `scripts/build-workflows.mjs`
(root). Run via `npm run build` (write) or `npm run validate:build` (`--check`, fails on drift). The dist
must equal a clean build at every commit. See `mem:workflows-overview`.

## Why generation
The Claude Code `Workflow` sandbox CANNOT resolve ESM imports, so each dist file is a **flat
self-contained concatenation**: banner → `export const meta` literal → `const ENGINE_VERSION` → module
bodies (in manifest order) → sandbox tail. Source modules use real ESM import/export (so Node + the test
harness import them directly); the build **strips** `import ...` and `export { ... }` lines and emits the
rest verbatim.

## Two entries (`ENTRIES` in the build script)
| dist file | meta | tail (entry point) | modules |
|-----------|------|--------------------|---------|
| `feature-pipeline.js` (top-level) | `src/meta/feature-pipeline.meta.mjs` | `const final = await main(); return final` | 32 modules ending in **`main.mjs`** |
| `fp-extract-slice.js` (leaf) | `src/meta/fp-extract-slice.meta.mjs` | `const final = await extractSliceMain(); return final` | SAME 31 shared modules, but **`main.mjs` dropped** and **`extract-slice-entry.mjs`** appended (32 total) |

Shared module emit order (both entries): schemas, config, text-utils, state, lifecycle, migration,
revision, inventory, discovery, graph-validation, queue-semantics, schedulability, budget-admission,
retry-policy, failure-isolation, continuation, synthesis, observe-persist, status-truth, stages-issues,
tune, extract-scope, review-mode, extract-slice, publish-persist, test-run, agent-core, json-repair,
review-loop, decisions, design-budget, design-loops. (Top-level then appends `main.mjs`; leaf appends
`extract-slice-entry.mjs`.)

## Critical rules
- **`src/engine-version.mjs` is Node-only — NEVER listed in `modules[]`.** The dist gets an injected
  `const ENGINE_VERSION = '<version>'` instead. The sandbox does not bind `meta` at runtime (issue #17),
  so runtime code must use `ENGINE_VERSION`, never `meta.version`. See `mem:issue-17-meta-not-defined-architecture`.
- **Version is injected from `plugins/feature-workflows/.claude-plugin/plugin.json`** into `meta.version`,
  `ENGINE_VERSION`, and the `// engine-version:` banner header — all three in lockstep
  (`npm run validate:versions` checks the N-surface agreement).
- Top-level `const`/`function`/`let` names must be unique across all modules (the build fails on duplicates).
- No CRLF (LF only); source modules containing `\r` are rejected.

## Build self-checks (per dist, fail the build if violated)
No CRLF; no forbidden tokens (`require(`, `Date.now(`, `Math.random(`, `new Date()`, `meta.` access);
every `phase('X')` is declared in `meta.phases`; ESM syntax via `node --input-type=module --check`
(neutralizing the sandbox-only top-level `return final`).

## Workflow after editing `workflows/src/*.mjs`
`npm run build` → `npm run validate:build` (drift) → `npm test` (1470 tests) → commit src + BOTH dist
files. Bump version in lockstep (plugin.json + header + meta.version) when the engine version changes.
