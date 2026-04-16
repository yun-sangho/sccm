#!/usr/bin/env node
/**
 * sync-shared.mjs — copy packages/hooks-shared/src/*.js into every
 * plugin's scripts/_shared/ directory.
 *
 * Why: Claude Code plugins are distributed as self-contained
 * directories; they cannot declare an external runtime dependency on
 * a sibling plugin or an npm package (the marketplace installer does
 * not run `npm install`). To keep one canonical source of truth for
 * helpers used by multiple plugins, we keep the canonical files under
 * `packages/hooks-shared/src/` and check in copies under each
 * consuming plugin.
 *
 * Usage:
 *   node scripts/sync-shared.mjs             # write copies
 *   node scripts/sync-shared.mjs --check     # drift check only
 *                                             (exit 1 if anything diverges)
 *
 * Pair with verify-shared.mjs (which delegates to --check) so CI /
 * pre-commit flows can fail loudly on hand-edited copies.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "packages", "hooks-shared", "src");

// Plugins that consume the shared code. Adding a new target is
// deliberate — the plugin should also import from `./_shared/*` or
// `../_shared/*` for the copies to serve a purpose.
const TARGETS = [
  "hooks-guard/scripts/_shared",
  "hooks-pnpm/scripts/_shared",
  "hooks-permission-log/scripts/_shared",
];

const MARKER_FILENAME = "SYNC_SOURCE";

function listSourceFiles() {
  return fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

function hashFile(p) {
  if (!fs.existsSync(p)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(p))
    .digest("hex");
}

function markerBody(files) {
  return (
    "# This directory is synced from packages/hooks-shared/src/\n" +
    "# Do NOT edit these files directly. Edit the canonical source and run:\n" +
    "#   pnpm run sync-shared\n" +
    "#\n" +
    "# `pnpm run verify-shared` fails if this copy drifts from the canonical source.\n" +
    "source=packages/hooks-shared/src\n" +
    `files=${files.join(",")}\n`
  );
}

function isMarkerStale(dstDir, files) {
  const marker = path.join(dstDir, MARKER_FILENAME);
  if (!fs.existsSync(marker)) return true;
  return fs.readFileSync(marker, "utf8") !== markerBody(files);
}

export function syncAll({ check = false } = {}) {
  const files = listSourceFiles();
  const drift = [];

  for (const target of TARGETS) {
    const dstDir = path.join(REPO_ROOT, "plugins", target);
    for (const f of files) {
      const src = path.join(SRC_DIR, f);
      const dst = path.join(dstDir, f);
      if (hashFile(src) !== hashFile(dst)) {
        drift.push({ target, file: f });
      }
    }
    if (isMarkerStale(dstDir, files)) {
      drift.push({ target, file: MARKER_FILENAME });
    }
  }

  if (check) return { drift, files, targets: TARGETS };

  for (const target of TARGETS) {
    const dstDir = path.join(REPO_ROOT, "plugins", target);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const f of files) {
      fs.copyFileSync(path.join(SRC_DIR, f), path.join(dstDir, f));
    }
    fs.writeFileSync(path.join(dstDir, MARKER_FILENAME), markerBody(files));
  }
  return { drift, files, targets: TARGETS };
}

// Only run main when invoked directly.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === __filename
) {
  const check = process.argv.includes("--check");
  const result = syncAll({ check });

  if (check) {
    if (result.drift.length > 0) {
      console.error(
        `✘ _shared directories are out of sync with packages/hooks-shared/src/:`
      );
      for (const d of result.drift) {
        console.error(`    plugins/${d.target}/${d.file}`);
      }
      console.error(`\nRun 'pnpm run sync-shared' to update.`);
      process.exit(1);
    }
    console.log(
      `✔ All _shared directories in sync (${result.targets.length} targets, ${result.files.length} files).`
    );
  } else {
    console.log(
      `✔ Synced ${result.files.length} file(s) into ${result.targets.length} plugin(s):`
    );
    for (const t of result.targets) console.log(`    plugins/${t}/`);
  }
}
