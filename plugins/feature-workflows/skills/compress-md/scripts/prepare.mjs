#!/usr/bin/env node
// compress-md prepare stage (deterministic, no tokens).
// Ported from prepare.py. Runs BEFORE the compress-agent touches the file:
//   - resolve + existence / size / sensitive guards
//   - write out-of-tree backup (abort if backup already exists — data-loss guard)
//   - split YAML frontmatter off the body (saved for verbatim re-prepend)
//   - emit the body for the agent to compress
//
// Machine-readable protocol (parsed by SKILL.md without prose):
//
//     OK <abspath>
//     BACKUP <backup_abspath>
//     FRONTMATTER <n_chars>
//     BODY <n_chars>
//     ---BODY START---
//     <body bytes>
//     ---BODY END---
//
// On any refuse/skip, prints a single line starting with `SKIP` or `ERROR` and
// exits non-zero, leaving the file untouched. The exit code is the contract.
//
// Agent files (path contains an "agents" dir): additionally emit a DESC block
// (the description's logical text) so the compress-agent can compress it too,
// and redact the memory-reminder line from the body. See extractDescription /
// redactReminder. finalize.mjs re-wraps the description as `|-` and re-inserts
// the reminder; the frozen frontmatter (all keys except description) is
// verified byte-identical there.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { shouldCompress } from "./detect.mjs";

// Canonical memory-reminder line (matches scripts/compress_agents.py MEMORY_REMINDER).
// It is prose, not code — the validator can't see it, so it's redacted here and
// re-inserted verbatim in finalize to prevent silent loss.
const REMINDER_PREFIX = "Read and update project memories";

export function isAgentFile(filepath) {
  // File lives in a directory named "agents" and is markdown. Used to gate the
  // description carve-out + reminder redaction; non-agent .md skips both.
  return path.extname(filepath) === ".md"
    && path.resolve(filepath).split(path.sep).includes("agents");
}

// --- constants + helpers ported verbatim from compress.py (non-LLM half) ---

// YAML frontmatter: starts at file start with --- on its own line, ends with
// --- on its own line. Captures the whole block + the body after it.
// (Python: r"\A(---\r?\n.*?\r?\n---\r?\n)(.*)", re.DOTALL. JS: ^ with s flag.)
const FRONTMATTER_REGEX = /^(---\r?\n.*?\r?\n---\r?\n)(.*)/s;

const MAX_FILE_SIZE = 500_000; // 500KB

// Filenames / paths that almost certainly hold secrets or PII. Defense-in-depth:
// in-session routing means bytes do not leave the session for a third-party API,
// but this guard still prevents accidental overwrite of credential files.
// (Python used (?ix) inline flags; JS has no inline flags, so case-insensitivity
// is the `i` flag and the extended-mode whitespace was removed.)
const SENSITIVE_BASENAME_REGEX = /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;

const SENSITIVE_PATH_COMPONENTS = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker"]);

const SENSITIVE_NAME_TOKENS = [
  "secret", "credential", "password", "passwd",
  "apikey", "accesskey", "token", "privatekey",
];

export function splitFrontmatter(text) {
  // Split YAML frontmatter from body. Returns [frontmatter, body].
  // The compression LLM has a habit of stripping or rewriting frontmatter
  // despite preserve-structure rules — so we remove it before compression and
  // prepend it back verbatim. Files without frontmatter pass through unchanged.
  const m = FRONTMATTER_REGEX.exec(text);
  if (m) return [m[1], m[2]];
  return ["", text];
}

