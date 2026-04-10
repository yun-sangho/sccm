# hooks-permission-log

A Claude Code plugin that logs every Bash permission-flow event
(`PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
`PermissionDenied`) to a local JSONL file, then lets you review the
history and get concrete suggestions for what to add to your
`sccm-sandbox` preset so Claude Code stops asking the same questions
over and over.

## Why

`sccm-sandbox` ships a static preset (`plugins/sccm-sandbox/presets/base.json`)
of pre-allowed tools. When a command you run regularly is _not_ in
that preset, Claude Code prompts you every single time. Deciding which
commands to add is guesswork unless you have data on what actually hit
the prompt. This plugin is that data layer.

## What it does

1. **Logs** — four thin hooks append one JSONL line per event to
   `.claude/permission-logs/YYYY-MM-DD.jsonl`. The hooks never block
   execution; any I/O or parse failure is silently swallowed.
2. **Reviews** — `/permission-log:review` groups events by
   `tool_use_id`, classifies each tool call's outcome, aggregates by
   `cmd_key` (e.g. `pnpm run`, `git commit`, `docker compose`), and
   prints a markdown report with a **diff for `base.json`** you can
   copy-paste.

## Outcome truth table

| PermissionRequest | Post / PostFailure | PermissionDenied | Outcome |
|---|---|---|---|
| ✗ | Post | ✗ | `auto_allowed` (already covered by preset) |
| ✗ | PostFailure | ✗ | `auto_allowed_failed` |
| ✓ | Post | ✗ | `user_approved` |
| ✓ | PostFailure | ✗ | `user_approved_failed` |
| ✓ | neither | ✗ | `user_denied` (inferred — Claude Code has no hook for manual deny) |
| — | — | ✓ | `auto_denied` (auto-mode classifier only) |

## Install

This plugin is distributed via the `sccm` marketplace. From a project
using the marketplace:

```
/plugin install hooks-permission-log@sccm
```

Restart Claude Code. After the first Bash command you run, a file
`.claude/permission-logs/<today>.jsonl` will appear.

## Usage

### `/permission-log:review` — print a markdown report

```
/permission-log:review
/permission-log:review --days=14
/permission-log:review --since=2026-04-01
/permission-log:review --no-prune
/permission-log:review --json
```

Suggestions appear when a `cmd_key` has **≥3 user approvals, 0
denials, and is not already covered** by your `base.json` preset's
`permissions.allow` / `sandbox.excludedCommands`. Claude Code's own
`permission_suggestions` (when present in the `PermissionRequest`
payload) are surfaced alongside.

### `/permission-log:file-proposals` — file GitHub issues

```
/permission-log:file-proposals              # dry-run: preview
/permission-log:file-proposals --days=14
```

Turns each suggestion into a GitHub issue at
[yun-sangho/sccm](https://github.com/yun-sangho/sccm/issues) so the
refinements become trackable work items instead of a report you have
to remember to read.

- **One issue per `cmd_key`**, with a stable title.
- **Deduplicated**: an existing issue with the same title (open **or
  closed**) causes the proposal to be skipped. A closed issue means
  "I already decided on this one" — it will not be refiled.
- **Add proposals** get `[sccm-sandbox] Add \`<cmd_key>\` to base preset`
  with the diff and sample commands.
- **Deny proposals** get `[hooks-guard] Consider blocking \`<cmd_key>\``
  with three candidate actions.
- Labels: `permission-log-proposal` + `plugin:sccm-sandbox` (or
  `plugin:hooks-guard`).
- Requires `gh` CLI authenticated against yun-sangho/sccm. Dry-run
  works without auth; `--apply` refuses if the dedup query fails.

The command always dry-runs first and asks for confirmation before
filing. Safe to re-run — duplicates are skipped.

### The refinement loop

1. `/permission-log:review` — quick read, or
2. `/permission-log:file-proposals` — file issues for each candidate.
3. On GitHub: triage, discuss, close the ones you reject.
4. For accepted ones: edit `plugins/sccm-sandbox/presets/base.json`,
   `pnpm run bump sccm-sandbox patch`, `/sccm-sandbox:apply`.
5. Close the issue once merged.
6. A week later, the same cmd_keys won't be refiled (closed issue =
   already decided). New cmd_keys show up as fresh issues.

## Privacy

- `cmd` is redacted for common secret patterns (`password=`, `token=`,
  `Bearer ...`, `AWS_SECRET_...`, `Authorization: Bearer ...`) before
  being written to the log.
- Commands longer than 200 characters are truncated.
- `review.js` prunes log files older than 30 days by default (change
  with `--prune-days=N`, disable with `--no-prune`).
- **Add `.claude/permission-logs/` to your `.gitignore`.** The repo's
  top-level `.claude/` is not ignored because `.claude/settings.json`
  is committed.

## Files

```
plugins/hooks-permission-log/
├── .claude-plugin/plugin.json
├── package.json
├── hooks/hooks.json            # registers 4 Bash hooks
├── scripts/
│   ├── log-event.js            # thin wrapper: stdin → jsonl
│   ├── review.js               # aggregation + markdown report
│   ├── file-proposals.js       # review → GitHub issues (dedup + apply)
│   └── lib/
│       ├── io.js               # readStdin / append / redact / truncate
│       └── cmdkey.js           # cmd → cmd_key extraction
└── commands/
    ├── review.md               # /permission-log:review
    └── file-proposals.md       # /permission-log:file-proposals
```
