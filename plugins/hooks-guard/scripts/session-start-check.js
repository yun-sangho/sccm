#!/usr/bin/env node
/**
 * session-start-check.js — SessionStart hook entry.
 *
 * Reads the SessionStart JSON envelope from stdin, filters to
 * source === "startup" (skipping "resume", "clear", "compact" so we don't
 * re-warn on every /compact and /resume), runs `safety-check.js`, and emits
 * the result via the documented hook output contract:
 *
 *   - { systemMessage: "..." }                     ← user-visible warning
 *   - { hookSpecificOutput: { hookEventName: "SessionStart",
 *                             additionalContext: "..." } }
 *                                                  ← Claude-visible context
 *                                                  (so the agent knows the
 *                                                  current safety posture
 *                                                  and can factor it in)
 *
 * Always exits 0. Never blocks session start.
 *
 * SessionStart and UserPromptSubmit are the only hook events where stdout is
 * surfaced to the model; for all other events stdout goes to the debug log.
 * See https://code.claude.com/docs/en/hooks for the contract.
 */
const { checkSafety } = require("./safety-check");

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (!input.trim()) return {};
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

async function main() {
  let data;
  try {
    data = await readStdin();
  } catch {
    process.exit(0);
  }

  // Only run on fresh startup. Skip resume/clear/compact to avoid re-nagging
  // on /compact and /resume.
  if (data.source && data.source !== "startup") {
    process.exit(0);
  }

  const projectDir =
    data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const { warnings, notes } = checkSafety({ projectDir });

  if (warnings.length === 0 && notes.length === 0) {
    process.exit(0);
  }

  const out = {};

  if (warnings.length > 0) {
    const lines = warnings.map((w) => `  ⚠ ${w}`).join("\n");
    out.systemMessage = `hooks-guard safety check:\n${lines}`;
  }

  // Always tell Claude about the current posture so it can factor it in
  // (e.g. recommend the user apply the sandbox before running risky tools).
  const ctxLines = [
    ...warnings.map((w) => `WARNING: ${w}`),
    ...notes.map((n) => `NOTE: ${n}`),
  ];
  out.hookSpecificOutput = {
    hookEventName: "SessionStart",
    additionalContext: `Project safety posture (from hooks-guard SessionStart):\n${ctxLines.join("\n")}`,
  };

  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}
