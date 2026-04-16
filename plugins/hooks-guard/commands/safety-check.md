---
description: "Report this project's current safety posture (sandbox, npm ignore-scripts, worktree)."
argument-hint: ""
allowed-tools: Bash(node:*)
---

The user wants a snapshot of the current project's safety posture. This is
the on-demand equivalent of the SessionStart safety check that runs
automatically at session boot — useful for re-checking after applying a
sandbox preset or toggling settings, and as a fallback when the SessionStart
warning was missed.

## Steps

1. Run the safety-check script:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/safety-check.js"
   ```

2. Surface the script output verbatim. It prints:
   - `✔ Safety posture OK` when sandbox is enabled and `ignore-scripts=true`
     is set in either the project or user `.npmrc`.
   - One or more `⚠` warnings (sandbox missing/disabled, ignore-scripts
     unset).
   - Zero or more `·` notes (informational, e.g. worktree suggestion).

3. If warnings are present, suggest concrete fixes:
   - "Sandbox not configured" or "not enabled" → `/sccm-sandbox:apply` (then
     restart Claude Code — sandbox config only takes effect on new sessions).
   - "Sandbox is explicitly disabled" → ask the user if this was deliberate.
     If yes, no action needed; if no, edit `.claude/settings.local.json`
     and remove `sandbox.enabled: false`, then `/sccm-sandbox:apply`.
   - "ignore-scripts is not enabled" → `pnpm config set ignore-scripts true`
     (or `npm config set ignore-scripts true`) to set it user-globally,
     or add `ignore-scripts=true` to `~/.npmrc` directly.

4. If the user wants to silence the SessionStart hook (CI / scripted use),
   mention they can set `SCCM_HOOKS_GUARD_QUIET=1`.

## Important constraints

- Read-only command. Do NOT modify any files in this command.
- The script never blocks; it always exits 0.
