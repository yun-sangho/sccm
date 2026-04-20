# hooks-permission-log

A Claude Code plugin that logs every Bash permission-flow event
(`PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
`PermissionDenied`) to a local JSONL file. The logs serve as a
general-purpose data layer that any plugin can consume to refine its
permission-related settings. The bundled review commands currently
target `sccm-sandbox` presets and `hooks-guard` rules, but the
underlying JSONL data is available for any consumer.

## Why

Claude Code's permission system — presets, allow-lists, guard rules —
is configured statically. Without observability into what actually
gets prompted, approved, or denied, refining those settings is
guesswork. This plugin provides that observability: a structured log
of every Bash permission event, so any plugin that manages permissions
(e.g. `sccm-sandbox` presets, `hooks-guard` block rules, or a future
plugin of your own) can be improved with real usage data instead of
assumptions.

## What it does

1. **Logs** (general-purpose) — four thin hooks append one JSONL line
   per event to `.claude/permission-logs/YYYY-MM-DD.jsonl`. The hooks
   never block execution; any I/O or parse failure is silently
   swallowed. The log files are plain JSONL — any script or plugin can
   read them.
2. **Reviews** (current consumers: `sccm-sandbox`, `hooks-guard`) —
   `/permission-log:review` groups events by `tool_use_id`, classifies
   each tool call's outcome, aggregates by `cmd_key` (e.g. `pnpm run`,
   `git commit`, `docker compose`), and prints a markdown report with
   a suggested diff for `sccm-sandbox`'s `base.json` and candidate
   block rules for `hooks-guard`.

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

Turns each suggestion into a GitHub issue so the refinements become
trackable work items instead of a report you have to remember to read.

By default issues are filed against
[yun-sangho/sccm](https://github.com/yun-sangho/sccm/issues), but the
target repo and dedup label are configurable for forks / downstream
users:

| Source | Repo | Label |
|---|---|---|
| CLI flag | `--repo=owner/name` | `--label=my-label` |
| Env var  | `SCCM_PROPOSAL_REPO` | `SCCM_PROPOSAL_LABEL` |
| Default  | `yun-sangho/sccm` | `permission-log-proposal` |

Precedence: CLI > env > default.

- **One issue per `cmd_key`**, with a stable title.
- **Deduplicated**: an existing issue with the same title (open **or
  closed**) causes the proposal to be skipped. A closed issue means
  "I already decided on this one" — it will not be refiled.
- **Add proposals** get `[sccm-sandbox] Add \`<cmd_key>\` to base preset`
  with the diff and sample commands.
- **Deny proposals** get `[hooks-guard] Consider blocking \`<cmd_key>\``
  with three candidate actions.
- Labels: `<PROPOSAL_LABEL>` + `plugin:sccm-sandbox` (or
  `plugin:hooks-guard`).
- Requires `gh` CLI authenticated against the target repo. Dry-run
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

## JSONL schema (v2)

Every line written by `log-event.js` carries the v2 shape:

```jsonc
{
  "schema_version": 2,
  "ts": "2026-04-16T12:34:56.000Z",
  "event": "permission_denied",           // or "post" | "post_failure" | "permission_request"
  "session_id": "sess_…",
  "tool_use_id": "toolu_…",
  "cwd": "/workspace",
  "permission_mode": "default",
  "hook_event_name": "PermissionDenied",
  "tool": "Bash",
  "cmd": "curl -H 'Authorization: Bearer <redacted>' …",
  "cmd_key": "curl",

  // v2-specific — always present:
  "decision": "deny",                      // "allow" | "confirm" | "deny"
  "reason": "matched token= rule",         // human-readable
  "rule_id": "hooks-guard:env-file"        // present when inferable

  // event-specific extras, when applicable:
  // "error": "...", "is_interrupt": false,
  // "permission_suggestions": [...],
}
```

### Migration from v1

On the first v2 write of a process, any un-versioned `.jsonl` files
sitting in `.claude/permission-logs/` are moved into
`.claude/permission-logs/v1/`. Your data is never deleted — just
quarantined so a single file never mixes schemas.

`review.js` reads both directories and synthesizes a compatible
`decision` / `reason` / `rule_id` triple for v1 lines so historical
data still populates the aggregation.

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
