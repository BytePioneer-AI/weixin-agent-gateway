import type { ImplementedWeixinBackendId, WeixinBackendAdapter } from "./contracts.js";
import { auggieBackendAdapter } from "./auggie/adapter.js";
import { claudeBackendAdapter } from "./claude/adapter.js";
import { copilotBackendAdapter } from "./copilot/adapter.js";
import { codexBackendAdapter } from "./codex/adapter.js";
import { cursorBackendAdapter } from "./cursor/adapter.js";
import { openclawBackendAdapter } from "./openclaw/adapter.js";
import { opencodeBackendAdapter } from "./opencode/adapter.js";

const backendAdapters: Record<ImplementedWeixinBackendId, WeixinBackendAdapter> = {
  auggie: auggieBackendAdapter,
  claude: claudeBackendAdapter,
  copilot: copilotBackendAdapter,
  codex: codexBackendAdapter,
  cursor: cursorBackendAdapter,
  openclaw: openclawBackendAdapter,
  opencode: opencodeBackendAdapter,
};

export function getWeixinBackendAdapter(id: ImplementedWeixinBackendId): WeixinBackendAdapter {
  return backendAdapters[id];
}

export function listImplementedWeixinBackendAdapters(): WeixinBackendAdapter[] {
  return Object.values(backendAdapters);
}
