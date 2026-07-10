---
name: compress-md
description: >
  Compress natural-language memory/doc files (CLAUDE.md, todos, notes) into
  caveman format in-session to cut input tokens (~46%), preserving all code,
  URLs, paths, headings, and frontmatter. Like caveman-compress, but the LLM
  work runs in the CURRENT session via a dedicated `feature-workflows:compress-agent` subagent
  (no out-of-session `claude --print` / API call) and multiple files compress
  IN PARALLEL (one agent per file). Deterministic detection, validation, backup,
  and frontmatter handling stay in local stdlib Node.js (ESM `.mjs`).
  Trigger: /compress-md <file> [<file>...] or "compress memory file(s)".
---

# compress-md

## Purpose

Compress natural-language files into caveman-speak to reduce input tokens.
Compressed version overwrites the original. Human-readable backup saved out of
tree as `<stem>.original.md` under `~/.local/share/caveman-compress/backups/`.

Difference from `caveman-compress`: LLM compression runs **in-session** through
the `feature-workflows:compress-agent` subagent (shares current model/tools/context), and **N files
run in parallel** (N agents in one message). No external `claude` CLI / API call.

## Trigger

`/compress-md <filepath> [<filepath> ...]` or when the user asks to compress
memory/documentation file(s).

## Architecture

| Stage | Where | Tokens? |
|---|---|---|
| detect file type, guards, backup, frontmatter split | Node `prepare.mjs` | no |
| compress prose → caveman | `feature-workflows:compress-agent` subagent | yes (in-session) |
| reassemble + validate + commit | Node `finalize.mjs` | no |
| fix only listed errors (≤2 retries) | `feature-workflows:compress-agent` subagent | yes (in-session) |

The Node helpers live in `scripts/` adjacent to this SKILL.md. Run them from
the **skill directory** (the parent of `scripts/`):

```bash
node scripts/<command>.mjs [args...]
```

## Process (per invocation)

### 1. Resolve the scripts dir

The helpers are next to this SKILL.md. From the skill directory run:

```bash
node scripts/prepare.mjs <abspath>
```

If you are unsure of the skill directory path, it is
`${CLAUDE_PLUGIN_ROOT}/skills/compress-md` (the skill ships inside the
feature-workflows plugin; locate this SKILL.md there).

### 2. Validate + prepare each file (Node, no tokens)

For each input filepath, run `node scripts/prepare.mjs <abspath>`. Parse its
machine-readable output:

- First line `OK <abspath>` → proceed. Also captures `BACKUP <path>`,
  `FRONTMATTER <n>`, `BODY <n>`, then the body between `---BODY START---` and
  `---BODY END---`.
- `SKIP <reason> <abspath> ...` → not compressible (code/config/sensitive/
  backup-exists). Skip this file, report to user. Do NOT spawn an agent.
- `ERROR <reason> <abspath>` → prepare failed (not found / too large / empty /
  backup verify failed). Skip, report.

Collect the set of files that printed `OK` + their bodies.

**Agent files (path under an `agents/` dir):** prepare emits an additional
`DESC <n>` block after `---BODY END---`:

```
DESC <n_chars>
---DESC START---
<description logical text>
---DESC END---
```

Capture the description text for step 3. The body between the markers has the
canonical memory-reminder line **redacted** — do NOT re-add it; `finalize`
re-inserts exactly one deterministic copy. If no `DESC` block is present the
agent has no `description:` scalar at all and its frontmatter is left untouched.

**Supported description scalar forms** (prepare extracts all of them; finalize
always re-wraps the compressed result as `description: |-`, normalizing any
form to one canonical shape):
- `description: |-` / `|` — literal block (indented multi-line)
- `description: "..."` — double-quoted scalar; `\n` escapes decode to newlines
- `description: '...'` — single-quoted scalar; `''` decodes to `'`
- `description: <plain text>` — plain scalar (one line)

### 3. Spawn compress-agents IN PARALLEL (the win)

If more than one file is OK, spawn **one `feature-workflows:compress-agent` per file in a single
message** (multiple Agent tool calls in one response) so they run concurrently.
For each file, build the agent prompt:

- Assign a unique temp output path per file, e.g.
  `/tmp/compress-md-<index>.md` (indices `0..N-1`).
- Pass the ORIGINAL body (from `---BODY START---`..`---BODY END---`) inline.
- Instruct: `MODE: COMPRESS`, write result to `<temp path>`, return the path.
- **Agent files:** assign a second temp path `/tmp/compress-md-<index>-desc.md`,
  pass the description text from the `DESC` block, and instruct the agent to
  compress BOTH regions — body to the body temp path, description to the
  `-desc.md` path. Tell it to preserve `<example>`/`<commentary>` tags and any
  backtick identifiers byte-for-byte, and to write logical text only (no
  `description: |-` header or indentation — finalize re-wraps).

Each agent returns its body temp path as its final line.

### 4. Finalize + validate each file (Node, no tokens)

For each file, read the agent's returned body temp path, then run:

```bash
# generic file
node scripts/finalize.mjs <abspath> <candidate_body_file>
# agent file (with compressed description)
node scripts/finalize.mjs <abspath> <candidate_body_file> <candidate_desc_file>
```

For agents, if no description was compressed (no `DESC` block), omit the third
arg — `finalize` keeps the original description verbatim.

Parse output:

- `VALID <abspath> <orig_chars> <final_chars>` → done. Backup kept. Report.
- `INVALID <abspath>` + `- <error>` lines → enter the fix loop (step 5).
- `ABORT <abspath> <reason>` → candidate empty or identical to input. Backup was
  auto-deleted; file untouched. Report abort; do not retry.

### 5. Fix loop (≤2 retries, per failed file)

