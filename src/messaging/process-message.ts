import path from "node:path";

import {
  resolvePreferredOpenClawTmpDir,
} from "openclaw/plugin-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk";

import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { buildWeixinLightweightBackendInput } from "../backends/lightweight/input.js";
import { resolveOpenClawAuthorization } from "../backends/openclaw/auth.js";
import {
  createOpenClawReplyDispatcher,
  createOpenClawTypingCallbacks,
} from "../backends/openclaw/reply-dispatch.js";
import { resolveOpenClawAgentRoute } from "../backends/openclaw/routing.js";
import {
  finalizeOpenClawInboundContext,
  recordOpenClawInboundSession,
} from "../backends/openclaw/session.js";
import { downloadMediaFromItem } from "../media/media-download.js";
import { resolveWeixinBackend, resolveWeixinBackendAdapter } from "../router/backend-router.js";
import {
  createWeixinReplyDeliverer,
  createWeixinReplyErrorHandler,
  type WeixinDebugDeliveryRecord,
} from "../transport/weixin/outbound/delivery.js";
import { createLightweightTextReplyBudgeter } from "../transport/weixin/outbound/lightweight-text-budget.js";
import { createWeixinTypingTransportConfig } from "../transport/weixin/outbound/typing.js";
import { logger } from "../util/logger.js";
import { redactBody } from "../util/redact.js";

import { isDebugMode } from "./debug-mode.js";
import {
  setContextToken,
  weixinMessageToMsgContext,
  getContextTokenFromMsgContext,
  isMediaItem,
} from "./inbound.js";
import type { WeixinInboundMediaOpts } from "./inbound.js";
import { sendMessageWeixin } from "./send.js";
import { handleSlashCommand } from "./slash-commands.js";

const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolvePreferredOpenClawTmpDir(), "weixin/media/outbound-temp");

/** Dependencies for processOneMessage, injected by the monitor loop. */
export type ProcessMessageDeps = {
  accountId: string;
  config: import("openclaw/plugin-sdk/core").OpenClawConfig;
  channelRuntime: PluginRuntime["channel"];
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  typingTicket?: string;
  log: (msg: string) => void;
  errLog: (m: string) => void;
};

