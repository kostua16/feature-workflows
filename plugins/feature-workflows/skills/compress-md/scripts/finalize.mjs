#!/usr/bin/env node
// compress-md finalize stage (deterministic, no tokens).
// Ported from finalize.py. Runs AFTER the compress-agent returns its candidate
// body. Reassembles frontmatter (verbatim) + candidate body, validates the
// candidate against the backup, and commits — or reports errors for the fix loop.
//
// Machine-readable protocol:
//
//     VALID <abspath> <orig_chars> <final_chars>
//       -> frontmatter+body written to <abspath>
//
//     INVALID <abspath>
//     - <error line>
//     - <error line>
//       -> file untouched; backup left intact (fix loop may retry)
//
//     ABORT <abspath> <reason>
//       -> candidate empty / identical to input. The backup already exists from
//          prepare — so on ABORT we DELETE the backup to return to the pre-run
//          state, leaving the file untouched.
//
// Validation runs on the BODY (frontmatter is verbatim and never changes).
// Agent files (path contains an "agents" dir): also re-wrap a compressed
// description as `description: |-`, re-insert the canonical memory-reminder, and
// verify every non-description frontmatter key is byte-identical to the backup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupDirFor, splitFrontmatter, extractDescription, isAgentFile } from "./prepare.mjs";
import { validate } from "./validate.mjs";

const REMINDER_PREFIX = "Read and update project memories";
const REMINDER_LINE = "Read and update project memories per the **Persistent Agent Memory** rules in `CLAUDE.md`.";

function stem(filepath) {
  return path.basename(filepath, path.extname(filepath));
}

function deleteBackup(filepath) {
  const backupPath = path.join(backupDirFor(filepath), `${stem(filepath)}.original.md`);
  try { fs.unlinkSync(backupPath); } catch {}
}

export function wrapDescription(descText, indent = 2) {
  // Re-wrap logical description text as a `description: |-` literal block.
  // 2-space content indent matches every agent's existing format + the
  // mechanical route's write_frontmatter. Trailing whitespace stripped per line
  // (a literal block would otherwise carry it invisibly).
  const pad = " ".repeat(indent);
  const lines = descText.split("\n").map((l) => l.replace(/\s+$/g, ""));
  return `description: |-\n${lines.map((l) => (l === "" ? "" : pad + l)).join("\n")}\n`;
}

export function frozenFrontmatterErrors(origFrontmatter, finalFrontmatter) {
  // Structural guard: every non-description top-level line must be byte-identical.
  // Also validates the description block re-wraps to a parseable `|-` shape
  // (content indent respected, no dedented content line). Returns error strings.
  const errors = [];
  const origFrozen = extractDescription(origFrontmatter).frozenFrontmatter;
  const finalFrozen = extractDescription(finalFrontmatter).frozenFrontmatter;
  if (origFrozen !== finalFrozen) {
    errors.push("Frontmatter corrupted: non-description key changed");
  }
  // Description shape: header present + no content line below block indent.
  const fLines = finalFrontmatter.split("\n");
  const hdrIdx = fLines.findIndex((l) => /^description:\s*\|-\s*$/.test(l));
  if (hdrIdx === -1) return errors;
  let contentIndent = -1;
  for (let i = hdrIdx + 1; i < fLines.length; i++) {
    if (fLines[i].trim() === "") continue;
    contentIndent = fLines[i].length - fLines[i].trimStart().length;
    break;
  }
  if (contentIndent <= 0) {
    errors.push("Description block malformed: no indented content");
  } else {
    for (let i = hdrIdx + 1; i < fLines.length; i++) {
      const l = fLines[i];
      if (l.trim() === "") continue;
      // A dedented line (indent < block indent) legitimately TERMINATES the
      // literal block per YAML semantics — it's a sibling key or the closing
      // `---`, not a malformed content line. extractDescription uses the same
      // rule to bound the block, so a re-wrapped description can't contain such
      // a line as content; this only stops iteration, never errors.
      const ind = l.length - l.trimStart().length;
      if (ind < contentIndent) break;
      if (/\s$/.test(l) && l.trim() !== "") {
        errors.push("Description block malformed: trailing whitespace on content line");
        break;
      }
    }
  }
  return errors;
}

