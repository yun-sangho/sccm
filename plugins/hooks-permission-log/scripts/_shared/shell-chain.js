/**
 * Shell-chain segmenter shared by the sccm hook plugins.
 *
 * Splits a bash command string into top-level segments separated by
 * unquoted `&&`, `||`, `;`, `|`, or `&`. Quoted strings, backticks,
 * and `$(...)` command substitutions are treated as opaque — operators
 * inside them do not split.
 *
 * Not a full bash parser. Handles the cases that matter for hook rule
 * evaluation: prevents `git commit -m "foo && bar"` from splitting on
 * the embedded `&&`, and prevents `git commit && rm .env` from being
 * passed through as a single `git commit` prefix.
 *
 * Limitations (documented, not bugs):
 *   - Heredoc bodies are not specially tracked. In practice they are
 *     almost always inside `$(...)` (e.g. `$(cat <<EOF ... EOF)`),
 *     which already protects them. A top-level heredoc with literal
 *     `&&` in its body would split incorrectly, but the resulting
 *     segments are still scanned so this is a UX issue at most, not
 *     a security hole.
 *   - `(subshell)` grouping is not special-cased; parens only count
 *     when preceded by `$`. A bare `(cmd1 && cmd2)` would split at the
 *     inner `&&`, again producing safe-but-imprecise segments.
 *
 * Synced into each plugin's scripts/_shared/ by scripts/sync-shared.mjs.
 * Do NOT edit the copies directly; edit this canonical source.
 */
function splitShellChain(cmd) {
  if (!cmd) return [];
  const segments = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let backtick = false;
  let parenDepth = 0;
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

    if (c === "\\" && !inSingle && i + 1 < n) {
      current += c + next;
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble && !backtick && parenDepth === 0) {
      inSingle = !inSingle;
      current += c;
      i++;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      current += c;
      i++;
      continue;
    }
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
    if (c === "`" && !inSingle) {
      backtick = !backtick;
      current += c;
      i++;
      continue;
    }
    if (inSingle || inDouble || backtick || parenDepth > 0) {
      current += c;
      i++;
      continue;
    }
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

module.exports = { splitShellChain };
