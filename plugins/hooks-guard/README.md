# hooks-guard — security-guard hooks

Security-guard hooks for Claude Code: blocks dangerous Bash commands and sensitive file access.

## Overview

Intercepts tools the Claude Code agent runs (Bash, Read, Edit, Write, …) and blocks dangerous operations before they execute.

| Hook | Event | Target tools | Description |
|------|-------|--------------|-------------|
| `guard-bash` | PreToolUse | Bash | Block dangerous shell commands |
| `guard-secrets` | PreToolUse | Read, Edit, Write, Bash | Block sensitive file access |

## Install

```bash
# Install via the SCCM marketplace
claude plugin install hooks-guard@sccm
```

## Hook details

### guard-bash

Blocks dangerous shell commands across three safety levels.

**Safety level** (`SAFETY_LEVEL`, default: `high`)

| Level | Blocked |
|-------|---------|
| `critical` | `rm -rf ~/`, fork bomb, `dd of=/dev/sda`, Docker host escapes (`--privileged`, host-root mount, docker.sock mount, `--pid=host` …), and other unrecoverable commands |
| `high` | + `curl \| sh` (RCE), `git push --force main`, `git reset --hard`, `chmod 777`, `DROP TABLE`, `--cap-add=SYS_ADMIN`, `docker system prune --all/--volumes`, `docker volume prune` |
| `strict` | + any force push, `git checkout .`, `sudo rm`, `docker system/image prune` |

**Project rules** (always active, independent of safety level)

- `git add .env` — prevents committing `.env` files
- `git add -A` / `git add .` — warns about possibly including `.env`
- `git commit` messages are not inspected (passthrough)

**Pattern list**

| ID | Level | Description |
|----|-------|-------------|
| `rm-home` | critical | `rm` targeting `~/` |
| `rm-home-var` | critical | `rm` targeting `$HOME` |
| `rm-root` | critical | `rm` targeting `/` |
| `rm-system` | critical | `rm` targeting `/etc`, `/usr`, and other system dirs |
| `rm-cwd` | critical | `rm .` / `rm *` deleting the current directory |
| `dd-disk` | critical | `dd` writing to a disk device |
| `fork-bomb` | critical | Fork bomb `:(){ :\|:& }` |
| `docker-privileged` | critical | `docker run/create/exec --privileged` |
| `docker-mount-docker-sock` | critical | Mounting `/var/run/docker.sock` into a container (host escape) |
| `docker-mount-root` | critical | `docker run -v /:/...` mounting host root |
| `docker-mount-system` | critical | `docker run -v /etc \| /root \| /boot \| /dev \| /proc \| /sys \| /bin \| /sbin \| /lib \| /usr` |
| `docker-host-namespace` | critical | `--pid=host` / `--net=host` / `--ipc=host` / `--uts=host` / `--userns=host` |
| `curl-pipe-sh` | high | `curl \| sh` (remote code execution) |
| `git-force-main` | high | `git push --force main/master` |
| `git-reset-hard` | high | `git reset --hard` |
| `git-clean-f` | high | `git clean -f` |
| `chmod-777` | high | `chmod 777` |
| `drop-sql` | high | `DROP TABLE/DATABASE/SCHEMA` |
| `docker-cap-add-dangerous` | high | `--cap-add=ALL/SYS_ADMIN/SYS_PTRACE/SYS_MODULE/NET_ADMIN/DAC_READ_SEARCH` |
| `docker-system-prune-all` | high | `docker system prune --all/--volumes/-a/-af` |
| `docker-volume-prune` | high | `docker volume prune` |
| `git-force-any` | strict | Any force push (except `--force-with-lease`) |
| `git-checkout-dot` | strict | `git checkout .` |
| `sudo-rm` | strict | `sudo rm` |
| `docker-prune` | strict | `docker system/image prune` (light variant) |

> **Network access:** plain `curl`/`wget` calls (including to localhost and external URLs) are **not** blocked. Only `curl ... | sh` / `wget ... | sh` pipes are blocked because of the RCE risk. See "Network policy" below.

---

### guard-secrets

Blocks access to sensitive files (keys, credentials, environment variables).

**Safety level** (`SAFETY_LEVEL`, default: `high`)

| Level | Blocked files |
|-------|---------------|
| `critical` | `.env*`, SSH keys (`id_rsa`, `id_ed25519`, …), AWS credentials, `.pem`, `.key` |
| `high` | + `credentials.json`, `secrets.json`, service-account keys, `.docker/config.json`, `.npmrc`, `.pgpass`, `.netrc` |
| `strict` | + `database.yml`, `.kube/config` |

