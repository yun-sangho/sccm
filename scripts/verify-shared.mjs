#!/usr/bin/env node
/**
 * verify-shared.mjs — triangulate three sources of truth and fail on
 * any disagreement:
 *
 *   [A] plugin source files — the actual `require("./_shared/X")`
 *       statements under plugins/<name>/scripts/**.
 *   [B] consumer manifest   — the CONSUMERS array in sync-shared.mjs
 *       (duplicated below).
 *   [C] synced copies       — the files physically present in
 *       plugins/<name>/scripts/_shared/.
 *
 * Enforced invariants:
 *   1. B ↔ C: every module declared in the manifest exists under
 *      _shared/ and is byte-identical to packages/hooks-shared/src/.
 *      No file exists under _shared/ that the manifest does not list.
 *   2. A ↔ B: every shared module a plugin's code requires is
 *      declared in its manifest entry. No manifest entry exists that
 *      no source file actually requires (catches dead copies that
 *      ship to the marketplace as bloat).
 *
 * Violations print a concrete remedy — usually `pnpm run sync-shared`
 * (for 1) or "edit CONSUMERS in sync-shared.mjs" (for 2).
 *
 * Intended uses:
 *   - Pre-commit (via lefthook)
 *   - CI (GitHub Actions, etc.)
 *   - Manual audit: `node scripts/verify-shared.mjs`
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
    modules: ["stdin.js", "logging.js", "shell-chain.js"],
  },
];

function read(p) {
  return fs.readFileSync(p);
}

// Recursively collect .js files under a plugin's scripts/ directory,
// skipping _shared/ (we're looking for *consumers* of _shared, not
// copies of it) and __tests__/ (tests may legitimately require the
// canonical source at ../../../../packages/hooks-shared/... or mock
// things in ways that don't reflect production dependency).
function walkPluginJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_shared" || entry.name === "__tests__") continue;
      out.push(...walkPluginJs(full));
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

// Match require('./_shared/X'), require("../_shared/X"), optional .js
// suffix. Does NOT try to parse JS — a simple regex handles every
// call site in this repo. If someone starts using dynamic imports
// with template strings, the derived set will under-count and the
// resulting test failure (MODULE_NOT_FOUND at runtime) is the
// backstop.
const SHARED_REQUIRE_RE =
  /require\(\s*['"]\.{1,2}\/_shared\/([A-Za-z0-9_-]+)(?:\.js)?['"]\s*\)/g;

// Returns Map<moduleBasename.js, firstSourceFile> — the firstSourceFile
// is used in the error message so the dev can jump straight to the
// culprit. `repoRoot` is passed explicitly so this works against test
// fixtures rooted outside the real repo.
function deriveUsage(pluginDir, repoRoot) {
  const used = new Map();
  for (const file of walkPluginJs(pluginDir)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(SHARED_REQUIRE_RE)) {
      const mod = `${m[1]}.js`;
      if (!used.has(mod)) used.set(mod, path.relative(repoRoot, file));
    }
  }
  return used;
}

// Pure validation function — exported so tests can exercise it against
// temp-dir fixtures without mutating real repo state.
//
// Returns { ok: boolean, problems: string[] }. main() below prints and
// exits; tests inspect the structured result instead.
export function validateShared({ repoRoot, srcDir, consumers }) {
  const problems = [];

  for (const { plugin, modules } of consumers) {
    const pluginScripts = path.join(repoRoot, "plugins", plugin, "scripts");
    const dest = path.join(pluginScripts, "_shared");

    if (!fs.existsSync(dest)) {
      problems.push(`missing directory: plugins/${plugin}/scripts/_shared/`);
      continue;
    }

    const declared = new Set(modules);
    const actual = new Set(
      fs.readdirSync(dest).filter((n) => n !== "SYNC_SOURCE")
    );
    const used = deriveUsage(pluginScripts, repoRoot);

    // [B ↔ C] manifest entries must exist on disk and match source byte-for-byte.
    for (const mod of declared) {
      if (!actual.has(mod)) {
        problems.push(
          `[sync] missing: plugins/${plugin}/scripts/_shared/${mod} (declared in manifest) — run \`pnpm run sync-shared\``
        );
        continue;
      }
      const a = read(path.join(srcDir, mod));
      const b = read(path.join(dest, mod));
      if (!a.equals(b)) {
        problems.push(
          `[drift] plugins/${plugin}/scripts/_shared/${mod} differs from canonical source — run \`pnpm run sync-shared\``
        );
      }
    }
    // [C → B] files on disk that the manifest does not declare.
    for (const name of actual) {
      if (!declared.has(name)) {
        problems.push(
          `[stray] plugins/${plugin}/scripts/_shared/${name} is not declared in the manifest — run \`pnpm run sync-shared\``
        );
      }
    }
    // [A → B] plugin code requires a module the manifest does not declare.
    for (const [mod, sourceFile] of used) {
      if (!declared.has(mod)) {
        problems.push(
          `[undeclared] ${sourceFile} requires "./_shared/${mod.replace(/\.js$/, "")}" but "${mod}" is not in the ${plugin} manifest — add it to CONSUMERS in scripts/sync-shared.mjs (and here), then run \`pnpm run sync-shared\``
        );
      }
    }
    // [B → A] manifest declares a module no plugin source actually requires
    // (dead copy — ships to the marketplace as bloat).
    for (const mod of declared) {
      if (!used.has(mod)) {
        problems.push(
          `[dead] ${plugin} manifest declares "${mod}" but no source file under plugins/${plugin}/scripts/ requires it — remove it from CONSUMERS in scripts/sync-shared.mjs (and here), then run \`pnpm run sync-shared\``
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

function main() {
  const { ok, problems } = validateShared({
    repoRoot: REPO_ROOT,
    srcDir: SRC_DIR,
    consumers: CONSUMERS,
  });

  if (!ok) {
    console.error("verify-shared: problems detected\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `verify-shared: ${CONSUMERS.length} consumers in sync (manifest ↔ usage ↔ copies all consistent)`
  );
}

// Only auto-run when invoked as a script. The test suite imports
// validateShared() directly and should not trigger the real-repo check.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
