#!/usr/bin/env node
/**
 * file-proposals.js — turn the current permission-log review
 * suggestions into GitHub issues, deduplicating against existing
 * proposals so a weekly run doesn't spam the tracker.
 *
 * Usage:
 *   node file-proposals.js                  # dry-run: print what would be filed
 *   node file-proposals.js --apply          # actually create issues via gh
 *   node file-proposals.js --days=14
 *   node file-proposals.js --json           # machine-readable output
 *
 * Output (default): human-readable preview, one block per proposal,
 * with "would-create" / "already-filed" markers.
 *
 * Output (--json): a JSON object with {proposals, created, skipped}.
 *
 * Dedup strategy: one `gh issue list` call at the top fetches every
 * issue (open + closed) tagged with `permission-log-proposal`, then
 * each proposal is matched by *exact title*. A proposal is skipped if
 * an issue with that title already exists in any state — we don't
 * re-open or re-file anything the user already decided on.
 *
 * This script calls the `gh` CLI via spawnSync. It never modifies the
 * repo's files. It creates issues only when --apply is passed AND the
 * user runs it themselves (the slash command wrapper handles the
 * confirmation flow).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  readEvents,
  groupEvents,
  aggregate,
  loadPresetAllowSet,
  buildSuggestions,
  cutoffDate,
} = require("./review");

const { LOG_DIR } = require("./lib/io");

const TARGET_REPO = "yun-sangho/sccm";
const PROPOSAL_LABEL = "permission-log-proposal";
const SCCM_SANDBOX_LABEL = "plugin:sccm-sandbox";
const HOOKS_GUARD_LABEL = "plugin:hooks-guard";

const SANDBOX_PRESET_PATH = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  "plugins",
  "sccm-sandbox",
  "presets",
  "base.json"
);

function parseArgs(argv) {
  const opts = {
    days: 7,
    since: null,
    apply: false,
    json: false,
    logDir: LOG_DIR,
    presetPath: SANDBOX_PRESET_PATH,
    repo: TARGET_REPO,
  };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "days") opts.days = Number(v);
    else if (k === "since") opts.since = v;
    else if (k === "apply") opts.apply = true;
    else if (k === "json") opts.json = true;
    else if (k === "log-dir") opts.logDir = v;
    else if (k === "preset") opts.presetPath = v;
    else if (k === "repo") opts.repo = v;
  }
  return opts;
}

/**
 * Build the list of proposals (both add and deny variants) from the
 * current review output. Each proposal has a stable title that the
 * dedup layer uses as its key.
 */
function buildProposals(suggestions, windowLabel) {
  const proposals = [];

  for (const a of suggestions.add) {
    proposals.push({
      kind: "add",
      cmd_key: a.cmd_key,
      title: `[sccm-sandbox] Add \`${a.cmd_key}\` to base preset`,
      labels: [PROPOSAL_LABEL, SCCM_SANDBOX_LABEL],
      body: renderAddBody(a, windowLabel),
    });
  }

  for (const d of suggestions.denies) {
    proposals.push({
      kind: "deny",
      cmd_key: d.cmd_key,
      title: `[hooks-guard] Consider blocking \`${d.cmd_key}\``,
      labels: [PROPOSAL_LABEL, HOOKS_GUARD_LABEL],
      body: renderDenyBody(d, windowLabel),
    });
  }

  return proposals;
}

