#!/usr/bin/env node
/**
 * Shared utilities for Claude Code hooks.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const LEVELS = { critical: 1, high: 2, strict: 3 };

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "hooks-logs"
);

// ── Shared guard config (guard-secrets.config.json) ──
//
// Loaded once per process. Read by both guard-secrets.js (safetyLevel,
// envRefAllowCommands) and guard-bash.js (safetyLevel). Kept here so the
// two hook scripts do not each do their own disk lookup / caching.
//
// Discovery order (first found wins):
//   1. {CLAUDE_PROJECT_DIR}/.claude/guard-secrets.config.json  (project)
//   2. ~/.claude/guard-secrets.config.json                     (user)
//   3. {} (no config)
const CONFIG_FILENAME = "guard-secrets.config.json";

let _guardConfig = undefined;

function loadGuardConfig() {
  if (_guardConfig !== undefined) return _guardConfig;

  const candidates = [
    path.join(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      ".claude",
      CONFIG_FILENAME
    ),
  ];
  try {
    const home = os.homedir();
    if (home) candidates.push(path.join(home, ".claude", CONFIG_FILENAME));
  } catch {
    // os.homedir() can throw on misconfigured systems — skip user-level
  }

  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        _guardConfig = parsed;
        return _guardConfig;
      }
    } catch {
      // File missing or invalid JSON — try next candidate
    }
  }

  _guardConfig = {};
  return _guardConfig;
}

// Resets the cached config. Only used by tests.
function _resetGuardConfigCache() {
  _guardConfig = undefined;
}

// Resolve SAFETY_LEVEL in priority order:
//   1. process.env.SCCM_GUARD_LEVEL  (critical|high|strict; invalid → ignored)
//   2. loadGuardConfig().safetyLevel (same validation)
//   3. fallback (caller-supplied, default "high")
// Never throws — a misconfigured env var or config file silently falls through.
function resolveSafetyLevel(fallback = "high") {
  const env = process.env.SCCM_GUARD_LEVEL;
  if (typeof env === "string" && LEVELS[env]) return env;
  const cfg = loadGuardConfig();
  if (typeof cfg.safetyLevel === "string" && LEVELS[cfg.safetyLevel]) {
    return cfg.safetyLevel;
  }
  return fallback;
}

// Canonicalize a path (resolve symlinks, collapse .. / .). On any error
// (missing file, ELOOP, permission denied, etc.) falls back to the raw
// input — a guard hook MUST NOT throw. Returns a discriminator so the
// caller can decide whether to re-check the resolved path or skip it.
//
// viaSymlink is true when the canonical path differs from path.resolve(raw):
// that is, realpath had a meaningful effect (symlink, or relative path
// outside cwd). A benign non-symlink absolute path resolves to itself and
// returns viaSymlink=false.
function resolvePath(raw) {
  if (!raw || typeof raw !== "string") {
    return { raw, resolved: raw, viaSymlink: false };
  }
  try {
    const resolved = fs.realpathSync(raw);
    const viaSymlink = resolved !== path.resolve(raw);
    return { raw, resolved, viaSymlink };
  } catch {
    return { raw, resolved: raw, viaSymlink: false };
  }
}

function log(hook, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(
      LOG_DIR,
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + "\n"
    );
  } catch {}
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
}

function block(id, reason) {
  console.error(`BLOCKED: [${id}] ${reason}`);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

// Split a bash command string into top-level segments separated by
// unquoted `&&`, `||`, `;`, `|`, or `&`. Quoted strings, backticks,
// and `$(...)` command substitutions are treated as opaque — operators
// inside them do not split.
//
// Not a full bash parser. Handles the cases that matter for hook rule
// evaluation: prevents `git commit -m "foo && bar"` from splitting on
// the embedded `&&`, and prevents `git commit && rm .env` from being
// passed through as a single `git commit` prefix.
//
// Limitations:
//   - Heredoc bodies are not specially tracked. In practice they are
//     almost always inside `$(...)` (e.g. `$(cat <<EOF ... EOF)`),
//     which already protects them. A top-level heredoc with literal
//     `&&` in its body would split incorrectly, but the resulting
//     segments are still scanned so this is a UX issue at most, not a
//     security hole.
//   - `(subshell)` grouping is not special-cased; parens only count
//     when preceded by `$`. A bare `(cmd1 && cmd2)` would split at the
//     inner `&&`, again producing safe-but-imprecise segments.
function splitShellChain(cmd) {
  if (!cmd) return [];
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let backtick = false;
  let parenDepth = 0; // $( ... ) nesting; tracked even inside double quotes
  const n = cmd.length;
  let i = 0;

  const flush = () => {
    const t = current.trim();
    if (t) segments.push(t);
    current = "";
  };

  while (i < n) {
    const c = cmd[i];
    const next = i + 1 < n ? cmd[i + 1] : "";

    // Backslash escapes the next character outside single quotes.
    if (c === "\\" && !inSingle && i + 1 < n) {
      current += c + next;
      i += 2;
      continue;
    }

    // Single quote: toggles only when not inside double quote / backtick / $().
    if (c === "'" && !inDouble && !backtick && parenDepth === 0) {
      inSingle = !inSingle;
      current += c;
      i++;
      continue;
    }

    // Double quote: toggles when not inside single quote.
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      current += c;
      i++;
      continue;
    }

    // $( … ): command substitution. Track even inside double quotes,
    // because chain operators inside $() must not split the outer cmd.
    if (!inSingle && c === "$" && next === "(") {
      parenDepth++;
      current += "$(";
      i += 2;
      continue;
    }
    if (parenDepth > 0 && c === ")") {
      parenDepth--;
      current += c;
      i++;
      continue;
    }

    // Backticks: another form of command substitution. Nesting is
    // unusual (requires escaping) — treat as a simple toggle.
    if (c === "`" && !inSingle) {
      backtick = !backtick;
      current += c;
      i++;
      continue;
    }

    // Inside any literal or substitution context, pass through verbatim.
    if (inSingle || inDouble || backtick || parenDepth > 0) {
      current += c;
      i++;
      continue;
    }

    // Top-level operators — match 2-char operators first.
    if (c === "&" && next === "&") {
      flush();
      i += 2;
      continue;
    }
    if (c === "|" && next === "|") {
      flush();
      i += 2;
      continue;
    }
    if (c === ";" || c === "|" || c === "&") {
      flush();
      i++;
      continue;
    }

    current += c;
    i++;
  }

  flush();
  return segments;
}

module.exports = {
  LEVELS,
  LOG_DIR,
  CONFIG_FILENAME,
  log,
  readStdin,
  block,
  allow,
  splitShellChain,
  loadGuardConfig,
  resolveSafetyLevel,
  resolvePath,
  _resetGuardConfigCache,
};
