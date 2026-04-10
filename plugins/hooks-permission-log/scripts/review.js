#!/usr/bin/env node
/**
 * review.js — aggregate permission-log events and emit a markdown
 * report with refinement suggestions for sccm-sandbox presets.
 *
 * Usage:
 *   node review.js                  # last 7 days
 *   node review.js --days=14
 *   node review.js --since=2026-04-01
 *   node review.js --no-prune       # don't delete old log files
 *   node review.js --prune-days=60  # change prune cutoff
 *   node review.js --json           # emit machine-readable JSON instead
 *
 * Reads:   $CLAUDE_PROJECT_DIR/.claude/permission-logs/*.jsonl
 * Writes:  stdout (markdown report)
 *          (optionally prunes log files older than --prune-days)
 */
const fs = require("fs");
const path = require("path");

const { LOG_DIR } = require("./lib/io");

const SANDBOX_PRESET_PATH = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  "plugins",
  "sccm-sandbox",
  "presets",
  "base.json"
);

const DEFAULT_DAYS = 7;
const DEFAULT_PRUNE_DAYS = 30;
const SUGGEST_MIN_APPROVALS = 3;

function parseArgs(argv) {
  const opts = {
    days: DEFAULT_DAYS,
    since: null,
    prune: true,
    pruneDays: DEFAULT_PRUNE_DAYS,
    json: false,
    presetPath: SANDBOX_PRESET_PATH,
    logDir: LOG_DIR,
  };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "days") opts.days = Number(v);
    else if (k === "since") opts.since = v;
    else if (k === "no-prune") opts.prune = false;
    else if (k === "prune-days") opts.pruneDays = Number(v);
    else if (k === "json") opts.json = true;
    else if (k === "preset") opts.presetPath = v;
    else if (k === "log-dir") opts.logDir = v;
  }
  return opts;
}

function listLogFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort();
}

function dateFromFile(f) {
  return f.slice(0, 10);
}

function isOnOrAfter(fileDate, sinceDate) {
  return fileDate >= sinceDate;
}

function cutoffDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function readEvents(dir, sinceDate) {
  const files = listLogFiles(dir);
  const events = [];
  for (const f of files) {
    if (sinceDate && !isOnOrAfter(dateFromFile(f), sinceDate)) continue;
    const full = path.join(dir, f);
    let raw;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip corrupt lines rather than abort the whole review.
      }
    }
  }
  return events;
}

function pruneOldFiles(dir, days) {
  const cutoff = cutoffDate(days);
  const files = listLogFiles(dir);
  const removed = [];
  for (const f of files) {
    if (dateFromFile(f) < cutoff) {
      try {
        fs.unlinkSync(path.join(dir, f));
        removed.push(f);
      } catch {}
    }
  }
  return removed;
}

/**
 * Group events into per-tool-call buckets.
 *
 * PostToolUse / PostToolUseFailure / PermissionDenied always carry a
 * `tool_use_id` and anchor a group. PermissionRequest is documented
 * as carrying `tool_name, tool_input, permission_suggestions` with
 * no `tool_use_id`, so we attach it to a Post-bearing group via a
 * chronological greedy match: each PR pairs 1:1 to the soonest
 * following Post group that matches (session_id, cmd) within a
 * short time window. A PermissionRequest that matches nothing stands
 * alone as its own group — that is the signal for `user_denied` (no
 * tool call ever ran after the prompt was shown).
 *
 * If a future Claude Code version does put `tool_use_id` on
 * PermissionRequest, the first pass picks it up automatically and
 * the second pass becomes a no-op for that event.
 */
