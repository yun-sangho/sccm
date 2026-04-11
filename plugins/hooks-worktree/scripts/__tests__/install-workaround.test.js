const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  MARKER,
  createHookEntry,
  removeHookEntry,
  isOurEntry,
  mergeInstall,
  mergeUninstall,
  getStatus,
  readSettings,
  writeSettings,
} = require("../install-workaround");

const FAKE_DIR = "/fake/plugins/hooks-worktree/scripts";

describe("install-workaround", () => {
  let tmpDir;
  let settingsFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-worktree-iw-"));
    settingsFile = path.join(tmpDir, "settings.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Hook entry builders ──

  describe("createHookEntry / removeHookEntry", () => {
    it("build entries with MARKER embedded in the command", () => {
      const c = createHookEntry(FAKE_DIR);
      const r = removeHookEntry(FAKE_DIR);
      assert.ok(c.hooks[0].command.includes(MARKER));
      assert.ok(r.hooks[0].command.includes(MARKER));
    });

    it("point at worktree-create.js and worktree-remove.js under the given dir", () => {
      const c = createHookEntry(FAKE_DIR);
      const r = removeHookEntry(FAKE_DIR);
      assert.ok(c.hooks[0].command.includes(`${FAKE_DIR}/worktree-create.js`));
      assert.ok(r.hooks[0].command.includes(`${FAKE_DIR}/worktree-remove.js`));
    });

    it("uses different timeouts for create (600s) and remove (30s)", () => {
      assert.equal(createHookEntry(FAKE_DIR).hooks[0].timeout, 600);
      assert.equal(removeHookEntry(FAKE_DIR).hooks[0].timeout, 30);
    });

    it("uses empty matcher so Claude Code dispatches on every event", () => {
      assert.equal(createHookEntry(FAKE_DIR).matcher, "");
      assert.equal(removeHookEntry(FAKE_DIR).matcher, "");
    });
  });

  // ── Entry identification ──

  describe("isOurEntry", () => {
    it("matches our own created entry", () => {
      assert.ok(isOurEntry(createHookEntry(FAKE_DIR)));
      assert.ok(isOurEntry(removeHookEntry(FAKE_DIR)));
    });

    it("does not match a user-authored WorktreeCreate hook", () => {
      assert.equal(
        isOurEntry({
          matcher: "",
          hooks: [{ type: "command", command: "echo hi" }],
        }),
        false
      );
    });

    it("does not match a user hook even if it touches a similar path", () => {
      assert.equal(
        isOurEntry({
          matcher: "",
          hooks: [
            {
              type: "command",
              command: "node /some/other/path/worktree-create.js",
            },
          ],
        }),
        false
      );
    });

    it("returns false for malformed / null entries", () => {
      assert.equal(isOurEntry(null), false);
      assert.equal(isOurEntry({}), false);
      assert.equal(isOurEntry({ hooks: null }), false);
      assert.equal(isOurEntry({ hooks: [{ type: "command" }] }), false);
    });
  });

  // ── mergeInstall ──

  describe("mergeInstall", () => {
    it("adds both events to an empty settings object", () => {
      const { settings, changes } = mergeInstall({}, FAKE_DIR);
      assert.equal(changes.WorktreeCreate, "added");
      assert.equal(changes.WorktreeRemove, "added");
      assert.equal(settings.hooks.WorktreeCreate.length, 1);
      assert.equal(settings.hooks.WorktreeRemove.length, 1);
      assert.ok(isOurEntry(settings.hooks.WorktreeCreate[0]));
      assert.ok(isOurEntry(settings.hooks.WorktreeRemove[0]));
    });

    it("adds to settings that already have unrelated hooks", () => {
      const input = {
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "echo stop" }],
            },
          ],
        },
      };
      const { settings } = mergeInstall(input, FAKE_DIR);
      // Unrelated hook is preserved
      assert.deepEqual(settings.hooks.Stop, input.hooks.Stop);
      // Our events are added
      assert.ok(isOurEntry(settings.hooks.WorktreeCreate[0]));
      assert.ok(isOurEntry(settings.hooks.WorktreeRemove[0]));
    });

    it("appends to existing user-authored WorktreeCreate arrays without clobbering", () => {
      const userEntry = {
        matcher: "",
        hooks: [{ type: "command", command: "echo user-hook" }],
      };
      const input = { hooks: { WorktreeCreate: [userEntry] } };

      const { settings, changes } = mergeInstall(input, FAKE_DIR);
      assert.equal(changes.WorktreeCreate, "added");
      assert.equal(settings.hooks.WorktreeCreate.length, 2);
      assert.deepEqual(settings.hooks.WorktreeCreate[0], userEntry);
      assert.ok(isOurEntry(settings.hooks.WorktreeCreate[1]));
    });

    it("is idempotent — running twice does not duplicate our entry", () => {
      const once = mergeInstall({}, FAKE_DIR);
      const twice = mergeInstall(once.settings, FAKE_DIR);

      assert.equal(twice.changes.WorktreeCreate, "already-present");
      assert.equal(twice.changes.WorktreeRemove, "already-present");
      assert.equal(twice.settings.hooks.WorktreeCreate.length, 1);
      assert.equal(twice.settings.hooks.WorktreeRemove.length, 1);
    });

    it("does not mutate the input settings object", () => {
      const input = { hooks: { Stop: [{ matcher: "", hooks: [] }] } };
      const snapshot = JSON.parse(JSON.stringify(input));
      mergeInstall(input, FAKE_DIR);
      assert.deepEqual(input, snapshot);
    });

    it("handles null/undefined settings as empty", () => {
      const { settings } = mergeInstall(null, FAKE_DIR);
      assert.ok(settings.hooks.WorktreeCreate);
      assert.ok(settings.hooks.WorktreeRemove);
    });
  });

  // ── mergeUninstall ──

  describe("mergeUninstall", () => {
    it("removes both events when only our entries are present", () => {
      const installed = mergeInstall({}, FAKE_DIR).settings;
      const { settings, changes } = mergeUninstall(installed);
      assert.equal(changes.WorktreeCreate, "removed");
      assert.equal(changes.WorktreeRemove, "removed");
      // hooks key should be gone entirely (both arrays emptied → keys dropped)
      assert.equal(settings.hooks, undefined);
    });

    it("preserves user-authored WorktreeCreate hooks alongside ours", () => {
      const userEntry = {
        matcher: "",
        hooks: [{ type: "command", command: "echo user-wc" }],
      };
      const startSettings = {
        hooks: { WorktreeCreate: [userEntry] },
      };
      const installed = mergeInstall(startSettings, FAKE_DIR).settings;
      // At this point: [userEntry, ourEntry]
      assert.equal(installed.hooks.WorktreeCreate.length, 2);

      const { settings, changes } = mergeUninstall(installed);
      assert.equal(changes.WorktreeCreate, "removed");
      assert.equal(settings.hooks.WorktreeCreate.length, 1);
      assert.deepEqual(settings.hooks.WorktreeCreate[0], userEntry);
    });

    it("preserves unrelated hook events", () => {
      const stopEntry = {
        matcher: "",
        hooks: [{ type: "command", command: "echo stop" }],
      };
      const installed = mergeInstall(
        { hooks: { Stop: [stopEntry] } },
        FAKE_DIR
      ).settings;

      const { settings } = mergeUninstall(installed);
      assert.deepEqual(settings.hooks, { Stop: [stopEntry] });
    });

    it("reports 'not-present' when our entry is missing", () => {
      const { changes } = mergeUninstall({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "x" }] }],
        },
      });
      assert.equal(changes.WorktreeCreate, "not-present");
      assert.equal(changes.WorktreeRemove, "not-present");
    });

    it("handles settings with no hooks object", () => {
      const { settings, changes } = mergeUninstall({});
      assert.deepEqual(settings, {});
      assert.equal(changes.WorktreeCreate, "not-present");
      assert.equal(changes.WorktreeRemove, "not-present");
    });

    it("does not mutate input", () => {
      const installed = mergeInstall({}, FAKE_DIR).settings;
      const snapshot = JSON.parse(JSON.stringify(installed));
      mergeUninstall(installed);
      assert.deepEqual(installed, snapshot);
    });
  });

  // ── getStatus ──

  describe("getStatus", () => {
    it("reports not-installed on empty settings", () => {
      assert.deepEqual(getStatus({}), {
        WorktreeCreate: false,
        WorktreeRemove: false,
      });
    });

    it("reports installed after mergeInstall", () => {
      const { settings } = mergeInstall({}, FAKE_DIR);
      assert.deepEqual(getStatus(settings), {
        WorktreeCreate: true,
        WorktreeRemove: true,
      });
    });

    it("is partial-aware (one event installed, one not)", () => {
      const partial = {
        hooks: { WorktreeCreate: [createHookEntry(FAKE_DIR)] },
      };
      assert.deepEqual(getStatus(partial), {
        WorktreeCreate: true,
        WorktreeRemove: false,
      });
    });
  });

  // ── I/O round-trip via readSettings/writeSettings ──

  describe("readSettings / writeSettings", () => {
    it("reads missing file as empty object", () => {
      assert.deepEqual(readSettings(settingsFile), {});
    });

    it("reads empty file as empty object", () => {
      fs.writeFileSync(settingsFile, "");
      assert.deepEqual(readSettings(settingsFile), {});
    });

    it("writes pretty-printed JSON with a trailing newline", () => {
      writeSettings({ hooks: { Stop: [] } }, settingsFile);
      const raw = fs.readFileSync(settingsFile, "utf8");
      assert.ok(raw.endsWith("\n"));
      assert.ok(raw.includes('  "hooks"'));
    });

    it("creates parent directories if missing", () => {
      const nested = path.join(tmpDir, "nested", "dir", "settings.json");
      writeSettings({ foo: "bar" }, nested);
      assert.deepEqual(JSON.parse(fs.readFileSync(nested, "utf8")), {
        foo: "bar",
      });
    });

    it("throws with a helpful message on malformed JSON", () => {
      fs.writeFileSync(settingsFile, "{not: valid json");
      assert.throws(
        () => readSettings(settingsFile),
        /Failed to parse .*settings\.json/
      );
    });
  });

  // ── End-to-end: install → status → uninstall ──

  describe("end-to-end round trip", () => {
    it("install → write → read → uninstall → write → read produces original", () => {
      // Start with a user-authored Stop hook that should survive the round trip.
      const original = {
        hooks: {
          Stop: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "echo stop" }],
            },
          ],
        },
      };
      writeSettings(original, settingsFile);

      // Install
      const { settings: installed } = mergeInstall(
        readSettings(settingsFile),
        FAKE_DIR
      );
      writeSettings(installed, settingsFile);

      // Status should report both installed
      assert.deepEqual(getStatus(readSettings(settingsFile)), {
        WorktreeCreate: true,
        WorktreeRemove: true,
      });

      // Uninstall
      const { settings: cleaned } = mergeUninstall(readSettings(settingsFile));
      writeSettings(cleaned, settingsFile);

      // Back to original (plus formatting)
      const finalSettings = readSettings(settingsFile);
      assert.deepEqual(finalSettings, original);
    });
  });
});
