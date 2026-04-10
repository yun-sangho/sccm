# sccm-sandbox

Vetted `sandbox.*` configuration snippets for Claude Code, plus a
`/sccm-sandbox:apply` slash command that merges one into your project's
`.claude/settings.local.json` without leaving the session.

## Why this is a plugin and not just settings

Claude Code's plugin system intentionally **strips `sandbox.*` and
`permissions.*` keys** from a plugin's bundled `settings.json`; only `agent`
keys are honored. A plugin cannot silently relax your security posture, so
this plugin ships a **script-driven merge** that you invoke explicitly via
a slash command.

## Install

```
/plugin marketplace add yun-sangho/sccm
/plugin install sccm-sandbox@sccm
```

## Usage

```
/sccm-sandbox:apply              # defaults to 'base'
/sccm-sandbox:apply min          # minimal profile
/sccm-sandbox:apply base --dry-run
/sccm-sandbox:apply base --shared
```

Arguments are forwarded to `scripts/sandbox-apply.mjs`:

| Argument | What it does |
|----------|-------------|
| `[profile]` | `min` or `base`. Optional — defaults to `base`. |
| `--dry-run` | Print the diff but do not write. |
| `--shared` | Merge into `.claude/settings.json` (team-committed) instead of `.claude/settings.local.json`. |
| `--target PATH` | Merge into a custom settings file. |

> ⚠ Sandbox config changes only take effect on **new** sessions.
> Restart Claude Code after applying.

## Profiles

| Profile | What it allows | Heads-up |
|---------|---------------|----------|
| `min` | Anthropic API + GitHub HTTPS + npm registry + Supabase + Vercel. Minimal bootstrap. | Stays fully sandboxed |
| `base` (default) | Broader network (Yarn / PyPI / Docker Hub / Supabase / Vercel …) **and** runs `docker / npm / pnpm / yarn / bun / pip / uv / poetry / cargo / go / git / gh` **outside** the sandbox via `excludedCommands` | Excluded commands have **no** OS-level sandbox protection — see trade-off below |

### Trade-off: `excludedCommands` runs unsandboxed

The `base` profile lists package managers and git/gh under
`sandbox.excludedCommands`. Per [official sandboxing guidance](https://code.claude.com/docs/en/sandboxing),
this is the recommended way to make these tools work — but commands in this
list run **entirely outside** the sandbox: free filesystem, free network,
all child processes (including `npm` postinstall scripts) inherit that. If
`hooks-guard` is also installed, its PreToolUse layer still applies, so the
dangerous patterns it knows about (`git push --force main`,
`docker run --privileged`, …) are still blocked, but OS-level protection
is gone for those commands. If you want stricter sandboxing, use `min`
instead.

To narrow the scope after applying, edit `.claude/settings.local.json` and
remove individual entries from `sandbox.excludedCommands`.

## Merge semantics

The merge is safe by construction:

- Array fields (`allowedDomains`, `allowWrite`, `excludedCommands`, …) are
  concat + dedupe, with your existing entries kept first.
- Scalar fields you already set are preserved — we only add keys you have
  not configured.
- `sandbox.enabled === false` in your settings is **preserved with a
  warning**. We will not silently flip a deliberate opt-out.
- Top-level keys outside `sandbox` (`permissions`, `enabledPlugins`, …)
  are never touched.
- Writes are atomic (temp-file + rename).

## Known issues

- [anthropics/claude-code#37970](https://github.com/anthropics/claude-code/issues/37970) — `sandbox.network.allowedDomains` may be ignored on Cowork / Remote.
- [anthropics/claude-code#33231](https://github.com/anthropics/claude-code/issues/33231) — `httpProxyPort` connection refused when using a custom proxy.
