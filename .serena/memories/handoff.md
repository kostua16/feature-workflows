# Handoff — current state & next actions

_Last updated: 2026-07-11 (embedded test-writer gate + removed pytest-runner)._

## Current state
- Implemented the accepted "Embed Test Writer And Remove Pytest Runner" plan in the feature-workflows plugin.
- `plugins/feature-workflows/workflows/feature-pipeline.js` now has an implement-mode `Test Authoring` phase that invokes `test-writer` after `designReady` and before both staged `plan-executor` execution and the `gsd-quick` path.
- Added resumable/config state for `useTestWriter`, `testsWritten`, `testWriterSummary`, and `_testWriter`.
- Added `--no-test-writer` command-surface docs for `implement-feature` and `feature-pipeline`.
- Removed `plugins/feature-workflows/agents/pytest-runner.md`; runtime test execution remains stack-agnostic through the `test-runner` persona.
- Updated metadata/docs from 32 to 31 agents and removed stale `pytest-runner` wording.
- Updated `test-writer` instructions to be stack-aware and to use the target project's existing test framework.

## Validation
- `npm run validate:agents` passed: `31 agents, 2 agentType ref(s), 30 persona ref(s) all resolve`.
- `npm test` passed: `90` tests.
- `npm run validate:versions` passed: `version lockstep OK: 1.1.0`.
- ESM syntax check for `plugins/feature-workflows/workflows/feature-pipeline.js` passed.
- Phase-label validation passed: `undeclared_count=0`.

## Uncommitted / untracked
- Implementation changes are unstaged.
- `.codegraph/` is unrelated and remains untracked; keep it out of commits unless explicitly requested.

## Next recommended actions
- Review the diff and commit with a conventional message such as `feat(workflows): add test-writer gate`.

Related: `mem:core`, `mem:session_start`, `mem:task_completion`, `mem:conventions`.
