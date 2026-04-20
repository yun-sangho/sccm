"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseArgs,
  readEvents,
  groupEvents,
  classifyGroup,
  aggregate,
  aggregateDecisions,
  synthDecision,
  loadPresetAllowSet,
  isCovered,
  patternsForKey,
  buildSuggestions,
  renderMarkdown,
  pruneOldFiles,
  cutoffDate,
} = require("../review");

function tmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hpl-review-"));
}

function write(dir, file, entries) {
  const p = path.join(dir, file);
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function mkEvent(overrides) {
  return {
    ts: new Date().toISOString(),
    session_id: "sess1",
    tool: "Bash",
    cwd: "/x",
    ...overrides,
  };
}

test("parseArgs: defaults and overrides", () => {
  const a = parseArgs([]);
  assert.strictEqual(a.days, 7);
  assert.strictEqual(a.prune, true);
  const b = parseArgs(["--days=14", "--no-prune", "--json"]);
  assert.strictEqual(b.days, 14);
  assert.strictEqual(b.prune, false);
  assert.strictEqual(b.json, true);
});

test("classifyGroup: auto_allowed (post only)", () => {
  const g = { events: [mkEvent({ event: "post", cmd_key: "ls" })] };
  assert.strictEqual(classifyGroup(g), "auto_allowed");
});

test("classifyGroup: auto_allowed_failed (post_failure only)", () => {
  const g = { events: [mkEvent({ event: "post_failure", cmd_key: "false" })] };
  assert.strictEqual(classifyGroup(g), "auto_allowed_failed");
});

test("classifyGroup: user_approved (permission_request + post)", () => {
  const g = {
    events: [
      mkEvent({ event: "permission_request", cmd_key: "tree" }),
      mkEvent({ event: "post", cmd_key: "tree" }),
    ],
  };
  assert.strictEqual(classifyGroup(g), "user_approved");
});

test("classifyGroup: user_denied (permission_request only)", () => {
  const g = {
    events: [mkEvent({ event: "permission_request", cmd_key: "curl" })],
  };
  assert.strictEqual(classifyGroup(g), "user_denied");
});

test("classifyGroup: user_approved_failed", () => {
  const g = {
    events: [
      mkEvent({ event: "permission_request", cmd_key: "tree" }),
      mkEvent({ event: "post_failure", cmd_key: "tree" }),
    ],
  };
  assert.strictEqual(classifyGroup(g), "user_approved_failed");
});

test("classifyGroup: auto_denied (permission_denied wins)", () => {
  const g = {
    events: [mkEvent({ event: "permission_denied", cmd_key: "rm" })],
  };
  assert.strictEqual(classifyGroup(g), "auto_denied");
});

test("classifyGroup: unknown when no recognized events", () => {
  const g = { events: [mkEvent({ event: "weird", cmd_key: "x" })] };
  assert.strictEqual(classifyGroup(g), "unknown");
});

test("groupEvents: groups by tool_use_id", () => {
  const events = [
    mkEvent({ event: "post", tool_use_id: "a", cmd: "ls", cmd_key: "ls" }),
    mkEvent({
      event: "post",
      tool_use_id: "b",
      cmd: "tree",
      cmd_key: "tree",
    }),
  ];
  const { groups } = groupEvents(events);
  assert.strictEqual(groups.length, 2);
});

test("groupEvents: fuzzy matches permission_request into post group", () => {
  const base = new Date("2026-04-10T00:00:00Z").getTime();
  const events = [
    mkEvent({
      ts: new Date(base).toISOString(),
      event: "permission_request",
      cmd: "tree",
      cmd_key: "tree",
      // no tool_use_id
    }),
    mkEvent({
      ts: new Date(base + 200).toISOString(),
      event: "post",
      tool_use_id: "a",
      cmd: "tree",
      cmd_key: "tree",
    }),
  ];
  const { groups } = groupEvents(events);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].events.length, 2);
  assert.strictEqual(classifyGroup(groups[0]), "user_approved");
});

