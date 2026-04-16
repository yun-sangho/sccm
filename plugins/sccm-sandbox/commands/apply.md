---
description: Merge a vetted sandbox.* + permissions.allow preset into this project's Claude Code settings (default profile is `base`).
argument-hint: "[profile] [--dry-run] [--shared] [--allow-default-mode]"
allowed-tools: Bash(node:*)
---

Apply a vetted sandbox preset to this project by running the bundled merge
script. The script concats+dedupes array fields (including `permissions.allow`,
which the `base` preset uses to pair with `excludedCommands` so tools like git
and docker stop hitting permission prompts), preserves scalars the user already
set, honors an explicit `sandbox.enabled: false` (with a warning), and never
touches `permissions.deny` / `permissions.ask` or any other top-level key
(`enabledPlugins`, `mcpServers`, `hooks`, …). `permissions.defaultMode` is only
written when the user explicitly passes `--allow-default-mode`.

## Profiles

- `base` — full dev workflow (default if no profile is given). Broader
  network + runs package managers / git via `excludedCommands`.
- `min` — minimal bootstrap. Just Anthropic + GitHub + npm + Supabase + Vercel.
- `plan` — read-only exploration profile. Ships `permissions.defaultMode=plan`
  so Claude Code blocks mutating tools until you exit plan mode. The
  `defaultMode` is only applied when you pass `--allow-default-mode`; without
  that flag the `allow` list still merges (so read-only tools auto-pass) but
  your current mode is preserved and a warning is surfaced.

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

5. If the script warned that a preset ships `permissions.defaultMode` but
   `--allow-default-mode` was not passed, surface the warning and let the
   user decide whether to re-run with the flag. Do NOT re-invoke the
   script with the flag on their behalf.
