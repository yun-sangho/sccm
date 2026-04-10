#!/usr/bin/env node
/**
 * sandbox-apply.mjs — merge a vetted sandbox.* preset from ./presets/ into
 * a Claude Code settings file.
 *
 * Usage:
 *   node sandbox-apply.mjs <profile> [options]
 *   /sandbox-presets:apply <profile> [options]   (when installed as a plugin)
 *
 * Profiles:
 *   minimal   Anthropic + GitHub + npm registry. Just enough to bootstrap.
 *   full      Everything: broader network, npm/python cache writable, docker
 *             via excludedCommands.
 *
 * Options:
 *   --target PATH   Settings file to merge into.
 *                   Default: <cwd>/.claude/settings.local.json
 *   --shared        Shortcut for --target <cwd>/.claude/settings.json
 *   --dry-run       Print the diff but do not write
 *   -h, --help      Show this help
 *
 * Merge semantics:
 *   - Array fields (allowedDomains, allowWrite, excludedCommands, ...) are
 *     concat + dedupe, with the user's existing entries kept first.
 *   - Scalar fields the user already set are preserved (we only add keys the
 *     user has not configured).
 *   - sandbox.enabled === false in the user's settings is preserved with a
 *     warning — we will not silently flip a deliberate opt-out.
 *   - Top-level keys outside `sandbox` (permissions, enabledPlugins, ...) are
 *     never touched.
 *
 * Why this script exists:
 *   Claude Code plugins can ship hooks/skills/agents/MCP servers but their
 *   bundled settings.json only honors `agent` keys — sandbox.* and
 *   permissions.* are deliberately excluded so a plugin cannot silently
 *   relax your security posture. This plugin therefore ships presets as
 *   plain JSON and exposes a /sandbox-presets:apply slash command that
 *   invokes this script — explicit, user-driven merge.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const PRESETS_DIR = path.join(PLUGIN_ROOT, "presets");

const ARRAY_KEYS_NETWORK = [
  "allowedDomains",
  "allowUnixSockets",
  "allowMachLookup",
];
const ARRAY_KEYS_FILESYSTEM = [
  "allowWrite",
  "denyWrite",
  "denyRead",
  "allowRead",
];
const SCALAR_KEYS_NETWORK = [
  "allowLocalBinding",
  "allowAllUnixSockets",
  "allowManagedDomainsOnly",
  "httpProxyPort",
  "socksProxyPort",
];
const SCALAR_KEYS_SANDBOX = [
  "failIfUnavailable",
  "autoAllowBashIfSandboxed",
  "allowUnsandboxedCommands",
  "enableWeakerNestedSandbox",
  "enableWeakerNetworkIsolation",
];

function help() {
  console.log(
    `Usage: node sandbox-apply.mjs <profile> [options]
       /sandbox-presets:apply <profile> [options]   (when installed as a plugin)

Profiles:
${listProfiles()
  .map((p) => `  ${p}`)
  .join("\n")}

Options:
  --target PATH   Settings file to merge into
                  (default: <cwd>/.claude/settings.local.json)
  --shared        Shortcut for --target <cwd>/.claude/settings.json
  --dry-run       Print the diff but do not write
  -h, --help      Show this help

Examples:
  node sandbox-apply.mjs minimal
  node sandbox-apply.mjs full --dry-run
  /sandbox-presets:apply full --shared
`
  );
}

function parseArgs(argv) {
  const args = {
    profile: null,
    target: null,
    shared: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") {
      args.target = argv[++i];
      if (!args.target) throw new Error("--target requires a path argument");
    } else if (a === "--shared") {
      args.shared = true;
    } else if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (!args.profile && !a.startsWith("-")) {
      args.profile = a;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function listProfiles() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs
    .readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function loadPreset(name) {
  const p = path.join(PRESETS_DIR, `${name}.json`);
  if (!fs.existsSync(p)) {
    const available = listProfiles();
    const err = new Error(
      `Unknown profile: ${name}\nAvailable: ${available.join(", ") || "(none)"}`
    );
    err.code = "UNKNOWN_PROFILE";
    throw err;
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadTarget(targetPath) {
  if (!fs.existsSync(targetPath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(targetPath, "utf8");
  } catch (e) {
    const err = new Error(`Failed to read ${targetPath}: ${e.message}`);
    err.code = "TARGET_READ_FAILED";
    throw err;
  }
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error(
      `Refusing to overwrite corrupt JSON at ${targetPath}: ${e.message}`
    );
    err.code = "TARGET_CORRUPT";
    throw err;
  }
}

function dedupeConcat(existing, incoming) {
  const seen = new Set();
  const result = [];
  for (const item of [...(existing || []), ...(incoming || [])]) {
    const key = typeof item === "string" ? item : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge a preset's sandbox block into an existing settings object.
 * Returns { merged, diff } where diff describes what was added.
 * Pure function — does not touch the filesystem.
 */
