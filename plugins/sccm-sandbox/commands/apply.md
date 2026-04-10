---
description: Merge a vetted sandbox.* + permissions.allow preset into this project's Claude Code settings (default profile is `base`).
argument-hint: [profile] [--dry-run] [--shared]
allowed-tools: Bash(node:*)
---

Apply a vetted sandbox preset to this project by running the bundled merge
script. The script concats+dedupes array fields (including `permissions.allow`,
which the `base` preset uses to pair with `excludedCommands` so tools like git
and docker stop hitting permission prompts), preserves scalars the user already
set, honors an explicit `sandbox.enabled: false` (with a warning), and never
touches `permissions.deny` / `permissions.ask` / `permissions.defaultMode` or
any other top-level key (`enabledPlugins`, `mcpServers`, `hooks`, …).

## Profiles

- `base` — full dev workflow (default if no profile is given). Broader
  network + runs package managers / git via `excludedCommands`.
- `min` — minimal bootstrap. Just Anthropic + GitHub + npm + Supabase + Vercel.

## Steps

1. If `$ARGUMENTS` is empty, default to the `base` profile:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/sandbox-apply.mjs base
   ```
   Otherwise, forward the user's arguments verbatim:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/sandbox-apply.mjs $ARGUMENTS
   ```

2. Surface the script's diff output to the user.

3. If the run **wrote** changes (no `--dry-run`), remind the user that
   sandbox config only takes effect on **new** sessions — they must
   restart Claude Code for it to apply.

4. If the script warned that `sandbox.enabled` is explicitly `false` in
   the user's settings, do NOT flip it on their behalf. Surface the
   warning verbatim and let the user decide.
