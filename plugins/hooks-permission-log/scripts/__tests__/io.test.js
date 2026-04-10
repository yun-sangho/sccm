"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { redact, truncate } = require("../lib/io");

test("redact: Authorization Bearer header", () => {
  const s = 'curl -H "Authorization: Bearer abc.def.ghi" https://x';
  assert.match(redact(s), /Bearer <redacted>/);
  assert.doesNotMatch(redact(s), /abc\.def\.ghi/);
});

test("redact: password=", () => {
  const s = "psql --password=hunter2 -U me";
  assert.match(redact(s), /password=<redacted>/);
  assert.doesNotMatch(redact(s), /hunter2/);
});

test("redact: token=", () => {
  const s = "curl https://api.example.com?token=abcXYZ123";
  assert.match(redact(s), /token=<redacted>/);
});

test("redact: AWS_SECRET_ACCESS_KEY env export", () => {
  const s = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI aws s3 ls";
  assert.match(redact(s), /AWS_SECRET_ACCESS_KEY=<redacted>/);
});

test("redact: preserves innocent commands", () => {
  const s = "ls -la /etc";
  assert.strictEqual(redact(s), s);
});

test("truncate: short string unchanged", () => {
  assert.strictEqual(truncate("hello", 200), "hello");
});

test("truncate: long string cut with ellipsis", () => {
  const s = "a".repeat(250);
  const out = truncate(s, 200);
  assert.strictEqual(out.length, 201); // 200 + ellipsis
  assert.ok(out.endsWith("…"));
});

test("truncate: empty/undefined", () => {
  assert.strictEqual(truncate(""), "");
  assert.strictEqual(truncate(undefined), undefined);
});
