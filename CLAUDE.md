# sccm — Sangho Claude Code Marketplace

A monorepo of Claude Code plugins under `plugins/`. Each plugin has its own
`package.json`, `.claude-plugin/plugin.json`, and is also listed in
`.claude-plugin/marketplace.json`.

## Plugin version rule — ALWAYS bump on change

**If you modify any file under `plugins/<name>/`, you MUST bump that
plugin's version in the same change.**

Claude Code keys plugin updates off the `version` field in
`marketplace.json` / `plugin.json`. If the version doesn't move, the
update is invisible to existing users — their cache treats it as
unchanged. A modification without a bump ships a silent no-op.

```
pnpm run bump <plugin-name> <patch|minor|major|X.Y.Z>
pnpm run verify-versions   # sanity check
```

Which level:
- **patch** — bug fix, doc change, internal refactor with no
  user-visible behavior change
- **minor** — new feature, new preset, new hook, new command, expanded
  default behavior (additive and backwards-compatible)
- **major** — breaking change: removed/renamed command, changed
  default that could surprise existing users, removed allow/exclude
  entries

See [VERSIONING.md](VERSIONING.md) for the full order of operations
and the past incident that motivated this rule.

## Plugin validation rule — ALWAYS validate on change

**If you modify any file under `plugins/<name>/`, you MUST run
`claude plugin validate plugins/<name>` and confirm it passes before
committing.**

The validator catches silent failure modes — command frontmatter YAML
errors, `plugin.json` / `hooks.json` schema violations — that drop
fields without breaking install. `pnpm test`, `pnpm run
verify-versions`, and `claude plugin install` all let these through.

See [VALIDATION.md](VALIDATION.md) for the concrete failure shapes,
expected output, warning-vs-error handling, and the past incident.

## Repo commands

| Command | What it does |
|---|---|
| `pnpm test` | Run every plugin's tests |
| `pnpm run test:<plugin>` | Run one plugin's tests |
| `pnpm run verify-versions` | Assert all three version files agree per plugin |
| `pnpm run bump <plugin> <level>` | Bump a plugin's version in all three files |
| `claude plugin validate plugins/<name>` | Validate one plugin's manifest, hooks, and command frontmatter |

## Testing

See [TESTING.md](TESTING.md) for the three testing layers — unit
tests via `pnpm test`, plugin validation via `claude plugin validate`,
and hook E2E via stdin-boundary simulation — and when each applies.

## Package manager

This repo uses **pnpm**. The `hooks-pnpm` plugin enforces this — `npm`
commands at the repo root are blocked by a PreToolUse hook. Always use
`pnpm`.
