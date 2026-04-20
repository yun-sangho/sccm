#!/usr/bin/env node
/**
 * Shared utilities for Claude Code hooks.
 *
 * Cross-plugin helpers live under ./_shared (synced from
 * packages/hooks-shared/src/ by scripts/sync-shared.mjs — do not
 * edit _shared/ files by hand). Plugin-specific helpers (LEVELS,
 * resolvePath, guard config discovery, log() timestamp wrapper)
 * stay in this file.
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

// ── Shared guard config ──
//
// Loaded once per process. Read by both guard-secrets.js (safetyLevel,
// envRefAllowCommands) and guard-bash.js (safetyLevel). Kept here so the
// two hook scripts do not each do their own disk lookup / caching.
//
// Canonical filename: hooks-guard.config.json (matches the plugin slug
// so it cannot collide with any other plugin installed in the same
// .claude/ directory). The older filename guard-secrets.config.json is
// still read for backwards compatibility — users who already have one
// do not need to rename it — but new files should use the canonical
// name.
//
// Discovery order (first file found wins):
//   1. {CLAUDE_PROJECT_DIR}/.claude/hooks-guard.config.json        (project, canonical)
//   2. {CLAUDE_PROJECT_DIR}/.claude/guard-secrets.config.json      (project, legacy)
//   3. ~/.claude/hooks-guard.config.json                           (user, canonical)
//   4. ~/.claude/guard-secrets.config.json                         (user, legacy)
//   5. {} (no config)
const CONFIG_FILENAME = "hooks-guard.config.json";
const LEGACY_CONFIG_FILENAME = "guard-secrets.config.json";

let _guardConfig = undefined;

function loadGuardConfig() {
  if (_guardConfig !== undefined) return _guardConfig;

  const dirs = [
    path.join(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      ".claude"
    ),
  ];
  try {
    const home = os.homedir();
    if (home) dirs.push(path.join(home, ".claude"));
  } catch {
    // os.homedir() can throw on misconfigured systems — skip user-level
  }

  // Within each directory, prefer the canonical filename over the legacy
  // one so a user who has migrated to hooks-guard.config.json in their
  // project still wins over an older ~/.claude/guard-secrets.config.json
  // they forgot to clean up.
  const filenames = [CONFIG_FILENAME, LEGACY_CONFIG_FILENAME];

  for (const dir of dirs) {
    for (const name of filenames) {
      try {
        const raw = fs.readFileSync(path.join(dir, name), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          _guardConfig = parsed;
          return _guardConfig;
        }
      } catch {
        // File missing or invalid JSON — try next candidate
      }
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

// Plugin-specific log wrapper — prepends {ts, hook} and delegates the
// file IO to the shared appendJsonl writer. Kept here so the LOG_DIR
// constant stays plugin-local.
function log(hook, data) {
  appendJsonl(LOG_DIR, { ts: new Date().toISOString(), hook, ...data });
}

module.exports = {
  LEVELS,
  LOG_DIR,
  CONFIG_FILENAME,
  LEGACY_CONFIG_FILENAME,
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
