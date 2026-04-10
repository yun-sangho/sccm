#!/usr/bin/env node
/**
 * guard-bash.js — PreToolUse hook for Bash commands.
 *
 * Blocks dangerous shell operations before execution.
 * Matcher: "Bash"
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict'
 *   critical — Catastrophic only (rm -rf /, fork bomb, dd to disk)
 *   high     — + risky (force push main, secrets exposure, git reset --hard)
 *   strict   — + cautionary (any force push, sudo rm, docker prune)
 *
 * Project-specific rules (always active):
 *   - pnpm enforcement (block npm commands)
 *   - env file commit prevention (git add .env)
 *   - git commit message passthrough
 */
const { LEVELS, log, readStdin, block, allow } = require("./utils");

const SAFETY_LEVEL = "high";

const PATTERNS = [
  // ── CRITICAL — Catastrophic, unrecoverable ──
  {
    level: "critical",
    id: "rm-home",
    regex: /\brm\s+(-.+\s+)*["']?~\/?["']?(\s|$|[;&|])/,
    reason: "rm targeting home directory",
  },
  {
    level: "critical",
    id: "rm-home-var",
    regex: /\brm\s+(-.+\s+)*["']?\$HOME["']?(\s|$|[;&|])/,
    reason: "rm targeting $HOME",
  },
  {
    level: "critical",
    id: "rm-root",
    regex: /\brm\s+(-.+\s+)*\/(\*|\s|$|[;&|])/,
    reason: "rm targeting root filesystem",
  },
  {
    level: "critical",
    id: "rm-system",
    regex:
      /\brm\s+(-.+\s+)*\/(etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(\/|\s|$)/,
    reason: "rm targeting system directory",
  },
  {
    level: "critical",
    id: "rm-cwd",
    regex: /\brm\s+(-.+\s+)*(\.\/?|\*|\.\/\*)(\s|$|[;&|])/,
    reason: "rm deleting current directory contents",
  },
  {
    level: "critical",
    id: "dd-disk",
    regex: /\bdd\b.+of=\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/,
    reason: "dd writing to disk device",
  },
  {
    level: "critical",
    id: "fork-bomb",
    regex: /:\(\)\s*\{.*:\s*\|\s*:.*&/,
    reason: "fork bomb detected",
  },
  {
    level: "critical",
    id: "docker-privileged",
    regex: /\bdocker\s+(?:run|create|exec)\b[^|;&]*--privileged\b/,
    reason: "docker --privileged grants host root capabilities",
  },
  {
    level: "critical",
    id: "docker-mount-docker-sock",
    regex:
      /\bdocker\s+(?:run|create|exec)\b[^|;&]*(?:-v\s+|--volume[=\s]+|--mount\s+[^|;&]*(?:source|src)=["']?)\/var\/run\/docker\.sock\b/,
    reason: "mounting docker.sock into a container = host escape",
  },
  {
    level: "critical",
    id: "docker-mount-root",
    regex:
      /\bdocker\s+(?:run|create)\b[^|;&]*(?:(?:-v|--volume)(?:=|\s+)["']?\/["']?:|--mount\s+[^|;&]*(?:source|src)=["']?\/["']?[,\s])/,
    reason: "docker mounting host root filesystem (-v /:...)",
  },
  {
    level: "critical",
    id: "docker-mount-system",
    regex:
      /\bdocker\s+(?:run|create)\b[^|;&]*(?:-v|--volume)(?:=|\s+)["']?\/(?:etc|root|boot|dev|proc|sys|bin|sbin|lib|lib64|usr)(?:\/|["']?:)/,
    reason: "docker mounting host system directory",
  },
  {
    level: "critical",
    id: "docker-host-namespace",
    regex:
      /\bdocker\s+(?:run|create)\b[^|;&]*--(?:pid|net|network|ipc|uts|userns)=host\b/,
    reason: "docker sharing host namespace (--pid=host / --net=host / ...)",
  },

  // ── HIGH — Significant risk, data loss, security ──
  {
    level: "high",
    id: "curl-pipe-sh",
    regex: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/,
    reason: "piping URL to shell (RCE risk)",
  },
  {
    level: "high",
    id: "git-force-main",
    regex:
      /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b.+\b(main|master)\b/,
    reason: "force push to main/master",
  },
  {
    level: "high",
    id: "git-reset-hard",
    regex: /\bgit\s+reset\s+--hard/,
    reason: "git reset --hard loses uncommitted work",
  },
  {
    level: "high",
    id: "git-clean-f",
    regex: /\bgit\s+clean\s+(-\w*f|-f)/,
    reason: "git clean -f deletes untracked files",
  },
  {
    level: "high",
    id: "chmod-777",
    regex: /\bchmod\b.+\b777\b/,
    reason: "chmod 777 is a security risk",
  },
  {
    level: "high",
    id: "drop-sql",
    regex: /\bdrop\s+(table|database|schema)\b/i,
    reason: "destructive SQL (DROP TABLE/DATABASE/SCHEMA)",
  },
  {
    level: "high",
    id: "docker-cap-add-dangerous",
    regex:
      /\bdocker\s+(?:run|create)\b[^|;&]*--cap-add[=\s](?:ALL|SYS_ADMIN|SYS_PTRACE|SYS_MODULE|NET_ADMIN|DAC_READ_SEARCH)\b/,
    reason: "docker --cap-add of a dangerous Linux capability",
  },
  {
    level: "high",
    id: "docker-system-prune-all",
    regex:
      /\bdocker\s+system\s+prune\b[^|;&]*(?:--volumes\b|--all\b|\s-a\b|\s-af\b|\s-fa\b)/,
    reason: "docker system prune --all/--volumes wipes containers/images/data",
  },
  {
    level: "high",
    id: "docker-volume-prune",
    regex: /\bdocker\s+volume\s+prune\b/,
    reason: "docker volume prune wipes unused volumes (data loss)",
  },

  // ── STRICT — Cautionary, context-dependent ──
  {
    level: "strict",
    id: "git-force-any",
    regex: /\bgit\s+push\b(?!.+--force-with-lease).+(--force|-f)\b/,
    reason: "force push (use --force-with-lease)",
  },
  {
    level: "strict",
    id: "git-checkout-dot",
    regex: /\bgit\s+checkout\s+\./,
    reason: "git checkout . discards changes",
  },
  {
    level: "strict",
    id: "sudo-rm",
    regex: /\bsudo\s+rm\b/,
    reason: "sudo rm has elevated privileges",
  },
  {
    level: "strict",
    id: "docker-prune",
    regex: /\bdocker\s+(system|image)\s+prune/,
    reason: "docker prune removes images",
  },
];

// ── Project-specific rules (always active regardless of safety level) ──

// Template files that are meant to be checked in — mirrored from
// guard-secrets.js ALLOWLIST so the two hooks stay aligned.
const ENV_TEMPLATE_ALLOWLIST = [
  /(^|\/)\.env\.example$/i,
  /(^|\/)\.env\.sample$/i,
  /(^|\/)\.env\.template$/i,
  /(^|\/)\.env\.defaults$/i,
];

function checkProjectRules(cmd) {
  // Skip all checks for git commit (message content is not a command)
  if (/^\s*git\s+commit\b/.test(cmd)) return null;

  // Env file commit prevention — block real .env files, allow templates
  const addMatch = cmd.match(/\bgit\s+add\b(.*)$/);
  if (addMatch) {
    const args = addMatch[1]
      .split(/\s+/)
      .filter((a) => a && !a.startsWith("-"));
    const envArgs = args.filter((a) => /(^|\/)\.env(\.|$)/.test(a));
    const hasBlockedEnv = envArgs.some(
      (a) => !ENV_TEMPLATE_ALLOWLIST.some((rx) => rx.test(a)),
    );
    if (hasBlockedEnv) {
      return {
        id: "git-add-env",
        reason:
          "Cannot git add a .env secret file (templates like .env.example / .env.sample are allowed)",
      };
    }
  }

  if (/\bgit\s+add\s+(-a\b|-A\b|\.\s*$)/.test(cmd)) {
    return {
      id: "git-add-all",
      reason:
        "git add -A / git add . may include .env files. Specify individual files instead.",
    };
  }

  return null;
}

function checkCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  // Project-specific rules first (always active)
  const projectResult = checkProjectRules(cmd);
  if (projectResult) return { blocked: true, pattern: projectResult };

  // Git commit messages are safe — skip pattern checks
  if (/^\s*git\s+commit\b/.test(cmd))
    return { blocked: false, pattern: null };

  // Safety level patterns
  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of PATTERNS) {
    if (LEVELS[p.level] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p };
    }
  }

  return { blocked: false, pattern: null };
}

async function main() {
  try {
    const data = await readStdin();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (tool_name !== "Bash") return allow();

    const cmd = tool_input?.command || "";
    const result = checkCommand(cmd);

    if (result.blocked) {
      const p = result.pattern;
      log("guard-bash", {
        level: "BLOCKED",
        id: p.id,
        priority: p.level || "project",
        cmd: cmd.slice(0, 200),
        session_id,
        cwd,
      });
      block(p.id, p.reason);
    }

    allow();
  } catch {
    allow();
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { PATTERNS, SAFETY_LEVEL, checkCommand, checkProjectRules };
}
