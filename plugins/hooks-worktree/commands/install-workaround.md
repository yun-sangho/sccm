---
description: Install a ~/.claude/settings.json bridge that makes hooks-worktree's WorktreeCreate/WorktreeRemove hooks fire on Claude Code 2.1.101 (workaround for the plugin-hook dispatch bug). Idempotent and safe.
allowed-tools: Bash(node:*)
---

The user wants to install the **hooks-worktree workaround** for the Claude
Code 2.1.101 plugin-hook dispatch bug.

## Background (do not ask the user about this — they already know, they
## ran this command)

On Claude Code 2.1.101, `WorktreeCreate` and `WorktreeRemove` hooks
registered via a plugin's `hooks/hooks.json` are silently dropped by the
runtime — see [yun-sangho/sccm#9][ds] and [anthropics/claude-code#46664][us]
for the full write-up and reproduction. The same events registered in
`~/.claude/settings.json`, however, **do** fire. This command bridges the
gap by merging equivalent entries into the user's settings file that
invoke the plugin's on-disk scripts from the marketplace git checkout.

[ds]: https://github.com/yun-sangho/sccm/issues/9
[us]: https://github.com/anthropics/claude-code/issues/46664

Once Claude Code ships a fix, the user can run
`/hooks-worktree:uninstall-workaround` to remove the bridge.

## Steps

1. Run the installer via Bash:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/install-workaround.js" install
   ```
   Read the script's stdout and forward it to the user verbatim — it
   reports exactly which events were added vs. were already present, and
   warns (non-fatal) if the marketplace script directory isn't on disk
   yet.

2. Tell the user what happens next, in one or two lines:
   - New worktrees started with `claude --worktree <name>` (or equivalent)
     will now invoke the hooks-worktree scripts via the settings.json
     bridge.
   - The bridge is idempotent — running this command again is a no-op.
   - To remove it, run `/hooks-worktree:uninstall-workaround`.

3. Do **not** modify anything else. Do **not** read or show the contents
   of `~/.claude/settings.json` unless the user explicitly asks — it may
   contain other user hooks or permissions the user has not chosen to
   share with this session.

## Constraints

- This command has exactly one side effect: appending (via merge) two
  entries to `~/.claude/settings.json`. It never overwrites or removes
  anything else.
- If the install script exits non-zero, surface the stderr verbatim and
  stop. Do not attempt to retry or work around the failure.
- If the user asks "is this safe?" answer honestly: the bridge is a
  temporary workaround, is fully reversible via the uninstall command,
  and preserves any pre-existing WorktreeCreate/WorktreeRemove hooks the
  user may already have in their settings.