test("groupEvents: permission_request with no match becomes standalone user_denied", () => {
  const events = [
    mkEvent({
      event: "permission_request",
      cmd: "mystery",
      cmd_key: "mystery",
    }),
  ];
  const { groups } = groupEvents(events);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(classifyGroup(groups[0]), "user_denied");
});

test("groupEvents: permission_denied anchored by tool_use_id", () => {
  const events = [
    mkEvent({
      event: "permission_denied",
      tool_use_id: "dd",
      cmd: "rm -rf /",
      cmd_key: "rm",
      reason: "too scary",
    }),
  ];
  const { groups } = groupEvents(events);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(classifyGroup(groups[0]), "auto_denied");
});

test("aggregate: counts outcomes per cmd_key", () => {
  const base = new Date("2026-04-10T00:00:00Z").getTime();
  let offset = 0;
  const at = () => new Date(base + (offset += 100)).toISOString();
  const events = [
    // ls: auto-allowed x2 (just post events, anchored by tool_use_id)
    mkEvent({
      ts: at(),
      event: "post",
      tool_use_id: "l1",
      cmd: "ls",
      cmd_key: "ls",
    }),
    mkEvent({
      ts: at(),
      event: "post",
      tool_use_id: "l2",
      cmd: "ls",
      cmd_key: "ls",
    }),
    // tree: user_approved x3 (permission_request fuzzy-matches to post)
    ...[3, 4, 5].flatMap((n) => [
      mkEvent({
        ts: at(),
        event: "permission_request",
        cmd: "tree",
        cmd_key: "tree",
      }),
      mkEvent({
        ts: at(),
        event: "post",
        tool_use_id: "t" + n,
        cmd: "tree",
        cmd_key: "tree",
      }),
    ]),
    // curl: user_denied x1 (standalone permission_request, no post)
    mkEvent({
      ts: at(),
      event: "permission_request",
      cmd: "curl x",
      cmd_key: "curl",
    }),
  ];
  const agg = aggregate(groupEvents(events));
  const byKey = Object.fromEntries(agg.buckets.map((b) => [b.cmd_key, b]));
  assert.strictEqual(byKey.ls.total, 2);
  assert.strictEqual(byKey.ls.auto_allowed, 2);
  assert.strictEqual(byKey.tree.total, 3);
  assert.strictEqual(byKey.tree.user_approved, 3);
  assert.strictEqual(byKey.curl.total, 1);
  assert.strictEqual(byKey.curl.user_denied, 1);
});

test("loadPresetAllowSet + isCovered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hpl-preset-"));
  const p = path.join(dir, "base.json");
  fs.writeFileSync(
    p,
    JSON.stringify({
      sandbox: { excludedCommands: ["git *"] },
      permissions: { allow: ["Bash(git:*)", "Bash(pnpm:*)"] },
    })
  );
  const preset = loadPresetAllowSet(p);
  assert.strictEqual(preset.missing, false);
  assert.ok(isCovered("git commit", preset));
  assert.ok(isCovered("git", preset));
  assert.ok(isCovered("pnpm run", preset));
  assert.ok(!isCovered("tree", preset));
});

test("patternsForKey: single and multi-word", () => {
  assert.deepStrictEqual(patternsForKey("tree"), {
    allow: "Bash(tree:*)",
    excluded: "tree *",
  });
  assert.deepStrictEqual(patternsForKey("git commit"), {
    allow: "Bash(git commit:*)",
    excluded: "git commit *",
  });
  assert.strictEqual(patternsForKey("(unknown)"), null);
});

