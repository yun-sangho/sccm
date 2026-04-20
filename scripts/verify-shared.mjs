#!/usr/bin/env node
/**
 * verify-shared.mjs — fail if any synced copy under
 * plugins/<name>/scripts/_shared/ diverges from the canonical source
 * at packages/hooks-shared/src/.
 *
 * Intended uses:
 *   - Pre-commit (via lefthook)
 *   - CI (GitHub Actions, etc.)
 *   - Manual audit: `node scripts/verify-shared.mjs`
 *
 * Exits 0 when every consumer's _shared/ directory contains byte-
 * identical copies of the modules it declares. Exits 1 and lists
 * concrete drifts otherwise — the remedy is always the same: run
 * `pnpm run sync-shared`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "packages", "hooks-shared", "src");

// Kept in sync with scripts/sync-shared.mjs. Deliberately duplicated
// rather than shared — both scripts are tiny, and a mismatch between
// sync and verify would itself be caught by `verify-shared` failing.
const CONSUMERS = [
  {
    plugin: "hooks-guard",
    modules: ["stdin.js", "logging.js", "exit.js", "shell-chain.js"],
  },
  {
    plugin: "hooks-pnpm",
    modules: ["stdin.js", "logging.js", "exit.js"],
  },
  {
    plugin: "hooks-permission-log",
    modules: ["stdin.js", "logging.js", "exit.js", "shell-chain.js"],
  },
];

function read(p) {
  return fs.readFileSync(p);
}

function main() {
  let failed = false;
  const problems = [];

  for (const { plugin, modules } of CONSUMERS) {
    const dest = path.join(
      REPO_ROOT,
      "plugins",
      plugin,
      "scripts",
      "_shared"
    );

    if (!fs.existsSync(dest)) {
      problems.push(`missing directory: plugins/${plugin}/scripts/_shared/`);
      failed = true;
      continue;
    }

    const declared = new Set(modules);
    const actual = new Set(
      fs
        .readdirSync(dest)
        .filter((n) => n !== "SYNC_SOURCE")
    );

    for (const mod of declared) {
      if (!actual.has(mod)) {
        problems.push(
          `missing: plugins/${plugin}/scripts/_shared/${mod}`
        );
        failed = true;
        continue;
      }
      const a = read(path.join(SRC_DIR, mod));
      const b = read(path.join(dest, mod));
      if (!a.equals(b)) {
        problems.push(
          `drift: plugins/${plugin}/scripts/_shared/${mod} differs from canonical source`
        );
        failed = true;
      }
    }
    for (const name of actual) {
      if (!declared.has(name)) {
        problems.push(
          `stale: plugins/${plugin}/scripts/_shared/${name} is not declared in the consumer manifest`
        );
        failed = true;
      }
    }
  }

  if (failed) {
    console.error("verify-shared: drift detected\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nFix: run `pnpm run sync-shared`");
    process.exit(1);
  }

  console.log(`verify-shared: ${CONSUMERS.length} consumers in sync`);
}

main();
