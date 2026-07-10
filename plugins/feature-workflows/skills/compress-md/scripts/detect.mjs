#!/usr/bin/env node
// Detect whether a file is natural language (compressible) or code/config (skip).
// Ported verbatim from detect.py. Regexes adjusted only for JS char-class syntax;
// matching semantics are identical (anchored at start, same alternations).
import path from "node:path";
import fs from "node:fs";

// Extensions that are natural language and compressible
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".md", ".txt", ".markdown", ".rst", ".typ", ".typst", ".tex",
]);
// Extensions that are code/config and should be skipped
const SKIP_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml",
  ".toml", ".env", ".lock", ".css", ".scss", ".html", ".xml",
  ".sql", ".sh", ".bash", ".zsh", ".go", ".rs", ".java", ".c",
  ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".kt", ".lua",
  ".dockerfile", ".makefile", ".csv", ".ini", ".cfg",
]);
const CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env"]);

// Patterns that indicate a line is code
const CODE_PATTERNS = [
  /^\s*(import |from .+ import |require\(|const |let |var )/,
  /^\s*(def |class |function |async function |export )/,
  /^\s*(if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{)/,
  /^\s*[\}\];)]+\s*$/, // closing braces/brackets
  /^\s*@\w+/, // decorators/annotations
  /^\s*"[^"]+"\s*:\s*/, // JSON-like key-value
  /^\s*\w+\s*=\s*[{\[("']/, // assignment with literal
];

function isCodeLine(line) {
  return CODE_PATTERNS.some((p) => p.test(line));
}

function isJsonContent(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isYamlContent(lines) {
  let yamlIndicators = 0;
  for (const line of lines.slice(0, 30)) {
    const stripped = line.trim();
    if (stripped.startsWith("---")) {
      yamlIndicators += 1;
    } else if (/^\w[\w\s]*:\s/.test(stripped)) {
      yamlIndicators += 1;
    } else if (stripped.startsWith("- ") && stripped.includes(":")) {
      yamlIndicators += 1;
    }
  }
  const nonEmpty = lines.slice(0, 30).filter((l) => l.trim()).length;
  return nonEmpty > 0 && yamlIndicators / nonEmpty > 0.6;
}

export function detectFileType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (COMPRESSIBLE_EXTENSIONS.has(ext)) return "natural_language";
  if (SKIP_EXTENSIONS.has(ext)) {
    return CONFIG_EXTENSIONS.has(ext) ? "config" : "code";
  }
  // Extensionless files (like CLAUDE.md, TODO) — check content
  if (!ext) {
    let text;
    try {
      text = fs.readFileSync(filepath, "utf8");
    } catch {
      return "unknown";
    }
    const lines = text.split(/\r?\n/).slice(0, 50);
    if (isJsonContent(text.slice(0, 10000))) return "config";
    if (isYamlContent(lines)) return "config";
    const codeLines = lines.filter((l) => l.trim() && isCodeLine(l)).length;
    const nonEmpty = lines.filter((l) => l.trim()).length;
    if (nonEmpty > 0 && codeLines / nonEmpty > 0.4) return "code";
    return "natural_language";
  }
  return "unknown";
}

export function shouldCompress(filepath) {
  let st;
  try {
    st = fs.statSync(filepath);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  if (path.basename(filepath).endsWith(".original.md")) return false;
  return detectFileType(filepath) === "natural_language";
}

function main(argv) {
  if (!argv.length) {
    console.log("Usage: node detect.mjs <file1> [file2] ...");
    return 1;
  }
  for (const pathStr of argv) {
    const p = path.resolve(pathStr);
    const fileType = detectFileType(p);
    const compress = shouldCompress(p);
    console.log(
      `  ${path.basename(p).padEnd(30)} type=${fileType.padEnd(20)} compress=${compress}`,
    );
  }
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
