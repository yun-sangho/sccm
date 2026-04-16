import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  listProfiles,
  loadPreset,
  loadTarget,
  dedupeConcat,
  mergeSandbox,
  PRESETS_DIR,
} from "../sandbox-apply.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function presetPath(name) {
  return path.join(PRESETS_DIR, `${name}.json`);
}

function loadPresetFile(name) {
  return JSON.parse(fs.readFileSync(presetPath(name), "utf8"));
}

describe("dedupeConcat", () => {
  test("preserves order: existing first, then new", () => {
    assert.deepEqual(
      dedupeConcat(["a", "b"], ["c", "d"]),
      ["a", "b", "c", "d"]
    );
  });

  test("dedupes overlapping entries", () => {
    assert.deepEqual(
      dedupeConcat(["a", "b"], ["b", "c"]),
      ["a", "b", "c"]
    );
  });

  test("handles undefined existing", () => {
    assert.deepEqual(dedupeConcat(undefined, ["a"]), ["a"]);
  });

  test("handles undefined incoming", () => {
    assert.deepEqual(dedupeConcat(["a"], undefined), ["a"]);
  });

  test("handles both undefined", () => {
    assert.deepEqual(dedupeConcat(undefined, undefined), []);
  });
});

describe("parseArgs", () => {
  test("parses profile only", () => {
    const a = parseArgs(["minimal"]);
    assert.equal(a.profile, "minimal");
    assert.equal(a.dryRun, false);
    assert.equal(a.shared, false);
    assert.equal(a.target, null);
    assert.equal(a.allowDefaultMode, false);
  });

  test("parses --dry-run", () => {
    assert.equal(parseArgs(["full", "--dry-run"]).dryRun, true);
  });

  test("parses --shared", () => {
    assert.equal(parseArgs(["full", "--shared"]).shared, true);
  });

  test("parses --target PATH", () => {
    assert.equal(
      parseArgs(["full", "--target", "/tmp/x.json"]).target,
      "/tmp/x.json"
    );
  });

  test("parses --allow-default-mode", () => {
    assert.equal(
      parseArgs(["plan", "--allow-default-mode"]).allowDefaultMode,
      true
    );
  });

  test("rejects --target without value", () => {
    assert.throws(() => parseArgs(["full", "--target"]), /requires a path/);
  });

  test("rejects unknown flag", () => {
    assert.throws(() => parseArgs(["full", "--bogus"]), /Unknown argument/);
  });

  test("parses --help", () => {
    assert.equal(parseArgs(["--help"]).help, true);
  });
});

describe("listProfiles", () => {
  test("returns at least min, base, and plan", () => {
    const profiles = listProfiles();
    assert.ok(profiles.includes("min"), "min missing");
    assert.ok(profiles.includes("base"), "base missing");
    assert.ok(profiles.includes("plan"), "plan missing");
  });

  test("returns sorted", () => {
    const profiles = listProfiles();
    const sorted = [...profiles].sort();
    assert.deepEqual(profiles, sorted);
  });
});

describe("loadPreset", () => {
  test("loads min", () => {
    const p = loadPreset("min");
    assert.equal(p.sandbox.enabled, true);
  });

  test("throws on unknown profile", () => {
    assert.throws(() => loadPreset("nonexistent-xyz"), /Unknown profile/);
  });
});

