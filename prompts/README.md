# prompts/

Source-of-truth prompts for Claude Code automations that run **outside**
this repo (currently: an hourly Anthropic-cloud scheduled task).

The cloud trigger holds only a small bootstrap. The bootstrap fetches
the canonical prompt from this directory via the GitHub MCP and follows
it. Editing automation behavior is therefore a normal commit on `main` —
the next scheduled run picks it up automatically.

## Files

| File | Used by | Purpose |
|---|---|---|
| [`triage.md`](triage.md) | Anthropic cloud hourly triage task | Canonical instructions: list open issues, classify, label, post one Discord embed |
| [`triage.bootstrap.md`](triage.bootstrap.md) | Same | Tiny bootstrap pasted into the cloud trigger UI; fetches `triage.md` and follows it |

## Required GitHub labels

The triage prompt assumes the following labels already exist on the
`yun-sangho/sccm` repo. The GitHub MCP `add_labels` call does not
create labels on the fly — they must be pre-created in the GitHub UI
(Issues → Labels → New label) before the first cloud run, otherwise
labeling will fail.

| Label | Color | Purpose |
|---|---|---|
| `triaged` | `#ededed` (light gray) | Set on every issue the triage agent has processed; the next run skips anything already wearing it |
| `needs-info` | `#fbca04` (yellow) | Agent could not classify confidently and asked the human a question |
| `duplicate` | `#cfd3d7` (gray) | Linked to an earlier issue with the same underlying request |
| `claude:auto-fix` | `#5319e7` (purple) | Eligible for automated fix per the criteria in `triage.md` step 2d |

The plugin scope labels (`plugin:hooks-guard`, `plugin:hooks-pnpm`,
`plugin:hooks-worktree`, `plugin:sccm-sandbox`) and the type labels
(`bug`, `enhancement`) already exist — they're applied today by the
`/<plugin>:report-issue` slash commands and by the GitHub issue forms.

## Required cloud-trigger environment

The bootstrap also assumes the cloud trigger has these set:

- `DISCORD_WEBHOOK_URL` — webhook for the Discord channel that should
  receive the run summary. Treat as a secret. Never logged.
- GitHub MCP server connected with read+write on `yun-sangho/sccm`
  issues (list, get, search, comment, add labels).

## Updating the prompt

1. Edit `triage.md` on `main` (PR or direct commit, your call).
2. Push.
3. The next hourly run picks it up. No need to touch the cloud trigger.

The bootstrap pins to branch `main`, not a SHA. A bad commit will break
the next run; the cost is one missed hour and the recovery is a
follow-up commit.
