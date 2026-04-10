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
const { LEVELS, log, readStdin, block, allow } = require("./utils");

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
const BASH_PATTERNS = [
  // CRITICAL
  {
    level: "critical",
    id: "cat-env",
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.env\b/i,
    reason: "Reading .env file exposes secrets",
  },
  {
    level: "critical",
    id: "cat-ssh-key",
    regex:
      /\b(cat|less|head|tail|more)\s+[^|;]*(id_rsa|id_ed25519|id_ecdsa|\.pem|\.key)\b/i,
    reason: "Reading private key",
  },
  {
    level: "critical",
    id: "cat-aws-creds",
    regex: /\b(cat|less|head|tail|more)\s+[^|;]*\.aws\/credentials/i,
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
      /\bsource\s+[^|;]*\.env\b|(?:^|[;&|]\s*)\.\s+[^|;]*\.env\b/i,
    reason: "Sourcing .env loads secrets into environment",
  },
  {
    level: "high",
    id: "curl-upload-secrets",
    regex:
      /\bcurl\b[^;|&]*(-d\s*@|-F\s*[^=]+=@|--data[^=]*=@)[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)/i,
    reason: "Uploading secrets via curl",
  },
  {
    level: "high",
    id: "scp-secrets",
    regex:
      /\bscp\b[^;|&]*(\.env|credentials|secrets|id_rsa|\.pem|\.key)[^;|&]+:/i,
    reason: "Copying secrets via scp",
  },
  {
    level: "high",
    id: "cp-env",
    regex: /\bcp\b[^;|&]*\.env\b/i,
    reason: "Copying .env file",
  },
  {
    level: "high",
    id: "rm-env",
    regex: /\brm\b.*\.env\b/i,
    reason: "Deleting .env file",
  },
  {
    level: "high",
    id: "rm-ssh-key",
    regex:
      /\brm\b[^;|&]*(id_rsa|id_ed25519|id_ecdsa|authorized_keys)/i,
    reason: "Deleting SSH key",
  },
];

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

function checkBashCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  if (!cmd) return { blocked: false, pattern: null };
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
    check,
    checkFilePath,
    checkBashCommand,
    isAllowlisted,
  };
}
