import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { logger } from "../../util/logger.js";

export type AgentApiAutoStartBackendId =
  | "codex"
  | "claude"
  | "opencode"
  | "copilot"
  | "auggie"
  | "cursor";

export const DEFAULT_CODEX_AGENTAPI_URL = "http://127.0.0.1:3284";
export const DEFAULT_CLAUDE_AGENTAPI_URL = "http://127.0.0.1:3285";
export const DEFAULT_OPENCODE_AGENTAPI_URL = "http://127.0.0.1:3286";
export const DEFAULT_COPILOT_AGENTAPI_URL = "http://127.0.0.1:3287";
export const DEFAULT_AUGGIE_AGENTAPI_URL = "http://127.0.0.1:3288";
export const DEFAULT_CURSOR_AGENTAPI_URL = "http://127.0.0.1:3289";

type EnsureAgentApiRunningOptions = {
  backendId: AgentApiAutoStartBackendId;
  baseUrl: string;
  requestTimeoutMs: number;
  pollIntervalMs: number;
};

const LOCAL_AGENTAPI_HOSTS = new Set([
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "localhost",
  os.hostname().toLowerCase(),
]);
const DEFAULT_AUTOSTART_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_AUTOSTART_WAIT_TIMEOUT_MS = 20_000;
const startupTasks = new Map<string, Promise<void>>();

function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAutoStartEnabled(): boolean {
  const raw = process.env.WEIXIN_AGENTAPI_AUTOSTART?.trim() || process.env.AGENTAPI_AUTOSTART?.trim();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function resolveLocalAgentApiUrl(baseUrl: string): URL | undefined {
  try {
    const url = new URL(baseUrl);
    return LOCAL_AGENTAPI_HOSTS.has(url.hostname.toLowerCase()) ? url : undefined;
  } catch {
    return undefined;
  }
}

function resolveUserBinCommandPath(command: string): string | undefined {
  if (!command.trim()) return undefined;
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command) ? command : undefined;
  }

  const binDir = path.join(os.homedir(), ".local", "bin");
  const candidates = isWindows()
    ? [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command]
    : [command];

  for (const candidate of candidates) {
    const fullPath = path.join(binDir, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}

function resolveDefaultPort(backendId: AgentApiAutoStartBackendId): number {
  switch (backendId) {
    case "codex":
      return 3284;
    case "claude":
      return 3285;
    case "opencode":
      return 3286;
    case "copilot":
      return 3287;
    case "auggie":
      return 3288;
    case "cursor":
      return 3289;
  }
}

function resolvePort(url: URL, backendId: AgentApiAutoStartBackendId): number {
  if (url.port) {
    const parsed = Number(url.port);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return resolveDefaultPort(backendId);
}

function quoteForDisplay(token: string): string {
  return /[\s"]/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
}

function commandExists(command: string): boolean {
  if (!command.trim()) return false;
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }
  const checker = isWindows() ? "where" : "which";
  const result = spawnSync(checker, [command], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  return (result.status === 0 && Boolean(result.stdout?.trim())) || Boolean(resolveUserBinCommandPath(command));
}

function resolveCommandPath(command: string): string | undefined {
  if (!command.trim()) return undefined;
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command) ? command : undefined;
  }
  const checker = isWindows() ? "where" : "which";
  const result = spawnSync(checker, [command], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  if (result.status !== 0) return resolveUserBinCommandPath(command);
  return result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean);
}

function resolveAgentApiExecutable(): string | undefined {
  const envBin = process.env.WEIXIN_AGENTAPI_BIN?.trim() || process.env.AGENTAPI_BIN?.trim();
  if (envBin) {
    return resolveCommandPath(envBin);
  }

  const fromPath = resolveCommandPath("agentapi");
  if (fromPath) return fromPath;

  const fallback = resolveUserBinCommandPath("agentapi");
  return fallback;
}

function resolveAgentCommand(backendId: AgentApiAutoStartBackendId): string {
  switch (backendId) {
    case "codex":
      return process.env.WEIXIN_CODEX_BIN?.trim() || process.env.CODEX_BIN?.trim() || "codex";
    case "claude":
      return process.env.WEIXIN_CLAUDE_BIN?.trim() || process.env.CLAUDE_BIN?.trim() || "claude";
    case "opencode":
      return process.env.WEIXIN_OPENCODE_BIN?.trim() || process.env.OPENCODE_BIN?.trim() || "opencode";
    case "copilot":
      return process.env.WEIXIN_COPILOT_BIN?.trim() || process.env.COPILOT_BIN?.trim() || "copilot";
    case "auggie":
      return process.env.WEIXIN_AUGGIE_BIN?.trim() || process.env.AUGGIE_BIN?.trim() || "auggie";
    case "cursor":
      return process.env.WEIXIN_CURSOR_BIN?.trim() || process.env.CURSOR_BIN?.trim() || "cursor-agent";
  }
}

function resolveBackendLabel(backendId: AgentApiAutoStartBackendId): string {
  switch (backendId) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "opencode":
      return "Opencode";
    case "copilot":
      return "GitHub Copilot";
    case "auggie":
      return "Auggie";
    case "cursor":
      return "Cursor CLI";
  }
}