| Level | Blocked Bash commands |
|-------|------------------------|
| `critical` | `cat .env`, `cat id_rsa`, `cat .aws/credentials` |
| `high` | + `printenv`, `echo $SECRET_*`, `source .env`, `curl -d @.env`, `scp .env`, `cp .env`, `rm .env`, `rm id_rsa`, `docker compose config` |

**Generic `.env*` reference guard** (high level and above):

Any Bash command referencing a `.env*` file is blocked by default. The guard
uses a **two-layer matching system** to catch indirect leaks from tools like
`docker compose --env-file .env.local config`, `dotenv`, `envsubst`, `sed`,
and any future tool that reads `.env` files.

#### Two-layer matching

| Layer | Source | Matching | Editable? |
|-------|--------|----------|-----------|
| **Built-in safe commands** | Hardcoded in guard-secrets.js | Prefix match (`"ls"` allows `ls -la .env`) | No — curated safe verbs |
| **User exceptions** | `guard-secrets.config.json` | **Exact match** (`"grep SECRET .env"` allows only that exact command) | Yes — via config file or `/guard-allow` |

Built-in defaults are **always active**. User exceptions are **additive** (they
do not replace the defaults).

#### Built-in safe commands (prefix matching, always active)

`ls`, `stat`, `file`, `test`, `touch`, `chmod`, `chown`, `chgrp`, `du`,
`find`, `fd`, `locate`, `which`, `whereis`,
`sha256sum`, `sha1sum`, `md5sum`, `sha512sum`, `cksum`, `b2sum`,
`mv`, `rename`, `basename`, `dirname`, `realpath`, `readlink`,
`echo`, `printf`, `wc`, `gh`,
`git log`, `git status`, `git branch`, `git remote`, `git tag`,
`git add`, `git rm`, `git checkout`, `git switch`,
`git fetch`, `git pull`, `git push`, `git clone`, `git init`,
`git merge`, `git rebase`, `git cherry-pick`

**Not on the list** (blocked by default): `cat`, `source`, `grep`, `docker`,
`sed`, `awk`, `diff`, `git show`, `git diff`, any unknown command.

#### User exceptions (exact match, via config file)

Create `guard-secrets.config.json` at one of these locations (first found wins):

| Priority | Path | Use case |
|----------|------|----------|
| 1 (highest) | `{project}/.claude/guard-secrets.config.json` | Team/project policy (commit to repo) |
| 2 | `~/.claude/guard-secrets.config.json` | Personal defaults (all projects) |

Config file discovery uses `CLAUDE_PROJECT_DIR` and `HOME`, not `CLAUDE_PLUGIN_ROOT` —
the config location is fully decoupled from where the plugin is installed.

Format:

```json
{
  "envRefAllowCommands": [
    "grep SECRET .env",
    "docker compose --env-file .env.staging up -d",
    "sed -i 's/old/new/' .env.local"
  ]
}
```

Each entry is an **exact command string**. The trimmed command must match the
entry exactly — no prefix matching, no wildcards. This is intentionally strict:
`"grep SECRET .env"` allows only `grep SECRET .env`, not `grep API_KEY .env`.

If you need multiple variants, add each one separately.

#### Managing exceptions via slash commands

```
/hooks-guard:guard-allow add "grep SECRET .env"           # project-level (default)
/hooks-guard:guard-allow add "grep SECRET .env" --user    # user-level
/hooks-guard:guard-allow remove "grep SECRET .env"        # remove entry
/hooks-guard:guard-config                                 # view current config
```

The `/guard-allow` command uses the Read and Write tools (not Bash) to edit the
config file, so the guard hook itself won't block the operation.

**Allowlist** — these files are always accessible:

- `.env.example`
- `.env.sample`
- `.env.template`
- `.env.defaults`

---

## Network policy

`hooks-common` does not impose a blanket block on outbound network calls. The intent is:

- **Allowed:** any `curl`/`wget` to localhost (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) and to external URLs — development workflows frequently need them.
- **Blocked:** `curl … | sh` and `wget … | sh` (the `curl-pipe-sh` rule), because piping a remote script into a shell is a classic RCE vector.
- **Blocked via `guard-secrets`:** `curl -d @.env …` and similar — prevents exfiltrating credentials.