For each `INVALID` file, spawn another `feature-workflows:compress-agent` (can batch all failed
files in one parallel message) with `MODE: FIX`, passing:

- ORIGINAL body (the uncompressed body from step 2)
- COMPRESSED body (the candidate that failed)
- ERRORS (the `- <error>` lines from finalize)

Re-run `finalize`. Repeat up to **2** total retries. If still `INVALID` after 2
retries:

- Restore the original from the backup (`node scripts/prepare.mjs` already
  wrote it; `finalize` left the file untouched on INVALID, so no restore is
  needed — the original is intact). Delete the backup to return to clean state:
  `rm <backup_path>` (path from step 2's `BACKUP` line).
- Report `FAILED: <abspath> (<reasons>)`. Do not leave the file in a bad state.

### 6. Report

One line per input file:

```text
<abspath> → compressed (N→M chars, backup <path>)
<abspath> → skipped (<reason>)
<abspath> → FAILED (<reason>)
```

Clean up all temp files in `/tmp/compress-md-*.md` when done.

## Compression Rules

### Idea

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). No tool-call narration, no decorative tables/emoji, no dumping long raw error logs unless asked — quote shortest decisive line. Standard well-known tech acronyms OK (DB/API/HTTP); never invent new abbreviations reader can't decode. Technical terms exact. Code blocks unchanged. Errors quoted exact.

### Remove

- Articles: a, an, the
- Filler: just, really, basically, actually, simply, essentially, generally
- Pleasantries: "sure", "certainly", "of course", "happy to", "I'd recommend"
- Hedging: "it might be worth", "you could consider", "it would be good to"
- Redundant phrasing: "in order to" → "to", "make sure to" → "ensure", "the reason is because" → "because", "delegate to" → "use"
- Connective fluff: "however", "furthermore", "additionally", "in addition"

### Preserve EXACTLY (never modify)

- Code blocks (fenced ``` and indented)
- Inline code (`backtick content`)
- URLs and links (full URLs, markdown links)
- File paths (`/src/components/...`, `./config.yaml`)
- Commands (`npm install`, `git commit`, `docker build`)
- Technical terms (library names, API names, protocols, algorithms)
- Proper nouns (project names, people, companies)
- Dates, version numbers, numeric values
- Environment variables (`$HOME`, `NODE_ENV`)
- YAML frontmatter blocks: name, tools, model, color, memory

### YAML frontmatter description block compression rules (only the description block should be compressed)

- Follow the main compression rules (idea, remove, preserve exactly, preserve structure, compress, pattern, boundaries)
- Multiple examples shall be compressed as one covering most of the cases
- Use short examples only
- Use short synonyms if necessary
- Remove unnecessary examples if possible
- Remove unnecessary punctuation if possible
- Remove unnecessary spaces if possible

### Preserve Structure

- All markdown headings (keep exact heading text, compress body below)
- Bullet point hierarchy (keep nesting level)
- Numbered lists (keep numbering)
- Tables (compress cell text, keep structure)
- Frontmatter/YAML headers in markdown files

### Compress

- Use short synonyms: "big" not "extensive", "fix" not "implement a solution for", "use" not "utilize"
- Fragments OK: "Run tests before commit" not "You should always run tests before committing"
- Drop "you should", "make sure to", "remember to" — just state the action
- Merge redundant bullets that say the same thing differently
- Keep one example where multiple examples show the same pattern

CRITICAL RULE:
Anything inside ``` ... ``` must be copied EXACTLY.
Do not:

- remove comments
- remove spacing
- reorder lines
- shorten commands
- simplify anything

Inline code (`...`) must be preserved EXACTLY.
Do not modify anything inside backticks.

If file contains code blocks:

- Treat code blocks as read-only regions
- Only compress text outside them
- Do not merge sections around code

## Pattern

Original:
> You should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.

Compressed:
> Run tests before push to main. Catch bugs early, prevent broken prod deploys.

Original:
> The application uses a microservices architecture with the following components. The API gateway handles all incoming requests and routes them to the appropriate service. The authentication service is responsible for managing user sessions and JWT tokens.

Compressed:
> Microservices architecture. API gateway route all requests to services. Auth service manage user sessions + JWT tokens.

## Boundaries

- ONLY compress natural language files (.md, .txt, .typ, .typst, .tex, extensionless)
- **Agent files** (path contains an `agents/` dir): the body's canonical
  memory-reminder line is **redacted before compression and re-inserted exactly
  once** by `finalize` (it is prose the validator can't see, so without the
  carve-out a reworded reminder would pass validation silently and the agent
  would lose its memory instruction). The frontmatter `description:` scalar is
  carved out, compressed as a second region, and re-wrapped as `description: |-`
  at its original position (key order preserved). Any of these description forms
  is recognized and normalized to `|-`: literal block (`|-`/`|`), double-quoted
  (`"..."`, with `\n` escapes), single-quoted (`'...'`), or plain scalar. Every
  non-`description` frontmatter key (`name`/`model`/`color`/`tools`/`memory`) is
  frozen byte-for-byte and verified by a structural guard — any non-description
  key change is `INVALID`.
- NEVER modify following YAML frontmatter blocks: name, tools, model, color, memory. Only the description block should be compressed (multiple examples shall be compressed as one covering most of the cases, use short examples only, use short synonyms if necessary, remove unnecessary examples if possible, remove unnecessary punctuation if possible).
- NEVER modify: .py, .js, .ts, .json, .yaml, .yml, .toml, .env, .lock, .css, .html, .xml, .sql, .sh
- If file has mixed content (prose + code), compress ONLY the prose sections
- If unsure whether something is code or prose, leave it unchanged
- Original file is backed up as FILE.original.md before overwriting
- Never compress FILE.original.md (skip it)
