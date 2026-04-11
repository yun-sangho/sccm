---
description: File GitHub issues for permission-log refinement suggestions (one per cmd_key, deduplicated, target yun-sangho/sccm).
argument-hint: "[--days=N] [--since=YYYY-MM-DD]"
allowed-tools: Bash(node:*), Bash(gh:*)
---

Turn the current permission-log review suggestions into GitHub issues
so each candidate refinement becomes a trackable work item. Issues are
filed against **yun-sangho/sccm** with the label
`permission-log-proposal` plus a plugin label (`plugin:sccm-sandbox`
for adds, `plugin:hooks-guard` for blocks).

The command is idempotent: each proposal has a stable title and any
existing issue with that title (open **or closed**) causes the
proposal to be skipped — a closed issue means "I already decided on
this one, don't refile".

## Steps

1. **Dry-run first.** Run the backing script with no `--apply` to see
   what would be filed, and to verify `gh` is authenticated and the
   dedup query works:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/file-proposals.js $ARGUMENTS
   ```

   Forward any `--days=N` / `--since=YYYY-MM-DD` the user passed.

2. **Surface the dry-run output verbatim** to the user. It includes
   a marker per proposal (`＋ WOULD CREATE`, `↺ SKIPPED (existing #N)`,
   or `⚠ gh query failed`). Do not summarize it away.

3. **Decide whether to proceed.**
   - If the dry-run reports 0 proposals, stop and say so. Nothing to file.
   - If all proposals are duplicates, stop and say so. Nothing new to file.
   - If there is at least one `WOULD CREATE`, ask the user exactly once:
     > "File N new proposal(s) at yun-sangho/sccm? (yes/no)"
     Do not auto-submit. If the user says no, stop.

4. **On confirm, run with `--apply`:**

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/file-proposals.js $ARGUMENTS --apply
   ```

   Surface the output verbatim. Each newly-created proposal will have
   a `✔ CREATED` marker and a GitHub URL.

5. **Error handling.**
   - If `gh` is not authenticated (`gh auth status` fails), the dry-run
     will print a warning and the `--apply` run will refuse. In that
     case instruct the user to run `gh auth login` and retry — do not
     fall back to a browser URL for this command (we need a working
     `gh` for dedup anyway).
   - If any single `gh issue create` fails (e.g. rate limit, network),
     the script marks only that item as `✘ FAILED` and continues with
     the rest. Re-running the command is safe — already-created items
     will be skipped as duplicates next time.

6. **Cleanup and limits.**
   - This command never modifies files in the repo and never runs
     `git`. Its only side effects are `gh issue create` calls and
     temporary issue-body files under `$TMPDIR`.
   - The body files under `$TMPDIR` are harmless; leave them alone.
   - Do not invent extra proposals beyond what the script outputs, and
     do not edit the proposal titles — the titles are the dedup keys.
