#!/usr/bin/env node
/**
 * Shared utilities for Claude Code hooks.
 */
const fs = require("fs");
const path = require("path");

const LEVELS = { critical: 1, high: 2, strict: 3 };

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "hooks-logs"
);

function log(hook, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(
      LOG_DIR,
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + "\n"
    );
  } catch {}
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
}

function block(id, reason) {
  console.error(`BLOCKED: [${id}] ${reason}`);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

module.exports = { LEVELS, LOG_DIR, log, readStdin, block, allow };
