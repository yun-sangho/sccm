#!/usr/bin/env node
/**
 * install-workaround.js — workaround for Claude Code 2.1.101 plugin hook
 * dispatch bug (yun-sangho/sccm#9, anthropics/claude-code#46664).
 *
 * Claude Code 2.1.101 silently drops `WorktreeCreate` / `WorktreeRemove`
 * events registered via a plugin's `hooks/hooks.json`, but still dispatches
 * the same events when they are registered in `~/.claude/settings.json`.
 * This script installs a bridge: it merges `WorktreeCreate` and
 * `WorktreeRemove` entries into the user's `~/.claude/settings.json` that
 * invoke the plugin's on-disk scripts from their stable marketplace path.
 *
 * Once Claude Code ships a fix, run `uninstall` to remove the bridge so
 * the hooks dispatch natively again.
 *
 * Usage:
 *   node install-workaround.js install
 *   node install-workaround.js uninstall
 *   node install-workaround.js status
 *
 * Testability: the settings file path and the plugin script directory can
 * be overridden via `HOOKS_WORKTREE_SETTINGS_PATH` and
 * `HOOKS_WORKTREE_SCRIPT_DIR` environment variables, and all the pure
 * functions are exported for unit tests.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Paths ──

const DEFAULT_SETTINGS_PATH = path.join(
  os.homedir(),
  ".claude",
  "settings.json"
);

// Stable marketplace git checkout path. Unlike the per-version plugin cache
// (~/.claude/plugins/cache/sccm/hooks-worktree/0.2.1/...), this path does
// NOT change when the plugin is updated, so users do not need to re-run
// `install` after every version bump.
const DEFAULT_SCRIPT_DIR = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "marketplaces",
  "sccm",
  "plugins",
  "hooks-worktree",
  "scripts"
);

function settingsPath() {
  return process.env.HOOKS_WORKTREE_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
}

function scriptDir() {
  return process.env.HOOKS_WORKTREE_SCRIPT_DIR || DEFAULT_SCRIPT_DIR;
}

// ── Marker ──
//
// Our hook entries are identified by a distinctive substring in the command
// field. Using the command string itself as the marker avoids polluting the
// settings schema with a custom field, and keeps entries that were installed
// via this script distinguishable from any user-authored WorktreeCreate
// hooks the same person may have set up by hand.

const MARKER = "hooks-worktree@sccm/workaround";

function markerTag() {
  return `# ${MARKER}`;
}

// ── Hook entry builders ──

function createHookEntry(dir = scriptDir()) {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `node "${path.join(dir, "worktree-create.js")}" ${markerTag()}`,
        timeout: 600,
      },
    ],
  };
}

function removeHookEntry(dir = scriptDir()) {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `node "${path.join(dir, "worktree-remove.js")}" ${markerTag()}`,
        timeout: 30,
      },
    ],
  };
}

// ── Entry matcher ──

function isOurEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
  return hooks.some(
    (h) => h && typeof h.command === "string" && h.command.includes(MARKER)
  );
}

// ── Settings read/write ──

function readSettings(file = settingsPath()) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${file}: ${err.message}`);
  }
}

function writeSettings(settings, file = settingsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

// ── Merge helpers (pure, for tests) ──

function mergeInstall(settings, dir = scriptDir()) {
  const out = settings ? { ...settings } : {};
  out.hooks = { ...(out.hooks || {}) };

  const changes = { WorktreeCreate: "unchanged", WorktreeRemove: "unchanged" };

  for (const [event, builder] of [
    ["WorktreeCreate", () => createHookEntry(dir)],
    ["WorktreeRemove", () => removeHookEntry(dir)],
  ]) {
    const existing = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
    if (existing.some(isOurEntry)) {
      changes[event] = "already-present";
      out.hooks[event] = existing;
    } else {
      out.hooks[event] = [...existing, builder()];
      changes[event] = "added";
    }
  }

  return { settings: out, changes };
}

function mergeUninstall(settings) {
  const out = settings ? { ...settings } : {};
  if (!out.hooks) return { settings: out, changes: { WorktreeCreate: "not-present", WorktreeRemove: "not-present" } };
  out.hooks = { ...out.hooks };

  const changes = { WorktreeCreate: "not-present", WorktreeRemove: "not-present" };

  for (const event of ["WorktreeCreate", "WorktreeRemove"]) {
    const existing = Array.isArray(out.hooks[event]) ? out.hooks[event] : null;
    if (!existing) continue;
    const filtered = existing.filter((e) => !isOurEntry(e));
    if (filtered.length === existing.length) continue;
    changes[event] = "removed";
    if (filtered.length === 0) {
      delete out.hooks[event];
    } else {
      out.hooks[event] = filtered;
    }
  }

  // If `hooks` object is now empty, strip it so the settings file stays tidy.
  if (Object.keys(out.hooks).length === 0) delete out.hooks;

  return { settings: out, changes };
}

function getStatus(settings) {
  const hooks = settings && settings.hooks ? settings.hooks : {};
  const wcInstalled =
    Array.isArray(hooks.WorktreeCreate) && hooks.WorktreeCreate.some(isOurEntry);
  const wrInstalled =
    Array.isArray(hooks.WorktreeRemove) && hooks.WorktreeRemove.some(isOurEntry);
  return { WorktreeCreate: wcInstalled, WorktreeRemove: wrInstalled };
}

// ── Command entry points ──

function cmdInstall() {
  const dir = scriptDir();
  const file = settingsPath();

  // Warn (non-fatal) if the marketplace script path doesn't exist yet: the
  // hook file will still be installed so the user can run the command
  // BEFORE or AFTER `claude plugin install`, but we want to surface it.
  if (!fs.existsSync(path.join(dir, "worktree-create.js"))) {
    console.warn(
      `warning: ${path.join(dir, "worktree-create.js")} not found.\n` +
        "  The hook entry will still be written, but will fail to run until\n" +
        "  `hooks-worktree@sccm` is installed via `claude plugin install`."
    );
  }

  const before = readSettings(file);
  const { settings: after, changes } = mergeInstall(before, dir);
  const anyAdded =
    changes.WorktreeCreate === "added" || changes.WorktreeRemove === "added";
  if (anyAdded) writeSettings(after, file);

  console.log(
    [
      "hooks-worktree workaround install:",
      `  target:         ${file}`,
      `  script dir:     ${dir}`,
      `  WorktreeCreate: ${changes.WorktreeCreate}`,
      `  WorktreeRemove: ${changes.WorktreeRemove}`,
      "",
      anyAdded
        ? "Done. New worktrees created via `claude --worktree` will now invoke"
        : "No changes. The workaround was already installed.",
      anyAdded
        ? "the hooks-worktree scripts until Claude Code ships a fix for the"
        : "",
      anyAdded ? "plugin hook dispatch bug." : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function cmdUninstall() {
  const file = settingsPath();
  const before = readSettings(file);
  const { settings: after, changes } = mergeUninstall(before);
  const anyRemoved =
    changes.WorktreeCreate === "removed" || changes.WorktreeRemove === "removed";
  if (anyRemoved) writeSettings(after, file);

  console.log(
    [
      "hooks-worktree workaround uninstall:",
      `  target:         ${file}`,
      `  WorktreeCreate: ${changes.WorktreeCreate}`,
      `  WorktreeRemove: ${changes.WorktreeRemove}`,
      "",
      anyRemoved
        ? "Done. Any non-workaround WorktreeCreate/Remove hooks in your settings"
        : "No changes. The workaround was not installed.",
      anyRemoved ? "were left untouched." : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function cmdStatus() {
  const file = settingsPath();
  const settings = readSettings(file);
  const status = getStatus(settings);
  console.log(
    [
      "hooks-worktree workaround status:",
      `  target:         ${file}`,
      `  WorktreeCreate: ${status.WorktreeCreate ? "installed" : "not installed"}`,
      `  WorktreeRemove: ${status.WorktreeRemove ? "installed" : "not installed"}`,
    ].join("\n")
  );
}

// ── Main ──

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "install":
      cmdInstall();
      return;
    case "uninstall":
      cmdUninstall();
      return;
    case "status":
      cmdStatus();
      return;
    default:
      process.stderr.write(
        "Usage: install-workaround.js [install|uninstall|status]\n"
      );
      process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`install-workaround failed: ${err.message}\n`);
    process.exit(1);
  }
} else {
  module.exports = {
    MARKER,
    DEFAULT_SETTINGS_PATH,
    DEFAULT_SCRIPT_DIR,
    createHookEntry,
    removeHookEntry,
    isOurEntry,
    mergeInstall,
    mergeUninstall,
    getStatus,
    readSettings,
    writeSettings,
  };
}
