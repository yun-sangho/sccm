#!/usr/bin/env node
/**
 * worktree-remove.js — WorktreeRemove hook.
 *
 * Contract:
 *   - Receives JSON on stdin with 'worktree_path' field
 *   - Removes the git worktree and its `worktree-*` branch
 *
 * No port killing, no process cleanup — git-level removal only.
 */
const { execSync } = require("child_process");
const fs = require("fs");

function progress(msg) {
  try {
    fs.writeFileSync("/dev/tty", msg + "\n");
  } catch {
    process.stderr.write(msg + "\n");
  }
}

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;

  const data = JSON.parse(input);
  const worktreePath = data.worktree_path;
  if (!worktreePath) throw new Error("worktree_path is required");

  // Capture branch name before removal
  let branch = null;
  try {
    branch = exec(`git -C "${worktreePath}" rev-parse --abbrev-ref HEAD`);
  } catch {}

  progress(`Removing worktree at ${worktreePath}...`);
  try {
    exec(`git worktree remove --force "${worktreePath}"`);
  } catch {
    progress("  git worktree remove failed, removing directory manually...");
    fs.rmSync(worktreePath, { recursive: true, force: true });
    try {
      exec("git worktree prune");
    } catch {}
  }

  // Delete the worktree-* branch
  if (branch && branch.startsWith("worktree-")) {
    progress(`  Deleting branch ${branch}...`);
    try {
      exec(`git branch -D "${branch}"`);
    } catch {}
  }

  progress("Worktree removed.");
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`WorktreeRemove failed: ${err.message}\n`);
    process.exit(1);
  });
}
