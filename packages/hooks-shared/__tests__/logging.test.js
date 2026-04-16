"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { appendJsonl } = require("../src/logging");

function makeTmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hooks-shared-log-"));
}

test("appendJsonl: creates the dir if missing and writes a line", () => {
  const dir = path.join(makeTmpLogDir(), "deep", "nested", "dir");
  assert.ok(!fs.existsSync(dir), "pre-condition: dir does not exist");

  appendJsonl(dir, { foo: "bar" });

  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${today}.jsonl`);
  assert.ok(fs.existsSync(file), `expected ${file} to exist`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(parsed.foo, "bar");
});

test("appendJsonl: appends — does not overwrite — existing file", () => {
  const dir = makeTmpLogDir();
  appendJsonl(dir, { n: 1 });
  appendJsonl(dir, { n: 2 });

  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `${today}.jsonl`);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).n, 1);
  assert.equal(JSON.parse(lines[1]).n, 2);
});

test("appendJsonl: swallows IO errors — never throws", () => {
  // Point at an unwritable path under an existing file (mkdir -p over a
  // regular file errors out). The function must not throw.
  const tmp = makeTmpLogDir();
  const blocker = path.join(tmp, "blocker");
  fs.writeFileSync(blocker, "i am a file, not a directory");
  const target = path.join(blocker, "logs");

  assert.doesNotThrow(() => appendJsonl(target, { foo: 1 }));
});

test("appendJsonl: file is named YYYY-MM-DD.jsonl", () => {
  const dir = makeTmpLogDir();
  appendJsonl(dir, { foo: 1 });
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
});
