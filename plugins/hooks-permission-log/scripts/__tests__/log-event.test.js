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
