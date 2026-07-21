# Gotchas — issue #17 sandbox meta binding

1. Node ESM + test harness bind `export const meta`, so unit tests can miss sandbox ReferenceErrors. Always add dist self-checks for sandbox-unsafe identifiers.
2. Extract fails "mid-slice" because `consolidate()` only calls `flushPipelineState` when `result.planPath` is set; scope resolution itself does not flush.
3. Do NOT ban bare `/\bmeta\b/` — comments already contain the word (e.g. "run meta showed"). Ban only `/\bmeta\./`.
4. Comments in concatenated modules must not contain `meta.` either — the whole-dist scan catches them.
5. Never list `engine-version.mjs` in modules[] — would duplicate ENGINE_VERSION with the injected const.

Related: mem:issue-17-meta-not-defined-architecture.
