# Session start — bootstrap context

Read this first each session, then follow its pointers.

1. **What this project is:** read `mem:core` (roadmap + invariants). TL;DR — a Claude Code
   workflow-orchestration framework (`.claude/` config), NOT an app. Core artifact:
   `.claude/workflows/feature-pipeline.js` (ES-module engine, 3 modes: design/implement/tune).
2. **Where things stand + what to do next:** read `mem:handoff`.
3. **Definition of done for coding tasks:** read `mem:task_completion`.
4. **Common commands (ESM/phase-label validation, git):** read `mem:suggested_commands`.
5. **Code style & design conventions:** read `mem:conventions`.
6. **How to keep memory healthy:** read `mem:memory_maintenance`.

Handoff file also lives at `.remember/remember.md` (write the next handoff there per the
SessionStart hook).

Key reminder: the workflow `.js` script has **no direct FS/shell** — only sub-agents do I/O — and it
must stay valid **ES module** (validate before every commit; see `mem:suggested_commands`).
