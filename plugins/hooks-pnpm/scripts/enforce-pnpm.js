#!/usr/bin/env node
/**
 * enforce-pnpm.js — PreToolUse hook for Bash.
 *
 * Blocks npm commands in pnpm monorepo.
 * Matcher: "Bash"
 */
const { log, readStdin, block, allow } = require("./utils");

const NPM_COMMANDS =
  /\bnpm\s+(install|i|ci|run|exec|start|test|build|publish|uninstall|remove|update|upgrade|init|link)\b/;

const NPX_COMMAND = /\bnpx\s+/;

async function main() {
  try {
    const data = await readStdin();
    if (data.tool_name !== "Bash") return allow();

    const cmd = data.tool_input?.command || "";

    // Skip git commit messages
    if (/^\s*git\s+commit\b/.test(cmd)) return allow();

    if (NPM_COMMANDS.test(cmd)) {
      log("enforce-pnpm", {
        level: "BLOCKED",
        cmd: cmd.slice(0, 200),
        session_id: data.session_id,
      });
      block(
        "enforce-pnpm",
        "This project uses pnpm. Use pnpm instead of npm."
      );
    }

    if (NPX_COMMAND.test(cmd)) {
      log("enforce-pnpm", {
        level: "BLOCKED",
        cmd: cmd.slice(0, 200),
        session_id: data.session_id,
      });
      block(
        "enforce-npx",
        "This project uses pnpm. Use pnpm dlx instead of npx."
      );
    }

    allow();
  } catch {
    allow();
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { NPM_COMMANDS, NPX_COMMAND };
}