function mergeSandbox(existing, preset) {
  const merged = clone(existing || {});
  const diff = {
    added: {
      allowedDomains: [],
      allowWrite: [],
      excludedCommands: [],
      other: [],
    },
    warnings: [],
  };

  if (!merged.sandbox) merged.sandbox = {};
  const ex = merged.sandbox;
  const ps = preset.sandbox || {};

  // sandbox.enabled — preserve explicit opt-out, otherwise enable
  if (ps.enabled === true) {
    if (ex.enabled === false) {
      diff.warnings.push(
        "sandbox.enabled is explicitly false in your settings — leaving as-is. " +
          "Set it to true manually if you actually want sandboxing."
      );
    } else if (ex.enabled !== true) {
      ex.enabled = true;
      diff.added.other.push("sandbox.enabled = true");
    }
  }

  // sandbox.network
  if (ps.network) {
    if (!ex.network) ex.network = {};
    for (const k of ARRAY_KEYS_NETWORK) {
      if (!Array.isArray(ps.network[k])) continue;
      const before = new Set(ex.network[k] || []);
      const next = dedupeConcat(ex.network[k], ps.network[k]);
      const newOnes = next.filter((x) => !before.has(x));
      ex.network[k] = next;
      if (newOnes.length === 0) continue;
      if (k === "allowedDomains") {
        diff.added.allowedDomains.push(...newOnes);
      } else {
        diff.added.other.push(`network.${k}: +${newOnes.length}`);
      }
    }
    for (const k of SCALAR_KEYS_NETWORK) {
      if (ps.network[k] === undefined) continue;
      if (ex.network[k] !== undefined) continue;
      ex.network[k] = ps.network[k];
      diff.added.other.push(`network.${k} = ${JSON.stringify(ps.network[k])}`);
    }
  }

  // sandbox.filesystem
  if (ps.filesystem) {
    if (!ex.filesystem) ex.filesystem = {};
    for (const k of ARRAY_KEYS_FILESYSTEM) {
      if (!Array.isArray(ps.filesystem[k])) continue;
      const before = new Set(ex.filesystem[k] || []);
      const next = dedupeConcat(ex.filesystem[k], ps.filesystem[k]);
      const newOnes = next.filter((x) => !before.has(x));
      ex.filesystem[k] = next;
      if (newOnes.length === 0) continue;
      if (k === "allowWrite") {
        diff.added.allowWrite.push(...newOnes);
      } else {
        diff.added.other.push(`filesystem.${k}: +${newOnes.length}`);
      }
    }
  }

  // sandbox.excludedCommands
  if (Array.isArray(ps.excludedCommands)) {
    const before = new Set(ex.excludedCommands || []);
    const next = dedupeConcat(ex.excludedCommands, ps.excludedCommands);
    const newOnes = next.filter((x) => !before.has(x));
    ex.excludedCommands = next;
    if (newOnes.length > 0) diff.added.excludedCommands.push(...newOnes);
  }

  // sandbox-level scalars (top-level under sandbox)
  for (const k of SCALAR_KEYS_SANDBOX) {
    if (ps[k] === undefined) continue;
    if (ex[k] !== undefined) continue;
    ex[k] = ps[k];
    diff.added.other.push(`sandbox.${k} = ${JSON.stringify(ps[k])}`);
  }

  return { merged, diff };
}

function printDiff(diff) {
  let total = 0;
  if (diff.added.allowedDomains.length > 0) {
    console.log(`+ ${diff.added.allowedDomains.length} allowedDomains:`);
    for (const d of diff.added.allowedDomains) console.log(`    ${d}`);
    total += diff.added.allowedDomains.length;
  }
  if (diff.added.allowWrite.length > 0) {
    console.log(`+ ${diff.added.allowWrite.length} filesystem.allowWrite:`);
    for (const p of diff.added.allowWrite) console.log(`    ${p}`);
    total += diff.added.allowWrite.length;
  }
  if (diff.added.excludedCommands.length > 0) {
    console.log(`+ ${diff.added.excludedCommands.length} excludedCommands:`);
    for (const c of diff.added.excludedCommands) console.log(`    ${c}`);
    total += diff.added.excludedCommands.length;
  }
  if (diff.added.other.length > 0) {
    console.log(`+ ${diff.added.other.length} other:`);
    for (const o of diff.added.other) console.log(`    ${o}`);
    total += diff.added.other.length;
  }
  if (total === 0) {
    console.log(
      "(nothing to add — your settings already include this profile)"
    );
  }
  for (const w of diff.warnings) {
    console.warn(`! ${w}`);
  }
}

function atomicWrite(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, targetPath);
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`Error: ${e.message}\n`);
    help();
    process.exit(1);
  }

  if (args.help) {
    help();
    return;
  }
  if (!args.profile) {
    help();
    process.exit(1);
  }

  const cwd = process.cwd();
  const targetPath = args.target
    ? path.resolve(cwd, args.target)
    : path.resolve(
        cwd,
        ".claude",
        args.shared ? "settings.json" : "settings.local.json"
      );

  let preset, existing;
  try {
    preset = loadPreset(args.profile);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  try {
    existing = loadTarget(targetPath);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }

  const { merged, diff } = mergeSandbox(existing, preset);

  console.log(`Profile: ${args.profile}`);
  console.log(`Target:  ${targetPath}`);
  console.log(``);
  printDiff(diff);
  console.log(``);

  if (args.dryRun) {
    console.log("(dry-run — no changes written)");
    return;
  }

  atomicWrite(targetPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`✔ Wrote ${targetPath}`);
  console.log(``);
  console.log(
    `⚠ Sandbox config changes only apply to NEW sessions — restart Claude Code.`
  );
}

// Run main only when invoked directly so tests can import the helpers.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  main();
}

export {
  parseArgs,
  listProfiles,
  loadPreset,
  loadTarget,
  dedupeConcat,
  mergeSandbox,
  PRESETS_DIR,
};
