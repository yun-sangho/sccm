#!/usr/bin/env node
/**
 * worktree-create.js — WorktreeCreate hook.
 *
 * Contract:
 *   - Receives JSON on stdin with 'name' field
 *   - Must print the absolute worktree path on stdout (nothing else!)
 *   - Progress output goes to /dev/tty / stderr
 *
 * Behavior (in order):
 *   1. Creates a git worktree at .claude/worktrees/{name} on branch worktree-{name}
 *   2. Mirrors every `.env` / `.env.local` file from the main repo into the
 *      worktree at the same relative path (monorepo-safe — recursive walk).
 *   3. Copies `.claude/settings.local.json` if it exists in the main repo
 *      (this file is typically gitignored so it does not travel with the
 *      worktree branch automatically).
 *   4. Detects package managers via lockfiles at the worktree root and runs
 *      the appropriate install command for each detected language family
 *      (JS, Python, Ruby, Rust, Go, PHP). Install failures are logged but
 *      do not abort the hook — the worktree is still created.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Helpers ──

function progress(msg) {
  try {
    fs.writeFileSync("/dev/tty", msg + "\n");
  } catch {
    process.stderr.write(msg + "\n");
  }
}

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim();
}

// ── Env file discovery ──

// Matches `.env` and `.env.local` exactly — NOT `.env.example`, `.env.sample`, etc.
const ENV_FILE_REGEX = /^\.env(?:\.local)?$/;

const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "target", // Rust build output
  "vendor", // Ruby/PHP dep caches
  ".venv",
  "venv",
  "__pycache__",
]);

/**
 * Walk `root` recursively and return all `.env` / `.env.local` file paths,
 * relative to `root` (POSIX-style). Skips hidden dirs and common build dirs.
 * Monorepo-safe: finds env files at any depth (apps/api/.env, packages/db/.env.local, ...).
 */
function findEnvFiles(root) {
  const results = [];

  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || EXCLUDE_DIRS.has(e.name)) continue;
        walk(
          path.join(absDir, e.name),
          relDir ? `${relDir}/${e.name}` : e.name
        );
      } else if (e.isFile() && ENV_FILE_REGEX.test(e.name)) {
        results.push(relDir ? `${relDir}/${e.name}` : e.name);
      }
    }
  }

  walk(root, "");
  return results;
}

// ── Package manager detection ──

/**
 * Lockfile-based package manager detection.
 *
 * Families are processed independently so a polyglot monorepo (e.g. JS + Python)
 * runs one install per language family. Within a family, candidates are tried
 * in order and the first lockfile found wins.
 *
 * Install command arrays are tried in order — if the first fails (typically a
 * frozen-lockfile mismatch), the next is attempted.
 */
const INSTALL_FAMILIES = [
  {
    family: "javascript",
    candidates: [
      {
        lockfile: "pnpm-lock.yaml",
        name: "pnpm",
        install: ["pnpm install --frozen-lockfile", "pnpm install"],
      },
      {
        lockfile: "bun.lockb",
        name: "bun",
        install: ["bun install --frozen-lockfile", "bun install"],
      },
      {
        lockfile: "yarn.lock",
        name: "yarn",
        install: ["yarn install --frozen-lockfile", "yarn install"],
      },
      {
        lockfile: "package-lock.json",
        name: "npm",
        install: ["npm ci", "npm install"],
      },
    ],
  },
  {
    family: "python",
    candidates: [
      {
        lockfile: "uv.lock",
        name: "uv",
        install: ["uv sync --frozen", "uv sync"],
      },
      {
        lockfile: "poetry.lock",
        name: "poetry",
        install: ["poetry install"],
      },
      {
        lockfile: "Pipfile.lock",
        name: "pipenv",
        install: ["pipenv install --deploy", "pipenv install"],
      },
    ],
  },
  {
    family: "ruby",
    candidates: [
      {
        lockfile: "Gemfile.lock",
        name: "bundler",
        install: ["bundle install"],
      },
    ],
  },
  {
    family: "rust",
    candidates: [
      {
        lockfile: "Cargo.lock",
        name: "cargo",
        install: ["cargo fetch"],
      },
    ],
  },
  {
    family: "go",
    candidates: [
      {
        lockfile: "go.sum",
        name: "go",
        install: ["go mod download"],
      },
    ],
  },
  {
    family: "php",
    candidates: [
      {
        lockfile: "composer.lock",
        name: "composer",
        install: ["composer install"],
      },
    ],
  },
];

