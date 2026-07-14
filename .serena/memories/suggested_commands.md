# Suggested commands

Platform: macOS (darwin), shell **zsh**. Node **v25**, Python **3.14** available. No build system.

Note: project `CLAUDE.md` asks to run shell via the Serena `execute_shell_command` tool rather than
a raw Bash tool.

## Build the workflow engine (v1.4.1+: dist is GENERATED from workflows/src/)
```bash
# EDIT plugins/feature-workflows/workflows/src/*.mjs — NEVER the dist feature-pipeline.js
npm run build            # regenerate the dist (injects version from plugin.json)
npm run validate:build   # fail if committed dist is stale (also tests/build-drift.test.mjs + CI)
npm test                 # 183 tests (harness reads the DIST — validates the shipped artifact)
```
The builder self-checks: dup top-level names, unstripped import/export, forbidden tokens
(require/Date.now/Math.random/new Date()), phase-labels ⊆ meta.phases, neutralized ESM check.
Version bump = plugin.json ONLY, then `npm run build` (header + meta.version injected).

## Release (see docs/release-process.md; users install pinned tags, not main)
PRIMARY: GitHub Actions -> release-dispatch -> "Run workflow" -> enter X.Y.Z (CI does
bump+build+validate+commit+tag+pin+publish; re-run same version = idempotent recovery).
Fallback (local CLI):
```bash
npm run release -- X.Y.Z              # bump+build+validate+commit+tag+pin catalog (local)
git push --atomic --follow-tags origin main   # tag triggers release.yml -> GitHub Release + assets
npm run marketplace:pin -- --release vX.Y.Z   # rollback/repoint the catalog pin
npm run marketplace:pin -- --dev              # local dogfooding (don't commit)
```
UI "Draft a new release" also works ONLY for a version-consistent commit (tag tree's
plugin.json == tag); release.yml then attaches assets to the existing Release; pin stays manual.

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
