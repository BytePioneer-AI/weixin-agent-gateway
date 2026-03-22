#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PACKAGE_NAME = "@bytepioneer-ai/weixin-agent-gateway";
const INSTALLER_USER_AGENT = "weixin-agent-gateway-installer";
const PLUGIN_SPEC = process.env.WEIXIN_GATEWAY_PLUGIN_SPEC?.trim() || PACKAGE_NAME;
const CHANNEL_ID = process.env.WEIXIN_GATEWAY_CHANNEL_ID?.trim() || "weixin-agent-gateway";
const PLUGIN_ENTRY_ID = process.env.WEIXIN_GATEWAY_PLUGIN_ID?.trim() || "weixin-agent-gateway";
const OFFICIAL_PLUGIN_ENTRY_ID = "openclaw-weixin";
const ENABLE_OFFICIAL_PLUGIN_CMD = "openclaw config set plugins.entries.openclaw-weixin.enabled true";
const AGENTAPI_VERSION = process.env.AGENTAPI_VERSION?.trim() || "latest";
const DEFAULT_CODEX_AGENTAPI_URL = "http://127.0.0.1:3284";
const DEFAULT_CLAUDE_AGENTAPI_URL = "http://127.0.0.1:3285";

function log(msg) {
  console.log(`\x1b[36m[weixin-agent-gateway]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.warn(`\x1b[33m[weixin-agent-gateway]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[weixin-agent-gateway]\x1b[0m ${msg}`);
}

function isWindows() {
  return process.platform === "win32";
}

function run(cmd, { silent = true } = {}) {
  const stdio = silent ? ["pipe", "pipe", "pipe"] : "inherit";
  const result = spawnSync(cmd, { shell: true, stdio });
  if (result.status !== 0) {
    const err = new Error(`Command failed with exit code ${result.status}: ${cmd}`);
    err.stderr = silent ? (result.stderr || "").toString() : "";
    throw err;
  }
  return silent ? (result.stdout || "").toString().trim() : "";
}

function commandExists(bin) {
  const checker = isWindows() ? `where ${bin}` : `command -v ${bin}`;
  try {
    return Boolean(run(checker));
  } catch {
    return false;
  }
}

function resolveAgentApiArch() {
  switch (process.arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture for agentapi: ${process.arch}`);
  }
}

function resolveAgentApiOs() {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported platform for agentapi: ${process.platform}`);
  }
}

function resolveAgentApiBinaryName() {
  const osPart = resolveAgentApiOs();
  const archPart = resolveAgentApiArch();
  return isWindows() ? `agentapi-${osPart}-${archPart}.exe` : `agentapi-${osPart}-${archPart}`;
}

function resolveAgentApiDownloadUrl(fileName) {
  if (AGENTAPI_VERSION === "latest") {
    return `https://github.com/coder/agentapi/releases/latest/download/${fileName}`;
  }
  return `https://github.com/coder/agentapi/releases/download/${AGENTAPI_VERSION}/${fileName}`;
}