/**
 * Scan `rootDir` for lockfiles and return the matching install entries
 * (one per detected language family).
 */
function detectInstallers(rootDir) {
  const detected = [];
  for (const family of INSTALL_FAMILIES) {
    for (const candidate of family.candidates) {
      if (fs.existsSync(path.join(rootDir, candidate.lockfile))) {
        detected.push({ family: family.family, ...candidate });
        break; // one candidate per family
      }
    }
  }
  return detected;
}

/**
 * Try each install command in order. Returns the command that succeeded, or
 * null if all failed. Errors are swallowed — caller decides how to surface.
 */
function runInstall(entry, cwd, logFile) {
  for (const cmd of entry.install) {
    try {
      execSync(cmd, {
        cwd,
        stdio: ["pipe", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")],
      });
      return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

// ── Main ──

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const data = JSON.parse(input);
  const name = data.name;
  const repoPath = process.env.CLAUDE_PROJECT_DIR;
  if (!repoPath) throw new Error("CLAUDE_PROJECT_DIR is not set");

  const worktreePath = path.join(repoPath, ".claude", "worktrees", name);
  const branch = `worktree-${name}`;

  progress(`Creating worktree '${name}'...`);
  progress(`  Branch: ${branch}`);

  // 1. Create git worktree
  fs.mkdirSync(path.join(repoPath, ".claude", "worktrees"), {
    recursive: true,
  });

  try {
    exec(`git -C "${repoPath}" rev-parse --verify "${branch}"`);
    exec(`git -C "${repoPath}" worktree add "${worktreePath}" "${branch}"`);
  } catch {
    exec(
      `git -C "${repoPath}" worktree add -b "${branch}" "${worktreePath}" HEAD`
    );
  }

  // 2. Copy env files (monorepo-safe recursive)
  progress("  Copying env files...");
  const envFiles = findEnvFiles(repoPath);
  let copied = 0;
  for (const rel of envFiles) {
    const src = path.join(repoPath, rel);
    const dst = path.join(worktreePath, rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      progress(`    ${rel}`);
      copied++;
    } catch (err) {
      progress(`    ${rel} — copy failed: ${err.message}`);
    }
  }
  if (copied === 0) progress("    (no .env files found)");

  // 3. Copy .claude/settings.local.json if present (gitignored file)
  const localSettingsSrc = path.join(repoPath, ".claude", "settings.local.json");
  if (fs.existsSync(localSettingsSrc)) {
    const localSettingsDst = path.join(
      worktreePath,
      ".claude",
      "settings.local.json"
    );
    try {
      fs.mkdirSync(path.dirname(localSettingsDst), { recursive: true });
      fs.copyFileSync(localSettingsSrc, localSettingsDst);
      progress("  Copied .claude/settings.local.json");
    } catch (err) {
      progress(`  .claude/settings.local.json — copy failed: ${err.message}`);
    }
  }

  // 4. Detect package managers and run installs
  const installers = detectInstallers(worktreePath);
  if (installers.length === 0) {
    progress("  No recognized lockfiles — skipping dependency install");
  } else {
    const logFile = path.join(worktreePath, ".worktree-setup.log");
    for (const entry of installers) {
      progress(`  Installing ${entry.family} deps via ${entry.name}...`);
      const ran = runInstall(entry, worktreePath, logFile);
      if (ran) {
        progress(`    ${entry.name}: ${ran}`);
      } else {
        progress(
          `    ${entry.name}: install failed — see ${logFile} (worktree still created)`
        );
      }
    }
  }

  // 5. Done
  progress(`Worktree '${name}' ready.`);
  progress(`  Path: ${worktreePath}`);

  // THE ONLY THING ON STDOUT
  process.stdout.write(worktreePath);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`WorktreeCreate failed: ${err.message}\n`);
    process.exit(1);
  });
} else {
  module.exports = {
    findEnvFiles,
    ENV_FILE_REGEX,
    EXCLUDE_DIRS,
    detectInstallers,
    INSTALL_FAMILIES,
    runInstall,
  };
}
