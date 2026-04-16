"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { splitShellChain } = require("../src/shell-chain");

test("empty string → []", () => {
  assert.deepEqual(splitShellChain(""), []);
});

test("null → []", () => {
  assert.deepEqual(splitShellChain(null), []);
});

test("single command → one segment", () => {
  assert.deepEqual(splitShellChain("ls -la"), ["ls -la"]);
});

test("trims whitespace around segments", () => {
  assert.deepEqual(splitShellChain("  ls -la  "), ["ls -la"]);
});

test("splits on &&", () => {
  assert.deepEqual(splitShellChain("foo && bar"), ["foo", "bar"]);
});

test("splits on ||", () => {
  assert.deepEqual(splitShellChain("foo || bar"), ["foo", "bar"]);
});

test("splits on ;", () => {
  assert.deepEqual(splitShellChain("foo ; bar"), ["foo", "bar"]);
});

test("splits on |", () => {
  assert.deepEqual(splitShellChain("foo | bar"), ["foo", "bar"]);
});

test("splits on background &", () => {
  assert.deepEqual(splitShellChain("foo & bar"), ["foo", "bar"]);
});

test("splits on mixed operators", () => {
  assert.deepEqual(splitShellChain("a && b || c ; d | e"), [
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("collapses empty segments from ;;", () => {
  assert.deepEqual(splitShellChain("a ;; b"), ["a", "b"]);
});

test("does not split inside single quotes", () => {
  assert.deepEqual(splitShellChain("echo 'foo && bar'"), [
    "echo 'foo && bar'",
  ]);
});

test("does not split inside double quotes", () => {
  assert.deepEqual(splitShellChain('git commit -m "msg && payload"'), [
    'git commit -m "msg && payload"',
  ]);
});

test("does not split on ; inside double quotes", () => {
  assert.deepEqual(splitShellChain('echo "a;b;c"'), ['echo "a;b;c"']);
});

test("splits outside quotes but not inside", () => {
  assert.deepEqual(splitShellChain('echo "a && b" && ls'), [
    'echo "a && b"',
    "ls",
  ]);
});

test("does not split inside $()", () => {
  assert.deepEqual(
    splitShellChain('git commit -m "$(cat msg && echo more)"'),
    ['git commit -m "$(cat msg && echo more)"']
  );
});

test("handles nested $()", () => {
  assert.deepEqual(
    splitShellChain("echo $(foo $(bar && baz) qux) && ls"),
    ["echo $(foo $(bar && baz) qux)", "ls"]
  );
});

test("does not split inside backticks", () => {
  assert.deepEqual(splitShellChain("echo `foo && bar` && ls"), [
    "echo `foo && bar`",
    "ls",
  ]);
});

test("treats backslash-escaped operators as literal", () => {
  assert.deepEqual(splitShellChain("echo a \\&\\& b"), ["echo a \\&\\& b"]);
});

test("splits git commit && rm .env — the motivating case from #5", () => {
  assert.deepEqual(splitShellChain("git commit -m msg && rm .env"), [
    "git commit -m msg",
    "rm .env",
  ]);
});

test("splits git commit with heredoc body && cat secret", () => {
  const cmd =
    "git commit -m \"$(cat <<'EOF'\nfix: .env handling\nEOF\n)\" && cat .env";
  assert.deepEqual(splitShellChain(cmd), [
    "git commit -m \"$(cat <<'EOF'\nfix: .env handling\nEOF\n)\"",
    "cat .env",
  ]);
});