function groupEvents(events) {
  const groups = new Map();

  // Pass 1: group everything with a tool_use_id.
  for (const e of events) {
    if (e.tool_use_id) {
      const key = `id:${e.tool_use_id}`;
      if (!groups.has(key)) {
        groups.set(key, { events: [], key, pairedPR: false });
      }
      groups.get(key).events.push(e);
    }
  }

  // Pass 2: PermissionRequest events without tool_use_id. Sort by
  // timestamp and greedily pair each one to the closest-following
  // Post-bearing group (by session + cmd), 1:1, within the window.
  const WINDOW_MS = 5000;
  const unanchored = events
    .filter((e) => !e.tool_use_id)
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  let standaloneIdx = 0;
  for (const e of unanchored) {
    const eTs = new Date(e.ts).getTime();
    let best = null;
    for (const g of groups.values()) {
      if (g.pairedPR) continue;
      const postEvt = g.events.find(
        (x) => x.event === "post" || x.event === "post_failure"
      );
      if (!postEvt) continue;
      if (postEvt.session_id !== e.session_id) continue;
      if (postEvt.cmd !== e.cmd) continue;
      const postTs = new Date(postEvt.ts).getTime();
      if (postTs < eTs) continue; // Post must come at or after PR
      const dt = postTs - eTs;
      if (dt > WINDOW_MS) continue;
      if (!best || dt < best.dt) best = { g, dt };
    }
    if (best) {
      best.g.events.push(e);
      best.g.pairedPR = true;
    } else {
      const key = `standalone:${e.session_id || "?"}:${standaloneIdx++}`;
      groups.set(key, { events: [e], key, pairedPR: true });
    }
  }

  return { groups: [...groups.values()], orphans: [] };
}

/**
 * Given a grouped set of events for one tool call, determine the
 * outcome. Truth table:
 *
 *   PermissionDenied present            -> auto_denied (auto-mode only)
 *   Post only                            -> auto_allowed
 *   PostFailure only                     -> auto_allowed_failed
 *   PermissionRequest + Post             -> user_approved
 *   PermissionRequest + PostFailure      -> user_approved_failed
 *   PermissionRequest only               -> user_denied
 *   (anything else)                      -> unknown
 */
function classifyGroup(group) {
  const has = {
    permission_request: false,
    post: false,
    post_failure: false,
    permission_denied: false,
  };
  for (const e of group.events) {
    if (e.event in has) has[e.event] = true;
  }

  if (has.permission_denied) return "auto_denied";
  if (has.permission_request) {
    if (has.post) return "user_approved";
    if (has.post_failure) return "user_approved_failed";
    return "user_denied";
  }
  if (has.post) return "auto_allowed";
  if (has.post_failure) return "auto_allowed_failed";
  return "unknown";
}

function aggregate(groupsAndOrphans) {
  const { groups, orphans } = groupsAndOrphans;
  const buckets = new Map(); // cmd_key -> stats

  const bump = (key) => {
    if (!buckets.has(key)) {
      buckets.set(key, {
        cmd_key: key,
        total: 0,
        auto_allowed: 0,
        auto_allowed_failed: 0,
        user_approved: 0,
        user_approved_failed: 0,
        user_denied: 0,
        auto_denied: 0,
        unknown: 0,
        sample_cmds: new Set(),
        permission_suggestions: new Set(),
      });
    }
    return buckets.get(key);
  };

  const sessions = new Set();
  let totalGroups = 0;

  for (const g of groups) {
    totalGroups++;
    const first =
      g.events.find((e) => e.cmd_key) ||
      g.events[0] ||
      null;
    if (!first) continue;
    if (first.session_id) sessions.add(first.session_id);
    const key = first.cmd_key || "(unknown)";
    const stats = bump(key);
    stats.total++;
    const outcome = classifyGroup(g);
    stats[outcome] = (stats[outcome] || 0) + 1;
    if (first.cmd && stats.sample_cmds.size < 5) {
      stats.sample_cmds.add(first.cmd);
    }
    for (const e of g.events) {
      if (e.event === "permission_request" && Array.isArray(e.permission_suggestions)) {
        for (const s of e.permission_suggestions) {
          stats.permission_suggestions.add(
            typeof s === "string" ? s : JSON.stringify(s)
          );
        }
      }
    }
  }

  return {
    buckets: [...buckets.values()].sort((a, b) => b.total - a.total),
    sessions: sessions.size,
    totalGroups,
    orphansCount: orphans.length,
  };
}

