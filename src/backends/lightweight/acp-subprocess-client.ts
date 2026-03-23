import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionId,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

import { getExtensionFromMime, getMimeFromFilename } from "../../media/mime.js";
import { logger } from "../../util/logger.js";
import type {
  WeixinLightweightBackendInput,
  WeixinLightweightBackendOutput,
  WeixinLightweightBackendProgress,
} from "../contracts.js";

type AcpPermissionMode = "auto" | "cancel";

type AcpConnectionState = {
  connection: ClientSideConnection;
  process: ChildProcessWithoutNullStreams;
};

type AcpImageData = {
  base64: string;
  mimeType: string;
};

type AcpSubprocessClientOptions = {
  backendId: string;
  backendLabel: string;
  defaultCommand: string;
  defaultArgs?: string[];
  commandEnvVarNames: string[];
  argsEnvVarNames?: string[];
  cwdEnvVarNames: string[];
  permissionModeEnvVarNames: string[];
  missingCommandHint: string;
  authRequiredHint: string;
  mediaOutDirName: string;
  cancelledMessage: string;
};

function isWindows(): boolean {
  return process.platform === "win32";
}

function normalizeProgressText(text: string): string | undefined {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return normalized || undefined;
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
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean);
}

function readFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function parseCommandArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escapeNext = false;

  for (const char of raw) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      if (char === "\\" && quote === '"') {
        escapeNext = true;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    if (char === "\\") {
      current += char;
      continue;
    }

    current += char;
  }

  if (escapeNext) {
    current += "\\";
  }
  if (current) {
    args.push(current);
  }

  return args;
}

function formatCommandForDisplay(command: string, args: string[]): string {
  if (!args.length) return command;
  return `${command} ${args.join(" ")}`;
}

function selectPermissionOption(options: PermissionOption[]): PermissionOption | undefined {
  const preferredKinds: PermissionOption["kind"][] = ["allow_once", "allow_always"];
  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) return option;
  }
  return options[0];
}

function normalizeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function countCodeFences(text: string): number {
  return (text.match(/```/g) ?? []).length;
}

function extractReadyMessageSegments(buffer: string): {
  rest: string;
  segments: string[];
} {
  if (!buffer.trim()) {
    return {
      rest: "",
      segments: [],
    };
  }
  if (countCodeFences(buffer) % 2 === 1) {
    return {
      rest: buffer,
      segments: [],
    };
  }

  const segments: string[] = [];
  const boundaryPattern = /\n{2,}|[。！？!?]|(?:\.(?=\s|$))/g;
  let lastIndex = 0;
  let match = boundaryPattern.exec(buffer);
  while (match) {
    const raw = buffer.slice(lastIndex, boundaryPattern.lastIndex);
    const normalized = normalizeProgressText(raw);
    if (normalized) {
      segments.push(normalized);
    }
    lastIndex = boundaryPattern.lastIndex;
    match = boundaryPattern.exec(buffer);
  }

  return {
    rest: buffer.slice(lastIndex),
    segments,
  };
}

function formatPlanProgress(update: Extract<SessionNotification["update"], { sessionUpdate: "plan" }>): string | undefined {
  const activeEntry = update.entries.find((entry) => entry.status === "in_progress")
    ?? update.entries.find((entry) => entry.status === "pending");
  return normalizeProgressText(activeEntry?.content ?? "");
}

class AcpResponseCollector {
  private imageData: AcpImageData | undefined;
  private lastPlanText: string | undefined;
  private lastProgressText: string | undefined;
  private messageBuffer = "";
  private progressTask = Promise.resolve();

  constructor(
    private readonly options: AcpSubprocessClientOptions,
    private readonly emitProgress?: WeixinLightweightBackendInput["emitProgress"],
  ) {}

  private queueProgress(progress: WeixinLightweightBackendProgress): void {
    if (!this.emitProgress) return;
    const text = normalizeProgressText(progress.text);
    if (!text) return;
    if (this.lastProgressText === text) return;
    this.lastProgressText = text;
    this.progressTask = this.progressTask
      .catch(() => {})
      .then(async () => {
        try {
          await this.emitProgress?.({
            ...progress,
            text,
          });
        } catch (err) {
          logger.warn(`${this.options.backendId}-acp progress emit failed kind=${progress.kind} err=${normalizeErrorMessage(err)}`);
        }
      });
  }

  handleUpdate(notification: SessionNotification): void {
    const { update } = notification;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") {
          if (!this.emitProgress) {
            this.messageBuffer += update.content.text;
            return;
          }
          this.messageBuffer += update.content.text;
          const { segments, rest } = extractReadyMessageSegments(this.messageBuffer);
          this.messageBuffer = rest;
          for (const segment of segments) {
            this.queueProgress({
              kind: "message",
              text: segment,
            });
          }
          return;
        }
        if (update.content.type === "image") {
          this.imageData = {
            base64: update.content.data,
            mimeType: update.content.mimeType,
          };
        }
        return;
      case "plan": {
        const planText = formatPlanProgress(update);
        if (!planText || planText === this.lastPlanText) return;
        this.lastPlanText = planText;
        this.queueProgress({
          kind: "plan",
          text: planText,
        });
        return;
      }
      case "tool_call":
      case "tool_call_update":
        return;
    }
  }

  async toOutput(stopReason?: string): Promise<WeixinLightweightBackendOutput | void> {
    await this.progressTask.catch(() => {});
    const text = normalizeProgressText(this.messageBuffer);
    const output: WeixinLightweightBackendOutput = {};

    if (text) {
      output.text = text;
    } else if (stopReason === "cancelled") {
      output.text = this.options.cancelledMessage;
    }

    if (this.imageData) {
      const mediaOutDir = path.join(os.tmpdir(), "weixin-agent-gateway", "media", this.options.mediaOutDirName);
      await fsp.mkdir(mediaOutDir, { recursive: true });
      const filePath = path.join(
        mediaOutDir,
        `${crypto.randomUUID()}${getExtensionFromMime(this.imageData.mimeType)}`,
      );
      await fsp.writeFile(filePath, Buffer.from(this.imageData.base64, "base64"));
      output.mediaUrl = filePath;
    }

    if (!output.text && !output.mediaUrl && !output.mediaUrls?.length) {
      return;
    }
    return output;
  }
}

export class AcpSubprocessLightweightClient {
  private connectionState: AcpConnectionState | undefined;
  private startupTask: Promise<AcpConnectionState> | undefined;
  private readonly sessions = new Map<string, SessionId>();
  private readonly collectors = new Map<SessionId, AcpResponseCollector>();
  private readonly conversationTasks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: AcpSubprocessClientOptions) {}

  private resolveCommand(): string {
    const raw = readFirstEnv(this.options.commandEnvVarNames) || this.options.defaultCommand;
    return resolveCommandPath(raw) ?? raw;
  }

  private resolveArgs(): string[] {
    const raw = readFirstEnv(this.options.argsEnvVarNames ?? []);
    if (raw) return parseCommandArgs(raw);
    return [...(this.options.defaultArgs ?? [])];
  }

  private assertCommandAvailable(command: string): void {
    if (resolveCommandPath(command)) return;
    throw new Error(
      `${this.options.backendLabel} ACP startup failed: executable "${command}" was not found. ${this.options.missingCommandHint}`,
    );
  }

  private resolveCwd(): string {
    const cwd = readFirstEnv(this.options.cwdEnvVarNames) || process.cwd();
    if (!fs.existsSync(cwd)) {
      throw new Error(`${this.options.backendLabel} ACP startup failed: working directory "${cwd}" does not exist.`);
    }
    return cwd;
  }

  private resolvePermissionMode(): AcpPermissionMode {
    const raw = readFirstEnv(this.options.permissionModeEnvVarNames) || "auto";
    return raw.toLowerCase() === "cancel" ? "cancel" : "auto";
  }

  private wrapError(err: unknown): Error {
    const message = normalizeErrorMessage(err);
    const lower = message.toLowerCase();
    if (lower.includes("auth_required") || lower.includes("authenticate")) {
      return new Error(this.options.authRequiredHint);
    }
    if (lower.includes("enoent") || lower.includes("spawn")) {
      return new Error(
        `${this.options.backendLabel} ACP startup failed. Ensure "${this.resolveCommand()}" is installed and available in PATH.`,
      );
    }
    return err instanceof Error ? err : new Error(message);
  }

  private createProcessLogger(proc: ChildProcessWithoutNullStreams): void {
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) {
        logger.debug(`${this.options.backendId}-acp stderr: ${message}`);
      }
    });
  }

  private createClientHandler(): (connection: ClientSideConnection) => {
    requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
    sessionUpdate: (params: SessionNotification) => Promise<void>;
  } {
    return () => ({
      requestPermission: async (params) => {
        const mode = this.resolvePermissionMode();
        const preferred = selectPermissionOption(params.options);
        const title = params.toolCall.title ?? params.toolCall.toolCallId;
        logger.info(
          `${this.options.backendId}-acp permission: session=${params.sessionId} tool=${title} mode=${mode} options=${params.options.map((option) => option.kind).join(",")}`,
        );
        if (mode === "cancel" || !preferred) {
          return {
            outcome: {
              outcome: "cancelled",
            },
          };
        }
        return {
          outcome: {
            outcome: "selected",
            optionId: preferred.optionId,
          },
        };
      },
      sessionUpdate: async (params) => {
        this.handleSessionUpdate(params);
      },
    });
  }

  private resetState(): void {
    this.connectionState = undefined;
    this.sessions.clear();
    this.collectors.clear();
  }

  private attachConnectionLifecycle(state: AcpConnectionState): void {
    state.process.on("exit", (code, signal) => {
      logger.warn(`${this.options.backendId}-acp: subprocess exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.resetState();
    });
    state.connection.closed
      .catch((err) => {
        logger.warn(`${this.options.backendId}-acp: connection closed with error err=${normalizeErrorMessage(err)}`);
      })
      .finally(() => {
        if (this.connectionState === state) {
          this.resetState();
        }
      });
  }

  private async ensureReady(): Promise<AcpConnectionState> {
    if (this.connectionState && !this.connectionState.connection.signal.aborted) {
      return this.connectionState;
    }
    if (!this.startupTask) {
      this.startupTask = (async () => {
        const command = this.resolveCommand();
        const args = this.resolveArgs();
        const cwd = this.resolveCwd();
        this.assertCommandAvailable(command);

        logger.info(
          `${this.options.backendId}-acp: initializing command=${formatCommandForDisplay(command, args)} cwd=${cwd}`,
        );
        const proc = spawn(command, args, {
          cwd,
          env: process.env,
          shell: isWindows(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        this.createProcessLogger(proc);

        const writable = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>;
        const readable = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>;
        const stream = ndJsonStream(writable, readable);
        const connection = new ClientSideConnection(this.createClientHandler(), stream);
        const state: AcpConnectionState = {
          connection,
          process: proc,
        };

        const initialized = await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: {
            name: "weixin-agent-gateway",
            version: "1.0.2",
          },
          clientCapabilities: {},
        });

        this.attachConnectionLifecycle(state);
        this.connectionState = state;
        if (initialized.authMethods?.length) {
          logger.info(
            `${this.options.backendId}-acp: agent advertised auth methods=${initialized.authMethods.map((method) => method.id).join(",")}`,
          );
        }
        logger.info(`${this.options.backendId}-acp: initialized`);
        return state;
      })()
        .catch((err) => {
          this.resetState();
          throw this.wrapError(err);
        })
        .finally(() => {
          this.startupTask = undefined;
        });
    }
    return this.startupTask;
  }

  private async buildPromptBlocks(input: WeixinLightweightBackendInput): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [];
    const text = input.text.trim();
    if (text) {
      blocks.push({ type: "text", text });
    }

    for (const imagePath of input.imagePaths) {
      const data = await fsp.readFile(imagePath);
      blocks.push({
        type: "image",
        data: data.toString("base64"),
        mimeType: getMimeFromFilename(imagePath),
      });
    }

    if (blocks.length === 0) {
      blocks.push({ type: "text", text: "The user sent an empty message." });
    }

    return blocks;
  }

  handleSessionUpdate(notification: SessionNotification): void {
    const collector = this.collectors.get(notification.sessionId);
    if (!collector) return;
    collector.handleUpdate(notification);
  }

  private async getOrCreateSession(
    conversationKey: string,
    connection: ClientSideConnection,
  ): Promise<SessionId> {
    const existing = this.sessions.get(conversationKey);
    if (existing) return existing;

    const response = await connection.newSession({
      cwd: this.resolveCwd(),
      mcpServers: [],
    });
    this.sessions.set(conversationKey, response.sessionId);
    logger.info(`${this.options.backendId}-acp: created session conversation=${conversationKey} session=${response.sessionId}`);
    return response.sessionId;
  }

  private async enqueueConversation<T>(conversationKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.conversationTasks.get(conversationKey) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(task);
    this.conversationTasks.set(conversationKey, current);
    try {
      return await current;
    } finally {
      if (this.conversationTasks.get(conversationKey) === current) {
        this.conversationTasks.delete(conversationKey);
      }
    }
  }

  async runLightweightConversation(
    input: WeixinLightweightBackendInput,
  ): Promise<WeixinLightweightBackendOutput | void> {
    const conversationKey = `${input.accountId}:${input.peerId}`;
    return this.enqueueConversation(conversationKey, async () => {
      const state = await this.ensureReady();
      const sessionId = await this.getOrCreateSession(conversationKey, state.connection);
      const blocks = await this.buildPromptBlocks(input);
      const collector = new AcpResponseCollector(this.options, input.emitProgress);
      this.collectors.set(sessionId, collector);
      try {
        const response = await state.connection.prompt({
          sessionId,
          prompt: blocks,
        });
        return collector.toOutput(response.stopReason);
      } catch (err) {
        throw this.wrapError(err);
      } finally {
        this.collectors.delete(sessionId);
      }
    });
  }

  dispose(): void {
    const state = this.connectionState;
    this.resetState();
    try {
      state?.process.kill();
    } catch {
      // Best effort cleanup only.
    }
  }
}