export function extractDescription(frontmatter) {
  // Split the `description:` scalar out of agent frontmatter. Supports three YAML
  // scalar forms found in agent files and normalizes all of them:
  //   1. `description: |-`      literal block (multi-line, indented content)
  //   2. `description: "..."`    double-quoted scalar (\n escapes → real newlines)
  //   3. `description: '...'`    single-quoted scalar ('' → ')
  //   4. `description: <plain>`  plain scalar (rare; treated as-is)
  // For (2)/(3)/(4) the value may flow across the single header line (agents keep
  // it on one line with \n escapes) OR span continuation lines; both resolve.
  //
  // Returns { descText, frozenFrontmatter, descHeaderIdx } where frozenFrontmatter
  // has the `description:` header line AND every content line of its value removed,
  // leaving sibling keys byte-identical for verbatim re-prepend, and descHeaderIdx
  // is the LINE INDEX in frozenFrontmatter at which the header sat (so finalize can
  // splice the re-wrapped `description: |-` block back into its original position,
  // preserving key order).
  //
  // Block-form resolution mirrors YAML literal-block semantics: consume every line
  // at indent >= content-indent (blank lines included) until a line dedents below
  // the content indent (a sibling key or the closing `---`). No YAML parser needed
  // — works for the flat top-level agent frontmatter format.
  const lines = frontmatter.split("\n");
  const descHeaderIdx = lines.findIndex((l) => /^description:\s*/.test(l));
  if (descHeaderIdx === -1) {
    return { descText: null, frozenFrontmatter: frontmatter, descHeaderIdx: -1 };
  }
  const headerLine = lines[descHeaderIdx];
  const valueStart = headerLine.replace(/^description:\s*/, "");

  // --- Form 1: literal block scalar `description: |-` (or `|`) ---
  // (`\|` escapes alternation: an unescaped `|` in a JS regex is the OR operator,
  // so /^|-?$/ would match every string via the empty first branch.)
  if (/^\|-\s*$/.test(valueStart) || /^\|\s*$/.test(valueStart)) {
    return extractBlockDescription(frontmatter, lines, descHeaderIdx);
  }

  // --- Forms 2-4: single-line (quoted/quoted-multi/plain) scalar ---
  // The value may occupy only the header line (the common case — agents keep the
  // description on one line using \n escapes). A genuinely multiline quoted scalar
  // spanning lines is rare for agents but handled: we collect continuation lines
  // only when the quote is still open at line end.
  if (valueStart.trim() === "") {
    // No inline value — fall back to block extraction (handles an indented
    // `description:` whose value is on subsequent lines in plain/quoted form too).
    return extractBlockDescription(frontmatter, lines, descHeaderIdx);
  }

  // Determine if the inline value is a fully-closed quoted scalar on one line.
  const { descText, consumedExtra } = unquoteDescription(valueStart, lines, descHeaderIdx);
  // frozenFrontmatter: drop the header line (always) and any continuation lines a
  // multiline quote consumed. descHeaderIdx is the insertion point and is unchanged
  // because we only remove the header + lines below it.
  const lastConsumedIdx = descHeaderIdx + consumedExtra;
  const frozenLines = lines.filter((_, i) => i !== descHeaderIdx && (i <= descHeaderIdx || i > lastConsumedIdx));
  return {
    descText,
    frozenFrontmatter: frozenLines.join("\n"),
    descHeaderIdx,
  };
}

function extractBlockDescription(frontmatter, lines, descHeaderIdx) {
  // Content indent = indentation of the first non-empty content line.
  let contentIndent = -1;
  for (let i = descHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    contentIndent = indent;
    break;
  }
  if (contentIndent === -1) {
    const frozen = lines.filter((_, i) => i !== descHeaderIdx).join("\n");
    return { descText: "", frozenFrontmatter: frozen, descHeaderIdx };
  }

  const descLines = [];
  let lastContentIdx = descHeaderIdx; // track where the block actually ends
  for (let i = descHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      descLines.push(""); // blank lines inside the block are part of it
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent < contentIndent) break; // dedented → block ends
    descLines.push(line.slice(contentIndent)); // dedent to logical text
    lastContentIdx = i;
  }
  // Strip trailing blank lines that belong to the block but aren't real content.
  while (descLines.length && descLines[descLines.length - 1] === "") descLines.pop();
  const descText = descLines.join("\n");

  // Frozen frontmatter = original minus the header line and the block's content
  // lines (blank or dedented). descHeaderIdx is unchanged: removing lines only
  // after the header doesn't shift the header's index.
  const frozenLines = lines.filter((line, i) => {
    if (i === descHeaderIdx) return false;
    if (i > descHeaderIdx && i <= lastContentIdx) return false;
    return true;
  });
  return { descText, frozenFrontmatter: frozenLines.join("\n"), descHeaderIdx };
}

