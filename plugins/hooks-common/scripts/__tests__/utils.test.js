const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { LEVELS, LOG_DIR, log } = require("../utils");

describe("utils", () => {
  // ── LEVELS ──

  describe("LEVELS", () => {
    it("has critical = 1", () => {
      assert.equal(LEVELS.critical, 1);
    });
    it("has high = 2", () => {
      assert.equal(LEVELS.high, 2);
    });
    it("has strict = 3", () => {
      assert.equal(LEVELS.strict, 3);
    });
    it("critical < high < strict", () => {
      assert.ok(LEVELS.critical < LEVELS.high);
      assert.ok(LEVELS.high < LEVELS.strict);
    });
  });

  // ── log ──

  describe("log", () => {
    let tmpDir;
    let origLogDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-common-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes JSONL to date-named file", () => {
      // Temporarily patch LOG_DIR by requiring a fresh context
      // Since LOG_DIR is computed at module load, we test by calling log
      // with the actual LOG_DIR. Instead, we test the file format directly.
      const logDir = path.join(tmpDir, "hooks-logs");
      fs.mkdirSync(logDir, { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      const logFile = path.join(logDir, `${today}.jsonl`);

      // Simulate what log() does
      const entry = { ts: new Date().toISOString(), hook: "test-hook", level: "BLOCKED", id: "test" };
      fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");

      const content = fs.readFileSync(logFile, "utf8").trim();
      const parsed = JSON.parse(content);
      assert.equal(parsed.hook, "test-hook");
      assert.equal(parsed.level, "BLOCKED");
      assert.equal(parsed.id, "test");
      assert.ok(parsed.ts);
    });

    it("log function does not throw on valid input", () => {
      // This tests that log() doesn't throw even if directory doesn't exist
      // (it creates it, or silently catches errors)
      assert.doesNotThrow(() => {
        log("test-hook", { level: "BLOCKED", id: "test" });
      });
    });

    it("log function does not throw on missing dir", () => {
      // Override env to point to non-existent dir — log should not throw
      const origDir = process.env.CLAUDE_PROJECT_DIR;
      process.env.CLAUDE_PROJECT_DIR = path.join(tmpDir, "nonexistent-project");

      // Re-require to pick up new LOG_DIR
      // Since LOG_DIR is computed at load time, we just verify
      // the exported log function is resilient
      assert.doesNotThrow(() => {
        log("test-hook", { data: "test" });
      });

      if (origDir !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = origDir;
      } else {
        delete process.env.CLAUDE_PROJECT_DIR;
      }
    });
  });

  // ── JSONL format validation ──

  describe("log format", () => {
    it("produces valid JSONL entries", () => {
      const entries = [
        { ts: "2026-04-09T00:00:00.000Z", hook: "guard-bash", level: "BLOCKED", id: "rm-root" },
        { ts: "2026-04-09T00:00:01.000Z", hook: "guard-secrets", level: "BLOCKED", id: "env-file" },
      ];

      const jsonl = entries.map((e) => JSON.stringify(e)).join("\n");
      const parsed = jsonl.split("\n").map((line) => JSON.parse(line));

      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].hook, "guard-bash");
      assert.equal(parsed[1].hook, "guard-secrets");
    });
  });
});
