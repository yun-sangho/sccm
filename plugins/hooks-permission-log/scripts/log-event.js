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
 * Schema (v2, emitted on every write):
 *   schema_version: 2
 *   ts, event, session_id, tool_use_id, cwd, permission_mode,
 *   hook_event_name, tool, cmd, cmd_key, cmd_keys?, description?,
 *   decision: "allow" | "confirm" | "deny"
 *   reason:   string                          // always present
 *   rule_id?: string                          // when inferable
 *   // event-specific extras preserved:
 *   error?, is_interrupt?, permission_suggestions?
 *
 * This script must NEVER block the hook chain. All errors are swallowed
 * and exit code is always 0.
 */
const {
  readStdin,
  appendJsonl,
  redact,
  truncate,
  SCHEMA_VERSION,
} = require("./lib/io");
const { primaryCmdKey, cmdKeysForCommand } = require("./lib/cmdkey");

const VALID_EVENTS = new Set([
  "permission_request",
  "post",
  "post_failure",
  "permission_denied",
]);

// Map the four hook events to a PermissionDecision-shaped triple. The
// four events neatly partition into allow/confirm/deny: post(+failure)
// both mean "Claude Code let the tool run" (allow), permission_request
// means "the user was prompted" (confirm), permission_denied means
// "blocked" (deny). rule_id surfaces the channel that produced the
// decision so review.js can group by policy source.
function decisionFor(event, payload) {
  const mode = payload.permission_mode || "default";
  const modeRule = `claude.permission_mode=${mode}`;
  switch (event) {
    case "post":
      return { decision: "allow", reason: "tool ran", rule_id: modeRule };
    case "post_failure":
      return {
        decision: "allow",
        reason: "tool ran then failed",
        rule_id: modeRule,
      };
    case "permission_request":
      return {
        decision: "confirm",
        reason: "user prompt requested",
        rule_id: null,
      };
    case "permission_denied": {
      const raw =
        payload.reason !== undefined ? String(payload.reason) : "denied";
      return {
        decision: "deny",
        reason: truncate(redact(raw), 500),
        rule_id:
          typeof payload.rule_id === "string" && payload.rule_id
            ? payload.rule_id
            : null,
      };
    }
    default:
      // Should not reach here — caller validates against VALID_EVENTS.
      return { decision: "allow", reason: "unknown event", rule_id: null };
  }
}

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
    schema_version: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    event,
    ...pickCommon(payload),
  };

  enrichBash(entry, payload);

  // v2 core fields: decision + reason are always present. rule_id only
  // when inferable (currently always for post/post_failure via
  // permission_mode; absent on confirm; optional on deny).
  const d = decisionFor(event, payload);
  entry.decision = d.decision;
  entry.reason = d.reason;
  if (d.rule_id) entry.rule_id = d.rule_id;

  // Event-specific extras preserved from v1.
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

  appendJsonl(entry);
  process.exit(0);
}

main().catch(() => process.exit(0));