function renderAddBody(a, windowLabel) {
  const samples = a.samples.length
    ? a.samples.map((s) => `- \`${s}\``).join("\n")
    : "_(no samples captured)_";
  const claudeHints =
    a.claude_suggestions && a.claude_suggestions.length > 0
      ? "\n\n**Claude Code's own suggestions:** " +
        a.claude_suggestions.map((x) => `\`${x}\``).join(", ")
      : "";
  return `<!-- permission-log:proposal kind=add cmd_key=${a.cmd_key} -->
**Source:** \`hooks-permission-log\` review over ${windowLabel}.
**Signal:** ${a.approvals} user approvals, 0 denials.

This command was prompted repeatedly and I approved it every time, and
it is not currently covered by \`plugins/sccm-sandbox/presets/base.json\`.
Adding it would stop the prompts in future sessions.

## Suggested diff

\`\`\`diff
# plugins/sccm-sandbox/presets/base.json
  "sandbox": {
    "excludedCommands": [
+     "${a.excluded}",
      …
    ]
  },
  "permissions": {
    "allow": [
+     "${a.allow}",
      …
    ]
  }
\`\`\`

## Sample commands observed

${samples}${claudeHints}

## How to apply

1. Edit \`plugins/sccm-sandbox/presets/base.json\` per the diff above.
2. \`pnpm run bump sccm-sandbox patch\` (or \`minor\` for a batch of adds).
3. \`pnpm run verify-versions && pnpm test:sccm-sandbox\`
4. \`/sccm-sandbox:apply\` in a new Claude Code session.

---
_Filed automatically by \`/permission-log:file-proposals\`. Close this issue if you decide not to add \`${a.cmd_key}\` — it will not be refiled._
`;
}

function renderDenyBody(d, windowLabel) {
  const samples = d.samples.length
    ? d.samples.map((s) => `- \`${s}\``).join("\n")
    : "_(no samples captured)_";
  return `<!-- permission-log:proposal kind=deny cmd_key=${d.cmd_key} -->
**Source:** \`hooks-permission-log\` review over ${windowLabel}.
**Signal:** ${d.denials} user denials, 0 approvals.

This command was prompted and I denied it every time. It may be worth
adding to \`hooks-guard\`'s block patterns (or to \`permissions.deny\`
in the sandbox preset) so future sessions don't even ask.

## Sample commands observed

${samples}

## Candidate actions

- **Option A:** add a \`guard-bash.js\` pattern under \`hooks-guard\`
  so the command is hard-blocked with an explanatory reason.
- **Option B:** add \`"Bash(${d.cmd_key}:*)"\` to
  \`permissions.deny\` in \`sccm-sandbox\`'s preset.
- **Option C:** do nothing — accept the prompt as a speed bump.

---
_Filed automatically by \`/permission-log:file-proposals\`. Close this issue if you decide no action is needed — it will not be refiled._
`;
}

/**
 * Fetch all existing proposal issues in a single `gh` call so we can
 * dedupe proposal titles client-side.
 *
 * Returns a Map<title, {number, url, state}>. Empty map on any gh
 * error — the dry-run flow will still surface proposals, and --apply
 * will bail loudly.
 */
function fetchExistingProposals(repo) {
  const r = spawnSync(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      PROPOSAL_LABEL,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,url,state",
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || "").trim(), map: new Map() };
  }
  const map = new Map();
  try {
    const arr = JSON.parse(r.stdout || "[]");
    for (const issue of arr) {
      map.set(issue.title, issue);
    }
  } catch (e) {
    return { ok: false, error: `parse error: ${e.message}`, map };
  }
  return { ok: true, map };
}

function createIssue(repo, proposal, bodyPath) {
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    proposal.title,
    "--body-file",
    bodyPath,
  ];
  for (const l of proposal.labels) {
    args.push("--label", l);
  }
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || "").trim() };
  }
  const url = (r.stdout || "").trim().split("\n").pop();
  return { ok: true, url };
}

function writeTempBody(proposal) {
  const tmp = process.env.TMPDIR || "/tmp";
  const safeKey = proposal.cmd_key.replace(/[^a-zA-Z0-9]+/g, "_");
  const file = path.join(
    tmp,
    `permission-log-proposal-${proposal.kind}-${safeKey}.md`
  );
  fs.writeFileSync(file, proposal.body);
  return file;
}