/** Extract text body from item_list (for slash command detection). */
function extractTextBody(itemList?: import("../api/types.js").MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

/**
 * Process a single inbound message: route → download media → dispatch reply.
 * Extracted from the monitor loop to keep monitoring and message handling separate.
 */
export async function processOneMessage(
  full: WeixinMessage,
  deps: ProcessMessageDeps,
): Promise<void> {
  if (!deps?.channelRuntime) {
    logger.error(
      `processOneMessage: channelRuntime is undefined, skipping message from=${full.from_user_id}`,
    );
    deps.errLog("processOneMessage: channelRuntime is undefined, skip");
    return;
  }

  const receivedAt = Date.now();
  const debug = isDebugMode(deps.accountId);
  const debugTrace: string[] = [];
  const debugTs: Record<string, number> = { received: receivedAt };

  const textBody = extractTextBody(full.item_list);
  if (textBody.startsWith("/")) {
    const slashResult = await handleSlashCommand(textBody, {
      to: full.from_user_id ?? "",
      contextToken: full.context_token,
      baseUrl: deps.baseUrl,
      token: deps.token,
      accountId: deps.accountId,
      log: deps.log,
      errLog: deps.errLog,
    }, receivedAt, full.create_time_ms);
    if (slashResult.handled) {
      logger.info(`[weixin] Slash command handled, skipping AI pipeline`);
      return;
    }
  }

  if (debug) {
    const itemTypes = full.item_list?.map((i) => i.type).join(",") ?? "none";
    debugTrace.push(
      "── 收消息 ──",
      `│ seq=${full.seq ?? "?"} msgId=${full.message_id ?? "?"} from=${full.from_user_id ?? "?"}`,
      `│ body="${textBody.slice(0, 40)}${textBody.length > 40 ? "…" : ""}" (len=${textBody.length}) itemTypes=[${itemTypes}]`,
      `│ sessionId=${full.session_id ?? "?"} contextToken=${full.context_token ? "present" : "none"}`,
    );
  }

  const mediaOpts: WeixinInboundMediaOpts = {};

  // Find the first downloadable media item (priority: IMAGE > VIDEO > FILE > VOICE).
  // When none found in the main item_list, fall back to media referenced via a quoted message.
  const mainMediaItem =
    full.item_list?.find(
      (i) => i.type === MessageItemType.IMAGE && i.image_item?.media?.encrypt_query_param,
    ) ??
    full.item_list?.find(
      (i) => i.type === MessageItemType.VIDEO && i.video_item?.media?.encrypt_query_param,
    ) ??
    full.item_list?.find(
      (i) => i.type === MessageItemType.FILE && i.file_item?.media?.encrypt_query_param,
    ) ??
    full.item_list?.find(
      (i) =>
        i.type === MessageItemType.VOICE &&
        i.voice_item?.media?.encrypt_query_param &&
        !i.voice_item.text,
    );
  const refMediaItem = !mainMediaItem
    ? full.item_list?.find(
        (i) =>
          i.type === MessageItemType.TEXT &&
          i.ref_msg?.message_item &&
          isMediaItem(i.ref_msg.message_item!),
      )?.ref_msg?.message_item
    : undefined;

  const mediaDownloadStart = Date.now();
  const mediaItem = mainMediaItem ?? refMediaItem;
  if (mediaItem) {
    const label = refMediaItem ? "ref" : "inbound";
    const downloaded = await downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: deps.cdnBaseUrl,
      saveMedia: deps.channelRuntime.media.saveMediaBuffer,
      log: deps.log,
      errLog: deps.errLog,
      label,
    });
    Object.assign(mediaOpts, downloaded);
  }
  const mediaDownloadMs = Date.now() - mediaDownloadStart;

  if (debug) {
    debugTrace.push(mediaItem
      ? `│ mediaDownload: type=${mediaItem.type} cost=${mediaDownloadMs}ms`
      : "│ mediaDownload: none",
    );
  }

  const ctx = weixinMessageToMsgContext(full, deps.accountId, mediaOpts);

  const peerId = full.from_user_id ?? ctx.To;
  const resolvedBackend = resolveWeixinBackend({
    accountId: deps.accountId,
    peerId,
  });
  const backendAdapter = resolveWeixinBackendAdapter({
    resolvedBackend,
    accountId: deps.accountId,
  });
  logger.debug(
    `backend selection: requested=${resolvedBackend.requestedBackendId} resolved=${resolvedBackend.backendId} source=${resolvedBackend.source}`,
  );

  if (debug) {
    debugTrace.push(
      `│ backend: requested=${resolvedBackend.requestedBackendId} resolved=${resolvedBackend.backendId} source=${resolvedBackend.source} mode=${backendAdapter.mode}`,
    );
  }
  const contextToken = getContextTokenFromMsgContext(ctx);
  if (contextToken) {
    setContextToken(deps.accountId, full.from_user_id ?? "", contextToken);
  }
  const replyErrorHandler = createWeixinReplyErrorHandler({
    to: ctx.To,
    contextToken,
    baseUrl: deps.baseUrl,
    token: deps.token,
    errLog: deps.errLog,
  });
  /** Delivery records populated synchronously at deliver() entry, safe to read in finally. */
  const debugDeliveries: WeixinDebugDeliveryRecord[] = [];
  const replyDeliverer = createWeixinReplyDeliverer({
    to: ctx.To,
    baseUrl: deps.baseUrl,
    token: deps.token,
    contextToken,
    cdnBaseUrl: deps.cdnBaseUrl,
    mediaOutboundTempDir: MEDIA_OUTBOUND_TEMP_DIR,
    debug,
    debugDeliveries,
  });
  let markDispatchIdle = () => {};

  try {
    if (backendAdapter.mode === "lightweight") {
      debugTs.preDispatch = Date.now();
      const lightweightReplyBudgeter = createLightweightTextReplyBudgeter({
        sendText: async (text: string) => {
          await replyDeliverer({ text });
        },
      });
      const lightweightInput = {
        ...buildWeixinLightweightBackendInput({
          full,
          ctx,
          mediaOpts,
          accountId: deps.accountId,
        }),
        emitProgress: async ({ text }: { text: string }) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          try {
            await lightweightReplyBudgeter.pushProgress(trimmed);
          } catch (progressErr) {
            logger.warn(
              `lightweight progress delivery failed backend=${backendAdapter.id} err=${String(progressErr)}`,
            );
          }
        },
      };
      const output = await backendAdapter.reply(
        lightweightInput,
      );
      const finalText = output && typeof output === "object" && "text" in output
        ? output.text
        : undefined;
      await lightweightReplyBudgeter.finish(finalText);
      return;
    }

    const rawBody = ctx.Body?.trim() ?? "";
    ctx.CommandBody = rawBody;
    const senderId = full.from_user_id ?? "";
    const { senderAllowedForCommands, commandAuthorized, directDmOutcome } =
      await resolveOpenClawAuthorization({
        config: deps.config,
        accountId: deps.accountId,
        rawBody,
        senderId,
        channelRuntime: deps.channelRuntime,
      });

    if (directDmOutcome === "disabled" || directDmOutcome === "unauthorized") {
      logger.info(
        `authorization: dropping message from=${senderId} outcome=${directDmOutcome}`,
      );
      return;
    }

    ctx.CommandAuthorized = commandAuthorized;
    logger.debug(
      `authorization: senderId=${senderId} commandAuthorized=${String(commandAuthorized)} senderAllowed=${String(senderAllowedForCommands)}`,
    );

    if (debug) {
      debugTrace.push(
        "── 鉴权 & 路由 ──",
        `│ auth: cmdAuthorized=${String(commandAuthorized)} senderAllowed=${String(senderAllowedForCommands)}`,
      );
    }

    const route = resolveOpenClawAgentRoute({
      channelRuntime: deps.channelRuntime,
      config: deps.config,
      accountId: deps.accountId,
      peerId: ctx.To,
    });
    logger.debug(
      `resolveAgentRoute: agentId=${route.agentId ?? "(none)"} sessionKey=${route.sessionKey ?? "(none)"} mainSessionKey=${route.mainSessionKey ?? "(none)"}`,
    );

    if (!route.agentId) {
      logger.error(
        `resolveAgentRoute: no agentId resolved for peer=${ctx.To} accountId=${deps.accountId} — message will not be dispatched`,
      );
    }

    if (debug) {
      debugTrace.push(`│ route: agent=${route.agentId ?? "none"} session=${route.sessionKey ?? "none"}`);
      debugTs.preDispatch = Date.now();
    }

    const { finalized, storePath } = finalizeOpenClawInboundContext({
      channelRuntime: deps.channelRuntime,
      config: deps.config,
      route,
      ctx,
    });

    logger.info(
      `inbound: from=${finalized.From} to=${finalized.To} bodyLen=${(finalized.Body ?? "").length} hasMedia=${Boolean(finalized.MediaPath ?? finalized.MediaUrl)}`,
    );
    logger.debug(`inbound context: ${redactBody(JSON.stringify(finalized))}`);

    await recordOpenClawInboundSession({
      channelRuntime: deps.channelRuntime,
      storePath,
      route,
      finalized,
      accountId: deps.accountId,
      to: ctx.To,
      errLog: deps.errLog,
    });
    logger.debug(
      `recordInboundSession: done storePath=${storePath} sessionKey=${route.sessionKey ?? "(none)"}`,
    );

    const typingCallbacks = createOpenClawTypingCallbacks(
      createWeixinTypingTransportConfig({
        baseUrl: deps.baseUrl,
        token: deps.token,
        to: ctx.To,
        typingTicket: deps.typingTicket,
        log: deps.log,
      }),
    );

    const replyDispatcher = createOpenClawReplyDispatcher({
      channelRuntime: deps.channelRuntime,
      config: deps.config,
      agentId: route.agentId,
      typingCallbacks,
      deliver: replyDeliverer,
      onError: replyErrorHandler,
    });
    markDispatchIdle = replyDispatcher.markDispatchIdle;

    await backendAdapter.dispatch({
      accountId: deps.accountId,
      backendContext: {
        config: deps.config,
        channelRuntime: deps.channelRuntime,
        agentId: route.agentId,
        finalized,
        dispatcher: replyDispatcher.dispatcher,
        replyOptions: replyDispatcher.replyOptions,
      },
    });
  } catch (err) {
    if (backendAdapter.mode === "lightweight") {
      replyErrorHandler(err, { kind: backendAdapter.id });
    } else {
      throw err;
    }
  } finally {
    markDispatchIdle();
    logger.info(
      `debug-check: accountId=${deps.accountId} debug=${String(debug)} hasContextToken=${Boolean(contextToken)} stateDir=${process.env.OPENCLAW_STATE_DIR ?? "(unset)"}`,
    );

    if (debug && contextToken) {
      const dispatchDoneAt = Date.now();
      const eventTs = full.create_time_ms ?? 0;
      const platformDelay = eventTs > 0 ? `${receivedAt - eventTs}ms` : "N/A";
      const inboundProcessMs = (debugTs.preDispatch ?? receivedAt) - receivedAt;
      const aiMs = dispatchDoneAt - (debugTs.preDispatch ?? receivedAt);
      const totalTime = eventTs > 0 ? `${dispatchDoneAt - eventTs}ms` : `${dispatchDoneAt - receivedAt}ms`;

      if (debugDeliveries.length > 0) {
        debugTrace.push("── 回复 ──");
        for (const d of debugDeliveries) {
          debugTrace.push(
            `│ textLen=${d.textLen} media=${d.media}`,
            `│ text="${d.preview}"`,
          );
        }
        const firstTs = debugDeliveries[0].ts;
        debugTrace.push(`│ deliver耗时: ${dispatchDoneAt - firstTs}ms`);
      } else {
        debugTrace.push("── 回复 ──", "│ (deliver未捕获)");
      }

      debugTrace.push(
        "── 耗时 ──",
        `├ 平台→插件: ${platformDelay}`,
        `├ 入站处理(auth+route+media): ${inboundProcessMs}ms (mediaDownload: ${mediaDownloadMs}ms)`,
        `├ AI生成+回复: ${aiMs}ms`,
        `├ 总耗时: ${totalTime}`,
        `└ eventTime: ${eventTs > 0 ? new Date(eventTs).toISOString() : "N/A"}`,
      );

      const timingText = `⏱ Debug 全链路\n${debugTrace.join("\n")}`;

      logger.info(`debug-timing: sending to=${ctx.To}`);
      try {
        await sendMessageWeixin({
          to: ctx.To,
          text: timingText,
          opts: { baseUrl: deps.baseUrl, token: deps.token, contextToken },
        });
        logger.info(`debug-timing: sent OK`);
      } catch (debugErr) {
        logger.error(`debug-timing: send FAILED err=${String(debugErr)}`);
      }
    }
  }
}
