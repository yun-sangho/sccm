"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  parseArgs,
  buildProposals,
  renderAddBody,
  renderDenyBody,
  humanWindowLabel,
} = require("../file-proposals");

const SCRIPT = path.resolve(__dirname, "..", "file-proposals.js");
const REVIEW = path.resolve(__dirname, "..", "review.js");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeLogs(dir, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const lines = entries.map((e) =>
    JSON.stringify({
      ts: new Date().toISOString(),
      session_id: "sess",
      tool: "Bash",
      cwd: "/x",
      ...e,
    })
  );
  fs.writeFileSync(path.join(dir, `${today}.jsonl`), lines.join("\n") + "\n");
}

function writePreset(dir, preset) {
  const full = path.join(dir, "base.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, JSON.stringify(preset));
  return full;
}

/**
 * Create a fake `gh` binary on disk. Its behavior is controlled by
 * three env vars so the test can script both dry-run (issue list) and
 * apply (issue create) paths:
 *
 *   FAKE_GH_LIST_STDOUT  — body for `gh issue list ...`
 *   FAKE_GH_LIST_STATUS  — exit code for list (default 0)
 *   FAKE_GH_CREATE_LOG   — path; each invocation appends one line
 *                          "<title>\\n" for later assertions
 *   FAKE_GH_CREATE_URL   — URL to print on stdout when creating
 *   FAKE_GH_CREATE_STATUS — exit code for create (default 0)
 */
function installFakeGh(dir) {
  const ghPath = path.join(dir, "gh");
  const contents = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const isList = args[0] === "issue" && args[1] === "list";
const isCreate = args[0] === "issue" && args[1] === "create";
if (isList) {
  process.stdout.write(process.env.FAKE_GH_LIST_STDOUT || "[]");
  process.exit(Number(process.env.FAKE_GH_LIST_STATUS || "0"));
}
if (isCreate) {
  const titleIdx = args.indexOf("--title");
  const title = titleIdx >= 0 ? args[titleIdx + 1] : "<notitle>";
  if (process.env.FAKE_GH_CREATE_LOG) {
    fs.appendFileSync(process.env.FAKE_GH_CREATE_LOG, title + "\\n");
  }
  process.stdout.write((process.env.FAKE_GH_CREATE_URL || "https://example.test/1") + "\\n");
  process.exit(Number(process.env.FAKE_GH_CREATE_STATUS || "0"));
}
process.exit(0);
`;
  fs.writeFileSync(ghPath, contents);
  fs.chmodSync(ghPath, 0o755);
  return ghPath;
}

function runProposals(opts) {
  const {
    args = [],
    env = {},
    logDir,
    presetPath,
  } = opts;
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      `--log-dir=${logDir}`,
      `--preset=${presetPath}`,
      "--json",
      ...args,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
    }
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: (() => {
      try {
        return JSON.parse(result.stdout || "{}");
      } catch {
        return null;
      }
    })(),
  };
}

// ---------- pure-function tests ----------

test("parseArgs: --apply toggles", () => {
  assert.strictEqual(parseArgs([]).apply, false);
  assert.strictEqual(parseArgs(["--apply"]).apply, true);
  assert.strictEqual(parseArgs(["--json"]).json, true);
  assert.strictEqual(parseArgs(["--days=14"]).days, 14);
  assert.strictEqual(
    parseArgs(["--repo=foo/bar"]).repo,
    "foo/bar"
  );
});

test("humanWindowLabel: since vs days", () => {
  assert.strictEqual(
    humanWindowLabel({ since: "2026-04-01", days: 7 }),
    "since 2026-04-01"
  );
  assert.strictEqual(
    humanWindowLabel({ since: null, days: 14 }),
    "the last 14 days"
  );
});

test("buildProposals: maps add + deny suggestions with stable titles", () => {
  const suggestions = {
    add: [
      {
        cmd_key: "tree",
        approvals: 5,
        samples: ["tree -L 2"],
        allow: "Bash(tree:*)",
        excluded: "tree *",
        claude_suggestions: [],
      },
    ],
    denies: [
      {
        cmd_key: "curl",
        denials: 3,
        samples: ["curl https://bad"],
      },
    ],
  };
  const ps = buildProposals(suggestions, "the last 7 days");
  assert.strictEqual(ps.length, 2);
  assert.strictEqual(ps[0].kind, "add");
  assert.strictEqual(ps[0].cmd_key, "tree");
  assert.strictEqual(
    ps[0].title,
    "[sccm-sandbox] Add `tree` to base preset"
  );
  assert.ok(ps[0].labels.includes("permission-log-proposal"));
  assert.ok(ps[0].labels.includes("plugin:sccm-sandbox"));
  assert.strictEqual(ps[1].kind, "deny");
  assert.strictEqual(
    ps[1].title,
    "[hooks-guard] Consider blocking `curl`"
  );
  assert.ok(ps[1].labels.includes("plugin:hooks-guard"));
});

test("renderAddBody: contains diff, samples, and hidden marker", () => {
  const body = renderAddBody(
    {
      cmd_key: "tree",
      approvals: 4,
      samples: ["tree -L 2", "tree ."],
      allow: "Bash(tree:*)",
      excluded: "tree *",
      claude_suggestions: ["Bash(tree:*)"],
    },
    "the last 7 days"
  );
  assert.match(body, /<!-- permission-log:proposal kind=add cmd_key=tree -->/);
  assert.match(body, /4 user approvals/);
  assert.match(body, /\+ {5}"tree \*"/);
  assert.match(body, /\+ {5}"Bash\(tree:\*\)"/);
  assert.match(body, /tree -L 2/);
  assert.match(body, /Claude Code's own suggestions/);
});

test("renderDenyBody: contains denial count and three options", () => {
  const body = renderDenyBody(
    { cmd_key: "curl", denials: 2, samples: ["curl bad"] },
    "the last 7 days"
  );
  assert.match(body, /<!-- permission-log:proposal kind=deny cmd_key=curl -->/);
  assert.match(body, /2 user denials/);
  assert.match(body, /Option A/);
  assert.match(body, /Option B/);
  assert.match(body, /Option C/);
});

// ---------- end-to-end with a fake gh ----------

function approvedTree(n = 4) {
  // n approvals for `tree`, each a (permission_request, post) pair
  // with matching session/cmd/time windows.
  const out = [];
  const base = Date.now();
  for (let i = 0; i < n; i++) {
    const prTs = new Date(base + i * 1000).toISOString();
    const postTs = new Date(base + i * 1000 + 100).toISOString();
    out.push({
      ts: prTs,
      event: "permission_request",
      cmd: "tree -L 2",
      cmd_key: "tree",
    });
    out.push({
      ts: postTs,
      event: "post",
      tool_use_id: "t" + i,
      cmd: "tree -L 2",
      cmd_key: "tree",
    });
  }
  return out;
}

test("end-to-end: dry-run finds a new proposal", () => {
  const logDir = tmpDir("hpl-fp-logs-");
  writeLogs(logDir, approvedTree(4));
  const presetDir = tmpDir("hpl-fp-preset-");
  const presetPath = writePreset(presetDir, {
    sandbox: { excludedCommands: [] },
    permissions: { allow: [] },
  });
  const ghDir = tmpDir("hpl-fp-gh-");
  installFakeGh(ghDir);

  const { json } = runProposals({
    logDir,
    presetPath,
    env: {
      PATH: `${ghDir}:${process.env.PATH}`,
      FAKE_GH_LIST_STDOUT: "[]",
    },
  });

  assert.ok(json, "expected JSON output");
  assert.strictEqual(json.totals.proposals, 1);
  assert.strictEqual(json.totals.would_create, 1);
  assert.strictEqual(json.totals.skipped_duplicate, 0);
  assert.strictEqual(json.totals.created, 0);
  assert.strictEqual(json.items[0].action, "would_create");
  assert.strictEqual(json.items[0].cmd_key, "tree");
});

test("end-to-end: dry-run skips when issue already exists (any state)", () => {
  const logDir = tmpDir("hpl-fp-logs-");
  writeLogs(logDir, approvedTree(4));
  const presetDir = tmpDir("hpl-fp-preset-");
  const presetPath = writePreset(presetDir, {
    sandbox: { excludedCommands: [] },
    permissions: { allow: [] },
  });
  const ghDir = tmpDir("hpl-fp-gh-");
  installFakeGh(ghDir);

  const existing = JSON.stringify([
    {
      number: 42,
      title: "[sccm-sandbox] Add `tree` to base preset",
      url: "https://github.com/yun-sangho/sccm/issues/42",
      state: "CLOSED",
    },
  ]);

  const { json } = runProposals({
    logDir,
    presetPath,
    env: {
      PATH: `${ghDir}:${process.env.PATH}`,
      FAKE_GH_LIST_STDOUT: existing,
    },
  });

  assert.strictEqual(json.totals.skipped_duplicate, 1);
  assert.strictEqual(json.totals.would_create, 0);
  assert.strictEqual(json.items[0].action, "skipped_duplicate");
  assert.strictEqual(json.items[0].existing.number, 42);
  assert.strictEqual(json.items[0].existing.state, "CLOSED");
});

test("end-to-end: --apply calls gh issue create for new proposals", () => {
  const logDir = tmpDir("hpl-fp-logs-");
  writeLogs(logDir, approvedTree(4));
  const presetDir = tmpDir("hpl-fp-preset-");
  const presetPath = writePreset(presetDir, {
    sandbox: { excludedCommands: [] },
    permissions: { allow: [] },
  });
  const ghDir = tmpDir("hpl-fp-gh-");
  installFakeGh(ghDir);
  const createLog = path.join(ghDir, "create.log");

  const { json } = runProposals({
    logDir,
    presetPath,
    args: ["--apply"],
    env: {
      PATH: `${ghDir}:${process.env.PATH}`,
      FAKE_GH_LIST_STDOUT: "[]",
      FAKE_GH_CREATE_LOG: createLog,
      FAKE_GH_CREATE_URL: "https://github.com/yun-sangho/sccm/issues/99",
    },
  });

  assert.strictEqual(json.totals.created, 1);
  assert.strictEqual(json.totals.would_create, 0);
  assert.strictEqual(
    json.items[0].url,
    "https://github.com/yun-sangho/sccm/issues/99"
  );
  const lines = fs.readFileSync(createLog, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0], "[sccm-sandbox] Add `tree` to base preset");
});

test("end-to-end: --apply refuses if gh list fails", () => {
  const logDir = tmpDir("hpl-fp-logs-");
  writeLogs(logDir, approvedTree(4));
  const presetDir = tmpDir("hpl-fp-preset-");
  const presetPath = writePreset(presetDir, {
    sandbox: { excludedCommands: [] },
    permissions: { allow: [] },
  });
  const ghDir = tmpDir("hpl-fp-gh-");
  installFakeGh(ghDir);

  const result = runProposals({
    logDir,
    presetPath,
    args: ["--apply"],
    env: {
      PATH: `${ghDir}:${process.env.PATH}`,
      FAKE_GH_LIST_STATUS: "1",
      FAKE_GH_LIST_STDOUT: "",
    },
  });

  assert.notStrictEqual(result.status, 0);
  assert.ok(result.json && result.json.error);
});

test("end-to-end: no logs → no proposals", () => {
  const logDir = tmpDir("hpl-fp-empty-");
  fs.mkdirSync(logDir, { recursive: true });
  const presetDir = tmpDir("hpl-fp-preset-");
  const presetPath = writePreset(presetDir, {
    sandbox: { excludedCommands: [] },
    permissions: { allow: [] },
  });
  const ghDir = tmpDir("hpl-fp-gh-");
  installFakeGh(ghDir);

  const { json } = runProposals({
    logDir,
    presetPath,
    env: {
      PATH: `${ghDir}:${process.env.PATH}`,
      FAKE_GH_LIST_STDOUT: "[]",
    },
  });

  assert.strictEqual(json.totals.proposals, 0);
  assert.strictEqual(json.items.length, 0);
});