function humanWindowLabel(opts) {
  if (opts.since) return `since ${opts.since}`;
  return `the last ${opts.days} days`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = opts.since || cutoffDate(opts.days);
  const events = readEvents(opts.logDir, since);
  const grouped = groupEvents(events);
  const agg = aggregate(grouped);
  const preset = loadPresetAllowSet(opts.presetPath);
  const suggestions = buildSuggestions(agg, preset);

  const windowLabel = humanWindowLabel(opts);
  const proposals = buildProposals(suggestions, windowLabel);

  const existing = fetchExistingProposals(opts.repo);
  if (!existing.ok && opts.apply) {
    const msg = `Failed to query existing proposals via gh: ${existing.error}\nRefusing to --apply without a working dedup check.`;
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ error: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(msg + "\n");
    }
    process.exit(1);
  }

  const results = {
    repo: opts.repo,
    window: { since, days: opts.days },
    totals: {
      proposals: proposals.length,
      would_create: 0,
      skipped_duplicate: 0,
      created: 0,
      failed: 0,
    },
    items: [],
  };

  for (const p of proposals) {
    const existingIssue = existing.map.get(p.title);
    const item = {
      kind: p.kind,
      cmd_key: p.cmd_key,
      title: p.title,
      labels: p.labels,
      existing: existingIssue
        ? {
            number: existingIssue.number,
            url: existingIssue.url,
            state: existingIssue.state,
          }
        : null,
      action: null,
      url: null,
      error: null,
    };

    if (existingIssue) {
      item.action = "skipped_duplicate";
      results.totals.skipped_duplicate++;
    } else if (!opts.apply) {
      item.action = "would_create";
      results.totals.would_create++;
    } else {
      const bodyPath = writeTempBody(p);
      const created = createIssue(opts.repo, p, bodyPath);
      if (created.ok) {
        item.action = "created";
        item.url = created.url;
        results.totals.created++;
      } else {
        item.action = "failed";
        item.error = created.error;
        results.totals.failed++;
      }
    }
    results.items.push(item);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }

  // Human-readable output.
  const lines = [];
  lines.push(
    `permission-log → proposals (${windowLabel}, target: ${opts.repo})`
  );
  lines.push("");
  if (proposals.length === 0) {
    lines.push(
      "No proposals — nothing met the threshold (≥3 approvals AND 0 denials for adds, or ≥1 denial AND 0 approvals for blocks)."
    );
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }
  lines.push(
    `Found ${proposals.length} proposal(s): ${results.totals.would_create} new, ${results.totals.skipped_duplicate} already filed${opts.apply ? `, ${results.totals.created} created, ${results.totals.failed} failed` : ""}.`
  );
  lines.push("");
  for (const it of results.items) {
    const marker =
      it.action === "created"
        ? "✔ CREATED"
        : it.action === "skipped_duplicate"
          ? `↺ SKIPPED (existing #${it.existing.number} [${it.existing.state}])`
          : it.action === "would_create"
            ? "＋ WOULD CREATE"
            : it.action === "failed"
              ? "✘ FAILED"
              : "";
    lines.push(`- ${marker}  ${it.title}`);
    if (it.existing) lines.push(`    ${it.existing.url}`);
    if (it.url) lines.push(`    ${it.url}`);
    if (it.error) lines.push(`    error: ${it.error}`);
  }
  lines.push("");
  if (!opts.apply && results.totals.would_create > 0) {
    lines.push(
      `Re-run with --apply to file the ${results.totals.would_create} new proposal(s).`
    );
  }
  if (!existing.ok) {
    lines.push("");
    lines.push(
      `⚠ Could not query existing issues via gh (${existing.error}). Dedup disabled — duplicates possible on --apply.`
    );
  }
  process.stdout.write(lines.join("\n") + "\n");
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  buildProposals,
  renderAddBody,
  renderDenyBody,
  fetchExistingProposals,
  humanWindowLabel,
};
