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
info` would still hit a permission prompt. `permissions.deny` and
`permissions.ask` are never touched. `permissions.defaultMode` is only
written when you pass the opt-in `--allow-default-mode` flag, used by the
`plan` profile.

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
/sccm-sandbox:apply plan --allow-default-mode
```

Arguments are forwarded to `scripts/sandbox-apply.mjs`:

| Argument | What it does |
|----------|-------------|
| `[profile]` | `min`, `base`, or `plan`. Optional — defaults to `base`. |
| `--dry-run` | Print the diff but do not write. |
| `--shared` | Merge into `.claude/settings.json` (team-committed) instead of `.claude/settings.local.json`. |
| `--target PATH` | Merge into a custom settings file. |
| `--allow-default-mode` | Opt-in: apply a preset's `permissions.defaultMode` (required to activate `plan`). Without it, the defaultMode is skipped with a warning. |

> ⚠ Sandbox config changes only take effect on **new** sessions.
> Restart Claude Code after applying.

## Profiles

| Profile | What it allows | Heads-up |
|---------|---------------|----------|
| `min` | Anthropic API + GitHub HTTPS + npm registry + Supabase + Vercel. Minimal bootstrap. | Stays fully sandboxed |
| `base` (default) | Broader network (Yarn / PyPI / Docker Hub / Supabase / Vercel …) **and** runs `docker / npm / pnpm / yarn / bun / pip / uv / poetry / cargo / go / git / gh` **outside** the sandbox via `excludedCommands` | Excluded commands have **no** OS-level sandbox protection — see trade-off below |
| `plan` | Read-only exploration: whitelists `Read / Grep / Glob / WebFetch / WebSearch` and a handful of read-only Bash commands (`git log/status/diff/show/branch/blame`, `ls`, `pwd`, `cat`, `rg`, `fd`, `find`, `wc`, `head`, `tail`). Ships `permissions.defaultMode: "plan"`. | Requires `--allow-default-mode` to actually switch Claude Code into plan mode — otherwise only the allow list merges and the mode is left untouched with a warning. |

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

The `base` preset also adds matching `Bash(<tool>:*)` entries to
`permissions.allow`, so these tools run without a permission prompt as well
as without a sandbox. If you want prompts for some of them, edit
`.claude/settings.local.json` after applying and remove the corresponding
`permissions.allow` entry.

To narrow the scope after applying, edit `.claude/settings.local.json` and
remove individual entries from `sandbox.excludedCommands` and/or
`permissions.allow`.

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
  `statusLine`, `agent`) and `permissions.deny` / `permissions.ask` are
  never touched.
- `permissions.defaultMode` is only written when you pass
  `--allow-default-mode`. Without the flag, a preset that ships a
  `defaultMode` (only `plan` does today) emits a visible warning and
  leaves your value alone.
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
