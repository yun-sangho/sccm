#!/usr/bin/env node
/**
 * release-plugins.mjs — per-plugin tag + GitHub Release generator.
 *
 * Invoked from .github/workflows/release.yml on every push to main.
 * For each plugin listed in marketplace.json, reads its declared
 * version. If the tag `<plugin>-v<version>` does not yet exist on the
 * remote, creates it and publishes a GitHub Release whose body is the
 * git log of commits that touched `plugins/<plugin>/` (and, when the
 * shared package was changed in the same range, `packages/hooks-shared/`
 * too — consumer plugins are affected by those).
 *
 * Idempotent: re-running on the same commit is a no-op. Missing any
 * required tool (gh CLI, GITHUB_TOKEN env) aborts with a clear error.
 *
 * Dry run: `DRY_RUN=1 node scripts/release-plugins.mjs` prints what
 * would happen without tagging or publishing.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DRY = process.env.DRY_RUN === "1";

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: opts.silent ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  }).trim();
}

function tagExists(tag) {
  try {
    sh(`git rev-parse -q --verify refs/tags/${tag}`, { silent: true });
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag) {
  try {
    const out = sh(`git ls-remote --tags origin refs/tags/${tag}`, {
      silent: true,
    });
    return out.length > 0;
  } catch {
    return false;
  }
}

function previousTag(plugin) {
  // Most recent existing tag of the form <plugin>-vX.Y.Z (excluding HEAD's).
  try {
    const tags = sh(`git tag --list '${plugin}-v*' --sort=-creatordate`, {
      silent: true,
    })
      .split("\n")
      .filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

function changelog(plugin, fromTag) {
  // Include shared-package commits alongside plugin-scoped ones, because
  // a shared change often ships inside every consumer at the same time.
  const paths = `plugins/${plugin} packages/hooks-shared`;
  const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
  try {
    const log = sh(
      `git log ${range} --pretty=format:"- %s (%h)" -- ${paths}`,
      { silent: true }
    );
    return log || "_no commits scoped to this plugin in this range_";
  } catch {
    return "_changelog unavailable_";
  }
}

function releasePlugin(entry) {
  const { name, version } = entry;
  const tag = `${name}-v${version}`;

  if (tagExists(tag) || remoteTagExists(tag)) {
    console.log(`• ${tag}: already exists — skipping`);
    return { name, tag, status: "skip" };
  }

  const prev = previousTag(name);
  const body = [
    `# ${name} ${version}`,
    "",
    prev ? `Changes since \`${prev}\`:` : "Initial tracked release.",
    "",
    changelog(name, prev),
  ].join("\n");

  console.log(`• ${tag}: tagging + releasing`);
  if (DRY) {
    console.log(`  [dry-run] body:\n${body.replace(/^/gm, "    ")}`);
    return { name, tag, status: "dry-run" };
  }

  sh(`git tag ${tag}`);
  sh(`git push origin ${tag}`);

  // gh CLI reads GITHUB_TOKEN from env; set in the workflow.
  const tmp = path.join(REPO_ROOT, `.release-body-${name}.md`);
  fs.writeFileSync(tmp, body);
  try {
    sh(
      `gh release create ${tag} --title "${name} ${version}" --notes-file "${tmp}"`
    );
  } finally {
    fs.unlinkSync(tmp);
  }
  return { name, tag, status: "released" };
}

function main() {
  const marketplacePath = path.join(
    REPO_ROOT,
    ".claude-plugin",
    "marketplace.json"
  );
  const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
  const results = marketplace.plugins.map(releasePlugin);

  const released = results.filter((r) => r.status === "released").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const dryRun = results.filter((r) => r.status === "dry-run").length;
  const parts = [`${released} new release(s)`, `${skipped} skipped`];
  if (dryRun) parts.push(`${dryRun} dry-run`);
  console.log(`\nrelease-plugins: ${parts.join(", ")}`);
}

main();