function resolveUserBinDir() {
  return path.join(os.homedir(), ".local", "bin");
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url, {
    headers: { "User-Agent": INSTALLER_USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`);
  }
  const arr = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(arr));
}

async function ensureAgentApiInstalled() {
  if (commandExists("agentapi")) {
    log("已检测到 agentapi");
    return { installed: false, targetPath: "agentapi" };
  }

  log("未检测到 agentapi，开始下载最新二进制...");
  const fileName = resolveAgentApiBinaryName();
  const downloadUrl = resolveAgentApiDownloadUrl(fileName);
  const binDir = resolveUserBinDir();
  const targetPath = path.join(binDir, isWindows() ? "agentapi.exe" : "agentapi");

  await downloadToFile(downloadUrl, targetPath);
  if (!isWindows()) {
    chmodSync(targetPath, 0o755);
  }

  const pathParts = (process.env.PATH || "").split(path.delimiter);
  if (!pathParts.includes(binDir)) {
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
  }

  if (!commandExists("agentapi")) {
    warn(`agentapi 已下载到 ${targetPath}，但当前 PATH 中可能还没有 ${binDir}`);
  } else {
    log(`agentapi 已安装到 ${targetPath}`);
  }
  return { installed: true, targetPath };
}

function ensureOpenClawInstalled() {
  if (!commandExists("openclaw")) {
    error("未找到 openclaw，请先安装 OpenClaw。");
    console.log("  npm install -g openclaw");
    console.log("  详见 https://docs.openclaw.ai/install");
    process.exit(1);
  }
  log("已找到本地安装的 openclaw");
}

function installPlugin() {
  log("正在安装插件...");
  try {
    const installOut = run(`openclaw plugins install "${PLUGIN_SPEC}"`);
    if (installOut) log(installOut);
  } catch (installErr) {
    if (installErr.stderr && installErr.stderr.includes("already exists")) {
      log("检测到本地已安装，尝试更新插件...");
      try {
        const updateOut = run(`openclaw plugins update "${PLUGIN_ENTRY_ID}"`);
        if (updateOut) log(updateOut);
      } catch (updateErr) {
        error("插件更新失败，请手动执行：");
        if (updateErr.stderr) console.error(updateErr.stderr);
        console.log(`  openclaw plugins update "${PLUGIN_ENTRY_ID}"`);
        process.exit(1);
      }
    } else {
      error("插件安装失败，请手动执行：");
      if (installErr.stderr) console.error(installErr.stderr);
      console.log(`  openclaw plugins install "${PLUGIN_SPEC}"`);
      process.exit(1);
    }
  }
}

function enablePlugin() {
  log("正在启用插件...");
  try {
    run(`openclaw config set plugins.entries.${PLUGIN_ENTRY_ID}.enabled true`, { silent: false });
  } catch (err) {
    warn("自动启用插件失败，请手动执行：");
    console.log(`  openclaw config set plugins.entries.${PLUGIN_ENTRY_ID}.enabled true`);
    if (err.stderr) console.error(err.stderr);
  }
}

function disableOfficialPlugin() {
  log("检测并禁用官方 openclaw-weixin 插件...");
  try {
    run(`openclaw config set plugins.entries.${OFFICIAL_PLUGIN_ENTRY_ID}.enabled false`, {
      silent: false,
    });
    warn("由于本插件与官方 openclaw-weixin 存在冲突，已尝试禁用官方插件。");
    console.log(
      `本插件的微信连接逻辑与官方保持一致。后续如需重新启用官方插件，可执行：\n  ${ENABLE_OFFICIAL_PLUGIN_CMD}`,
    );
    console.log(
      `如需仅启用本插件，可执行：\n  openclaw config set plugins.entries.${PLUGIN_ENTRY_ID}.enabled true`,
    );
    console.log(
      `如需使用本插件重新登录微信，可执行：\n  openclaw channels login --channel ${CHANNEL_ID}`,
    );
  } catch (err) {
    warn("自动禁用官方插件失败，请手动执行：");
    console.log(`  openclaw config set plugins.entries.${OFFICIAL_PLUGIN_ENTRY_ID}.enabled false`);
    if (err.stderr) console.error(err.stderr);
  }
}

function loginWeixin() {
  log("开始微信扫码登录...");
  try {
    run(`openclaw channels login --channel ${CHANNEL_ID}`, { silent: false });
  } catch {
    console.log();
    warn("首次连接未完成，可稍后手动重试：");
    console.log(`  openclaw channels login --channel ${CHANNEL_ID}`);
  }
}

function restartGateway() {
  log("正在重启 OpenClaw Gateway...");
  try {
    run("openclaw gateway restart", { silent: false });
  } catch {
    warn("Gateway 重启失败，可手动执行：");
    console.log("  openclaw gateway restart");
  }
}

function printNextSteps(agentapiInfo) {
  console.log();
  log("安装完成。下一步建议：");
  console.log();
  if (agentapiInfo?.installed) {
    console.log(`AgentAPI 已下载到: ${agentapiInfo.targetPath}`);
    console.log();
  }
  console.log("1. 直接在微信里切换后端");
  console.log("   /codex");
  console.log("   /claude");
  console.log("   /openclaw");
  console.log();
  console.log("   默认会连接本地 AgentAPI：Codex 3284，Claude 3285；没拉起时会自动尝试启动。");
  console.log("   前提是本机 `agentapi`、`codex`、`claude` 命令可用且已登录。");
  console.log();
  console.log("2. 只有在你需要改远端地址或非默认端口时，才设置环境变量");
  if (isWindows()) {
    console.log(`   $env:WEIXIN_CODEX_AGENTAPI_URL=\"${DEFAULT_CODEX_AGENTAPI_URL}\"`);
    console.log(`   $env:WEIXIN_CLAUDE_AGENTAPI_URL=\"${DEFAULT_CLAUDE_AGENTAPI_URL}\"`);
  } else {
    console.log(`   export WEIXIN_CODEX_AGENTAPI_URL=\"${DEFAULT_CODEX_AGENTAPI_URL}\"`);
    console.log(`   export WEIXIN_CLAUDE_AGENTAPI_URL=\"${DEFAULT_CLAUDE_AGENTAPI_URL}\"`);
  }
  console.log();
}

async function install() {
  ensureOpenClawInstalled();
  installPlugin();
  disableOfficialPlugin();
  enablePlugin();
  loginWeixin();
  const agentapiInfo = await ensureAgentApiInstalled();
  restartGateway();
  printNextSteps(agentapiInfo);
}

function help() {
  console.log(`
用法: npx -y ${PACKAGE_NAME} <命令>

命令:
  install   安装插件、启用插件、扫码登录，并安装 AgentAPI
  help      显示帮助信息
`);
}

const command = process.argv[2];

switch (command) {
  case "install":
    await install();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    if (command) {
      error(`未知命令: ${command}`);
    }
    help();
    process.exit(command ? 1 : 0);
}