function loadPresetAllowSet(presetPath) {
  if (!fs.existsSync(presetPath)) {
    return { allow: new Set(), excluded: new Set(), missing: true };
  }
  try {
    const j = JSON.parse(fs.readFileSync(presetPath, "utf8"));
    const allow = new Set((j.permissions && j.permissions.allow) || []);
    const excluded = new Set(
      (j.sandbox && j.sandbox.excludedCommands) || []
    );
    return { allow, excluded, missing: false };
  } catch {
    return { allow: new Set(), excluded: new Set(), missing: true };
  }
}

/**
 * Turn a cmd_key into the sandbox patterns we would add:
 *   "git commit"     -> Bash(git commit:*) + "git commit *"
 *   "pnpm"           -> Bash(pnpm:*)       + "pnpm *"
 *   "ls"             -> Bash(ls:*)         + "ls *"
 */
function patternsForKey(key) {
  if (!key || key === "(unknown)") return null;
  return {
    allow: `Bash(${key}:*)`,
    excluded: `${key} *`,
  };
}

/**
 * Is this cmd_key already covered by the preset's allow list or
 * excludedCommands? We match on exact string AND on a shorter prefix
 * key (so "git commit" is considered covered by "Bash(git:*)").
 */
function isCovered(key, preset) {
  const first = key.split(" ")[0];
  const candidates = [
    `Bash(${key}:*)`,
    `Bash(${first}:*)`,
  ];
  for (const c of candidates) if (preset.allow.has(c)) return true;
  for (const c of [`${key} *`, `${first} *`]) {
    if (preset.excluded.has(c)) return true;
  }
  return false;
}

function buildSuggestions(agg, preset) {
  const add = [];
  const denies = [];
  for (const b of agg.buckets) {
    if (
      b.user_approved >= SUGGEST_MIN_APPROVALS &&
      b.user_denied === 0 &&
      !isCovered(b.cmd_key, preset)
    ) {
      const p = patternsForKey(b.cmd_key);
      if (p) {
        add.push({
          cmd_key: b.cmd_key,
          approvals: b.user_approved,
          samples: [...b.sample_cmds].slice(0, 3),
          allow: p.allow,
          excluded: p.excluded,
          claude_suggestions: [...b.permission_suggestions],
        });
      }
    }
    if (b.user_denied > 0 && b.user_approved === 0 && b.auto_allowed === 0) {
      denies.push({
        cmd_key: b.cmd_key,
        denials: b.user_denied,
        samples: [...b.sample_cmds].slice(0, 3),
      });
    }
  }
  return { add, denies };
}