export function finalize(filepath, bodyFile, descFile) {
  filepath = path.resolve(filepath);

  const originalText = fs.readFileSync(filepath, "utf8");
  const [frontmatter, originalBody] = splitFrontmatter(originalText);

  const candidateBody = fs.readFileSync(bodyFile, "utf8");
  const agent = isAgentFile(filepath);

  // Abort guards (mirror original): empty or no-op output is not a compression.
  if (!candidateBody.trim()) {
    deleteBackup(filepath);
    console.log(`ABORT ${filepath} empty_candidate`);
    return 1;
  }
  // For agents the reminder is redacted from the candidate body, so compare
  // reminder-stripped text to avoid a false "identical" abort.
  const stripRem = (s) => s.split("\n").filter((l) => !l.startsWith(REMINDER_PREFIX)).join("\n").trim();
  const baseBody = agent ? stripRem(originalBody) : originalBody.trim();
  if (agent && stripRem(candidateBody) === baseBody) {
    deleteBackup(filepath);
    console.log(`ABORT ${filepath} identical_to_input`);
    return 1;
  }
  if (!agent && candidateBody.trim() === originalBody.trim()) {
    deleteBackup(filepath);
    console.log(`ABORT ${filepath} identical_to_input`);
    return 1;
  }

  const backupPath = path.join(backupDirFor(filepath), `${stem(filepath)}.original.md`);

  // Assemble the final frontmatter + body.
  let finalFrontmatter = frontmatter;
  let finalBody = candidateBody;
  if (agent) {
    // Re-insert exactly one canonical reminder as the first body line.
    finalBody = `${REMINDER_LINE}\n\n${candidateBody.replace(/^\n+/, "")}`;
    // Description: compressed if provided, else keep original text verbatim.
    // Splice the re-wrapped `description: |-` block back into the frontmatter at
    // its original line index (descHeaderIdx) so key ORDER is preserved — appending
    // at the end would reorder `description` after its siblings on all 31 agents.
    const { descText: origDesc } = extractDescription(frontmatter);
    if (origDesc != null) {
      const descText = descFile ? fs.readFileSync(descFile, "utf8").trim() : origDesc;
      const { frozenFrontmatter, descHeaderIdx } = extractDescription(frontmatter);
      const frozenLines = frozenFrontmatter.split("\n");
      frozenLines.splice(descHeaderIdx, 0, wrapDescription(descText).replace(/\n$/, ""));
      finalFrontmatter = frozenLines.join("\n");
    }
  }
  const candidateFull = finalFrontmatter + finalBody;

  // Structural frontmatter guard (agents only): non-description keys frozen.
  if (agent) {
    const fmErrors = frozenFrontmatterErrors(frontmatter, finalFrontmatter);
    if (fmErrors.length) {
      console.log(`INVALID ${filepath}`);
      for (const e of fmErrors) console.log(`- ${e}`);
      return 1; // file untouched, backup kept
    }
  }

  // Body structural validation (headings/code/urls/paths/inline-code).
  const tmpCandidate = `${filepath}.compress-md-candidate`;
  fs.writeFileSync(tmpCandidate, candidateFull);
  let result;
  try {
    result = validate(backupPath, tmpCandidate);
  } finally {
    try { fs.unlinkSync(tmpCandidate); } catch {}
  }

  if (result.is_valid) {
    fs.writeFileSync(filepath, candidateFull);
    console.log(`VALID ${filepath} ${originalText.length} ${candidateFull.length}`);
    return 0;
  }

  // INVALID: leave file untouched, keep backup for the fix loop to retry.
  console.log(`INVALID ${filepath}`);
  for (const err of result.errors) console.log(`- ${err}`);
  return 1;
}

function main(argv) {
  if (argv.length < 2 || argv.length > 3) {
    console.log("Usage: node finalize.mjs <abspath> <candidate_body_file> [candidate_desc_file]");
    return 2;
  }
  return finalize(argv[0], argv[1], argv[2]);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
