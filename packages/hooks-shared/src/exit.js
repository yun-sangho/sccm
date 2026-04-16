/**
 * block / allow — exit-code helpers for PreToolUse hook scripts.
 *
 * Claude Code interprets a hook's exit code:
 *   0 → proceed
 *   2 → block, with stderr surfaced as the block reason to the user
 *
 * Centralized here so every hook produces the same "BLOCKED: [id]
 * reason" message format — reviewers can grep for BLOCKED across logs
 * and always see the same shape.
 *
 * Synced into each plugin's scripts/_shared/ by scripts/sync-shared.mjs.
 * Do NOT edit the copies directly; edit this canonical source.
 */

function block(id, reason) {
  console.error(`BLOCKED: [${id}] ${reason}`);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

module.exports = { block, allow };
