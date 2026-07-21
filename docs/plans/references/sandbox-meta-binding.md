# Reference: Workflow sandbox vs Node — `meta` binding

**Purpose:** Explain why issue #17 (`meta is not defined`) appears in Claude Code Workflow execution but not in Node-based tests.

## Dist shape

`scripts/build-workflows.mjs` concatenates:

1. Banner (includes `// engine-version: X.Y.Z`)
2. `export const meta = { name, version, description, phases, … }` (version injected from `plugin.json`)
3. Module bodies from `workflows/src/*.mjs` with `import` lines and trailing `export { … }` stripped
4. Sandbox tail: `const final = await main()` / `return final`

## Node ESM (tests / harness)

Loading the dist (or source modules) as real ESM creates a module scope where `export const meta` **is** a live binding. Identifiers like `meta.version` resolve. Therefore:

- `tests/config-and-state.test.mjs` and friends can pass while the sandbox still fails
- Harness coverage alone is insufficient for sandbox binding assumptions

## Workflow sandbox (Claude Code)

The sandbox **requires** `export const meta` for workflow metadata (name, version, phase titles for progress UI). Observed behavior for issue #17:

- Meta is extracted for UI/progress
- The executable body is evaluated **without** a runtime binding named `meta`
- First evaluation of `meta.version` → `ReferenceError: meta is not defined` → surfaced as `uncaught-throw: meta is not defined`

## Why extract mode fails “mid-slice”

`consolidate()` only calls `flushPipelineState()` when `result.planPath` is set. Extract mode completes scope resolution without an immediate consolidate that stamps state; the first stamp often occurs at scope-confirm pause or mid-/post-slice checkpoints. Any consolidating mode (design / implement / tune / extract / review) is affected; extract merely surfaced it first.

## Rule for engine authors

- **Allowed:** `export const meta = { … }` for sandbox metadata only
- **Forbidden in runtime logic:** reading `meta.*` (or any bare `meta` identifier) inside concatenated module bodies
- **Use instead:** build-injected `ENGINE_VERSION` (see `engine-version-injection.md`)
