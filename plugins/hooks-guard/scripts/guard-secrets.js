#!/usr/bin/env node
/**
 * guard-secrets.js — PreToolUse hook for Read|Edit|Write|Bash.
 *
 * Prevents reading, modifying, or exfiltrating sensitive files.
 * Matcher: "Read|Edit|Write|Bash"
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict'
 *   critical — SSH keys, AWS creds, .env files only
 *   high     — + secrets files, env dumps, exfiltration attempts
 *   strict   — + database configs, any config that might contain secrets
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  LEVELS,
  log,
  readStdin,
  block,
  allow,
  splitShellChain,
} = require("./utils");

const SAFETY_LEVEL = "high";

// Files explicitly safe to access (templates, examples)
const ALLOWLIST = [
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
  /\.env\.defaults$/i,
];

// ── Sensitive file patterns (Read, Edit, Write) ──
const SENSITIVE_FILES = [
  // CRITICAL
  {
    level: "critical",
    id: "env-file",
    regex: /(?:^|\/)\.env(?:\.[^/]*)?$/,
    reason: ".env file contains secrets",
  },
  {
    level: "critical",
    id: "ssh-private-key",
    regex: /(?:^|\/)\.ssh\/id_[^/]+$/,
    reason: "SSH private key",
  },
  {
    level: "critical",
    id: "ssh-private-key-2",
    regex: /(?:^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$/,
    reason: "SSH private key",
  },
  {
    level: "critical",
    id: "aws-credentials",
    regex: /(?:^|\/)\.aws\/credentials$/,
    reason: "AWS credentials file",
  },
  {
    level: "critical",
    id: "pem-key",
    regex: /\.pem$/i,
    reason: "PEM key file",
  },
  {
    level: "critical",
    id: "key-file",
    regex: /\.key$/i,
    reason: "Key file",
  },

  // HIGH
  {
    level: "high",
    id: "credentials-json",
    regex: /(?:^|\/)credentials\.json$/i,
    reason: "Credentials file",
  },
  {
    level: "high",
    id: "secrets-file",
    regex: /(?:^|\/)(secrets?|credentials?)\.(json|ya?ml|toml)$/i,
    reason: "Secrets configuration file",
  },
  {
    level: "high",
    id: "service-account",
    regex: /service[_-]?account.*\.json$/i,
    reason: "GCP service account key",
  },
  {
    level: "high",
    id: "docker-config",
    regex: /(?:^|\/)\.docker\/config\.json$/,
    reason: "Docker config may contain registry auth",
  },
  {
    level: "high",
    id: "npmrc",
    regex: /(?:^|\/)\.npmrc$/,
    reason: ".npmrc may contain auth tokens",
  },
  {
    level: "high",
    id: "pgpass",
    regex: /(?:^|\/)\.pgpass$/,
    reason: "PostgreSQL password file",
  },
  {
    level: "high",
    id: "netrc",
    regex: /(?:^|\/)\.netrc$/,
    reason: ".netrc contains credentials",
  },

  // STRICT
  {
    level: "strict",
    id: "database-config",
    regex: /(?:^|\/)(?:config\/)?database\.(json|ya?ml)$/i,
    reason: "Database config may contain passwords",
  },
  {
    level: "strict",
    id: "kube-config",
    regex: /(?:^|\/)\.kube\/config$/,
    reason: "Kubernetes config contains credentials",
  },
];

// ── Bash patterns that expose or exfiltrate secrets ──
//
// Path-argument shape: `(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>\`]*<SUFFIX>`
//   • `(?:\s+-\S+(?:\s+\S+)?)*` — optional flags between the command and the path arg
//   • `[^\s|;&<>\`]*`  — path prefix without whitespace, pipes, redirects,
//     heredoc chars, or backticks, so the match terminates cleanly at
//     shell-metacharacters and cannot span heredoc bodies or prose
//
// This shape replaces the old `[^|;]*` which would greedily eat arbitrary
// text (including whitespace and quoted strings) and caused false positives
// when commit/PR bodies mentioned secret-looking tokens in prose.
const BASH_PATTERNS = [
  // CRITICAL
  {
    level: "critical",
    id: "cat-env",
    regex:
      /\b(cat|less|head|tail|more)(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.env\b/i,
    reason: "Reading .env file exposes secrets",
  },
  {
    level: "critical",
    id: "cat-ssh-key",
    regex:
      /\b(cat|less|head|tail|more)(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*(id_rsa|id_ed25519|id_ecdsa|\.pem|\.key)\b/i,
    reason: "Reading private key",
  },
  {
    level: "critical",
    id: "cat-aws-creds",
    regex:
      /\b(cat|less|head|tail|more)(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.aws\/credentials\b/i,
    reason: "Reading AWS credentials",
  },

  // HIGH
  {
    level: "high",
    id: "env-dump",
    regex: /\bprintenv\b|(?:^|[;&|]\s*)env\s*(?:$|[;&|])/,
    reason: "Environment dump may expose secrets",
  },
  {
    level: "high",
    id: "echo-secret-var",
    regex:
      /\becho\b[^;|&]*\$\{?[A-Za-z_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|API_KEY|AUTH|PRIVATE)[A-Za-z_]*\}?/i,
    reason: "Echoing secret variable",
  },
  {
    level: "high",
    id: "source-env",
    regex:
      /\bsource(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.env\b|(?:^|[;&|]\s*)\.(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.env\b/i,
    reason: "Sourcing .env loads secrets into environment",
  },
  {
    level: "high",
    id: "curl-upload-secrets",
    regex:
      /\bcurl\b[^;|&]*(-d\s*@|-F\s*[^=]+=@|--data[^=]*=@)[^\s|;&<>`]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)\b/i,
    reason: "Uploading secrets via curl",
  },
  {
    level: "high",
    id: "scp-secrets",
    regex:
      /\bscp\b(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)[^\s|;&<>`]*\s+\S+:/i,
    reason: "Copying secrets via scp",
  },
  {
    level: "high",
    id: "cp-env",
    regex: /\bcp\b(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.env\b/i,
    reason: "Copying .env file",
  },
  {
    level: "high",
    id: "rm-env",
    regex: /\brm\b(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*\.env\b/i,
    reason: "Deleting .env file",
  },
  {
    level: "high",
    id: "rm-ssh-key",
    regex:
      /\brm\b(?:\s+-\S+(?:\s+\S+)?)*\s+[^\s|;&<>`]*(id_rsa|id_ed25519|id_ecdsa|authorized_keys)\b/i,
    reason: "Deleting SSH key",
  },
  // HIGH — docker compose config reads .env implicitly (no .env in command text)
  {
    level: "high",
    id: "docker-compose-config",
    regex:
      /\bdocker(?:-compose|\s+compose)\b(?:\s+-\S+(?:\s+\S+)?)*\s+config\b/i,
    reason:
      "docker compose config interpolates ${VAR} from .env into stdout",
  },
];

// ── User-configurable allow list for generic .env* reference guard ──
//
// Commands on this list are allowed to reference .env files without being
// blocked by the generic guard. The list is loaded from a config file at
// project-level or user-level, falling back to hardcoded defaults.

const DEFAULT_ENV_REF_ALLOW_COMMANDS = [
  // File metadata — never reads content
  "ls", "stat", "file", "test", "touch", "chmod", "chown", "chgrp", "du",
  // File search — locates, doesn't read
  "find", "fd", "locate", "which", "whereis",
  // Hash output, not content
  "sha256sum", "sha1sum", "md5sum", "sha512sum", "cksum", "b2sum",
  // Move/rename, doesn't read
  "mv", "rename",
  // Path string operations
  "basename", "dirname", "realpath", "readlink",
  // Prose — .env is a string literal, not a file read
  "echo", "printf",
  // Line/word count only
  "wc",
  // GitHub CLI — issue/PR bodies mentioning .env
  "gh",
  // Safe git subcommands (NOT git show, git diff, git blame — those read content)
  "git log", "git status", "git branch", "git remote", "git tag",
  "git add", "git rm", "git checkout", "git switch",
  "git fetch", "git pull", "git push", "git clone", "git init",
  "git merge", "git rebase", "git cherry-pick",
];

const CONFIG_FILENAME = "guard-secrets.config.json";

// Cache: loaded once per process (hooks are short-lived, one invocation = one process)
let _envRefAllowCommands = null;

function loadEnvRefAllowCommands() {
  if (_envRefAllowCommands !== null) return _envRefAllowCommands;

  // Build candidate paths — project-level first, then user-level.
  // Uses CLAUDE_PROJECT_DIR (set by Claude Code runtime) with cwd fallback,
  // matching the same pattern as utils.js LOG_DIR.
  // Does NOT use CLAUDE_PLUGIN_ROOT — config is decoupled from plugin install location.
  const candidates = [
    path.join(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      ".claude",
      CONFIG_FILENAME
    ),
  ];
  try {
    const home = os.homedir();
    if (home) {
      candidates.push(path.join(home, ".claude", CONFIG_FILENAME));
    }
  } catch {
    // os.homedir() can throw on misconfigured systems — skip user-level
  }

  for (const configPath of candidates) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.envRefAllowCommands)) {
        _envRefAllowCommands = parsed.envRefAllowCommands;
        return _envRefAllowCommands;
      }
    } catch {
      // File not found or invalid JSON — try next candidate
    }
  }

  _envRefAllowCommands = DEFAULT_ENV_REF_ALLOW_COMMANDS;
  return _envRefAllowCommands;
}

// Exposed for testing — resets the cached allow list
function _resetEnvRefCache() {
  _envRefAllowCommands = null;
}

// Check whether cmd starts with an allowed command prefix.
// "git log" matches "git log --all -- .env" but NOT "git logger".
function matchesAllowEntry(cmd, entry) {
  const trimmed = cmd.trimStart();
  if (!trimmed.startsWith(entry)) return false;
  const next = trimmed[entry.length];
  return next === undefined || /\s/.test(next);
}

// ── Generic .env* reference guard ──
//
// Any command that references a .env dotfile is blocked unless the command
// verb is on the user-configurable allow list. This catches leaks from
// docker compose --env-file, dotenv, envsubst, sed, and any future tool.

const ENV_DOTFILE = /(?:^|[/\\:])\.env(?:\.[^/\\]*)?$/i;

function cleanToken(token) {
  return token
    .replace(/^['"`]+|['"`]+$/g, "")              // strip quotes
    .replace(/^-{1,2}[a-zA-Z][-a-zA-Z0-9]*=/, "") // --flag=value → value
    .replace(/^[0-9]*[<>]+/, "");                  // strip redirects
}

function checkEnvFileReference(cmd) {
  if (!cmd || !/\.env/i.test(cmd)) return { blocked: false, pattern: null };

  const tokens = cmd.match(/[^\s]+/g) || [];
  for (const token of tokens) {
    const cleaned = cleanToken(token);
    if (!ENV_DOTFILE.test(cleaned)) continue;
    if (ALLOWLIST.some((p) => p.test(cleaned))) continue;

    // Check user-configurable allow-command list
    const allowCommands = loadEnvRefAllowCommands();
    if (allowCommands.some((entry) => matchesAllowEntry(cmd, entry))) continue;

    return {
      blocked: true,
      pattern: {
        level: "high",
        id: "generic-env-ref",
        regex: ENV_DOTFILE,
        reason: `Command references ${cleaned} — may leak secrets from .env file`,
      },
    };
  }
  return { blocked: false, pattern: null };
}

function isAllowlisted(filePath) {
  return filePath && ALLOWLIST.some((p) => p.test(filePath));
}

function checkFilePath(filePath, safetyLevel = SAFETY_LEVEL) {
  if (!filePath || isAllowlisted(filePath))
    return { blocked: false, pattern: null };
  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of SENSITIVE_FILES) {
    if (LEVELS[p.level] <= threshold && p.regex.test(filePath)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

// Evaluate a single shell command segment against BASH_PATTERNS.
// Splitting into segments is handled by `checkBashCommand` so the
// `git commit` passthrough only exempts the commit sub-command itself.
function checkBashSegment(cmd, safetyLevel = SAFETY_LEVEL) {
  if (!cmd) return { blocked: false, pattern: null };
  // Commit messages are content, not commands — skip pattern checks for
  // THIS segment so prose mentioning .env / id_rsa / etc. in a commit
  // body does not trip the secret-exfiltration rules.
  if (/^\s*git\s+commit\b/.test(cmd))
    return { blocked: false, pattern: null };
  // Allow .env.example access in bash commands too
  for (const a of ALLOWLIST) {
    if (a.test(cmd)) return { blocked: false, pattern: null };
  }
  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of BASH_PATTERNS) {
    if (LEVELS[p.level] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p };
    }
  }
  // Generic .env* reference check — catches ANY command referencing .env files
  // not already handled by specific patterns above. Uses user-configurable
  // allow-command list. Only active at 'high' level and above.
  if (threshold >= LEVELS["high"]) {
    const envRef = checkEnvFileReference(cmd);
    if (envRef.blocked) return envRef;
  }
  return { blocked: false, pattern: null };
}

function checkBashCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  if (!cmd) return { blocked: false, pattern: null };
  const segments = splitShellChain(cmd);
  if (segments.length === 0) return checkBashSegment(cmd, safetyLevel);
  for (const segment of segments) {
    const result = checkBashSegment(segment, safetyLevel);
    if (result.blocked) return result;
  }
  return { blocked: false, pattern: null };
}

function check(toolName, toolInput, safetyLevel = SAFETY_LEVEL) {
  if (["Read", "Edit", "Write"].includes(toolName)) {
    return checkFilePath(toolInput?.file_path, safetyLevel);
  }
  if (toolName === "Bash") {
    return checkBashCommand(toolInput?.command, safetyLevel);
  }
  return { blocked: false, pattern: null };
}

async function main() {
  try {
    const data = await readStdin();
    const { tool_name, tool_input, session_id, cwd } = data;

    if (!["Read", "Edit", "Write", "Bash"].includes(tool_name))
      return allow();

    const result = check(tool_name, tool_input);

    if (result.blocked) {
      const p = result.pattern;
      const target =
        tool_input?.file_path || (tool_input?.command || "").slice(0, 200);
      log("guard-secrets", {
        level: "BLOCKED",
        id: p.id,
        priority: p.level,
        tool: tool_name,
        target,
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
  module.exports = {
    SENSITIVE_FILES,
    BASH_PATTERNS,
    ALLOWLIST,
    SAFETY_LEVEL,
    DEFAULT_ENV_REF_ALLOW_COMMANDS,
    ENV_DOTFILE,
    check,
    checkFilePath,
    checkBashCommand,
    checkBashSegment,
    checkEnvFileReference,
    loadEnvRefAllowCommands,
    matchesAllowEntry,
    cleanToken,
    isAllowlisted,
    _resetEnvRefCache,
  };
}
