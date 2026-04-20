/**
 * appendJsonl — low-level JSONL writer shared by every sccm hook plugin.
 *
 * Takes the log directory as an argument so each plugin keeps its own
 * sub-directory name (hooks-logs vs permission-logs vs …). The date-
 * named file pattern (YYYY-MM-DD.jsonl) and the "swallow every IO
 * error" policy are shared — a logging helper that throws inside a
 * hook would block the tool call, which we never want.
 *
 * Higher-level helpers (adding a ts/hook prefix, v1 schema archival,
 * etc.) live in each plugin; this function is intentionally minimal.
 *
 * Synced into each plugin's scripts/_shared/ by scripts/sync-shared.mjs.
 * Do NOT edit the copies directly; edit this canonical source.
 */
const fs = require("fs");
const path = require("path");

function appendJsonl(logDir, entry) {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(
      logDir,
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {
    // Never disturb the hook chain — swallow IO failures.
  }
}

module.exports = { appendJsonl };
