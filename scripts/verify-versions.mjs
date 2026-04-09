#!/usr/bin/env node
/**
 * verify-versions.mjs — assert that every plugin has a consistent version
 * across the three places it is recorded:
 *
 *   - .claude-plugin/marketplace.json   (plugins[name].version)
 *   - plugins/<name>/.claude-plugin/plugin.json   (version)
 *   - plugins/<name>/package.json                 (version)
 *
 * Exits 0 on success, 1 on any mismatch or missing file.
 *
 * Intended uses:
 *   - Pre-commit sanity check
 *   - CI (GitHub Actions, etc.)
 *   - Manual audit: `node scripts/verify-versions.mjs`
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const marketplacePath = path.join(
    REPO_ROOT,
    ".claude-plugin",
    "marketplace.json"
  );
  if (!fs.existsSync(marketplacePath)) {
    console.error(`Missing: ${path.relative(REPO_ROOT, marketplacePath)}`);
    process.exit(1);
  }

  const marketplace = loadJson(marketplacePath);
  const plugins = marketplace.plugins || [];

  console.log(
    `Checking version consistency across ${plugins.length} plugins...\n`
  );

  let failed = false;

  for (const entry of plugins) {
    const name = entry.name;
    const pluginJsonPath = path.join(
      REPO_ROOT,
      "plugins",
      name,
      ".claude-plugin",
      "plugin.json"
    );
    const packageJsonPath = path.join(
      REPO_ROOT,
      "plugins",
      name,
      "package.json"
    );

    if (!fs.existsSync(pluginJsonPath)) {
      console.log(
        `✘ ${name}: missing plugins/${name}/.claude-plugin/plugin.json`
      );
      failed = true;
      continue;
    }
    if (!fs.existsSync(packageJsonPath)) {
      console.log(`✘ ${name}: missing plugins/${name}/package.json`);
      failed = true;
      continue;
    }

    const pluginJson = loadJson(pluginJsonPath);
    const packageJson = loadJson(packageJsonPath);

    const versions = {
      "marketplace.json": entry.version,
      "plugin.json": pluginJson.version,
      "package.json": packageJson.version,
    };

    const unique = new Set(Object.values(versions));
    if (unique.size === 1) {
      console.log(`✔ ${name}: ${entry.version}`);
    } else {
      console.log(`✘ ${name}: version mismatch`);
      for (const [file, v] of Object.entries(versions)) {
        console.log(`    ${file}: ${v}`);
      }
      failed = true;
    }
  }

  if (failed) {
    console.log("\n✘ Version consistency check FAILED");
    process.exit(1);
  }
  console.log("\n✔ All plugins have consistent versions");
}

main();
