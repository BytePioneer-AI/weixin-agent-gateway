#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

function resolveNpmInvocation(args) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
      display: `npm ${args.join(" ")}`,
    };
  }
  return {
    command: "npm",
    args,
    display: `npm ${args.join(" ")}`,
  };
}

function printUsage() {
  console.log(`
Usage:
  node scripts/publish-npm.mjs [options]

Options:
  --dry-run           Only simulate publishing
  --tag <tag>         Publish under a dist-tag
  --otp <code>        Pass npm 2FA code
  --access <level>    npm publish access level, default: public
  --with-scripts      Do not append --ignore-scripts
  -h, --help          Show this help
`);
}

function readPackageJson(dir) {
  const packageJsonPath = path.join(dir, "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function runNpm(args, options = {}) {
  const invocation = resolveNpmInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? ROOT_DIR,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    throw new Error(
      `${invocation.display} failed in ${options.cwd ?? ROOT_DIR}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  return result;
}

function resolvePublishedVersions(packageName) {
  const result = runNpm(["view", packageName, "versions", "--json"], {
    capture: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    const stderr = `${result.stderr || ""}${result.stdout || ""}`;
    if (/E404|404 Not Found|is not in this registry/i.test(stderr)) {
      return [];
    }
    throw new Error(`Failed to query published versions for ${packageName}: ${stderr.trim()}`);
  }

  const raw = (result.stdout || "").trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw);
  if (typeof parsed === "string") return [parsed];
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function ensureLoggedIn() {
  const result = runNpm(["whoami"], { capture: true, allowFailure: true });
  if (result.status === 0) {
    return (result.stdout || "").trim();
  }
  throw new Error("npm login is required before publishing. Run `npm login` first.");
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    tag: undefined,
    otp: undefined,
    access: "public",
    withScripts: false,
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--with-scripts") {
      options.withScripts = true;
      continue;
    }

    if (arg === "--tag") {
      options.tag = args.shift();
      if (!options.tag) {
        throw new Error("--tag requires a value.");
      }
      continue;
    }

    if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length);
      continue;
    }

    if (arg === "--otp") {
      options.otp = args.shift();
      if (!options.otp) {
        throw new Error("--otp requires a value.");
      }
      continue;
    }

    if (arg.startsWith("--otp=")) {
      options.otp = arg.slice("--otp=".length);
      continue;
    }

    if (arg === "--access") {
      options.access = args.shift();
      if (!options.access) {
        throw new Error("--access requires a value.");
      }
      continue;
    }

    if (arg.startsWith("--access=")) {
      options.access = arg.slice("--access=".length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function buildPublishArgs(options) {
  const args = ["publish", "--access", options.access];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  if (options.tag) {
    args.push("--tag", options.tag);
  }
  if (options.otp) {
    args.push("--otp", options.otp);
  }
  if (!options.withScripts) {
    args.push("--ignore-scripts");
  }
  return args;
}

function publishOne(options) {
  const pkg = readPackageJson(ROOT_DIR);
  const publishedVersions = resolvePublishedVersions(pkg.name);
  const latestPublishedVersion =
    publishedVersions.length > 0 ? publishedVersions[publishedVersions.length - 1] : undefined;

  console.log(`\npackage: ${pkg.name}@${pkg.version}`);
  console.log(`directory: ${ROOT_DIR}`);

  if (latestPublishedVersion) {
    console.log(`latest published: ${latestPublishedVersion}`);
  } else {
    console.log("latest published: (not found)");
  }

  if (!options.dryRun && publishedVersions.includes(pkg.version)) {
    throw new Error(`${pkg.name}@${pkg.version} has already been published.`);
  }

  const publishArgs = buildPublishArgs(options);
  console.log(`command: ${resolveNpmInvocation(publishArgs).display}`);
  runNpm(publishArgs, { cwd: ROOT_DIR });
}

try {
  const options = parseArgs(process.argv.slice(2));
  const npmUser = ensureLoggedIn();

  console.log(`npm user: ${npmUser}`);
  console.log(`mode: ${options.dryRun ? "dry-run" : "publish"}`);
  if (!options.withScripts) {
    console.log("lifecycle scripts: skipped by default (--ignore-scripts)");
  }

  publishOne(options);

  console.log("\nPublish flow completed.");
} catch (err) {
  console.error(`\n[publish-npm] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
