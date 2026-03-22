import path from "node:path";

import {
  WEIXIN_BACKEND_LABELS,
  isWeixinBackendId,
} from "../../../backends/contracts.js";
import { downloadRemoteImageToTemp } from "../../../cdn/upload.js";
import { sendWeixinMediaFile } from "../../../messaging/send-media.js";
import { markdownToPlainText, sendMessageWeixin } from "../../../messaging/send.js";
import { sendWeixinErrorNotice } from "../../../messaging/error-notice.js";
import { logger } from "../../../util/logger.js";
import { redactBody, redactToken } from "../../../util/redact.js";

export type WeixinReplyPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

export type WeixinDebugDeliveryRecord = {
  textLen: number;
  media: string;
  preview: string;
  ts: number;
};

export function createWeixinReplyDeliverer(params: {
  to: string;
  baseUrl: string;
  token?: string;
  contextToken?: string;
  cdnBaseUrl: string;
  mediaOutboundTempDir: string;
  debug: boolean;
  debugDeliveries: WeixinDebugDeliveryRecord[];
}): (payload: WeixinReplyPayload) => Promise<void> {
  return async (payload) => {
    const text = markdownToPlainText(payload.text ?? "");
    const mediaUrl = payload.mediaUrl ?? payload.mediaUrls?.[0];
    logger.debug(`outbound payload: ${redactBody(JSON.stringify(payload))}`);
    logger.info(
      `outbound: to=${params.to} contextToken=${redactToken(params.contextToken)} textLen=${text.length} mediaUrl=${mediaUrl ? "present" : "none"}`,
    );

    if (params.debug) {
      params.debugDeliveries.push({
        textLen: text.length,
        media: mediaUrl ? "present" : "none",
        preview: `${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`,
        ts: Date.now(),
      });
    }

    try {
      if (mediaUrl) {
        let filePath: string;
        if (!mediaUrl.includes("://") || mediaUrl.startsWith("file://")) {
          if (mediaUrl.startsWith("file://")) {
            filePath = new URL(mediaUrl).pathname;
          } else if (!path.isAbsolute(mediaUrl)) {
            filePath = path.resolve(mediaUrl);
            logger.debug(`outbound: resolved relative path ${mediaUrl} -> ${filePath}`);
          } else {
            filePath = mediaUrl;
          }
          logger.debug(`outbound: local file path resolved filePath=${filePath}`);
        } else if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
          logger.debug(`outbound: downloading remote mediaUrl=${mediaUrl.slice(0, 80)}...`);
          filePath = await downloadRemoteImageToTemp(mediaUrl, params.mediaOutboundTempDir);
          logger.debug(`outbound: remote image downloaded to filePath=${filePath}`);
        } else {
          logger.warn(
            `outbound: unrecognized mediaUrl scheme, sending text only mediaUrl=${mediaUrl.slice(0, 80)}`,
          );
          await sendMessageWeixin({
            to: params.to,
            text,
            opts: {
              baseUrl: params.baseUrl,
              token: params.token,
              contextToken: params.contextToken,
            },
          });
          logger.info(`outbound: text sent to=${params.to}`);
          return;
        }
        await sendWeixinMediaFile({
          filePath,
          to: params.to,
          text,
          opts: { baseUrl: params.baseUrl, token: params.token, contextToken: params.contextToken },
          cdnBaseUrl: params.cdnBaseUrl,
        });
        logger.info(`outbound: media sent OK to=${params.to}`);
      } else {
        logger.debug(`outbound: sending text message to=${params.to}`);
        await sendMessageWeixin({
          to: params.to,
          text,
          opts: {
            baseUrl: params.baseUrl,
            token: params.token,
            contextToken: params.contextToken,
          },
        });
        logger.info(`outbound: text sent OK to=${params.to}`);
      }
    } catch (err) {
      logger.error(
        `outbound: FAILED to=${params.to} mediaUrl=${mediaUrl ?? "none"} err=${String(err)} stack=${(err as Error).stack ?? ""}`,
      );
      throw err;
    }
  };
}

export function createWeixinReplyErrorHandler(params: {
  to: string;
  contextToken?: string;
  baseUrl: string;
  token?: string;
  errLog: (message: string) => void;
}): (err: unknown, info: { kind: string }) => void {
  return (err, info) => {
    params.errLog(`weixin reply ${info.kind}: ${String(err)}`);
    const errMsg = err instanceof Error ? err.message : String(err);
    const lowerErrMsg = errMsg.toLowerCase();
    let notice: string;
    if (errMsg.includes("contextToken is required")) {
      logger.warn(`onError: contextToken missing, cannot send error notice to=${params.to}`);
      return;
    }
    const isKnownBackend = isWeixinBackendId(info.kind);
    if (
      (isKnownBackend && info.kind !== "openclaw") ||
      lowerErrMsg.includes("agentapi") ||
      lowerErrMsg.includes("get /status") ||
      lowerErrMsg.includes("get /messages") ||
      lowerErrMsg.includes("post /message") ||
      lowerErrMsg.includes("post /upload")
    ) {
      const backendLabel = isKnownBackend ? WEIXIN_BACKEND_LABELS[info.kind] : "Agent";
      notice = `⚠️ ${backendLabel} 后端连接失败，请检查 agentapi 和对应命令是否可用，或 AgentAPI 地址配置是否正确。`;
    } else if (errMsg.includes("remote media download failed") || errMsg.includes("fetch")) {
      notice = "⚠️ 媒体文件下载失败，请检查链接是否可访问。";
    } else if (
      errMsg.includes("getUploadUrl") ||
      errMsg.includes("CDN upload") ||
      errMsg.includes("upload_param")
    ) {
      notice = "⚠️ 媒体文件上传失败，请稍后重试。";
    } else {
      notice = `⚠️ 消息发送失败：${errMsg}`;
    }
    void sendWeixinErrorNotice({
      to: params.to,
      contextToken: params.contextToken,
      message: notice,
      baseUrl: params.baseUrl,
      token: params.token,
      errLog: params.errLog,
    });
  };
}
