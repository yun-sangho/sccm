---
description: Remove the ~/.claude/settings.json bridge installed by /hooks-worktree:install-workaround. Leaves any other WorktreeCreate/WorktreeRemove hooks the user may have authored themselves untouched.
allowed-tools: Bash(node:*)
---

The user wants to **uninstall the hooks-worktree workaround** that was
previously installed via `/hooks-worktree:install-workaround`. This is
safe and fully reversible — typically run when Claude Code has shipped a
fix for the plugin-hook dispatch bug (anthropics/claude-code#46664) and
the plugin-registered `hooks/hooks.json` entries work natively again.

## Steps

1. Run the uninstaller via Bash:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install-workaround.js" uninstall
   ```
   Forward the script's stdout to the user verbatim — it reports whether
   each event was removed, or was not present to begin with.

2. Tell the user, in one line, that any **non-workaround**
   `WorktreeCreate` / `WorktreeRemove` hooks they may have authored
   themselves are preserved — only entries marked with the
   `hooks-worktree@sccm/workaround` marker are removed.

## Constraints

- This command's only side effect is removing two specific entries from
  `~/.claude/settings.json` (or leaving the file alone if neither entry
  is present).
- The removal is identified by the `hooks-worktree@sccm/workaround`
  marker that the install command embeds in the hook command string.
  Entries the user added by hand (without that marker) will not be
  touched.
- If the uninstall script exits non-zero, surface the stderr verbatim
  and stop.
- Do **not** read or display the contents of `~/.claude/settings.json`
  unless the user explicitly asks — it may contain other private config.
