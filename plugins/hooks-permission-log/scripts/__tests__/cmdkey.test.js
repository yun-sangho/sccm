"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  splitShellChain,
  firstTokens,
  cmdKeyForSegment,
  cmdKeysForCommand,
  primaryCmdKey,
} = require("../lib/cmdkey");

test("splitShellChain: single command", () => {
  assert.deepStrictEqual(splitShellChain("ls -la"), ["ls -la"]);
});

test("splitShellChain: && chain", () => {
  assert.deepStrictEqual(splitShellChain("a && b && c"), ["a", "b", "c"]);
});

test("splitShellChain: ; and |", () => {
  assert.deepStrictEqual(splitShellChain("a; b | c"), ["a", "b", "c"]);
});

test("splitShellChain: && inside single quote does not split", () => {
  assert.deepStrictEqual(
    splitShellChain("git commit -m 'foo && bar'"),
    ["git commit -m 'foo && bar'"]
  );
});

test("splitShellChain: && inside $(...) does not split", () => {
  assert.deepStrictEqual(
    splitShellChain("echo $(foo && bar) && baz"),
    ["echo $(foo && bar)", "baz"]
  );
});

test("firstTokens: strips env-var assignments", () => {
  assert.deepStrictEqual(
    firstTokens("FOO=bar BAZ=qux npm test", 3),
    ["npm", "test"]
  );
});

test("firstTokens: handles single quotes", () => {
  assert.deepStrictEqual(
    firstTokens("git commit -m 'hello world'", 3),
    ["git", "commit", "-m"]
  );
});

test("cmdKeyForSegment: plain command", () => {
  assert.strictEqual(cmdKeyForSegment("ls -la"), "ls");
});

test("cmdKeyForSegment: git subcommand", () => {
  assert.strictEqual(cmdKeyForSegment("git commit -m foo"), "git commit");
});

test("cmdKeyForSegment: pnpm run", () => {
  assert.strictEqual(cmdKeyForSegment("pnpm run test:hooks-guard"), "pnpm run");
});

test("cmdKeyForSegment: docker compose up", () => {
  assert.strictEqual(
    cmdKeyForSegment("docker compose up -d"),
    "docker compose up"
  );
});

test("cmdKeyForSegment: docker-compose up", () => {
  assert.strictEqual(
    cmdKeyForSegment("docker-compose up -d"),
    "docker-compose up"
  );
});

test("cmdKeyForSegment: docker compose with no subcommand falls back", () => {
  assert.strictEqual(cmdKeyForSegment("docker compose"), "docker compose");
});

test("cmdKeyForSegment: sudo unwraps", () => {
  assert.strictEqual(cmdKeyForSegment("sudo rm -rf foo"), "rm");
});

test("cmdKeyForSegment: env var prefix", () => {
  assert.strictEqual(cmdKeyForSegment("NODE_ENV=test pnpm run build"), "pnpm run");
});

test("cmdKeyForSegment: git with global flag falls back to git", () => {
  assert.strictEqual(cmdKeyForSegment("git -C /tmp status"), "git");
});

test("cmdKeysForCommand: chain", () => {
  assert.deepStrictEqual(
    cmdKeysForCommand("pnpm install && git status"),
    ["pnpm install", "git status"]
  );
});

test("primaryCmdKey: chain returns first", () => {
  assert.strictEqual(
    primaryCmdKey("pnpm install && git status"),
    "pnpm install"
  );
});

test("primaryCmdKey: empty input", () => {
  assert.strictEqual(primaryCmdKey(""), "");
  assert.strictEqual(primaryCmdKey(undefined), "");
});
