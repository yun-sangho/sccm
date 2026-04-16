#!/usr/bin/env node
/**
 * hooks-guard — plugin-local utilities.
 *
 * Cross-plugin helpers (readStdin, appendJsonl, block/allow,
 * splitShellChain) live in scripts/_shared/ and are synced from
 * packages/hooks-shared at dev time. This file re-exports them so
 * existing callers keep working with require("./utils"), and owns
 * only hooks-guard-specific logic: LEVELS, LOG_DIR, the
 * guard-secrets.config.json loader, resolveSafetyLevel, resolvePath,
 * and the log() wrapper that stamps a ts/hook prefix.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const { readStdin } = require("./_shared/stdin");
const { appendJsonl } = require("./_shared/logging");
const { block, allow } = require("./_shared/exit");
const { splitShellChain } = require("./_shared/shell-chain");

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

// hooks-guard's flavor of the JSONL log entry: stamp ts + hook name,
// then let the shared writer handle mkdir / date-file / IO swallowing.
function log(hook, data) {
  appendJsonl(LOG_DIR, { ts: new Date().toISOString(), hook, ...data });
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
