#!/usr/bin/env node
/**
 * Shared utilities for Claude Code hooks.
 *
 * Cross-plugin helpers live under ./_shared (synced from
 * packages/hooks-shared/src/ by scripts/sync-shared.mjs — do not
 * edit _shared/ files by hand). Plugin-specific bits (LOG_DIR and
 * the log() timestamp wrapper) stay here.
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
