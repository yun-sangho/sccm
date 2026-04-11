---
description: File a bug report or feature request for the hooks-guard plugin at github.com/yun-sangho/sccm/issues. Auto-collects plugin version, OS, and recent context.
argument-hint: "[bug|feature] [optional: short title]"
allowed-tools: Bash(gh:*), Bash(uname:*), Bash(open:*), Bash(claude:*), Bash(cat:*), Bash(jq:*), Bash(node:*)
---

The user wants to file an issue against the **hooks-guard** plugin. Issues
go to `https://github.com/yun-sangho/sccm/issues`. This command must do the
work of gathering context and only ask the user for what cannot be derived.

## Plugin identity (do not change)

- Plugin name: `hooks-guard`
- Repo: `yun-sangho/sccm`
- Plugin manifest: `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`

## Steps

1. **Parse `$ARGUMENTS`**. The first whitespace-separated token may be
   `bug` or `feature` (anything else means "ask"). The remainder, if any,
   is a seed for the issue title.

2. **Auto-collect context. Do NOT ask the user for these.**
   - Plugin version: read it from
     `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`. Use the Read tool,
     not Bash. If parsing fails, fall back to "unknown".
   - OS: run `uname -srm` (allowed via `Bash(uname:*)`).
   - Claude Code version: try `claude --version`. If it errors, fall back
     to "unknown" — do not block.
   - Recent context from this conversation: scan the last few user/assistant
     turns for any error message, unexpected behavior, or stack trace
     related to hooks-guard. Summarize in 2-4 lines. If nothing relevant
     is in scope, say so and skip.

3. **Decide issue type.** If `$ARGUMENTS` did not specify, ask the user
   exactly one question: "Is this a bug or a feature request?" Accept
   `bug` / `feature` (or short equivalents). Set `LABEL` to `bug` or
   `enhancement` accordingly.

4. **Collect the missing essentials.** Ask the user only for what the body
   genuinely needs that is not already known:
   - **Title** (one line, will be prefixed with `[hooks-guard] `)
   - For a **bug**: what happened, what was expected, reproduction steps
     (skip any of these that the auto-summary in step 2 already covers — be
     explicit about which fields you are filling from context vs asking)
   - For a **feature**: motivation (the problem they hit), proposed
     solution, alternatives considered (optional)

5. **Build the issue body** as Markdown. Mirror the field order of
   `.github/ISSUE_TEMPLATE/bug_report.yml` (for bugs) or
   `feature_request.yml` (for features) so issues filed via this command
   look identical to ones filed via the GitHub web form. Use this skeleton
   for a bug:

   ```markdown
   **Plugin:** hooks-guard `<version>`
   **OS:** `<uname output>`
   **Claude Code:** `<claude --version output, or "unknown">`

   ## What happened
   <description>

   ## What you expected
   <expected>

   ## Reproduction steps
   <repro>

   ## Workarounds tried
   <optional>

   ---
   _Filed via `/hooks-guard:report-issue` from inside Claude Code._
   ```

   For a feature, replace the three sections with **Motivation**,
   **Proposed solution**, **Alternatives**.

6. **Show the user the final title and body verbatim** and ask for explicit
   confirmation before filing. Wording: "Ready to file this issue at
   yun-sangho/sccm? (yes/no)". Do not auto-submit. If the user says no,
   stop without filing.

7. **On confirm, file the issue.** Try `gh` first:
   - Write the body to a temp file (e.g. via the Write tool to
     `/tmp/sccm-issue-body.md`) so multiline content is not subject to
     shell escaping.
   - Run:
     ```
     gh issue create \
       --repo yun-sangho/sccm \
       --title "[hooks-guard] <title>" \
       --body-file /tmp/sccm-issue-body.md \
       --label "plugin:hooks-guard" \
       --label "<bug|enhancement>"
     ```
   - Capture the resulting issue URL from `gh`'s stdout and surface it to
     the user. Done.

8. **Fallback if `gh` is missing or unauthenticated.** If `gh` is not on
   PATH, or `gh issue create` fails with an auth error:
   - Build a prefilled GitHub issue URL using GitHub's issue-form query
     parameters:
     ```
     https://github.com/yun-sangho/sccm/issues/new?template=<bug_report|feature_request>.yml
       &title=URLENCODED_TITLE
       &plugin=hooks-guard
       &plugin_version=URLENCODED_VERSION
       &claude_code_version=URLENCODED_VERSION
       &os=URLENCODED_OS
       &what_happened=URLENCODED_WHAT
       &expected=URLENCODED_EXPECTED
       &repro=URLENCODED_REPRO
     ```
     (For a feature request, use `motivation`, `proposal`, `alternatives`
     field IDs instead.) URL-encode every value.
   - On macOS, run `open "<url>"` (allowed via `Bash(open:*)`) to launch
     the browser. On other OSes, just print the URL with a one-line
     instruction to open it manually.

9. **Cleanup and limits.**
   - Do not modify any files in the project. Do not stage anything. Do
     not run `git`. The only side effects of this command are: optionally
     creating one GitHub issue, optionally opening one browser tab, and
     temporarily writing the issue body to `/tmp`.
   - If you wrote a tmp body file, leave it — it is harmless and helps
     debugging if the user wants to re-file.
   - If the user aborts at any point, stop immediately and confirm
     nothing was filed.
