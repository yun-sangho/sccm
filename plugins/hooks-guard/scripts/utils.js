#!/usr/bin/env node
/**
 * Shared utilities for Claude Code hooks.
 */
const fs = require("fs");
const path = require("path");

const LEVELS = { critical: 1, high: 2, strict: 3 };

const LOG_DIR = path.join(
  process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  ".claude",
  "hooks-logs"
);

function log(hook, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(
      LOG_DIR,
      `${new Date().toISOString().slice(0, 10)}.jsonl`
    );
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + "\n"
    );
  } catch {}
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
}

function block(id, reason) {
  console.error(`BLOCKED: [${id}] ${reason}`);
  process.exit(2);
}

function allow() {
  process.exit(0);
}

// Split a bash command string into top-level segments separated by
// unquoted `&&`, `||`, `;`, `|`, or `&`. Quoted strings, backticks,
// and `$(...)` command substitutions are treated as opaque — operators
// inside them do not split.
//
// Not a full bash parser. Handles the cases that matter for hook rule
// evaluation: prevents `git commit -m "foo && bar"` from splitting on
// the embedded `&&`, and prevents `git commit && rm .env` from being
// passed through as a single `git commit` prefix.
//
// Limitations:
//   - Heredoc bodies are not specially tracked. In practice they are
//     almost always inside `$(...)` (e.g. `$(cat <<EOF ... EOF)`),
//     which already protects them. A top-level heredoc with literal
//     `&&` in its body would split incorrectly, but the resulting
//     segments are still scanned so this is a UX issue at most, not a
//     security hole.
//   - `(subshell)` grouping is not special-cased; parens only count
//     when preceded by `$`. A bare `(cmd1 && cmd2)` would split at the
//     inner `&&`, again producing safe-but-imprecise segments.
function splitShellChain(cmd) {
  if (!cmd) return [];
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let backtick = false;
  let parenDepth = 0; // $( ... ) nesting; tracked even inside double quotes
  const n = cmd.length;
  let i = 0;

  const flush = () => {
    const t = current.trim();
    if (t) segments.push(t);
    current = "";
  };

  while (i < n) {
    const c = cmd[i];
    const next = i + 1 < n ? cmd[i + 1] : "";

    // Backslash escapes the next character outside single quotes.
    if (c === "\\" && !inSingle && i + 1 < n) {
      current += c + next;
      i += 2;
      continue;
    }

    // Single quote: toggles only when not inside double quote / backtick / $().
    if (c === "'" && !inDouble && !backtick && parenDepth === 0) {
      inSingle = !inSingle;
      current += c;
      i++;
      continue;
    }

    // Double quote: toggles when not inside single quote.
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      current += c;
      i++;
      continue;
    }

    // $( … ): command substitution. Track even inside double quotes,
    // because chain operators inside $() must not split the outer cmd.
    if (!inSingle && c === "$" && next === "(") {
      parenDepth++;
      current += "$(";
      i += 2;
      continue;
    }
    if (parenDepth > 0 && c === ")") {
      parenDepth--;
      current += c;
      i++;
      continue;
    }

    // Backticks: another form of command substitution. Nesting is
    // unusual (requires escaping) — treat as a simple toggle.
    if (c === "`" && !inSingle) {
      backtick = !backtick;
      current += c;
      i++;
      continue;
    }

    // Inside any literal or substitution context, pass through verbatim.
    if (inSingle || inDouble || backtick || parenDepth > 0) {
      current += c;
      i++;
      continue;
    }

    // Top-level operators — match 2-char operators first.
    if (c === "&" && next === "&") {
      flush();
      i += 2;
      continue;
    }
    if (c === "|" && next === "|") {
      flush();
      i += 2;
      continue;
    }
    if (c === ";" || c === "|" || c === "&") {
      flush();
      i++;
      continue;
    }

    current += c;
    i++;
  }

  flush();
  return segments;
}

module.exports = {
  LEVELS,
  LOG_DIR,
  log,
  readStdin,
  block,
  allow,
  splitShellChain,
};