// Resolve the inline description value to logical text. Handles single-line and
// multi-line quoted scalars plus plain scalars. Returns { descText, consumedExtra }
// where consumedExtra = number of lines BELOW the header consumed by a multiline
// quote (0 for single-line values).
function unquoteDescription(valueStart, lines, descHeaderIdx) {
  const first = valueStart[0];

  // Double-quoted scalar: "..." with backslash escapes (\n, \t, \", \\, ...).
  if (first === '"') {
    return resolveDoubleQuoted(valueStart, lines, descHeaderIdx);
  }
  // Single-quoted scalar: '...' with '' as an escaped '.
  if (first === "'") {
    return resolveSingleQuoted(valueStart, lines, descHeaderIdx);
  }
  // Plain scalar: take the trimmed value on this line (no continuation handling —
  // plain scalars are single-line for our agent format). Keep as-is.
  return { descText: valueStart.replace(/\s+$/, ""), consumedExtra: 0 };
}

function resolveDoubleQuoted(valueStart, lines, descHeaderIdx) {
  // Walk characters tracking escape state until the closing unescaped quote.
  let buf = "";
  let i = 1; // skip opening quote
  let s = valueStart;
  let lineIdx = 0; // offset from header line
  let closed = false;
  while (true) {
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\") {
        const next = s[i + 1];
        buf += decodeEscape(next);
        i += 2;
        continue;
      }
      if (ch === '"') {
        closed = true;
        i += 1;
        break;
      }
      buf += ch;
      i += 1;
    }
    if (closed) break;
    // Quote still open — consume next physical line as a folded continuation.
    lineIdx += 1;
    const nextLine = lines[descHeaderIdx + lineIdx];
    if (nextLine === undefined) break; // unterminated; take what we have
    buf += "\n";
    s = nextLine;
    i = 0;
  }
  return { descText: buf, consumedExtra: lineIdx };
}

function resolveSingleQuoted(valueStart, lines, descHeaderIdx) {
  // Single-quoted: only escape is '' → '. No backslash processing.
  let buf = "";
  let i = 1; // skip opening quote
  let s = valueStart;
  let lineIdx = 0;
  let closed = false;
  while (true) {
    while (i < s.length) {
      const ch = s[i];
      if (ch === "'") {
        if (s[i + 1] === "'") {
          buf += "'";
          i += 2;
          continue;
        }
        closed = true;
        i += 1;
        break;
      }
      buf += ch;
      i += 1;
    }
    if (closed) break;
    lineIdx += 1;
    const nextLine = lines[descHeaderIdx + lineIdx];
    if (nextLine === undefined) break;
    buf += "\n";
    s = nextLine;
    i = 0;
  }
  return { descText: buf, consumedExtra: lineIdx };
}

function decodeEscape(ch) {
  // Decode the common YAML double-quoted escapes. Unknown escapes pass through
  // the backslash + char verbatim (safe default; agent descriptions only use \n
  // and \" in practice).
  switch (ch) {
    case "n": return "\n";
    case "t": return "\t";
    case "r": return "\r";
    case '"': return '"';
    case "\\": return "\\";
    case "0": return "\0";
    case "/": return "/";
    default: return `\\${ch}`;
  }
}

export function redactReminder(body) {
  // Drop every memory-reminder line from the body sent to the compress-agent.
  // finalize re-inserts exactly one canonical line, so the agent can't reword it.
  return body
    .split("\n")
    .filter((line) => !line.startsWith(REMINDER_PREFIX))
    .join("\n");
}

export function backupDirFor(filepath) {
  // Resolve the out-of-tree backup directory for a given source file.
  // Backups live OUTSIDE the source directory so skill auto-loaders don't
  // re-ingest the `.original.md` copy as a live file. Base dir is
  // platform-aware; the source's parent-dir name is mirrored to reduce
  // cross-project collisions.
  let base;
  if (process.platform === "win32") {
    const localAppdata = process.env.LOCALAPPDATA;
    base = localAppdata ? path.join(localAppdata, "caveman-compress", "backups")
                        : path.join(os.homedir(), "AppData", "Local", "caveman-compress", "backups");
  } else {
    const xdg = process.env.XDG_DATA_HOME;
    base = xdg ? path.join(xdg, "caveman-compress", "backups")
               : path.join(os.homedir(), ".local", "share", "caveman-compress", "backups");
  }
  return path.join(base, path.basename(path.dirname(filepath)));
}