test("buildSuggestions: surfaces approved + excludes covered keys", () => {
  // Preset already covers git, but not tree.
  const preset = {
    allow: new Set(["Bash(git:*)"]),
    excluded: new Set(["git *"]),
    missing: false,
  };
  const agg = {
    buckets: [
      {
        cmd_key: "tree",
        total: 4,
        user_approved: 4,
        user_denied: 0,
        auto_allowed: 0,
        sample_cmds: new Set(["tree -L 2", "tree ."]),
        permission_suggestions: new Set(["Bash(tree:*)"]),
      },
      {
        cmd_key: "git commit",
        total: 10,
        user_approved: 10,
        user_denied: 0,
        auto_allowed: 0,
        sample_cmds: new Set(),
        permission_suggestions: new Set(),
      },
      {
        cmd_key: "curl",
        total: 2,
        user_approved: 0,
        user_denied: 2,
        auto_allowed: 0,
        sample_cmds: new Set(["curl https://foo"]),
        permission_suggestions: new Set(),
      },
      {
        cmd_key: "only_two",
        total: 2,
        user_approved: 2,
        user_denied: 0,
        auto_allowed: 0,
        sample_cmds: new Set(),
        permission_suggestions: new Set(),
      },
    ],
  };
  const s = buildSuggestions(agg, preset);
  const keys = s.add.map((x) => x.cmd_key);
  assert.deepStrictEqual(keys, ["tree"]); // git already covered, only_two below threshold
  assert.deepStrictEqual(s.add[0].claude_suggestions, ["Bash(tree:*)"]);
  assert.strictEqual(s.denies.length, 1);
  assert.strictEqual(s.denies[0].cmd_key, "curl");
});

test("readEvents: respects since filter", () => {
  const dir = tmpLogDir();
  write(dir, "2026-04-01.jsonl", [
    mkEvent({ event: "post", tool_use_id: "old", cmd: "ls", cmd_key: "ls" }),
  ]);
  write(dir, "2026-04-09.jsonl", [
    mkEvent({ event: "post", tool_use_id: "new", cmd: "ls", cmd_key: "ls" }),
  ]);
  const events = readEvents(dir, "2026-04-05");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].tool_use_id, "new");
});

test("readEvents: tolerates corrupt lines", () => {
  const dir = tmpLogDir();
  const p = path.join(dir, `${today()}.jsonl`);
  fs.writeFileSync(
    p,
    [
      JSON.stringify(
        mkEvent({
          event: "post",
          tool_use_id: "x",
          cmd: "ls",
          cmd_key: "ls",
        })
      ),
      "not json",
      JSON.stringify(
        mkEvent({
          event: "post",
          tool_use_id: "y",
          cmd: "ls",
          cmd_key: "ls",
        })
      ),
    ].join("\n") + "\n"
  );
  const events = readEvents(dir);
  assert.strictEqual(events.length, 2);
});

test("pruneOldFiles: removes files older than cutoff", () => {
  const dir = tmpLogDir();
  write(dir, "2020-01-01.jsonl", [mkEvent({ event: "post" })]);
  write(dir, `${today()}.jsonl`, [mkEvent({ event: "post" })]);
  const removed = pruneOldFiles(dir, 30);
  assert.deepStrictEqual(removed, ["2020-01-01.jsonl"]);
  assert.ok(fs.existsSync(path.join(dir, `${today()}.jsonl`)));
});

test("renderMarkdown: contains diff when suggestions exist", () => {
  const preset = {
    allow: new Set(),
    excluded: new Set(),
    missing: false,
  };
  const agg = {
    buckets: [
      {
        cmd_key: "tree",
        total: 3,
        auto_allowed: 0,
        auto_allowed_failed: 0,
        user_approved: 3,
        user_approved_failed: 0,
        user_denied: 0,
        auto_denied: 0,
        pre_only: 0,
        sample_cmds: new Set(["tree -L 2"]),
        permission_suggestions: new Set(),
      },
    ],
    sessions: 1,
    totalGroups: 3,
    orphansCount: 0,
  };
  const sugg = buildSuggestions(agg, preset);
  const md = renderMarkdown(
    { days: 7, since: null },
    agg,
    sugg,
    preset,
    []
  );
  assert.match(md, /Suggested preset additions/);
  assert.match(md, /Bash\(tree:\*\)/);
  assert.match(md, /"tree \*"/);
});

