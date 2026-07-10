#!/usr/bin/env node
// Deterministic validator (no tokens). Ported verbatim from validate.py.
// Checks that compressed markdown preserves headings, code blocks, URLs, paths,
// bullet counts, and inline code relative to the original.
import fs from "node:fs";
import path from "node:path";

const pathResolve = (p) => path.resolve(p);

const URL_REGEX = /https?:\/\/[^\s)]+/g;
const FENCE_OPEN_REGEX = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const HEADING_REGEX = /^(#{1,6})\s+(.*)/gm;
const BULLET_REGEX = /^\s*[-*+]\s+/gm;
// crude but effective path detection
// Requires either a path prefix (./ ../ / or drive letter) or a slash/backslash within the match
const PATH_REGEX = /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\w\-/\\.]+|[\w\-.]+[/\\][\w\-/\\.]+/g;

export class ValidationResult {
  constructor() {
    this.is_valid = true;
    this.errors = [];
    this.warnings = [];
  }
  addError(msg) {
    this.is_valid = false;
    this.errors.push(msg);
  }
  addWarning(msg) {
    this.warnings.push(msg);
  }
}

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

// ---------- Extractors ----------

function extractHeadings(text) {
  const out = [];
  let m;
  HEADING_REGEX.lastIndex = 0;
  while ((m = HEADING_REGEX.exec(text)) !== null) {
    out.push([m[1], m[2].trim()]);
  }
  return out;
}

function extractCodeBlocks(text) {
  // Line-based fenced code block extractor.
  // Handles ``` and ~~~ fences with variable length (CommonMark: closing fence must
  // use same char and be at least as long as opening). Supports nested fences.
  const blocks = [];
  const lines = text.split("\n");
  let i = 0;
  const n = len(lines);
  while (i < n) {
    const m = FENCE_OPEN_REGEX.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const fenceChar = m[2][0];
    const fenceLen = m[2].length;
    const blockLines = [lines[i]];
    i += 1;
    let closed = false;
    while (i < n) {
      const closeM = FENCE_OPEN_REGEX.exec(lines[i]);
      if (
        closeM &&
        closeM[2][0] === fenceChar &&
        closeM[2].length >= fenceLen &&
        closeM[3].trim() === ""
      ) {
        blockLines.push(lines[i]);
        closed = true;
        i += 1;
        break;
      }
      blockLines.push(lines[i]);
      i += 1;
    }
    if (closed) blocks.push(blockLines.join("\n"));
    // Unclosed fences are silently skipped — malformed markdown; including them
    // would cause false-positive validation failures.
  }
  return blocks;
}

function extractUrls(text) {
  return new Set(text.match(URL_REGEX) || []);
}

function extractPaths(text) {
  return new Set(text.match(PATH_REGEX) || []);
}

function countBullets(text) {
  const m = text.match(BULLET_REGEX);
  return m ? m.length : 0;
}

function extractInlineCodes(text) {
  let t = text.replace(/^```[\s\S]*?^```/gm, "");
  t = t.replace(/^~~~[\s\S]*?^~~~/gm, "");
  const matches = t.match(/`([^`]+)`/g) || [];
  return matches.map((s) => s.slice(1, -1));
}

function len(x) {
  return Array.isArray(x) ? x.length : String(x).length;
}

// ---------- Validators ----------

function validateHeadings(orig, comp, result) {
  const h1 = extractHeadings(orig);
  const h2 = extractHeadings(comp);
  if (h1.length !== h2.length) {
    result.addError(`Heading count mismatch: ${h1.length} vs ${h2.length}`);
  }
  if (JSON.stringify(h1) !== JSON.stringify(h2)) {
    result.addWarning("Heading text/order changed");
  }
}

function validateCodeBlocks(orig, comp, result) {
  const c1 = extractCodeBlocks(orig);
  const c2 = extractCodeBlocks(comp);
  if (JSON.stringify(c1) !== JSON.stringify(c2)) {
    result.addError("Code blocks not preserved exactly");
  }
}

function validateUrls(orig, comp, result) {
  const u1 = extractUrls(orig);
  const u2 = extractUrls(comp);
  if (!setsEqual(u1, u2)) {
    result.addError(`URL mismatch: lost=${setFormat(diff(u1, u2))}, added=${setFormat(diff(u2, u1))}`);
  }
}

function validatePaths(orig, comp, result) {
  const p1 = extractPaths(orig);
  const p2 = extractPaths(comp);
  if (!setsEqual(p1, p2)) {
    result.addWarning(`Path mismatch: lost=${setFormat(diff(p1, p2))}, added=${setFormat(diff(p2, p1))}`);
  }
}

function validateBullets(orig, comp, result) {
  const b1 = countBullets(orig);
  const b2 = countBullets(comp);
  if (b1 === 0) return;
  const d = Math.abs(b1 - b2) / b1;
  if (d > 0.15) {
    result.addWarning(`Bullet count changed too much: ${b1} -> ${b2}`);
  }
}

function validateInlineCodes(orig, comp, result) {
  const c1 = countMap(extractInlineCodes(orig));
  const c2 = countMap(extractInlineCodes(comp));
  if (mapsEqual(c1, c2)) return;
  const lost = new Set([...c1.keys()].filter((k) => !c2.has(k)));
  const added = new Set([...c2.keys()].filter((k) => !c1.has(k)));
  for (const [code, count] of c1) {
    if (c2.has(code) && c2.get(code) < count) {
      lost.add(`${code} (lost ${count - c2.get(code)} of ${count} occurrences)`);
    }
  }
  if (lost.size) result.addError(`Inline code lost: ${setFormat(lost)}`);
  if (added.size) result.addWarning(`Inline code added: ${setFormat(added)}`);
}

function setFormat(s) {
  // Match Python's set repr exactly: empty -> "set()", else "{'a', 'b'}".
  const arr = [...s];
  if (arr.length === 0) return "set()";
  return `{${arr.map((x) => `'${x}'`).join(", ")}}`;
}
function diff(a, b) {
  return new Set([...a].filter((x) => !b.has(x)));
}
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function countMap(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}
function mapsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

// ---------- Main ----------

export function validate(originalPath, compressedPath) {
  const result = new ValidationResult();
  const orig = readFile(originalPath);
  const comp = readFile(compressedPath);
  validateHeadings(orig, comp, result);
  validateCodeBlocks(orig, comp, result);
  validateUrls(orig, comp, result);
  validatePaths(orig, comp, result);
  validateBullets(orig, comp, result);
  validateInlineCodes(orig, comp, result);
  return result;
}

// ---------- CLI ----------

function main(argv) {
  if (argv.length !== 2) {
    console.log("Usage: node validate.mjs <original> <compressed>");
    return 2;
  }
  const orig = pathResolve(argv[0]);
  const comp = pathResolve(argv[1]);
  const res = validate(orig, comp);
  console.log(`\nValid: ${res.is_valid}`);
  if (res.errors.length) {
    console.log("\nErrors:");
    for (const e of res.errors) console.log(`  - ${e}`);
  }
  if (res.warnings.length) {
    console.log("\nWarnings:");
    for (const w of res.warnings) console.log(`  - ${w}`);
  }
  return res.is_valid ? 0 : 1;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
