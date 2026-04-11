---
description: Review recent Bash permission events and suggest sandbox/guard refinements based on your approval history.
argument-hint: "[--days=N] [--since=YYYY-MM-DD] [--no-prune] [--json]"
allowed-tools: Bash(node:*)
---

Run the review script and surface its markdown report to the user. The
script reads `.claude/permission-logs/*.jsonl` (written by this plugin's
hooks), groups events by `tool_use_id`, classifies each tool call's
outcome (auto-allowed / user-approved / user-denied / failed), and
produces a suggested diff for `plugins/sccm-sandbox/presets/base.json`.

## Steps

1. Run the review script, forwarding any arguments verbatim:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/review.js $ARGUMENTS
   ```
   Default window is the last 7 days. Pass `--days=14` or
   `--since=2026-04-01` to widen it. Pass `--no-prune` to keep old log
   files around.

2. Show the full markdown report to the user. Do NOT summarize it away
   — the diff block is the whole point.

3. If the report contains a "Suggested preset additions" section with
   entries, remind the user of the follow-up flow:
   - Edit `plugins/sccm-sandbox/presets/base.json` per the diff
   - `pnpm run bump sccm-sandbox patch`
   - `pnpm run verify-versions && pnpm test:sccm-sandbox`
   - `/sccm-sandbox:apply` in a new Claude Code session

4. If "Commands you consistently denied" is present, surface it as a
   candidate list for `hooks-guard` rules — but do not add guard rules
   automatically; the user decides.

5. If the report says it could not read the preset file, the user's
   repo layout may differ. Ask them where `base.json` lives and offer
   to re-run with `--preset=<path>`.