export function isSensitivePath(filepath) {
  // Heuristic denylist for files that must never be compressed.
  const name = path.basename(filepath);
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  const parts = filepath.split(path.sep).map((p) => p.toLowerCase());
  if (parts.some((p) => SENSITIVE_PATH_COMPONENTS.has(p))) return true;
  const lower = name.toLowerCase().replace(/[_\-\s.]/g, "");
  return SENSITIVE_NAME_TOKENS.some((tok) => lower.includes(tok));
}

function fail(msg, code = 1) {
  console.log(msg);
  return code;
}

function stem(filepath) {
  // Python: filepath.stem = basename minus final extension.
  return path.basename(filepath, path.extname(filepath));
}

export function prepare(filepath) {
  filepath = path.resolve(filepath);

  if (!fs.existsSync(filepath)) return fail(`ERROR not_found ${filepath}`);
  let st;
  try {
    st = fs.statSync(filepath);
  } catch {
    return fail(`ERROR not_found ${filepath}`);
  }
  if (!st.isFile()) return fail(`ERROR not_a_file ${filepath}`);
  if (st.size > MAX_FILE_SIZE) return fail(`ERROR too_large ${filepath} (max ${MAX_FILE_SIZE} bytes)`);
  if (isSensitivePath(filepath)) {
    return fail(
      `SKIP sensitive ${filepath} `
      + "(filename looks like credentials/keys/secrets — rename if false positive)",
    );
  }
  if (!shouldCompress(filepath)) return fail(`SKIP not_natural_language ${filepath} (code/config)`);
  if (path.basename(filepath).endsWith(".original.md")) return fail(`SKIP backup_file ${filepath}`);

  const originalText = fs.readFileSync(filepath, "utf8");
  if (!originalText.trim()) return fail(`ERROR empty ${filepath}`);

  const backupDir = backupDirFor(filepath);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${stem(filepath)}.original.md`);

  // Data-loss guard: never clobber an existing backup.
  if (fs.existsSync(backupPath)) {
    return fail(
      `SKIP backup_exists ${backupPath} `
      + "(remove/rename the backup to proceed — aborting to prevent data loss)",
    );
  }

  const [frontmatter, body] = splitFrontmatter(originalText);
  if (!body.trim()) return fail(`ERROR empty_body_after_frontmatter ${filepath}`);

  // Write backup and verify readback before emitting anything the orchestrator
  // might commit. A corrupt backup must abort, not leave a half-state.
  fs.writeFileSync(backupPath, originalText);
  const readback = fs.readFileSync(backupPath, "utf8");
  if (readback !== originalText) {
    try { fs.unlinkSync(backupPath); } catch {}
    return fail(`ERROR backup_verify_failed ${backupPath}`);
  }

  process.stdout.write(`OK ${filepath}\n`);
  process.stdout.write(`BACKUP ${backupPath}\n`);
  process.stdout.write(`FRONTMATTER ${frontmatter.length}\n`);

  const agent = isAgentFile(filepath);
  let bodyOut = body;
  let descText = null;
  if (agent) {
    // Agent files: redact the memory-reminder, carve the description out so the
    // compress-agent can compress it too. descText is null when there is no
    // `description: |-` block (finalize then leaves the description untouched).
    bodyOut = redactReminder(body);
    ({ descText } = extractDescription(frontmatter));
  }

  process.stdout.write(`BODY ${bodyOut.length}\n`);
  process.stdout.write("---BODY START---\n");
  process.stdout.write(bodyOut);
  process.stdout.write("---BODY END---\n");
  if (agent && descText != null) {
    process.stdout.write(`DESC ${descText.length}\n`);
    process.stdout.write("---DESC START---\n");
    process.stdout.write(descText);
    process.stdout.write("\n---DESC END---\n");
  }
  return 0;
}

function main(argv) {
  if (argv.length !== 1) {
    console.log("Usage: node prepare.mjs <abspath>");
    return 2;
  }
  return prepare(argv[0]);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
