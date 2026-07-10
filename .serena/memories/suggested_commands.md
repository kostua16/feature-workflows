# Suggested commands

Platform: macOS (darwin), shell **zsh**. Node **v25**, Python **3.14** available. No build system.

Note: project `CLAUDE.md` asks to run shell via the Serena `execute_shell_command` tool rather than
a raw Bash tool.

## Validate the workflow engine (run after every edit to feature-pipeline.js)
```bash
cd .claude/workflows
# 1) ESM syntax check (plain `node --check` silently passes invalid ESM — do NOT rely on it)
sed 's/^return final$/\/\/ __sandbox_return__ final/' feature-pipeline.js \
  | node --input-type=module --check          # exit 0, no output = pass

# 2) Phase-label validation — undeclared_count must be 0
grep -oE "(phase|stateCheckpoint)\('[^']+'" feature-pipeline.js \
  | sed -E "s/.*'([^']+)'/\1/" | sort -u > /tmp/used.txt
sed -n "/^  phases:/,/^  }/p" feature-pipeline.js \
  | grep -oE "title: *'[^']+'" | sed -E "s/.*'([^']+)'/\1/" | sort -u > /tmp/declared.txt
comm -23 /tmp/used.txt /tmp/declared.txt
echo "undeclared_count=$(comm -23 /tmp/used.txt /tmp/declared.txt | wc -l)"
```

## compress-md skill (Node .mjs)
```bash
node .claude/skills/compress-md/scripts/detect.mjs   <file>   # detect/prepare/validate/finalize
```

## Git (worktree branch: claude/project-initialization-442534)
```bash
git status
git log --oneline -10
git add -A && git commit -m "type(scope): message"   # conventional commits, no AI refs
```

## Running the pipeline (inside Claude Code)
```
/design-feature <task>        # THINK, stops pre-execute
/implement-feature <planDir>  # DO
/tune-feature <planDir>       # FIX
```

Related: `mem:task_completion`.
