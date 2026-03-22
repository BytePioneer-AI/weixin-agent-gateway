/**
 * Weixin 斜杠指令处理模块
 *
 * 支持的指令：
 * - /echo <message>         直接回复消息（不经过 AI），并附带通道耗时统计
 * - /toggle-debug           开关 debug 模式，启用后每条 AI 回复追加全链路耗时
 * - /backend [name]         查看或切换当前会话后端
 * - /openclaw              切换到 OpenClaw 后端
 * - /codex                 切换到 Codex lightweight 后端
 * - /claude                切换到 Claude Code lightweight 后端
 * - /opencode              切换到 Opencode lightweight 后端
 * - /copilot               切换到 GitHub Copilot lightweight 后端
 * - /auggie                切换到 Auggie lightweight 后端
 * - /cursor                切换到 Cursor CLI lightweight 后端
 */
import type { WeixinApiOptions } from "../api/api.js";
import {
  DEFAULT_WEIXIN_BACKEND_ID,
  WEIXIN_BACKEND_LABELS,
  isImplementedWeixinBackendId,
  normalizeWeixinBackendId,
} from "../backends/contracts.js";
import {
  clearBackendSelection,
  getBackendSelection,
  getSelectedBackendId,
  setBackendSelection,
} from "../router/backend-selection.js";
import { logger } from "../util/logger.js";

import { toggleDebugMode } from "./debug-mode.js";
import { sendMessageWeixin } from "./send.js";

export interface SlashCommandResult {
  /** 是否是斜杠指令（true 表示已处理，不需要继续走 AI） */
  handled: boolean;
}

export interface SlashCommandContext {
  to: string;
  contextToken?: string;
  baseUrl: string;
  token?: string;
  accountId: string;
  log: (msg: string) => void;
  errLog: (msg: string) => void;
}

/** 发送回复消息 */
async function sendReply(ctx: SlashCommandContext, text: string): Promise<void> {
  const opts: WeixinApiOptions & { contextToken?: string } = {
    baseUrl: ctx.baseUrl,
    token: ctx.token,
    contextToken: ctx.contextToken,
  };
  await sendMessageWeixin({ to: ctx.to, text, opts });
}

/** 处理 /echo 指令 */
async function handleEcho(
  ctx: SlashCommandContext,
  args: string,
  receivedAt: number,
  eventTimestamp?: number,
): Promise<void> {
  const message = args.trim();
  if (message) {
    await sendReply(ctx, message);
  }
  const eventTs = eventTimestamp ?? 0;
  const platformDelay = eventTs > 0 ? `${receivedAt - eventTs}ms` : "N/A";
  const timing = [
    "⏱ 通道耗时",
    `├ 事件时间: ${eventTs > 0 ? new Date(eventTs).toISOString() : "N/A"}`,
    `├ 平台→插件: ${platformDelay}`,
    `└ 插件处理: ${Date.now() - receivedAt}ms`,
  ].join("\n");
  await sendReply(ctx, timing);
}

function formatBackendStatus(ctx: SlashCommandContext): string {
  const backendId = getSelectedBackendId(ctx.accountId, ctx.to);
  const label = WEIXIN_BACKEND_LABELS[backendId];
  const isDefault = !getBackendSelection(ctx.accountId, ctx.to);
  return [
    `当前后端: ${label}`,
    isDefault ? "来源: 默认" : "来源: 会话选择",
    `默认后端: ${WEIXIN_BACKEND_LABELS.openclaw}`,
    `可切换后端: ${WEIXIN_BACKEND_LABELS.codex}、${WEIXIN_BACKEND_LABELS.claude}、${WEIXIN_BACKEND_LABELS.opencode}、${WEIXIN_BACKEND_LABELS.copilot}、${WEIXIN_BACKEND_LABELS.auggie}、${WEIXIN_BACKEND_LABELS.cursor}`,
  ].join("\n");
}

async function handleBackendCommand(ctx: SlashCommandContext, args: string): Promise<void> {
  const backendArg = normalizeWeixinBackendId(args);
  if (!args.trim()) {
    await sendReply(ctx, formatBackendStatus(ctx));
    return;
  }
  if (!backendArg) {
    await sendReply(
      ctx,
      [
        `未知后端: ${args.trim()}`,
        `当前支持: openclaw / codex / claude / opencode / copilot / auggie / cursor`,
      ].join("\n"),
    );
    return;
  }
  if (!isImplementedWeixinBackendId(backendArg)) {
    await sendReply(ctx, `${WEIXIN_BACKEND_LABELS[backendArg]} 后端尚未接入。`);
    return;
  }
  if (backendArg === DEFAULT_WEIXIN_BACKEND_ID) {
    clearBackendSelection(ctx.accountId, ctx.to);
  } else {
    setBackendSelection(ctx.accountId, ctx.to, backendArg);
  }
  await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS[backendArg]} 后端。`);
}

/**
 * 尝试处理斜杠指令
 *
 * @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
 */
export async function handleSlashCommand(
  content: string,
  ctx: SlashCommandContext,
  receivedAt: number,
  eventTimestamp?: number,
): Promise<SlashCommandResult> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  logger.info(`[weixin] Slash command: ${command}, args: ${args.slice(0, 50)}`);

  try {
    switch (command) {
      case "/echo":
        await handleEcho(ctx, args, receivedAt, eventTimestamp);
        return { handled: true };
      case "/toggle-debug": {
        const enabled = toggleDebugMode(ctx.accountId);
        await sendReply(
          ctx,
          enabled
            ? "Debug 模式已开启"
            : "Debug 模式已关闭",
        );
        return { handled: true };
      }
      case "/backend":
        await handleBackendCommand(ctx, args);
        return { handled: true };
      case "/openclaw":
        clearBackendSelection(ctx.accountId, ctx.to);
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.openclaw} 后端。`);
        return { handled: true };
      case "/codex":
        setBackendSelection(ctx.accountId, ctx.to, "codex");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.codex} 后端。`);
        return { handled: true };
      case "/claude":
        setBackendSelection(ctx.accountId, ctx.to, "claude");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.claude} 后端。`);
        return { handled: true };
      case "/opencode":
        setBackendSelection(ctx.accountId, ctx.to, "opencode");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.opencode} 后端。`);
        return { handled: true };
      case "/copilot":
        setBackendSelection(ctx.accountId, ctx.to, "copilot");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.copilot} 后端。`);
        return { handled: true };
      case "/auggie":
        setBackendSelection(ctx.accountId, ctx.to, "auggie");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.auggie} 后端。`);
        return { handled: true };
      case "/cursor":
        setBackendSelection(ctx.accountId, ctx.to, "cursor");
        await sendReply(ctx, `已切换到 ${WEIXIN_BACKEND_LABELS.cursor} 后端。`);
        return { handled: true };
      default:
        return { handled: false };
    }
  } catch (err) {
    logger.error(`[weixin] Slash command error: ${String(err)}`);
    try {
      await sendReply(ctx, `❌ 指令执行失败: ${String(err).slice(0, 200)}`);
    } catch {
      // 发送错误消息也失败了，只能记日志
    }
    return { handled: true };
  }
}
