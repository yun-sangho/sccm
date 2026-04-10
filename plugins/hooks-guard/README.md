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
| `high` | + `printenv`, `echo $SECRET_*`, `source .env`, `curl -d @.env`, `scp .env`, `cp .env`, `rm .env`, `rm id_rsa` |

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

Edit the `SAFETY_LEVEL` constant at the top of each hook file:

```js
// guard-bash.js, guard-secrets.js
const SAFETY_LEVEL = "high";  // "critical" | "high" | "strict"
```

## Tests

```bash
cd plugins/hooks-guard
node --test
```

## Reporting bugs / suggesting features

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
├── package.json
└── README.md
```
