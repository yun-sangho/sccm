# sccm — Sangho Claude Code Marketplace

A monorepo of Claude Code plugins under `plugins/`. Each plugin has its own
`package.json`, `.claude-plugin/plugin.json`, and is also listed in
`.claude-plugin/marketplace.json`.

## Plugin version rule — ALWAYS bump on change

**If you modify any file under `plugins/<name>/`, you MUST bump that
plugin's version in the same change.**

Why: Claude Code keys plugin updates off the `version` field in
`marketplace.json` / `plugin.json`. If the version doesn't move, users
who installed the plugin via this marketplace will **not** receive the
update — Claude Code's cache treats it as unchanged. A modification
without a bump is effectively invisible to every existing user.

How: use the bump script — it updates all three places (marketplace.json,
plugin.json, package.json) atomically and refuses to run on a mismatch.

```
pnpm run bump <plugin-name> <patch|minor|major|X.Y.Z>
pnpm run verify-versions   # sanity check
```

Which level:
- **patch** — bug fix, doc change, internal refactor with no user-visible
  behavior change
- **minor** — new feature, new preset, new hook, new command, expanded
  default behavior (additive and backwards-compatible)
- **major** — breaking change: removed/renamed command, changed default
  that could surprise existing users, removed allow/exclude entries

Recent example of the trap: commit `af1e257` added `permissions.allow`
merging to `sccm-sandbox` but forgot to bump → fixed in `be0d62a` as
`0.2.0`. Don't repeat this. Bump in the same commit as the change, or as
the immediately following commit before pushing.

Order of operations when modifying a plugin:
1. Make the code/preset/hook/doc change under `plugins/<name>/`
2. `pnpm run bump <name> <level>`
3. `pnpm run verify-versions`
4. `pnpm test` (or `pnpm run test:<name>`)
5. Commit (the bump can be in the same commit as the change, or its own
   commit immediately after — but never push the change without the bump)

## Repo commands

| Command | What it does |
|---|---|
| `pnpm test` | Run every plugin's tests (337+ tests across 4 plugins) |
| `pnpm run test:<plugin>` | Run one plugin's tests |
| `pnpm run verify-versions` | Assert all three version files agree per plugin |
| `pnpm run bump <plugin> <level>` | Bump a plugin's version in all three files |

## Package manager

This repo uses **pnpm**. The `hooks-pnpm` plugin enforces this — `npm`
commands at the repo root are blocked by a PreToolUse hook. Always use
`pnpm`.
