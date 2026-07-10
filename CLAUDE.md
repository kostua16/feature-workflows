# Claude Code Project Instructions

## Idea

This project shall be a claude code plugin\marketplace app that allows users to run created dynamic workflows created in this project.

## Mandatory rules for all agents (FOLLOW THESE RULES STRICTLY WITHOUT EXCEPTIONS)

- Always activate the Serena project named `feature_workflows` (path: "$CWD") using the Serena `activate-project` tool before any code exploration or edits.
- Always read `mem:core` to load the current roadmap and project invariants.
- Always read `mem:handoff` to load the current project state and next recommended actions.
- Always read `mem:session_start` to load the current handoff and roadmap context.
- Always read `mem:task_completion` to load the definition of done for coding tasks in this project.
- Always read `mem:suggested_commands` to load the common commands for this project.
- Always read `mem:memory_maintenance` to load the memory maintenance rules for this project.
- Always read `mem:conventions` to load the code style and design conventions for this project.
- Always spawn 'task-definition-architect' agent to define the detailed task from the user's request.
- Always spawn 'git-ops' agent to perform git operations instead of doing it yourself.
- Always spawn 'code-explorer' agent to explore the codebase instead of doing it yourself.
- Always spawn 'file-summarizer' agent to summarize files instead of doing it yourself.
- Always spawn 'file-writer' agent to write files instead of doing it yourself.
- Always spawn 'pytest-runner' agent to run pytest tests instead of doing it yourself.
- Always spawn 'plan-architect' agent to create a plan for the task instead of doing it yourself. For any non-trivial task, you should create a plan first.
- Always spawn 'critical-reviewer' agent to review the plan instead of doing it yourself, check his feedback carefully and make sure to address all issues before proceeding to the the next step.
- Always spawn 'plan-executor' agent to execute the plan instead of doing it yourself. You should also enforce any quality standards defined by the plan.
- Always spawn 'plan-refiner' agent to refine the plan instead of doing it yourself, check his feedback carefully and make sure to address all issues before proceeding to the next step.
- Always spawn 'critical-reviewer' agent to review the code before finishing task/making commit, check his feedback carefully and make sure to address all issues before proceeding to the next step.
- Always spawn 'arch-design-orchestrator' agent to create a high-level architecture design for the feature/change/CR.
- Always spawn 'detailed-design-architect' agent to create a detailed design for the feature/change/CR after the high-level architecture design is created.
- Always spawn 'design-plan-reconciler' agent to compare a plan created by the 'plan-architect' agent against design artifacts produced by 'arch-design-orchestrator', 'detailed-design-architect', and 'e2e-usecase-extractor' to identify inconsistencies, gaps, or conflicts.
- Always spawn 'docs-architecture-publisher' agent to publish the plan and architecture design to the project documentation.
- Always spawn 'tdd-plan-enforcer' agent to enforce TDD and YAGNI principles on the plan, and update it with TDD gates, RED test sections, and GREEN success/exit criteria.
- Always spawn 'e2e-usecase-extractor' agent to identify and define end-to-end (e2e) use cases / test scenarios for the task, feature, or high-level architecture design.
- Always spawn 'knowledge-persist' agent to capture and persist session findings (gaps, issues, evidences, recommendations, review rejects, patterns, gotchas, or any actionable knowledge) into CLAUDE.md and Serena memories for future sessions and agents to learn from.
- Always spawn 'project-knowledge-consultant' agent to consult the project knowledge and findings to answer questions and provide guidance.
- Always spawn 'user-interviewer' agent to gather information, decisions, or clarifications from the user via structured interviews.
- Always spawn 'todo-store' agent to track, query, or update task progress in the shared todo store.
- Always spawn 'complex-decision-analyst' agent to make a complex decision when the user is facing a difficult technical problem but hasn't defined specific options.
- Always spawn 'quick-decider' agent to make a quick decision when the user needs a fast recommendation.
- Always spawn 'prompt-enhancer' agent to improve, refine, or strengthen prompt intended for another agent or LLM.
- Always spawn 'design-reviser' agent to revise the design document based on the feedback from the 'critical-reviewer' agent.
- Always spawn 'prompt-translator' agent to translate the user's input into English if it's not in English.
- Always spawn 'requirements-collector' agent to collect requirements from the user.
- Always spawn 'feature-categorizer' agent to categorize the feature/change/CR into the project's structured taxonomy.
- Always spawn 'plan-chunker' agent to chunk the plan into smaller, more manageable parts.
- Always spawn 'test-writer' agent to write tests for the feature/change/CR.
- Always run shell commands using the Serena `execute_shell_command` tool instead of using a Bash tool or similar.
- Always read related documents in the 'docs' folder and serena memories before starting any task.
- Once useful notes/knowledge are found, always capture them in the 'docs' folder and serena memories.
