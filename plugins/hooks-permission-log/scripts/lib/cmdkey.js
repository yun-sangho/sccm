#!/usr/bin/env node
/**
 * cmd_key extraction for Bash commands.
 *
 * A cmd_key is a short, stable identifier that groups similar command
 * invocations for aggregation in the review report. Examples:
 *
 *   "ls -la"                  -> "ls"
 *   "pnpm run test"           -> "pnpm run"
 *   "git commit -m 'foo'"     -> "git commit"
 *   "docker compose up -d"    -> "docker compose"
 *
 * For command chains (`a && b`), returns an array of per-segment keys.
 */

// CLIs where the second token meaningfully changes the operation and
// should be part of the key. Extend cautiously — too many entries
// fragment aggregation.
const KNOWN_SUBCOMMAND_CLIS = new Set([
  "git",
  "gh",
  "pnpm",
  "npm",
  "npx",
  "yarn",
  "bun",
  "bunx",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "pipenv",
  "cargo",
  "go",
  "docker",
  "docker-compose",
  "kubectl",
  "brew",
  "apt",
  "apt-get",
]);

// Special two-token CLIs where "<a> <b>" itself is the CLI name. The
// third token is treated as the subcommand (same as single-word CLIs
// in KNOWN_SUBCOMMAND_CLIS).
const TWO_WORD_CLIS = new Set(["docker compose"]);

// Shell-chain segmenter is shared across plugins — imported from
// ../_shared/ which is synced from packages/hooks-shared/src/.
const { splitShellChain } = require("../_shared/shell-chain");

// Very small tokenizer: respects single/double quotes; returns the first
// few bare tokens of a command segment, ignoring env-var assignments
// like `FOO=bar cmd ...`.
function firstTokens(segment, max = 3) {
  const tokens = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length && tokens.length < max + 4; i++) {
    const c = segment[i];
    if (c === "\\" && i + 1 < segment.length) {
      cur += c + segment[i + 1];
      i++;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(c)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push(cur);

  // Strip leading env-var assignments (FOO=bar BAR=baz cmd ...).
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens.shift();
  }
  return tokens.slice(0, max);
}

function cmdKeyForSegment(segment) {
  const tokens = firstTokens(segment, 4);
  if (tokens.length === 0) return "";
  const first = tokens[0];
  // Strip common prefixes: `sudo`, `time`, `exec`, `command`, `env`
  if (
    ["sudo", "time", "exec", "command", "env"].includes(first) &&
    tokens.length > 1
  ) {
    return cmdKeyForSegment(tokens.slice(1).join(" "));
  }

  // Determine whether the CLI name is one token or two.
  let cliLen = 1;
  if (tokens.length >= 2 && TWO_WORD_CLIS.has(`${first} ${tokens[1]}`)) {
    cliLen = 2;
  }
  const cli = tokens.slice(0, cliLen).join(" ");

  // If this is a known subcommand-bearing CLI, append the next
  // non-flag token as the subcommand. Otherwise return the CLI alone.
  const takesSubcommand =
    KNOWN_SUBCOMMAND_CLIS.has(cli) || TWO_WORD_CLIS.has(cli);
  if (takesSubcommand && tokens.length > cliLen) {
    const sub = tokens[cliLen];
    if (sub && !sub.startsWith("-")) return `${cli} ${sub}`;
    return cli;
  }
  return cli;
}

function cmdKeysForCommand(cmd) {
  const segments = splitShellChain(cmd);
  return segments.map(cmdKeyForSegment).filter(Boolean);
}

function primaryCmdKey(cmd) {
  const keys = cmdKeysForCommand(cmd);
  return keys[0] || "";
}

module.exports = {
  splitShellChain,
  firstTokens,
  cmdKeyForSegment,
  cmdKeysForCommand,
  primaryCmdKey,
};