If you want a stricter internet policy (e.g. block outbound curl to public hosts while allowing localhost), add a new pattern to `PATTERNS` in `scripts/guard-bash.js` with an allowlist for localhost.

## Shared utilities (`utils.js`)

Helpers shared by all hooks:

| Function | Description |
|----------|-------------|
| `readStdin()` | Parse JSON from stdin |
| `block(id, reason)` | Print the reason to stderr and exit with code 2 (block) |
| `allow()` | Exit with code 0 (allow) |
| `log(hook, data)` | Append a JSON record to `.claude/hooks-logs/YYYY-MM-DD.jsonl` |

**Safety-level constants:**

```js
{ critical: 1, high: 2, strict: 3 }
```

Lower numbers mean higher risk. Only patterns with a level number ≤ the configured `SAFETY_LEVEL` are enforced.

## Logs

Blocked commands are appended to `{CLAUDE_PROJECT_DIR}/.claude/hooks-logs/` as JSONL:

```jsonl
{"ts":"2026-04-09T12:00:00.000Z","hook":"guard-bash","level":"BLOCKED","id":"rm-root","priority":"critical","cmd":"rm -rf /","session_id":"...","cwd":"..."}
```

## Changing the safety level

The safety level is resolved at hook start-up in this order (first wins):

1. `SCCM_GUARD_LEVEL` environment variable (`critical` | `high` | `strict`;
   invalid values are silently ignored)
2. `guard-secrets.config.json` → `"safetyLevel"` key (project or user-level —
   same discovery order as `envRefAllowCommands`)
3. Built-in fallback: `"high"`

Examples:

```bash
# One-off in the current shell (applies to every hook invocation)
export SCCM_GUARD_LEVEL=strict

# Persistent project default — commit next to envRefAllowCommands
# {project}/.claude/guard-secrets.config.json
{
  "safetyLevel": "strict",
  "envRefAllowCommands": [ ... ]
}
```

Editing the `SAFETY_LEVEL` constant in `guard-bash.js` /
`guard-secrets.js` is no longer required.

## Symlink / path canonicalization

File paths passed to `Read` / `Edit` / `Write`, and path-like tokens inside
`Bash` commands, are canonicalized with `fs.realpathSync` before being
matched against the sensitive-file patterns. That closes the loophole where
an innocent-looking name is actually a symlink to a secret:

- `Read(/tmp/notes.txt)` where `/tmp/notes.txt → ~/.ssh/id_rsa` — blocked
  because the resolved path matches `ssh-private-key`.
- `Bash("cat /tmp/plain")` where `/tmp/plain → .env` — blocked because the
  resolved token matches the `.env*` reference guard.
- `.env.example` (a real file, not a symlink) still passes via the
  allowlist.
- A nonexistent path (realpath throws) silently falls back to raw-name
  matching, matching the pre-symlink behavior — a missing file can't be a
  secret anyway.

## Tests

```bash
cd plugins/hooks-guard
node --test
```

## Slash commands

| Command | Description |
|---------|-------------|
| `/hooks-guard:guard-allow` | Add or remove exact-match command exceptions for the `.env` reference guard |
| `/hooks-guard:guard-config` | View the current guard configuration (built-in defaults + user exceptions) |
| `/hooks-guard:report-issue` | File a bug report or feature request at GitHub |

### Reporting bugs / suggesting features

From inside Claude Code:

```
/hooks-guard:report-issue bug       # file a bug report
/hooks-guard:report-issue feature   # suggest an improvement
```

The command auto-collects the plugin version, OS, and recent conversation
context, then files a structured issue at
[github.com/yun-sangho/sccm/issues](https://github.com/yun-sangho/sccm/issues/new/choose).
If `gh` is not installed it opens a pre-filled browser form instead.

## Structure

```
plugins/hooks-guard/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── hooks/
│   └── hooks.json           # Hook registration
├── scripts/
│   ├── utils.js             # Shared utilities
│   ├── guard-bash.js        # Bash command guard
│   ├── guard-secrets.js     # Sensitive file guard
│   └── __tests__/           # Tests
│       ├── guard-bash.test.js
│       ├── guard-secrets.test.js
│       └── utils.test.js
├── commands/
│   ├── guard-allow.md       # /guard-allow slash command
│   ├── guard-config.md      # /guard-config slash command
│   └── report-issue.md      # /report-issue slash command
├── package.json
└── README.md
```
