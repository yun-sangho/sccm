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

import { CONSUMERS } from "./consumer-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// All git invocations here are probes — we catch failures and handle
// them, so stderr from the child (e.g. "fatal: Path 'foo' does not
// exist in 'HEAD~1'") should not leak to the user's terminal.
function sh(cmd) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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

function changedCanonicalFiles({ mode, base }) {
  const cmd =
    mode === "staged"
      ? "git diff --cached --name-only"
      : `git diff --name-only ${base}...HEAD`;
  const files = sh(cmd).split("\n").filter(Boolean);
  const prefix = "packages/hooks-shared/src/";
  return files
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
}

// Per-plugin impact: given the set of changed basename modules under
// canonical src, return the plugins whose _shared/ output would be
// affected. A plugin is affected iff its manifest declares any of
// the changed modules.
//
// Why this matters: deleting packages/hooks-shared/src/index.js (not
// in any consumer manifest) does not change any plugin's marketplace
// payload, so requiring a bump would be a false alarm. Likewise,
// changing shell-chain.js affects hooks-guard + hooks-permission-log
// but NOT hooks-pnpm, which never syncs it.
function affectedPlugins(changedModules) {
  return CONSUMERS.filter(({ modules }) =>
    modules.some((m) => changedModules.includes(m))
  ).map(({ plugin }) => plugin);
}

function readVersionAt(ref, relPath) {
  try {
    const raw = sh(`git show ${ref}:${relPath}`);
    return JSON.parse(raw).version;
  } catch {
    return null;
  }
}

// In "staged" mode we want the staged contents (what the commit will
// contain). `git show :<path>` reads the index.
function stagedVersion(relPath) {
  try {
    const raw = sh(`git show :${relPath}`);
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
  const changed = changedCanonicalFiles({ mode, base });

  if (changed.length === 0) {
    console.log(
      "verify-shared-bump: no changes under packages/hooks-shared/src/ — skipped"
    );
    process.exit(0);
  }

  const affected = affectedPlugins(changed);
  if (affected.length === 0) {
    console.log(
      `verify-shared-bump: changes to [${changed.join(", ")}] do not affect any consumer's synced output — skipped`
    );
    process.exit(0);
  }

  const missing = [];
  for (const name of affected) {
    const rel = `plugins/${name}/.claude-plugin/plugin.json`;
    const baseVer = readVersionAt(base, rel);
    if (baseVer === null) continue; // new plugin, nothing to diff
    const headVer =
      mode === "staged" ? stagedVersion(rel) || workingVersion(rel) : workingVersion(rel);
    if (headVer === baseVer) {
      missing.push(`${name}: ${baseVer} (unchanged)`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `verify-shared-bump: canonical changes to [${changed.join(", ")}] affect these consumers, but they did not bump their version:\n`
    );
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "\nFix: run `pnpm run bump <plugin> patch` for each, then commit again."
    );
    process.exit(1);
  }

  console.log(
    `verify-shared-bump: all ${affected.length} affected consumer(s) bumped (${mode} vs ${base})`
  );
}

main();
