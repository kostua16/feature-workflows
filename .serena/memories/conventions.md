# Conventions — code style & design

## Naming & files
- **kebab-case, long descriptive filenames** — self-documenting for LLM tools (Grep/Glob). Length
  is fine if it aids clarity.
- Guideline: keep code files <200 LOC and modularize by concern. **Deliberate exception:**
  `.claude/workflows/feature-pipeline.js` (~3.9k LOC) is a single ES-module workflow — the Claude
  Code runtime loads ONE script per workflow, so it cannot be split across files. Keep it cohesive
  and well-sectioned instead.

## Comments
- Explain the **why** (invariant, race, trade-off), not the origin. **Never** reference plan
  artifacts in code/comments/filenames — no phase numbers, finding codes (F1/Y1), audit labels.
  Allowed: symbol names, stable external IDs (RFC, SQLSTATE, CVE, durable issue numbers).

## Dynamic-workflow design patterns (for editing feature-pipeline.js)
- **`pipeline()` is the default** for multi-stage fan-out; use `parallel()` only when a later stage
  needs all results at once (it is a barrier).
- **Give `agent()` a strict JSON `schema`** whenever its result feeds code.
- **`label` every agent in a fan-out** (usually the file/module name) — makes the progress tree
  readable. Open groups with `phase()`.
- **Adversarial verify** — one agent does the work, a second independent agent checks it.
- **`agent()` returns `null` on failure** — always `.filter(Boolean)` before further processing.
- Keep stages **idempotent** (resume replays them) and the `pipeline-state.json` contract stable.
- No direct FS/shell in the script (see `mem:core`).

## Git
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). **No AI
  references** in messages. Never commit secrets / `.env` / `.claude/settings.local.json`.

Related: `mem:core`, `mem:task_completion`.