describe("loadTarget", () => {
  test("returns {} when file missing", () => {
    assert.deepEqual(loadTarget("/tmp/sccm-test-missing-xyz.json"), {});
  });

  test("returns {} when file is empty", () => {
    const tmp = path.join(
      __dirname,
      `.tmp-empty-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(tmp, "");
    try {
      assert.deepEqual(loadTarget(tmp), {});
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("throws TARGET_CORRUPT on bad JSON", () => {
    const tmp = path.join(
      __dirname,
      `.tmp-corrupt-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(tmp, "{ this is not json");
    try {
      assert.throws(() => loadTarget(tmp), /Refusing to overwrite corrupt/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("parses valid JSON", () => {
    const tmp = path.join(
      __dirname,
      `.tmp-valid-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(tmp, '{"a":1}');
    try {
      assert.deepEqual(loadTarget(tmp), { a: 1 });
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe("mergeSandbox — empty target", () => {
  test("merging min into {} yields a sandbox block with allowed domains", () => {
    const { merged } = mergeSandbox({}, loadPresetFile("min"));
    assert.equal(merged.sandbox.enabled, true);
    assert.ok(Array.isArray(merged.sandbox.network.allowedDomains));
    assert.ok(merged.sandbox.network.allowedDomains.length > 0);
    assert.ok(
      merged.sandbox.network.allowedDomains.includes("api.anthropic.com")
    );
  });

  test("merging base into {} carries excludedCommands", () => {
    const { merged } = mergeSandbox({}, loadPresetFile("base"));
    assert.ok(Array.isArray(merged.sandbox.excludedCommands));
    assert.ok(merged.sandbox.excludedCommands.includes("docker *"));
    assert.ok(merged.sandbox.excludedCommands.includes("npm *"));
    assert.ok(merged.sandbox.excludedCommands.includes("git *"));
    assert.ok(merged.sandbox.excludedCommands.includes("gh *"));
  });
});

describe("mergeSandbox — array dedupe + ordering", () => {
  test("preserves existing domain first, concats new ones, dedupes overlap", () => {
    const existing = {
      sandbox: {
        network: { allowedDomains: ["foo.com", "github.com"] },
      },
    };
    const { merged } = mergeSandbox(existing, loadPresetFile("min"));
    const domains = merged.sandbox.network.allowedDomains;
    assert.equal(domains[0], "foo.com");
    assert.equal(domains[1], "github.com");
    assert.ok(domains.includes("api.anthropic.com"));
    assert.equal(
      domains.filter((d) => d === "github.com").length,
      1,
      "github.com should be deduped"
    );
  });

  test("excludedCommands dedupes", () => {
    const existing = {
      sandbox: { excludedCommands: ["docker *", "vim *"] },
    };
    const { merged } = mergeSandbox(existing, loadPresetFile("base"));
    assert.equal(merged.sandbox.excludedCommands[0], "docker *");
    assert.equal(merged.sandbox.excludedCommands[1], "vim *");
    assert.ok(merged.sandbox.excludedCommands.includes("npm *"));
    assert.equal(
      merged.sandbox.excludedCommands.filter((c) => c === "docker *").length,
      1
    );
  });
});

describe("mergeSandbox — preserves user settings", () => {
  test("non-sandbox top-level keys are untouched (min has no permissions block)", () => {
    const existing = {
      permissions: { allow: ["Bash(ls)"] },
      enabledPlugins: { "hooks-guard@sccm": true },
      mcpServers: { foo: { command: "bar" } },
      sandbox: { network: { allowedDomains: [] } },
    };
    const { merged } = mergeSandbox(existing, loadPresetFile("min"));
    // min ships no permissions block, so permissions.allow is unchanged.
    assert.deepEqual(merged.permissions, { allow: ["Bash(ls)"] });
    assert.deepEqual(merged.enabledPlugins, { "hooks-guard@sccm": true });
    assert.deepEqual(merged.mcpServers, { foo: { command: "bar" } });
  });

  test("explicitly disabled sandbox is preserved with a warning", () => {
    const existing = { sandbox: { enabled: false } };
    const { merged, diff } = mergeSandbox(existing, loadPresetFile("min"));
    assert.equal(merged.sandbox.enabled, false);
    assert.ok(
      diff.warnings.some((w) => w.includes("explicitly false")),
      "expected an explicit-false warning"
    );
  });

  test("user-set scalar (enableWeakerNetworkIsolation: false) is preserved", () => {
    const existing = { sandbox: { enableWeakerNetworkIsolation: false } };
    const preset = { sandbox: { enableWeakerNetworkIsolation: true } };
    const { merged } = mergeSandbox(existing, preset);
    assert.equal(merged.sandbox.enableWeakerNetworkIsolation, false);
  });

  test("user-set httpProxyPort is preserved over preset", () => {
    const existing = { sandbox: { network: { httpProxyPort: 9999 } } };
    const preset = { sandbox: { network: { httpProxyPort: 8080 } } };
    const { merged } = mergeSandbox(existing, preset);
    assert.equal(merged.sandbox.network.httpProxyPort, 9999);
  });

  test("preset adds a scalar key the user has not configured", () => {
    const existing = { sandbox: {} };
    const preset = { sandbox: { autoAllowBashIfSandboxed: true } };
    const { merged, diff } = mergeSandbox(existing, preset);
    assert.equal(merged.sandbox.autoAllowBashIfSandboxed, true);
    assert.ok(
      diff.added.other.some((s) => s.includes("autoAllowBashIfSandboxed"))
    );
  });
});

describe("mergeSandbox — diff reporting", () => {
  test("counts added domains", () => {
    const { diff } = mergeSandbox({}, loadPresetFile("min"));
    assert.ok(diff.added.allowedDomains.length > 0);
  });

  test("reports zero adds when re-applying the same preset", () => {
    const first = mergeSandbox({}, loadPresetFile("base"));
    const second = mergeSandbox(first.merged, loadPresetFile("base"));
    assert.equal(second.diff.added.allowedDomains.length, 0);
    assert.equal(second.diff.added.excludedCommands.length, 0);
    assert.equal(second.diff.added.allowWrite.length, 0);
    assert.equal(second.diff.added.permissionsAllow.length, 0);
  });
});

describe("mergeSandbox — permissions.allow", () => {
  test("merging base into {} carries permissions.allow patterns", () => {
    const { merged } = mergeSandbox({}, loadPresetFile("base"));
    assert.ok(Array.isArray(merged.permissions.allow));
    assert.ok(merged.permissions.allow.includes("Bash(git:*)"));
    assert.ok(merged.permissions.allow.includes("Bash(docker:*)"));
    assert.ok(merged.permissions.allow.includes("Bash(docker compose:*)"));
    assert.ok(merged.permissions.allow.includes("Bash(gh:*)"));
    assert.ok(merged.permissions.allow.includes("Bash(npm:*)"));
  });

  test("preserves user permissions.allow first, appends and dedupes", () => {
    const existing = {
      permissions: { allow: ["Bash(ls)", "Bash(git:*)"] },
    };
    const { merged } = mergeSandbox(existing, loadPresetFile("base"));
    const allow = merged.permissions.allow;
    assert.equal(allow[0], "Bash(ls)");
    assert.equal(allow[1], "Bash(git:*)");
    assert.ok(allow.includes("Bash(docker:*)"));
    assert.equal(
      allow.filter((x) => x === "Bash(git:*)").length,
      1,
      "Bash(git:*) should be deduped"
    );
  });

  test("re-applying base over its own output adds zero permissions.allow", () => {
    const first = mergeSandbox({}, loadPresetFile("base"));
    const second = mergeSandbox(first.merged, loadPresetFile("base"));
    assert.equal(second.diff.added.permissionsAllow.length, 0);
  });

  test("never touches permissions.deny / ask / defaultMode (base preset)", () => {
    const existing = {
      permissions: {
        defaultMode: "ask",
        deny: ["Bash(rm:*)"],
        ask: ["Bash(curl:*)"],
      },
    };
    const { merged } = mergeSandbox(existing, loadPresetFile("base"));
    assert.equal(merged.permissions.defaultMode, "ask");
    assert.deepEqual(merged.permissions.deny, ["Bash(rm:*)"]);
    assert.deepEqual(merged.permissions.ask, ["Bash(curl:*)"]);
    assert.ok(Array.isArray(merged.permissions.allow));
    assert.ok(merged.permissions.allow.includes("Bash(git:*)"));
  });

  test("min preset does not create a permissions block", () => {
    const { merged } = mergeSandbox({}, loadPresetFile("min"));
    assert.equal(merged.permissions, undefined);
  });

  test("diff.added.permissionsAllow is populated on first apply", () => {
    const { diff } = mergeSandbox({}, loadPresetFile("base"));
    assert.ok(diff.added.permissionsAllow.length > 0);
    assert.ok(diff.added.permissionsAllow.includes("Bash(git:*)"));
  });
});

describe("mergeSandbox — permissions.defaultMode opt-in", () => {
  test("plan preset WITHOUT --allow-default-mode leaves defaultMode untouched", () => {
    const existing = { permissions: { defaultMode: "acceptEdits" } };
    const { merged, diff } = mergeSandbox(existing, loadPresetFile("plan"));
    assert.equal(merged.permissions.defaultMode, "acceptEdits");
    assert.ok(
      diff.warnings.some((w) => w.includes("--allow-default-mode")),
      "expected a warning about the flag"
    );
    // allow list still merges
    assert.ok(merged.permissions.allow.includes("Bash(git log:*)"));
  });

  test("plan preset WITH --allow-default-mode overwrites defaultMode", () => {
    const existing = { permissions: { defaultMode: "acceptEdits" } };
    const { merged, diff } = mergeSandbox(
      existing,
      loadPresetFile("plan"),
      { allowDefaultMode: true }
    );
    assert.equal(merged.permissions.defaultMode, "plan");
    assert.ok(
      diff.added.other.some((s) => s.includes("permissions.defaultMode")),
      "expected a diff entry recording the defaultMode change"
    );
    assert.deepEqual(diff.warnings, []);
  });

  test("plan preset into empty settings applies defaultMode when opted-in", () => {
    const { merged } = mergeSandbox({}, loadPresetFile("plan"), {
      allowDefaultMode: true,
    });
    assert.equal(merged.permissions.defaultMode, "plan");
  });

  test("plan preset into empty settings warns without opt-in (no defaultMode set)", () => {
    const { merged, diff } = mergeSandbox({}, loadPresetFile("plan"));
    assert.equal(merged.permissions?.defaultMode, undefined);
    assert.ok(diff.warnings.some((w) => w.includes("--allow-default-mode")));
  });

  test("base preset has no defaultMode, opt-in flag is a no-op", () => {
    const { merged, diff } = mergeSandbox({}, loadPresetFile("base"), {
      allowDefaultMode: true,
    });
    assert.equal(merged.permissions?.defaultMode, undefined);
    assert.ok(
      !diff.warnings.some((w) => w.includes("--allow-default-mode")),
      "no warning when preset lacks defaultMode"
    );
  });

  test("re-applying plan with opt-in produces no new diff entry", () => {
    const first = mergeSandbox({}, loadPresetFile("plan"), {
      allowDefaultMode: true,
    });
    const second = mergeSandbox(first.merged, loadPresetFile("plan"), {
      allowDefaultMode: true,
    });
    assert.ok(
      !second.diff.added.other.some((s) =>
        s.includes("permissions.defaultMode")
      ),
      "re-apply should not record a defaultMode change"
    );
  });
});

describe("preset files — schema whitelist", () => {
  const ALLOWED_TOP = new Set(["sandbox", "permissions"]);
  const ALLOWED_SANDBOX = new Set([
    "enabled",
    "failIfUnavailable",
    "autoAllowBashIfSandboxed",
    "excludedCommands",
    "allowUnsandboxedCommands",
    "filesystem",
    "network",
    "enableWeakerNestedSandbox",
    "enableWeakerNetworkIsolation",
  ]);
  const ALLOWED_NETWORK = new Set([
    "allowUnixSockets",
    "allowAllUnixSockets",
    "allowLocalBinding",
    "allowMachLookup",
    "allowedDomains",
    "allowManagedDomainsOnly",
    "httpProxyPort",
    "socksProxyPort",
  ]);
  const ALLOWED_FS = new Set([
    "allowWrite",
    "denyWrite",
    "denyRead",
    "allowRead",
    "allowManagedReadPathsOnly",
  ]);
  // "allow" and "defaultMode" only — deny / ask must NEVER ship in a preset
  // because the script would refuse to merge them anyway. defaultMode is
  // allowed but gated on --allow-default-mode, and is only expected in the
  // `plan` preset (enforced by a dedicated test below).
  const ALLOWED_PERMISSIONS = new Set(["allow", "defaultMode"]);
  const PRESETS_WITH_DEFAULT_MODE = new Set(["plan"]);

  for (const name of listProfiles()) {
    test(`${name}.json — only whitelisted keys`, () => {
      const preset = loadPresetFile(name);
      for (const k of Object.keys(preset)) {
        assert.ok(ALLOWED_TOP.has(k), `unexpected top-level key: ${k}`);
      }
      for (const k of Object.keys(preset.sandbox || {})) {
        assert.ok(ALLOWED_SANDBOX.has(k), `unexpected sandbox.${k}`);
      }
      for (const k of Object.keys(preset.sandbox?.network || {})) {
        assert.ok(ALLOWED_NETWORK.has(k), `unexpected sandbox.network.${k}`);
      }
      for (const k of Object.keys(preset.sandbox?.filesystem || {})) {
        assert.ok(ALLOWED_FS.has(k), `unexpected sandbox.filesystem.${k}`);
      }
      for (const k of Object.keys(preset.permissions || {})) {
        assert.ok(ALLOWED_PERMISSIONS.has(k), `unexpected permissions.${k}`);
      }
    });

    test(`${name}.json — sandbox.enabled is true`, () => {
      assert.equal(loadPresetFile(name).sandbox.enabled, true);
    });

    test(`${name}.json — defaultMode presence matches policy`, () => {
      const preset = loadPresetFile(name);
      const hasMode = preset.permissions?.defaultMode !== undefined;
      const shouldHaveMode = PRESETS_WITH_DEFAULT_MODE.has(name);
      assert.equal(
        hasMode,
        shouldHaveMode,
        shouldHaveMode
          ? `${name} must ship permissions.defaultMode`
          : `${name} must NOT ship permissions.defaultMode (opt-in only for: ${[...PRESETS_WITH_DEFAULT_MODE].join(", ")})`
      );
    });
  }
});
