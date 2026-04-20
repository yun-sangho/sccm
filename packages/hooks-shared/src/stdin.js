/**
 * readStdin — read all of stdin and JSON.parse it.
 *
 * Shared across the sccm hook plugins because every PreToolUse /
 * PermissionRequest / PostToolUse / PermissionDenied hook starts the
 * same way: drain stdin, parse it as JSON, and enrich from there.
 *
 * Empty or whitespace-only input returns {} rather than throwing.
 *
 * Synced into each plugin's scripts/_shared/ by scripts/sync-shared.mjs.
 * Do NOT edit the copies directly; edit this canonical source.
 */
async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  return JSON.parse(input);
}

module.exports = { readStdin };
