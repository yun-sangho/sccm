---
description: Merge a vetted sandbox.* preset into this project's Claude Code settings.
argument-hint: <profile> [--dry-run] [--shared]
allowed-tools: Bash(node:*)
---

Apply a vetted sandbox preset to this project by running the bundled merge
script. The script concats+dedupes array fields, preserves scalars the user
already set, honors an explicit `sandbox.enabled: false` (with a warning),
and never touches non-`sandbox` top-level keys.

## Steps

1. If `$ARGUMENTS` is empty, run the help command and stop:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/sandbox-apply.mjs --help
   ```
   Then tell the user to re-run with a profile name (e.g.
   `/sandbox-presets:apply full`).

2. Otherwise, run:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/sandbox-apply.mjs $ARGUMENTS
   ```

3. Surface the script's diff output to the user.

4. If the run **wrote** changes (no `--dry-run`), remind the user that
   sandbox config only takes effect on **new** sessions — they must
   restart Claude Code for it to apply.

5. If the script warned that `sandbox.enabled` is explicitly `false` in
   the user's settings, do NOT flip it on their behalf. Surface the
   warning verbatim and let the user decide.
