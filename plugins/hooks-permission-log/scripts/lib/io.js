#!/usr/bin/env node
/**
 * I/O helpers for hooks-permission-log.
 *
 * Kept self-contained so the plugin can run from the marketplace
 * install location without reaching into sibling plugins at runtime.
 * Cross-plugin primitives (readStdin, the raw appendJsonl writer)
 * come from `../_shared/*`, which is synced from
 * packages/hooks-shared at dev time — still self-contained from the
 * runtime's perspective, but no source duplication across plugins.
 *
 * Plugin-specific behavior that stays here:
 *   - SCHEMA_VERSION + v1 archival (first-v2-write migration)
 *   - redact() patterns tuned for the cmd/reason fields we log
 *   - truncate() policy (MAX_CMD_LEN)
 *   - the appendJsonl wrapper that triggers archival before delegating
 */
const fs = require("fs");
const path = require("path");

const { readStdin } = require("../_shared/stdin");
const { appendJsonl: appendJsonlCore } = require("../_shared/logging");

// Schema version of the JSONL events this plugin writes. Bumped from
// the implicit v1 (un-versioned, fields: ts/event/tool/cmd/cmd_key/...)
// to v2 which always carries {schema_version, decision, reason} and
// sometimes {rule_id}. See README — Migration for details.
const SCHEMA_VERSION = 2;

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "permission-logs"
);

// Legacy (v1) log files are quarantined here on the first v2 write of a
// process so a single .jsonl file never mixes schemas. review.js reads
// from both directories and shims v1 into the v2 shape for aggregation.
const LOG_DIR_V1 = path.join(LOG_DIR, "v1");

const MAX_CMD_LEN = 200;

// Process-level flag: v1 archival only runs once per invocation.
let _v1Archived = false;

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

// Move un-versioned .jsonl files sitting in LOG_DIR into LOG_DIR/v1/ so
// the first v2 write of the process starts a clean v2-only file. A file
// is considered v1 when its first line does NOT contain the v2 schema
// marker — including empty files, which are moved out of the way so the
// new write starts fresh rather than appending into a zero-length legacy
// file whose next line would be v2.
//
// Idempotent per process via _v1Archived. Called from appendJsonl() only
// when we are about to write a v2 entry; a caller writing a v1-shaped
// entry (should not happen in this plugin, but kept robust) will not
// trigger archival.
function archiveV1Once() {
  if (_v1Archived) return;
  _v1Archived = true;
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const entries = fs.readdirSync(LOG_DIR);
    const toMove = [];
    for (const name of entries) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const full = path.join(LOG_DIR, name);
      let head = "";
      try {
        head = fs.readFileSync(full, "utf8").split("\n", 1)[0] || "";
      } catch {
        continue;
      }
      if (!/"schema_version"\s*:\s*2\b/.test(head)) toMove.push(name);
    }
    if (toMove.length === 0) return;
    fs.mkdirSync(LOG_DIR_V1, { recursive: true });
    for (const name of toMove) {
      try {
        fs.renameSync(path.join(LOG_DIR, name), path.join(LOG_DIR_V1, name));
      } catch {
        // rename across mounts or due to EACCES — leave the file alone;
        // review.js already tolerates v1 entries mixed in with v2 when
        // reading (and will degrade to un-archived state gracefully).
      }
    }
  } catch {
    // Never throw from a hook helper.
  }
}

// Exposed for tests that need to reset the archival guard between runs.
function _resetArchiveFlag() {
  _v1Archived = false;
}

// Public appendJsonl for this plugin: triggers v1 archival on the first
// v2 entry, then delegates the raw mkdir+date-file+append write to the
// shared primitive. The shared writer already swallows its IO errors;
// the outer try/catch is belt-and-suspenders against the archive check.
function appendJsonl(entry) {
  try {
    if (entry && entry.schema_version === SCHEMA_VERSION) archiveV1Once();
    appendJsonlCore(LOG_DIR, entry);
  } catch {
    // Never disturb the hook chain — swallow IO failures.
  }
}

module.exports = {
  LOG_DIR,
  LOG_DIR_V1,
  SCHEMA_VERSION,
  MAX_CMD_LEN,
  redact,
  truncate,
  readStdin,
  appendJsonl,
  archiveV1Once,
  _resetArchiveFlag,
};