function renderMarkdown(opts, agg, suggestions, preset, pruned) {
  const lines = [];
  lines.push(`# permission-log review`);
  lines.push("");
  const since =
    opts.since || cutoffDate(opts.days);
  lines.push(`- Window: since **${since}**`);
  lines.push(`- Sessions observed: ${agg.sessions}`);
  lines.push(`- Tool calls grouped: ${agg.totalGroups}`);
  lines.push(`- Orphan events (unmatched): ${agg.orphansCount}`);
  if (pruned && pruned.length) {
    lines.push(`- Pruned old log files: ${pruned.length}`);
  }
  if (preset.missing) {
    lines.push("");
    lines.push(
      `> ⚠️  Could not read \`${path.relative(process.cwd(), SANDBOX_PRESET_PATH)}\` — coverage check skipped. Suggestions will be based only on logs.`
    );
  }
  lines.push("");

  lines.push(`## Summary by cmd_key`);
  lines.push("");
  lines.push(
    "| cmd_key | total | auto-allow | approved | denied | failed | samples |"
  );
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const b of agg.buckets) {
    const failed = (b.auto_allowed_failed || 0) + (b.user_approved_failed || 0);
    const samples = [...b.sample_cmds]
      .slice(0, 2)
      .map((s) => "`" + s.replace(/\|/g, "\\|") + "`")
      .join("<br>");
    lines.push(
      `| \`${b.cmd_key}\` | ${b.total} | ${b.auto_allowed} | ${b.user_approved} | ${b.user_denied} | ${failed} | ${samples} |`
    );
  }
  lines.push("");

  lines.push(`## Suggested preset additions`);
  lines.push("");
  if (suggestions.add.length === 0) {
    lines.push(
      `_No cmd_keys met the threshold (≥${SUGGEST_MIN_APPROVALS} user approvals, 0 denials, not already covered)._`
    );
    lines.push("");
  } else {
    lines.push(
      `The following commands were approved by you at least ${SUGGEST_MIN_APPROVALS} times without a single denial, and are not yet in the \`base\` preset. Add them to skip future prompts:`
    );
    lines.push("");
    lines.push("```diff");
    lines.push("# plugins/sccm-sandbox/presets/base.json");
    lines.push("  {");
    lines.push('    "sandbox": {');
    lines.push('      "excludedCommands": [');
    for (const a of suggestions.add) {
      lines.push(`+        "${a.excluded}",`);
    }
    lines.push('        …');
    lines.push("      ]");
    lines.push("    },");
    lines.push('    "permissions": {');
    lines.push('      "allow": [');
    for (const a of suggestions.add) {
      lines.push(`+        "${a.allow}",`);
    }
    lines.push('        …');
    lines.push("      ]");
    lines.push("    }");
    lines.push("  }");
    lines.push("```");
    lines.push("");
    lines.push("### Per-candidate detail");
    lines.push("");
    for (const a of suggestions.add) {
      lines.push(`- **\`${a.cmd_key}\`** — ${a.approvals} approvals`);
      for (const s of a.samples) lines.push(`  - \`${s}\``);
      if (a.claude_suggestions.length > 0) {
        lines.push(
          `  - Claude Code also suggested: ${a.claude_suggestions
            .map((x) => "`" + x + "`")
            .join(", ")}`
        );
      }
    }
    lines.push("");
  }

  if (suggestions.denies.length > 0) {
    lines.push(`## Commands you consistently denied`);
    lines.push("");
    lines.push(
      "These were prompted and you denied every time. Consider adding them to `hooks-guard` or `permissions.deny` if you want them blocked outright."
    );
    lines.push("");
    for (const d of suggestions.denies) {
      lines.push(`- **\`${d.cmd_key}\`** — ${d.denials} denials`);
      for (const s of d.samples) lines.push(`  - \`${s}\``);
    }
    lines.push("");
  }

  lines.push(`## How to apply`);
  lines.push("");
  lines.push(
    "1. Edit `plugins/sccm-sandbox/presets/base.json` with the diff above."
  );
  lines.push(
    "2. `pnpm run bump sccm-sandbox patch` (or `minor` if you're adding several new entries)."
  );
  lines.push("3. `pnpm run verify-versions && pnpm test:sccm-sandbox`");
  lines.push("4. `/sccm-sandbox:apply` in a new Claude Code session.");
  lines.push(
    "5. Re-run `/permission-log:review` in a week — newly auto-allowed commands should now show up in the **auto-allow** column."
  );

  return lines.join("\n") + "\n";
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = opts.since || cutoffDate(opts.days);
  const events = readEvents(opts.logDir, since);
  const grouped = groupEvents(events);
  const agg = aggregate(grouped);
  const preset = loadPresetAllowSet(opts.presetPath);
  const suggestions = buildSuggestions(agg, preset);

  let pruned = [];
  if (opts.prune) {
    pruned = pruneOldFiles(opts.logDir, opts.pruneDays);
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          window: { since, days: opts.days },
          sessions: agg.sessions,
          totalGroups: agg.totalGroups,
          orphans: agg.orphansCount,
          buckets: agg.buckets.map((b) => ({
            ...b,
            sample_cmds: [...b.sample_cmds],
            permission_suggestions: [...b.permission_suggestions],
          })),
          suggestions,
          preset_missing: preset.missing,
          pruned,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  process.stdout.write(renderMarkdown(opts, agg, suggestions, preset, pruned));
}

// Only run main() when invoked as a script, not when required by tests.
if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  readEvents,
  groupEvents,
  classifyGroup,
  aggregate,
  loadPresetAllowSet,
  isCovered,
  patternsForKey,
  buildSuggestions,
  renderMarkdown,
  pruneOldFiles,
  cutoffDate,
};
