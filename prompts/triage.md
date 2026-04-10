# Hourly issue triage — canonical prompt

> This file is the source of truth for the Anthropic-cloud hourly
> triage task. The cloud trigger holds a small bootstrap
> ([`triage.bootstrap.md`](triage.bootstrap.md)) that fetches this file
> via the GitHub MCP and follows it verbatim.

You are running as a Claude Code scheduled task on Anthropic cloud,
hourly, against the public marketplace repo `github.com/yun-sangho/sccm`.

## Goal

Triage every open GitHub issue that has not yet been triaged. For each
issue, classify (which plugin? bug or enhancement?), apply labels, flag
duplicates, flag cases that need a human, and at the very end send ONE
Discord notification summarizing what happened.

## Hard constraints (do NOT bypass)

- Do NOT close any issue.
- Do NOT rename any issue.
- Do NOT create or push any branch.
- Do NOT open any PR.
- Do NOT modify any file in the repo.
- Do NOT use the `gh` CLI or curl GitHub's REST API directly.
  Use the GitHub MCP tools (`mcp__github__*`) for ALL GitHub interactions.
- Do NOT process any issue that already has the `triaged` label —
  skip it entirely without even reading its body.
- Do NOT send more than ONE Discord notification per run.

## Tools you must use

- GitHub MCP server: `mcp__github__list_issues`, `mcp__github__get_issue`,
  `mcp__github__search_issues`, `mcp__github__add_issue_comment`, and
  whatever the MCP exposes for adding labels (typically
  `mcp__github__update_issue` or `mcp__github__add_issue_labels`).
- Bash for: computing timestamps, building the JSON payload, and curl.

## Step 1 — Fetch open untriaged issues

Call the GitHub MCP to list all OPEN issues in `yun-sangho/sccm`.
Filter out any issue that already has the `triaged` label. The remaining
list is what you process. If the list is empty, jump straight to Step 4
(notification with the "all clear" branch).

## Step 2 — For each untriaged issue, triage it

Process issues one at a time. For each issue, do this in order:

### 2a. Identify the plugin

Determine which plugin the issue concerns. Use this priority:

  1. If the issue already has a label like `plugin:hooks-guard` etc.,
     use that. Done.
  2. Otherwise, read the title and body. Search (case-insensitive) for
     these exact plugin names: `hooks-guard`, `hooks-pnpm`,
     `hooks-worktree`, `sccm-sandbox`. Pick the one mentioned first.
  3. Otherwise, look for keyword cues:
     - `git`, `rm -rf`, `secret`, `.env`, `dangerous`, `block` →
       likely `hooks-guard`
     - `npm`, `pnpm`, `enforce` → likely `hooks-pnpm`
     - `worktree`, `.env mirror`, `git worktree`, `dependency install` →
       likely `hooks-worktree`
     - `sandbox`, `permissions.allow`, `excludedCommands`, `seatbelt`,
       `presets` → likely `sccm-sandbox`
  4. If none of the above identifies a plugin with reasonable confidence,
     this issue is ambiguous. Skip the rest of step 2 for this issue and
     handle it via the "needs-info" branch in step 2e instead.

### 2b. Check for duplicates BEFORE labeling

Before adding any label, search the repo for similar issues. Use
`mcp__github__search_issues` with a query like:
`repo:yun-sangho/sccm <2-3 keywords from this issue's title>`.
Include both open AND closed issues.

If you find an existing issue (open or closed) that is clearly the same
underlying request — same plugin, same observed behavior, same proposed
change — handle it as a duplicate:

  1. Post ONE comment on the new issue:
     "Looks like a duplicate of #<original num>. Linking for context."
  2. Add labels: `plugin:<name>`, `duplicate`, `triaged`.
  3. Move on to the next issue. Do NOT also add `bug` / `enhancement` /
     `claude:auto-fix` / `needs-info` to a duplicate.

If unsure whether it's a real duplicate, treat it as NOT a duplicate
(false positives are worse than false negatives here).

### 2c. Decide bug vs enhancement

Read the issue body. Apply this rule:

