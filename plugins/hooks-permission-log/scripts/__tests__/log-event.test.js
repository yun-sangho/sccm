"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.resolve(__dirname, "..", "log-event.js");

function makeTmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpl-test-"));
  return dir;
}

function runLogEvent(eventName, payload, projectDir) {
  const result = spawnSync(process.execPath, [SCRIPT, eventName], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
  return result;
}

function readLogLines(projectDir) {
  const logDir = path.join(projectDir, ".claude", "permission-logs");
  if (!fs.existsSync(logDir)) return [];
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith(".jsonl"));
  const all = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(logDir, f), "utf8");
    for (const line of raw.split("\n")) {
      if (line.trim()) all.push(JSON.parse(line));
    }
  }
  return all;
}

test("log-event: post event writes a line with cmd + cmd_key", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "post",
    {
      tool_name: "Bash",
      tool_input: { command: "pnpm run test" },
      tool_use_id: "toolu_01",
      session_id: "sess_a",
      cwd: "/some/where",
      hook_event_name: "PostToolUse",
    },
    dir
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = readLogLines(dir);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].event, "post");
  assert.strictEqual(lines[0].tool, "Bash");
  assert.strictEqual(lines[0].cmd, "pnpm run test");
  assert.strictEqual(lines[0].cmd_key, "pnpm run");
  assert.strictEqual(lines[0].tool_use_id, "toolu_01");
  assert.strictEqual(lines[0].session_id, "sess_a");
});

test("log-event: permission_denied captures reason", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "permission_denied",
    {
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
      tool_use_id: "toolu_dd",
      session_id: "sess_dd",
      reason: "classifier flagged destructive",
    },
    dir
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.event, "permission_denied");
  assert.strictEqual(entry.reason, "classifier flagged destructive");
});

test("log-event: post_failure event captures error + is_interrupt", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "post_failure",
    {
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_use_id: "toolu_02",
      session_id: "sess_b",
      error: "command exited with code 1",
      is_interrupt: false,
    },
    dir
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.event, "post_failure");
  assert.strictEqual(entry.error, "command exited with code 1");
  assert.strictEqual(entry.is_interrupt, false);
});

test("log-event: permission_request captures permission_suggestions", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "permission_request",
    {
      tool_name: "Bash",
      tool_input: { command: "tree -L 2" },
      session_id: "sess_c",
      permission_suggestions: ["Bash(tree:*)"],
    },
    dir
  );
  assert.strictEqual(res.status, 0, res.stderr);
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.event, "permission_request");
  assert.deepStrictEqual(entry.permission_suggestions, ["Bash(tree:*)"]);
});

test("log-event: secret is redacted", () => {
  const dir = makeTmpProject();
  runLogEvent(
    "post",
    {
      tool_name: "Bash",
      tool_input: {
        command: 'curl -H "Authorization: Bearer sk-supersecret" https://x',
      },
      tool_use_id: "toolu_03",
      session_id: "sess_d",
    },
    dir
  );
  const [entry] = readLogLines(dir);
  assert.ok(!entry.cmd.includes("sk-supersecret"));
  assert.match(entry.cmd, /<redacted>/);
});

test("log-event: non-Bash tool is silently ignored", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "post",
    {
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
      tool_use_id: "toolu_04",
      session_id: "sess_e",
    },
    dir
  );
  assert.strictEqual(res.status, 0);
  assert.strictEqual(readLogLines(dir).length, 0);
});

test("log-event: unknown event name exits 0 without writing", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "totally_made_up",
    { tool_name: "Bash", tool_input: { command: "ls" } },
    dir
  );
  assert.strictEqual(res.status, 0);
  assert.strictEqual(readLogLines(dir).length, 0);
});

