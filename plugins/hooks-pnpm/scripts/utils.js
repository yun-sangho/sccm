#!/usr/bin/env node
/**
 * hooks-pnpm — plugin-local utilities.
 *
 * Cross-plugin helpers (readStdin, appendJsonl, block/allow) live in
 * scripts/_shared/ and are synced from packages/hooks-shared at dev
 * time. This file re-exports them so existing callers keep working
 * with require("./utils"), and owns only the log() wrapper that
 * stamps a ts/hook prefix onto entries and the plugin-specific
 * LOG_DIR.
 */
const path = require("path");

const { readStdin } = require("./_shared/stdin");
const { appendJsonl } = require("./_shared/logging");
const { block, allow } = require("./_shared/exit");

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "hooks-logs"
);

function log(hook, data) {
  appendJsonl(LOG_DIR, { ts: new Date().toISOString(), hook, ...data });
}

module.exports = { LOG_DIR, log, readStdin, block, allow };