- **bug** — the user is reporting that existing behavior is wrong,
  broken, crashing, throwing errors, blocking something it shouldn't,
  failing to block something it should, producing incorrect output,
  or otherwise diverging from documented or reasonable behavior.

- **enhancement** — the user is requesting new functionality, a new
  preset, a new option, expanded coverage, better UX, documentation
  improvements, or any addition to existing capabilities.

If the issue mixes both (e.g. "X is broken AND it would be nice to also
add Y"), pick whichever is the primary focus of the title. If still
unsure, default to `enhancement`.

### 2d. Decide auto-fix eligibility

Add the `claude:auto-fix` label ONLY if ALL of these are true:

- The issue has a clear, single-paragraph description.
- The fix is in ONE plugin only (no cross-plugin coordination).
- The fix is plausibly under 20 lines net change in code.
- The fix is one of: typo in docs/strings/comments, regex tweak that
  adds or removes a single pattern, missing case in an existing
  switch/conditional, missing entry in an array (e.g. one new file
  to allowlist, one new excludedCommand entry), trivial test
  addition for an already-fixed bug.
- The issue does NOT touch security-sensitive code (hooks-guard
  PATTERNS array, hooks-guard SECRETS list, sandbox preset
  permissions.allow / excludedCommands lists), because those need
  human review even for "small" changes.
- The issue does NOT require an API design choice ("should this
  command take a flag?", "should the default be X or Y?").
- The fix would NOT require modifying more than 2 files total.

If even one of the above is false, do NOT add `claude:auto-fix`.
Better to leave a real human to look at it than to flag a risky
auto-fix.

### 2e. Decide needs-info eligibility

Add the `needs-info` label and post ONE targeted question if any of
these are true:

- You could not identify the plugin from labels, body, or keywords
  (ambiguous case from step 2a).
- It's a bug report but there are no reproduction steps and the
  description is vague.
- The user's environment is critical (e.g. "it crashes") but no
  plugin version, OS, or Claude Code version is given.
- The behavior described is internally contradictory ("X happened
  but X is impossible because Y").

Post the question as ONE comment. Be specific. Examples:
- "Which plugin is this about — hooks-guard or sccm-sandbox?"
- "What plugin version are you on? Run `cat plugins/<name>/.claude-plugin/plugin.json | grep version`."
- "Could you share the exact command that triggered the block message?"

If you add `needs-info`, still add `triaged` (you've handled it for this
hour — the next hour will skip it because it's already triaged, until
the user replies and a human re-triages).

### 2f. Apply the labels

For a normal issue (not a duplicate), the label set is:
- `plugin:<name>` (one of the four)
- `bug` or `enhancement` (exactly one)
- `triaged` (always)
- `claude:auto-fix` (if step 2d said yes)
- `needs-info` (if step 2e said yes)

Use the GitHub MCP to add all the labels in one call if possible.
Issues can have both `claude:auto-fix` and `needs-info` only in the
unusual case where the fix is obvious but a detail is missing — try
to avoid that combination.

## Step 3 — Aggregate the run results

Track these counters in shell variables as you process issues:

- `TOTAL_OPEN`         total open issues in the repo (from step 1)
- `TRIAGED_COUNT`      how many issues you actually triaged this run
- `ATTENTION_COUNT`    how many of those got `needs-info` or `claude:auto-fix`
- `DUPLICATE_COUNT`    how many got `duplicate`
- `TRIAGED_LIST`       multi-line, one per issue, in this exact format:
                       `• [#<num>](https://github.com/yun-sangho/sccm/issues/<num>) — \`<plugin>\` — <title>`
- `ATTENTION_LIST`     multi-line, one per attention-needing issue, in this exact format:
                       `[#<num>](https://github.com/yun-sangho/sccm/issues/<num>) — _<reason or question>_`

The Markdown link syntax `[#12](https://github.com/yun-sangho/sccm/issues/12)`
is intentional — Discord embed `description` and `field.value` render
markdown links as clickable, so the human reading the notification can
jump straight to the issue without copy-pasting a number.

If you encountered any error during step 2 (an MCP call failed, an
issue couldn't be processed), record it in an `ERROR_NOTE` variable
but do NOT abort the run — continue with the next issue.

## Step 4 — Send ONE Discord notification (EXACTLY ONCE, at the end)

This is the LAST action of the run. After the curl call returns, the
run is over. Do not call curl again. Do not call any other notification
tool. Do not summarize back to me — the Discord embed IS the summary.

### 4a. Compute KST timestamps

```bash
KST_DISPLAY=$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M KST')
KST_ISO=$(TZ=Asia/Seoul date '+%Y-%m-%dT%H:%M:%S+09:00')
```

### 4b. Decide color, emoji, and title

- If `TRIAGED_COUNT == 0` and no `ERROR_NOTE`:
  - `COLOR=5763719`  `EMOJI="🟢"`
  - `TITLE="sccm triage — all clear"`
  - `DESC="No untriaged issues. Repo is clean."`

- If `TRIAGED_COUNT >= 1` and `ATTENTION_COUNT == 0` and no `ERROR_NOTE`:
  - `COLOR=5793266`  `EMOJI="🔵"`
  - `TITLE="sccm triage — ${TRIAGED_COUNT} triaged"`
  - `DESC="${TRIAGED_LIST}"`

- If `TRIAGED_COUNT >= 1` and `ATTENTION_COUNT >= 1`:
  - `COLOR=16705372`  `EMOJI="🟡"`
  - `TITLE="sccm triage — ${TRIAGED_COUNT} triaged, ${ATTENTION_COUNT} need attention"`
  - `DESC="${TRIAGED_LIST}"`

- If `ERROR_NOTE` is set:
  - `COLOR=15548997`  `EMOJI="🔴"`
  - `TITLE="sccm triage — error"`
  - `DESC="${ERROR_NOTE}"`

Truncate `DESC` to 1500 chars if longer (Discord embed description hard
limit is 4096; we keep it visually clean).

### 4c. Build /tmp/notify.json with a heredoc

Use a heredoc so multi-line content does not have to be shell-escaped.
Substitute the variables you computed:

```bash
cat > /tmp/notify.json <<JSON
{
  "embeds": [{
    "title": "${EMOJI} ${TITLE}",
    "description": "${DESC}",
    "color": ${COLOR},
    "url": "https://github.com/yun-sangho/sccm/issues",
    "fields": [
      {"name": "Open issues",      "value": "${TOTAL_OPEN}",      "inline": true},
      {"name": "Triaged this run", "value": "${TRIAGED_COUNT}",   "inline": true},
      {"name": "Need attention",   "value": "${ATTENTION_COUNT}", "inline": true}
    ],
    "footer": { "text": "${KST_DISPLAY} · next run ~60 min" },
    "timestamp": "${KST_ISO}"
  }]
}
JSON
```

If `ATTENTION_COUNT > 0`, ALSO add this extra field at the end of the
`fields` array (before the closing `]`):

```json
{"name": "🟡 Needs human review",
 "value": "${ATTENTION_LIST}",
 "inline": false}
```

### 4d. Send the curl ONCE

```bash
curl -fsS -X POST -H "Content-Type: application/json" \
  --data @/tmp/notify.json \
  "$DISCORD_WEBHOOK_URL"
```

### 4e. STOP

After curl returns, the run is over. Specifically:
- Do not retry the curl on any non-zero exit code.
- Do not call any notification tool other than this one curl.
- Do not write a summary message back into the conversation.
- Do not perform any other action.
- End the run.

## Error handling for the notification step

- If `$DISCORD_WEBHOOK_URL` is unset or empty: log "no webhook
  configured" to stdout and skip step 4 entirely. Do NOT fail the run.
  The triage work in steps 1–3 is the source of truth.
- If the curl call fails (network blocked, 4xx, 5xx, etc.): log the
  curl exit code and any stderr to stdout, but do NOT retry and do
  NOT fail the run. Next hour's run will produce a fresh notification.
- NEVER echo `$DISCORD_WEBHOOK_URL` into stdout — it's a secret.
