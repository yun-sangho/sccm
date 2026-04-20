#!/usr/bin/env node
/**
 * verify-shared-bump.mjs — enforce that a change to
 * packages/hooks-shared/src/** is accompanied by a version bump on
 * every consumer plugin, in the same commit / PR.
 *
 * Rationale: Claude Code keys plugin updates off the `version` field
 * in plugin.json / marketplace.json. A shared-helper change that
 * touches the code inside every consumer plugin (via
 * scripts/_shared/) but does NOT bump any version would ship a
 * silent no-op — existing users' cached installs would keep using
 * the old copies forever. CLAUDE.md already mandates this manually;
 * this script is the automated guard.
 *
 * Modes:
 *   - CI  — compares HEAD against GITHUB_BASE_REF (or $BASE_REF).
 *   - Local pre-commit — diffs the index against HEAD.
 *   - Manual — default to `HEAD~1..HEAD`.
 *
 * Exits 0 when either (a) no canonical source files changed, or
 * (b) every consumer plugin has a newer version than on the base.
 * Exits 1 otherwise and prints the unchanged versions.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Kept in sync with scripts/sync-shared.mjs.
const CONSUMERS = ["hooks-guard", "hooks-pnpm", "hooks-permission-log"];

function sh(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

// Returns { mode, base } where mode is "staged" (diff index vs HEAD)
// or "range" (diff base..HEAD). Both forms are understood by the
// `git diff` calls below.
function resolveMode() {
  if (process.env.GITHUB_BASE_REF) {
    try {
      const base = sh(`git rev-parse origin/${process.env.GITHUB_BASE_REF}`);
      return { mode: "range", base };
    } catch {
      // Fall through.
    }
  }
  if (process.env.BASE_REF) return { mode: "range", base: process.env.BASE_REF };
  if (process.env.LEFTHOOK === "1" || process.argv.includes("--staged")) {
    return { mode: "staged", base: "HEAD" };
  }
  return { mode: "range", base: "HEAD~1" };
}

function canonicalChanged({ mode, base }) {
  const cmd =
    mode === "staged"
      ? "git diff --cached --name-only"
      : `git diff --name-only ${base}...HEAD`;
  const files = sh(cmd, { silent: true }).split("\n").filter(Boolean);
  return files.some((f) => f.startsWith("packages/hooks-shared/src/"));
}

function readVersionAt(ref, relPath) {
  try {
    const raw = sh(`git show ${ref}:${relPath}`, { silent: true });
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

// In "staged" mode we want the staged contents (what the commit will
// contain). `git show :<path>` reads the index.
function stagedVersion(relPath) {
  try {
    const raw = sh(`git show :${relPath}`, { silent: true });
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

function workingVersion(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"))
    .version;
}

function main() {
  const { mode, base } = resolveMode();

  if (!canonicalChanged({ mode, base })) {
    console.log(
      "verify-shared-bump: no changes under packages/hooks-shared/src/ — skipped"
    );
    process.exit(0);
  }

  const missing = [];
  for (const name of CONSUMERS) {
    const rel = `plugins/${name}/.claude-plugin/plugin.json`;
    const baseVer = readVersionAt(base, rel);
    // If the base revision didn't have the file, nothing to enforce.
    if (baseVer === null) continue;
    const headVer =
      mode === "staged" ? stagedVersion(rel) || workingVersion(rel) : workingVersion(rel);
    if (headVer === baseVer) {
      missing.push(`${name}: ${baseVer} (unchanged)`);
    }
  }

  if (missing.length > 0) {
    console.error(
      "verify-shared-bump: canonical source changed, but these consumer plugins did not bump their version:\n"
    );
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "\nFix: run `pnpm run bump <plugin> patch` for each, then commit again."
    );
    process.exit(1);
  }

  console.log(
    `verify-shared-bump: all ${CONSUMERS.length} consumers bumped (${mode} vs ${base})`
  );
}

main();
