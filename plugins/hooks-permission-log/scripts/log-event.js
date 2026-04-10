#!/usr/bin/env node
/**
 * log-event.js — thin PermissionRequest / PostToolUse /
 * PostToolUseFailure / PermissionDenied logger.
 *
 * Invoked as:  node log-event.js <event-name>
 *
 * Reads the hook payload from stdin, enriches it with tool/cmd info,
 * redacts obvious secrets, and appends one JSONL line to
 * .claude/permission-logs/YYYY-MM-DD.jsonl.
 *
 * This script must NEVER block the hook chain. All errors are swallowed
 * and exit code is always 0.
 */
const { readStdin, appendJsonl, redact, truncate } = require("./lib/io");
const { primaryCmdKey, cmdKeysForCommand } = require("./lib/cmdkey");

const VALID_EVENTS = new Set([
  "permission_request",
  "post",
  "post_failure",
  "permission_denied",
]);

function pickCommon(payload) {
  return {
    session_id: payload.session_id || null,
    tool_use_id: payload.tool_use_id || null,
    cwd: payload.cwd || null,
    permission_mode: payload.permission_mode || null,
    hook_event_name: payload.hook_event_name || null,
  };
}

function enrichBash(entry, payload) {
  const toolInput = payload.tool_input || {};
  const rawCmd = typeof toolInput.command === "string" ? toolInput.command : "";
  const cmd = truncate(redact(rawCmd));
  const keys = cmdKeysForCommand(rawCmd);
  entry.tool = payload.tool_name || null;
  entry.cmd = cmd;
  entry.cmd_key = primaryCmdKey(rawCmd) || null;
  if (keys.length > 1) entry.cmd_keys = keys;
  if (typeof toolInput.description === "string") {
    entry.description = truncate(redact(toolInput.description));
  }
}

async function main() {
  const event = process.argv[2];
  if (!event || !VALID_EVENTS.has(event)) {
    // Unknown event name — do nothing, but don't fail the hook.
    process.exit(0);
  }

  let payload = {};
  try {
    payload = await readStdin();
  } catch {
    process.exit(0);
  }

  // Only Bash for v0.1.0. If a non-Bash tool sneaks in because the
  // matcher is not honored for this event, silently ignore it.
  if (payload.tool_name && payload.tool_name !== "Bash") {
    process.exit(0);
  }

  const entry = {
    ts: new Date().toISOString(),
    event,
    ...pickCommon(payload),
  };

  enrichBash(entry, payload);

  // Event-specific extras.
  if (event === "post_failure") {
    if (payload.error !== undefined) {
      entry.error = truncate(
        redact(
          typeof payload.error === "string"
            ? payload.error
            : JSON.stringify(payload.error)
        ),
        500
      );
    }
    if (payload.is_interrupt !== undefined) {
      entry.is_interrupt = !!payload.is_interrupt;
    }
  }
  if (event === "permission_request" && payload.permission_suggestions) {
    entry.permission_suggestions = payload.permission_suggestions;
  }
  if (event === "permission_denied" && payload.reason !== undefined) {
    entry.reason = truncate(redact(String(payload.reason)), 500);
  }

  appendJsonl(entry);
  process.exit(0);
}

main().catch(() => process.exit(0));