function assertAgentCommandAvailable(
  backendId: AgentApiAutoStartBackendId,
  agentCommand: string,
): void {
  if (commandExists(agentCommand)) return;
  throw new Error(
    `${resolveBackendLabel(backendId)} AgentAPI auto-start failed: executable "${agentCommand}" was not found.`,
  );
}

function resolveAgentApiType(backendId: AgentApiAutoStartBackendId): string | undefined {
  switch (backendId) {
    case "codex":
    case "opencode":
    case "copilot":
    case "auggie":
    case "cursor":
      return backendId;
    case "claude":
      return undefined;
  }
}

function buildLaunchArgs(
  backendId: AgentApiAutoStartBackendId,
  port: number,
  agentCommand: string,
): string[] {
  const args = ["server", "--port", String(port)];
  const agentType = resolveAgentApiType(backendId);
  if (agentType) {
    args.push(`--type=${agentType}`);
  }
  args.push("--", agentCommand);
  return args;
}

async function canReachStatus(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimTrailingSlash(baseUrl)}/status`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForStatus(baseUrl: string, timeoutMs: number, pollIntervalMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReachStatus(baseUrl, DEFAULT_AUTOSTART_PROBE_TIMEOUT_MS)) {
      return;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`AgentAPI auto-start failed: ${baseUrl} did not become reachable in time.`);
}

async function spawnDetached(agentapiBin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(agentapiBin, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function startLocalAgentApi(options: EnsureAgentApiRunningOptions, url: URL): Promise<void> {
  if (await canReachStatus(options.baseUrl, DEFAULT_AUTOSTART_PROBE_TIMEOUT_MS)) {
    return;
  }

  const agentapiBin = resolveAgentApiExecutable();
  if (!agentapiBin) {
    throw new Error('AgentAPI auto-start failed: executable "agentapi" was not found.');
  }

  const agentCommand = resolveAgentCommand(options.backendId);
  assertAgentCommandAvailable(options.backendId, agentCommand);

  const port = resolvePort(url, options.backendId);
  const args = buildLaunchArgs(options.backendId, port, agentCommand);
  logger.info(
    `agentapi autostart: launching backend=${options.backendId} url=${options.baseUrl} command=${[agentapiBin, ...args].map(quoteForDisplay).join(" ")}`,
  );

  await spawnDetached(agentapiBin, args);
  await waitForStatus(
    options.baseUrl,
    Math.max(options.requestTimeoutMs, DEFAULT_AUTOSTART_WAIT_TIMEOUT_MS),
    options.pollIntervalMs,
  );
}

export async function ensureAgentApiRunning(options: EnsureAgentApiRunningOptions): Promise<void> {
  if (!isAutoStartEnabled()) {
    return;
  }

  const url = resolveLocalAgentApiUrl(options.baseUrl);
  if (!url) {
    return;
  }

  const key = `${options.backendId}:${url.origin}`;
  let startupTask = startupTasks.get(key);
  if (!startupTask) {
    startupTask = startLocalAgentApi(options, url).finally(() => {
      startupTasks.delete(key);
    });
    startupTasks.set(key, startupTask);
  }
  await startupTask;
}