test("log-event: malformed stdin still exits 0", () => {
  const dir = makeTmpProject();
  const result = spawnSync(process.execPath, [SCRIPT, "post"], {
    input: "not json at all",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  assert.strictEqual(result.status, 0);
});

test("log-event: pre event is rejected (not in the 4-hook set)", () => {
  const dir = makeTmpProject();
  const res = runLogEvent(
    "pre",
    {
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "toolu_pre",
      session_id: "sess_pre",
    },
    dir
  );
  assert.strictEqual(res.status, 0);
  assert.strictEqual(readLogLines(dir).length, 0);
});

// ── v2 schema: every line carries schema_version + decision + reason ──

test("log-event v2: post event has schema_version=2, decision=allow, reason", () => {
  const dir = makeTmpProject();
  runLogEvent(
    "post",
    {
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "v2_post",
      session_id: "sess_v2",
      permission_mode: "default",
    },
    dir
  );
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.schema_version, 2);
  assert.strictEqual(entry.decision, "allow");
  assert.strictEqual(entry.reason, "tool ran");
  assert.strictEqual(entry.rule_id, "claude.permission_mode=default");
});

test("log-event v2: permission_request decision=confirm (no rule_id)", () => {
  const dir = makeTmpProject();
  runLogEvent(
    "permission_request",
    {
      tool_name: "Bash",
      tool_input: { command: "tree" },
      session_id: "sess_v2",
    },
    dir
  );
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.schema_version, 2);
  assert.strictEqual(entry.decision, "confirm");
  assert.strictEqual(entry.reason, "user prompt requested");
  assert.ok(!("rule_id" in entry), "rule_id should be omitted for confirm");
});

test("log-event v2: permission_denied decision=deny + redacted reason", () => {
  const dir = makeTmpProject();
  runLogEvent(
    "permission_denied",
    {
      tool_name: "Bash",
      tool_input: { command: "curl -H 'Authorization: Bearer sk-secret' x" },
      tool_use_id: "v2_deny",
      session_id: "sess_v2",
      reason: "matched token=supersecret rule",
      rule_id: "hooks-guard:generic-env-ref",
    },
    dir
  );
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.schema_version, 2);
  assert.strictEqual(entry.decision, "deny");
  assert.ok(!entry.reason.includes("supersecret"));
  assert.match(entry.reason, /token=<redacted>/);
  assert.strictEqual(entry.rule_id, "hooks-guard:generic-env-ref");
});

test("log-event v2: post_failure reason='tool ran then failed'", () => {
  const dir = makeTmpProject();
  runLogEvent(
    "post_failure",
    {
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_use_id: "v2_fail",
      session_id: "sess_v2",
      error: "exited 1",
      is_interrupt: false,
    },
    dir
  );
  const [entry] = readLogLines(dir);
  assert.strictEqual(entry.schema_version, 2);
  assert.strictEqual(entry.decision, "allow");
  assert.strictEqual(entry.reason, "tool ran then failed");
  assert.strictEqual(entry.error, "exited 1");
  assert.strictEqual(entry.is_interrupt, false);
});

// ── v1 archival on first v2 write ──

test("log-event v2: archives pre-existing v1 .jsonl into v1/", () => {
  const dir = makeTmpProject();
  const logDir = path.join(dir, ".claude", "permission-logs");
  fs.mkdirSync(logDir, { recursive: true });
  // A v1-shaped line (no schema_version). Filename matches the YYYY-MM-DD
  // pattern that listLogFiles() expects.
  const yesterday = "2024-01-01";
  const v1File = path.join(logDir, `${yesterday}.jsonl`);
  fs.writeFileSync(
    v1File,
    JSON.stringify({ ts: "2024-01-01T00:00:00Z", event: "post", tool: "Bash", cmd: "ls", cmd_key: "ls" }) +
      "\n"
  );

  runLogEvent(
    "post",
    {
      tool_name: "Bash",
      tool_input: { command: "pwd" },
      tool_use_id: "v2_first",
      session_id: "sess_arch",
    },
    dir
  );

  // Original v1 file moved into v1/ subdir
  assert.ok(
    fs.existsSync(path.join(logDir, "v1", `${yesterday}.jsonl`)),
    "v1 file should be moved into v1/ subdir"
  );
  assert.ok(
    !fs.existsSync(v1File),
    "original v1 file should no longer exist in top-level LOG_DIR"
  );
  // A fresh v2 file was written (today)
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(
    fs.existsSync(path.join(logDir, `${today}.jsonl`)),
    "new v2 file should be created at today's date"
  );
});
