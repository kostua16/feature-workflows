# Task completion — definition of done

A coding task in this repo is DONE only when all of the below hold.

## If the change touched `.claude/workflows/feature-pipeline.js`
1. **ESM syntax check passes** (mandatory — plain `node --check` is NOT sufficient):
   ```bash
   cd .claude/workflows
   sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
     | node --input-type=module --check      # exit 0, no output = pass
   ```
2. **Phase-label validation passes** — `undeclared_count=0` (every `phase('X')` /
   `stateCheckpoint('X', …)` maps to a `meta.phases` entry). See `mem:suggested_commands`.
3. **No direct FS/shell added to the script** — all I/O stays inside sub-agents (`agent()`).
   `agent()` results are null-checked (`.filter(Boolean)`) before use.
4. New/changed gates keep the state machine idempotent and the `pipeline-state.json` /
   `--resume` contract intact.

## Always
- No syntax errors; code is parseable/compilable.
- Conventional-commit message; **no AI references** in commit messages.
- Do NOT commit secrets or `.claude/settings.local.json` (gitignored). Never commit `.env`.
- Code comments explain the *why*, not plan-artifact references (no phase numbers / finding codes).
- **Update `mem:handoff`** with the new state + next actions, and write the next handoff to
  `.remember/remember.md`.

## Tests
- This repo has no test suite of its own. `pytest-runner` is the pipeline's Gate 4 for the *target*
  projects the pipeline operates on — run it there, not here, unless tests are added to this repo.

Related: `mem:conventions`, `mem:suggested_commands`.
