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

Once invoked, the script merges both the `sandbox.*` block and a matching
`permissions.allow` block into your settings file — without the `allow`
patterns that pair with `excludedCommands`, every `git status` or `docker
info` would still hit a permission prompt. Other `permissions.*` keys
(`deny`, `ask`, `defaultMode`) are never touched.

## Install

```
/plugin marketplace add yun-sangho/sccm
/plugin install sccm-sandbox@sccm
```

## Usage

```
/sccm-sandbox:apply              # defaults to 'base'
/sccm-sandbox:apply min          # minimal profile
/sccm-sandbox:apply narrow       # subcommand-scoped (tighter than base)
/sccm-sandbox:apply base --dry-run
/sccm-sandbox:apply base --shared
```

Arguments are forwarded to `scripts/sandbox-apply.mjs`:

| Argument | What it does |
|----------|-------------|
| `[profile]` | `min`, `narrow`, or `base`. Optional — defaults to `base`. |
| `--dry-run` | Print the diff but do not write. |
| `--shared` | Merge into `.claude/settings.json` (team-committed) instead of `.claude/settings.local.json`. |
| `--target PATH` | Merge into a custom settings file. |

> ⚠ Sandbox config changes only take effect on **new** sessions.
> Restart Claude Code after applying.

## Profiles

| Profile | What it allows | Heads-up |
|---------|---------------|----------|
| `min` | Anthropic API + GitHub HTTPS + npm registry + Supabase + Vercel. Minimal bootstrap. | Stays fully sandboxed |
| `narrow` | Same network as `base`. `excludedCommands` is **subcommand-scoped**: `pnpm install *`, `git push *`, `gh pr view *`, `docker pull *`, `cargo build *` etc. | Dangerous subcommands (`pnpm dlx`, `gh pr merge`, `cargo install`, `docker run`) fall back to the sandbox / permission flow → more prompts but smaller unsandboxed surface than `base` |
| `base` (default) | Broader network (Yarn / PyPI / Docker Hub / Supabase / Vercel …) **and** runs `docker / npm / pnpm / yarn / bun / pip / uv / poetry / cargo / go / git / gh` **outside** the sandbox via verb-level `excludedCommands` (`pnpm *`, `git *`, `gh *`, `docker *`, …) | Excluded commands have **no** OS-level sandbox protection — see trade-off below |

### Trade-off: `excludedCommands` runs unsandboxed

The `base` profile lists package managers and git/gh under
`sandbox.excludedCommands`. Per [official sandboxing guidance](https://code.claude.com/docs/en/sandboxing),
this is the recommended way to make these tools work — but commands in this
list run **entirely outside** the sandbox: free filesystem, free network,
all child processes (including `npm` postinstall scripts) inherit that. If
`hooks-guard` is also installed, its PreToolUse layer still applies, so the
dangerous patterns it knows about (`git push --force main`,
`docker run --privileged`, …) are still blocked, but OS-level protection
is gone for those commands. If you want stricter sandboxing, use `narrow`
or `min` instead.

The `base` preset also adds matching `Bash(<tool>:*)` entries to
`permissions.allow`, so these tools run without a permission prompt as well
as without a sandbox. If you want prompts for some of them, edit
`.claude/settings.local.json` after applying and remove the corresponding
`permissions.allow` entry.

To narrow the scope after applying, edit `.claude/settings.local.json` and
remove individual entries from `sandbox.excludedCommands` and/or
`permissions.allow`.

### `narrow` vs `base`: switching semantics

`narrow` is an **alternative to** `base`, not an addition. The merge in
`sandbox-apply.mjs` is exact-string concat + dedupe — it has no awareness
that `pnpm *` is a superset of `pnpm install *`. So if you applied `base`
first and then run `/sccm-sandbox:apply narrow`, the result is the
**union** of both lists. Because `excludedCommands` is permissive (any match
excludes), the broad `pnpm *` from `base` still matches everything and the
narrow entries don't tighten anything — the change is a silent no-op
security-wise.

To switch from `base` to `narrow`:

1. Open `.claude/settings.local.json`.
2. Remove the broad verb-level entries from `sandbox.excludedCommands` and
   the matching `Bash(<verb>:*)` from `permissions.allow` (`pnpm *`,
   `git *`, `gh *`, `docker *`, `npm *`, `yarn *`, `bun *`, `pip *`,
   `uv *`, `poetry *`, `cargo *`, `go *`).
3. Run `/sccm-sandbox:apply narrow`.
4. Restart Claude Code.

## Merge semantics

The merge is safe by construction:

- Array fields (`allowedDomains`, `allowWrite`, `excludedCommands`, …) are
  concat + dedupe, with your existing entries kept first.
- `permissions.allow` is concat + dedupe like the sandbox arrays — your
  existing entries are kept first.
- Scalar fields you already set are preserved — we only add keys you have
  not configured.
- `sandbox.enabled === false` in your settings is **preserved with a
  warning**. We will not silently flip a deliberate opt-out.
- All other top-level keys (`enabledPlugins`, `mcpServers`, `hooks`,
  `statusLine`, `agent`) and all other `permissions.*` keys (`deny`, `ask`,
  `defaultMode`) are never touched.
- Writes are atomic (temp-file + rename).

## Reporting bugs / suggesting features

From inside Claude Code:

```
/sccm-sandbox:report-issue bug       # file a bug report
/sccm-sandbox:report-issue feature   # suggest an improvement
```

The command auto-collects the plugin version, OS, and recent conversation
context, then files a structured issue at
[github.com/yun-sangho/sccm/issues](https://github.com/yun-sangho/sccm/issues/new/choose).
If `gh` is not installed it opens a pre-filled browser form instead.

## Known issues

- [anthropics/claude-code#37970](https://github.com/anthropics/claude-code/issues/37970) — `sandbox.network.allowedDomains` may be ignored on Cowork / Remote.
- [anthropics/claude-code#33231](https://github.com/anthropics/claude-code/issues/33231) — `httpProxyPort` connection refused when using a custom proxy.
