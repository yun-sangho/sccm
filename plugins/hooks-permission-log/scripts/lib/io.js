#!/usr/bin/env node
/**
 * I/O helpers for hooks-permission-log.
 *
 * Kept dependency-free and self-contained so the plugin can run from
 * the marketplace install location without reaching into sibling
 * plugins at runtime.
 */
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "permission-logs"
);

const MAX_CMD_LEN = 200;

// Patterns for common secrets that might appear on a command line.
// Order matters: longer/more-specific patterns first.
const REDACT_PATTERNS = [
  // Authorization: Bearer <token>
  /([Aa]uthorization:\s*[Bb]earer\s+)\S+/g,
  // --header "Authorization: ..."
  /(-H\s+["']?[Aa]uthorization:\s*[Bb]earer\s+)\S+/g,
  // key=value style for common secret-ish keys
  /((?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|auth)=)[^\s&"']+/gi,
  // AWS-style env exports
  /(AWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN|ACCESS_KEY_ID)=)\S+/g,
  // Generic "Bearer xxx" not captured above
  /\b([Bb]earer\s+)[A-Za-z0-9._\-]+/g,
];

function redact(s) {
  if (!s) return s;
  let out = s;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, "$1<redacted>");
  }
  return out;
}

function truncate(s, n = MAX_CMD_LEN) {
  if (!s) return s;
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  return JSON.parse(input);
}

function appendJsonl(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(
      LOG_DIR,
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never disturb the hook chain — swallow IO failures.
  }
}

module.exports = {
  LOG_DIR,
  MAX_CMD_LEN,
  redact,
  truncate,
  readStdin,
  appendJsonl,
};
