export const DEFAULT_WEIXIN_BACKEND_ID = "openclaw" as const;

export const WEIXIN_BACKEND_IDS = [
  DEFAULT_WEIXIN_BACKEND_ID,
  "codex",
  "claude",
  "opencode",
  "copilot",
  "auggie",
  "cursor",
] as const;

export const IMPLEMENTED_WEIXIN_BACKEND_IDS = [
  DEFAULT_WEIXIN_BACKEND_ID,
  "codex",
  "claude",
  "opencode",
  "copilot",
  "auggie",
  "cursor",
] as const;

export type WeixinBackendId = (typeof WEIXIN_BACKEND_IDS)[number];
export type ImplementedWeixinBackendId = (typeof IMPLEMENTED_WEIXIN_BACKEND_IDS)[number];

export const WEIXIN_BACKEND_LABELS: Record<WeixinBackendId, string> = {
  openclaw: "OpenClaw",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "Opencode",
  copilot: "GitHub Copilot",
  auggie: "Auggie",
  cursor: "Cursor CLI",
};

export type BackendSelectionSource = "default" | "stored" | "fallback";

export type WeixinBackendDispatchContext = {
  accountId: string;
  backendContext: unknown;
};

export type WeixinLightweightBackendInput = {
  accountId: string;
  peerId: string;
  senderId: string;
  text: string;
  imagePaths: string[];
  contextToken?: string;
  messageId?: string;
  timestamp?: number;
};

export type WeixinLightweightBackendOutput = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

export type WeixinOpenClawBackendAdapter = {
  id: ImplementedWeixinBackendId;
  mode: "openclaw";
  dispatch: (ctx: WeixinBackendDispatchContext) => Promise<void>;
};

export type WeixinLightweightBackendAdapter = {
  id: ImplementedWeixinBackendId;
  mode: "lightweight";
  reply: (input: WeixinLightweightBackendInput) => Promise<WeixinLightweightBackendOutput | void>;
};

export type WeixinBackendAdapter = WeixinOpenClawBackendAdapter | WeixinLightweightBackendAdapter;

export type ResolvedWeixinBackend = {
  requestedBackendId: WeixinBackendId;
  backendId: ImplementedWeixinBackendId;
  source: BackendSelectionSource;
  warning?: string;
};

export function isWeixinBackendId(value: string): value is WeixinBackendId {
  return (WEIXIN_BACKEND_IDS as readonly string[]).includes(value);
}

export function isImplementedWeixinBackendId(
  value: WeixinBackendId,
): value is ImplementedWeixinBackendId {
  return (IMPLEMENTED_WEIXIN_BACKEND_IDS as readonly string[]).includes(value);
}

export function normalizeWeixinBackendId(raw: string): WeixinBackendId | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "claude-code") return "claude";
  if (trimmed === "github-copilot" || trimmed === "copilot-cli") return "copilot";
  if (trimmed === "cursor-cli" || trimmed === "cursor-agent") return "cursor";
  return isWeixinBackendId(trimmed) ? trimmed : undefined;
}
