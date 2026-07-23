# Agents overview — 31 sub-agents (`plugins/feature-workflows/agents/*.md`)

All namespaced `feature-workflows:<agent>` when spawned. Spawned by the engine/workflow as needed.
See `mem:conventions` for how they're written; descriptions were trimmed to headline-only in `eceafe3`.

## Design / architecture
- **arch-design-orchestrator** — high-level architecture design (create/modify/review/align).
- **detailed-design-architect** — detailed technical design for a component/feature.
- **design-plan-reconciler** — reconcile design docs vs implementation plans.
- **design-reviser** — apply reviewer feedback into a design doc.
- **e2e-usecase-extractor** — extract end-to-end use cases from requirements/code.
- **requirements-collector** — elicit/structure functional + non-functional requirements.
- **feature-categorizer** — classify a feature into the project taxonomy.
- **docs-architecture-publisher** — publish/organize architecture documentation.

## Planning
- **task-definition-architect** — detailed task spec + acceptance criteria + subtask breakdown.
- **plan-architect** — structured implementation plan before code.
- **plan-chunker** — split a large plan into dependency-ordered `stageNN.md` execution stages.
- **plan-executor** — execute a plan to completion (gates/standards enforced, atomic commits).
- **plan-refiner** — refine/improve an existing plan.
- **tdd-plan-enforcer** — enforce TDD gates/RED-GREEN in a plan.

## Execution / code / tests
- **simple-task-executor** — trivial well-defined edits/renames/config/boilerplate.
- **file-writer** — create/update files with specific content.
- **test-writer** — write TDD RED-then-GREEN tests from e2e/NFRs/plan goals.

## Review
- **critical-reviewer** — rigorous review of code/design/plan/task for bugs, OWASP, flaws.

## Exploration / files / knowledge
- **code-explorer** — explore/search/read/analyze project code.
- **file-summarizer** — summarize large files without blowing the context window.
- **project-knowledge-consultant** — consult existing project knowledge/docs.
- **knowledge-persist** — persist codebase knowledge/patterns/decisions for future sessions.

## Decisions
- **complex-decision-analyst** — high-stakes multi-option decisions (use instead of quick-decider when stakes/ambiguity high).
- **quick-decider** — fast recommendation among a small option set (1–4 turns).

## Prompts / i18n / user
- **prompt-enhancer** — improve/strengthen a prompt for another agent/LLM.
- **prompt-translator** — translate non-English input to clear English (verbatim if already EN).
- **user-interviewer** — gather requirements/decisions via structured questioning (AskUserQuestion).

## Git / ops / utilities
- **git-ops** — all git operations (status/branch/commit/merge/rebase/log…).
- **todo-store** — manage the shared task/todo list.
- **performance-auditor** — audit/tune perf, SQL, profile, diagnose slowdowns.
- **compress-agent** — in-session caveman markdown compression (spawned by the compress-md skill).

Notes:
- The project `CLAUDE.md` mandates spawning these (e.g. git-ops for git, code-explorer for exploration,
  file-writer for writes, plan-architect for plans, critical-reviewer for review) — see `mem:core`.
- A sub-agent cannot spawn the Skill/Task tool, so when driven through GSD commands they execute the
  workflow inline rather than nesting sub-agents.
