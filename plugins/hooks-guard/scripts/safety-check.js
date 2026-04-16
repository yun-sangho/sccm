#!/usr/bin/env node
/**
 * safety-check.js — inspect the current project's safety posture.
 *
 * Pure function `checkSafety({ projectDir, home, env })` returns
 * { warnings, notes }. Callers:
 *
 *   - session-start-check.js   — SessionStart hook entry
 *   - /hooks-guard:safety-check — on-demand slash command
 *
 * Checks performed:
 *
 *   1. Sandbox enabled in <projectDir>/.claude/settings.local.json?
 *      - Missing file → warn "sandbox not configured"
 *      - sandbox.enabled === false → warn "explicitly disabled"
 *      - sandbox.enabled !== true → warn "not enabled"
 *      - Malformed JSON → warn "could not parse"
 *
 *   2. ignore-scripts=true in either <projectDir>/.npmrc or ~/.npmrc?
 *      - Neither set → warn (supply-chain risk: lifecycle scripts run on install)
 *
 *   3. Worktree heuristic (informational):
 *      - If cwd is inside .claude/worktrees/ → silent (good)
 *      - Else if <projectDir>/.claude/worktrees/ exists → note "consider worktree"
 *      - Else silent
 *
 * Honors SCCM_HOOKS_GUARD_QUIET=1 → returns empty { warnings: [], notes: [] }.
 *
 * Never throws. All filesystem failures are silently treated as "absent".
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// Match `ignore-scripts=true` (with optional whitespace) on its own line.
// .npmrc semantics: later entries override earlier, but for this guard we
// only care that the setting is present and `true`. False/missing are both
// treated as "lifecycle scripts will run".
function hasIgnoreScripts(npmrcText) {
  if (!npmrcText) return false;
  return /^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrcText);
}

function checkSafety({ projectDir, home, env } = {}) {
  projectDir = projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  home = home || os.homedir();
  env = env || process.env;

  if (env.SCCM_HOOKS_GUARD_QUIET === "1") {
    return { warnings: [], notes: [] };
  }

  const warnings = [];
  const notes = [];

  // 1. Sandbox enabled?
  const settingsPath = path.join(projectDir, ".claude", "settings.local.json");
  const settingsExists = fs.existsSync(settingsPath);
  const settings = settingsExists ? readJsonSafe(settingsPath) : null;
  if (!settingsExists) {
    warnings.push(
      "Sandbox not configured (.claude/settings.local.json missing). Run /sccm-sandbox:apply to apply a vetted profile."
    );
  } else if (settings === null) {
    warnings.push(
      `Could not parse ${settingsPath} — sandbox state unknown.`
    );
  } else {
    const enabled = settings && settings.sandbox && settings.sandbox.enabled;
    if (enabled === false) {
      warnings.push(
        "Sandbox is explicitly disabled (sandbox.enabled: false). Re-enable it manually if you want OS-level isolation."
      );
    } else if (enabled !== true) {
      warnings.push(
        "Sandbox is not enabled (sandbox.enabled missing or non-true). Run /sccm-sandbox:apply."
      );
    }
  }

  // 2. ignore-scripts in any .npmrc?
  const projHas = hasIgnoreScripts(readTextSafe(path.join(projectDir, ".npmrc")));
  const userHas = hasIgnoreScripts(readTextSafe(path.join(home, ".npmrc")));
  if (!projHas && !userHas) {
    warnings.push(
      "npm ignore-scripts is not enabled. Lifecycle scripts (preinstall/postinstall) will run automatically — supply-chain risk. Add `ignore-scripts=true` to ~/.npmrc or this project's .npmrc."
    );
  }

  // 3. Worktree note (informational)
  const worktreeMarker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const inWorktree = projectDir.includes(worktreeMarker);
  if (!inWorktree) {
    const worktreesDir = path.join(projectDir, ".claude", "worktrees");
    if (fs.existsSync(worktreesDir)) {
      notes.push(
        "This repo uses worktrees (.claude/worktrees/ exists) but you're running in the main checkout. Consider running risky changes inside a worktree."
      );
    }
  }

  return { warnings, notes };
}

module.exports = { checkSafety, hasIgnoreScripts };

// CLI entry — used by /hooks-guard:safety-check slash command.
if (require.main === module) {
  const { warnings, notes } = checkSafety();
  if (warnings.length === 0 && notes.length === 0) {
    console.log("✔ Safety posture OK (sandbox enabled, ignore-scripts set).");
    process.exit(0);
  }
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (notes.length > 0) {
    if (warnings.length > 0) console.log("");
    console.log("Notes:");
    for (const n of notes) console.log(`  · ${n}`);
  }
  process.exit(0);
}
