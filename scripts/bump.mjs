#!/usr/bin/env node
/**
 * bump.mjs — bump the SemVer of a single plugin across all files that carry
 * a copy of its version.
 *
 * Usage:
 *   node scripts/bump.mjs <plugin-name> <patch|minor|major|X.Y.Z>
 *
 * Examples:
 *   node scripts/bump.mjs hooks-guard patch       # 0.1.0 -> 0.1.1
 *   node scripts/bump.mjs hooks-pnpm minor        # 0.1.1 -> 0.2.0
 *   node scripts/bump.mjs hooks-worktree 1.0.0    # explicit version
 *
 * Files updated (all three must exist and match beforehand):
 *   - .claude-plugin/marketplace.json      (plugins[name].version)
 *   - plugins/<name>/.claude-plugin/plugin.json   (version)
 *   - plugins/<name>/package.json                 (version)
 *
 * The marketplace-wide `metadata.version` is NOT touched — manage it manually.
 *
 * If the three files disagree before the bump, this script refuses to run.
 * Fix the mismatch with scripts/verify-versions.mjs first.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(
    "Usage: node scripts/bump.mjs <plugin-name> <patch|minor|major|X.Y.Z>"
  );
  process.exit(1);
}

function parseArgs() {
  const [, , plugin, bump] = process.argv;
  if (!plugin || !bump) usage("missing arguments");
  return { plugin, bump };
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Invalid SemVer string: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function computeNext(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const { major, minor, patch } = parseVersion(current);
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "major") return `${major + 1}.0.0`;
  throw new Error(`Invalid bump '${bump}' — use patch|minor|major|X.Y.Z`);
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function main() {
  const { plugin, bump } = parseArgs();

  const marketplacePath = path.join(
    REPO_ROOT,
    ".claude-plugin",
    "marketplace.json"
  );
  const pluginJsonPath = path.join(
    REPO_ROOT,
    "plugins",
    plugin,
    ".claude-plugin",
    "plugin.json"
  );
  const packageJsonPath = path.join(
    REPO_ROOT,
    "plugins",
    plugin,
    "package.json"
  );

  for (const p of [marketplacePath, pluginJsonPath, packageJsonPath]) {
    if (!fs.existsSync(p)) {
      console.error(`Missing file: ${path.relative(REPO_ROOT, p)}`);
      process.exit(1);
    }
  }

  const marketplace = loadJson(marketplacePath);
  const entry = marketplace.plugins.find((p) => p.name === plugin);
  if (!entry) {
    console.error(
      `Plugin '${plugin}' is not listed in .claude-plugin/marketplace.json`
    );
    process.exit(1);
  }

  const pluginJson = loadJson(pluginJsonPath);
  const packageJson = loadJson(packageJsonPath);

  const current = {
    "marketplace.json": entry.version,
    "plugin.json": pluginJson.version,
    "package.json": packageJson.version,
  };

  const unique = new Set(Object.values(current));
  if (unique.size > 1) {
    console.error(
      `Version mismatch BEFORE bump for '${plugin}' — refusing to proceed:`
    );
    for (const [file, v] of Object.entries(current))
      console.error(`  ${file}: ${v}`);
    console.error(
      "\nFix the mismatch (or pick one value and set the others) and retry."
    );
    process.exit(1);
  }

  const currentVersion = entry.version;
  let nextVersion;
  try {
    nextVersion = computeNext(currentVersion, bump);
  } catch (err) {
    usage(err.message);
  }

  if (nextVersion === currentVersion) {
    console.error(
      `New version is the same as current (${currentVersion}) — nothing to do.`
    );
    process.exit(1);
  }

  // Apply
  entry.version = nextVersion;
  pluginJson.version = nextVersion;
  packageJson.version = nextVersion;

  saveJson(marketplacePath, marketplace);
  saveJson(pluginJsonPath, pluginJson);
  saveJson(packageJsonPath, packageJson);

  console.log(`✔ Bumped ${plugin}: ${currentVersion} → ${nextVersion}`);
  console.log(`  Updated:`);
  console.log(`    .claude-plugin/marketplace.json`);
  console.log(`    plugins/${plugin}/.claude-plugin/plugin.json`);
  console.log(`    plugins/${plugin}/package.json`);
  console.log(``);
  console.log(`Suggested next steps:`);
  console.log(
    `  cd plugins/${plugin} && node --test 'scripts/__tests__/*.test.js'`
  );
  console.log(`  node scripts/verify-versions.mjs`);
  console.log(`  git add -A && git commit -m "${plugin} ${nextVersion}"`);
}

main();