test("cutoffDate: returns ISO date string", () => {
  const d = cutoffDate(7);
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

// ── v1 / v2 coexistence ──

test("synthDecision: v2 event passes through unchanged", () => {
  const e = {
    schema_version: 2,
    event: "post",
    decision: "allow",
    reason: "tool ran",
  };
  assert.strictEqual(synthDecision(e), e);
});

test("synthDecision: v1 post → decision=allow + rule_id", () => {
  const e = { event: "post", permission_mode: "default" };
  const out = synthDecision(e);
  assert.strictEqual(out.decision, "allow");
  assert.strictEqual(out.reason, "tool ran");
  assert.strictEqual(out.rule_id, "claude.permission_mode=default");
  assert.strictEqual(out.schema_version, 1);
});

test("synthDecision: v1 permission_request → decision=confirm (no rule_id)", () => {
  const out = synthDecision({ event: "permission_request" });
  assert.strictEqual(out.decision, "confirm");
  assert.ok(!("rule_id" in out));
});

test("synthDecision: v1 permission_denied → decision=deny + preserved reason", () => {
  const out = synthDecision({ event: "permission_denied", reason: "blocked!" });
  assert.strictEqual(out.decision, "deny");
  assert.strictEqual(out.reason, "blocked!");
});

test("readEvents: merges v1 (LOG_DIR_V1) + v2 (LOG_DIR) files", () => {
  const dir = tmpLogDir();
  const v1dir = path.join(dir, "v1");
  fs.mkdirSync(v1dir, { recursive: true });

  // v1-style line (no schema_version)
  write(v1dir, `${today()}.jsonl`, [
    mkEvent({
      event: "post",
      tool_use_id: "v1_a",
      cmd_key: "ls",
      permission_mode: "default",
    }),
  ]);

  // v2-style line
  write(dir, `${today()}.jsonl`, [
    mkEvent({
      schema_version: 2,
      event: "permission_denied",
      tool_use_id: "v2_a",
      cmd_key: "rm",
      decision: "deny",
      reason: "too dangerous",
      rule_id: "hooks-guard:rm-root",
    }),
  ]);

  const events = readEvents(dir, null, v1dir);
  assert.strictEqual(events.length, 2);
  // v1 got synthesized
  const v1 = events.find((e) => e.tool_use_id === "v1_a");
  assert.strictEqual(v1.decision, "allow");
  // v2 preserved
  const v2 = events.find((e) => e.tool_use_id === "v2_a");
  assert.strictEqual(v2.decision, "deny");
  assert.strictEqual(v2.rule_id, "hooks-guard:rm-root");
});

test("aggregateDecisions: groups by rule_id with allow/confirm/deny tally", () => {
  const events = [
    { decision: "allow", rule_id: "claude.permission_mode=default", reason: "tool ran" },
    { decision: "allow", rule_id: "claude.permission_mode=default", reason: "tool ran" },
    { decision: "confirm", rule_id: null, reason: "user prompt requested" },
    { decision: "deny", rule_id: "hooks-guard:env-file", reason: "blocked .env" },
    { decision: "deny", rule_id: "hooks-guard:env-file", reason: "blocked .env" },
  ];
  const rows = aggregateDecisions(events);
  const modeRow = rows.find((r) => r.rule_id === "claude.permission_mode=default");
  const denyRow = rows.find((r) => r.rule_id === "hooks-guard:env-file");
  const confirmRow = rows.find((r) => r.rule_id === "(none)");

  assert.strictEqual(modeRow.allow, 2);
  assert.strictEqual(denyRow.deny, 2);
  assert.strictEqual(confirmRow.confirm, 1);
  // sorted by total descending — first row has the most events
  assert.ok(
    rows[0].allow + rows[0].confirm + rows[0].deny >=
      rows[rows.length - 1].allow + rows[rows.length - 1].confirm + rows[rows.length - 1].deny
  );
});

test("renderMarkdown: includes Decision breakdown table when decisions is non-empty", () => {
  const events = [
    { decision: "deny", rule_id: "hooks-guard:env-file", reason: "blocked .env" },
  ];
  const agg = aggregate({ groups: [], orphans: [] });
  const preset = { allow: new Set(), excluded: new Set(), missing: false };
  const sugg = { add: [], denies: [] };
  const decisions = aggregateDecisions(events);

  const md = renderMarkdown(
    { days: 7, since: null },
    agg,
    sugg,
    preset,
    [],
    decisions
  );
  assert.match(md, /Decision breakdown/);
  assert.match(md, /hooks-guard:env-file/);
});
