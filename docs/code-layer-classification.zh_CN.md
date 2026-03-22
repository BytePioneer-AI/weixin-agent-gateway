# 代码分层清单

## 1. 目的

这份清单用于回答两个问题：

- 当前项目中，哪些代码属于“微信接入公共能力层”
- 哪些代码属于“后端能力层”

同时补充两类容易混淆、但应单独看待的代码：

- 路由 / 编排层
- OpenClaw 宿主 / 插件层

## 2. 分层定义

### 2.1 公共接入层

职责：

- 与微信 `ilink` 网关通信
- 扫码登录
- 长轮询收消息
- 发送文本和媒体
- 下载、解密、上传媒体
- 管理 `context_token`

边界：

- 不应感知 OpenClaw / Codex / Claude 等具体后端
- 不应直接依赖 OpenClaw 的 session、route、reply dispatcher

### 2.2 后端能力层

职责：

- 将规范化后的入站消息交给某个 backend
- 处理 backend 特有的鉴权、路由、session、上下文和回复生成

边界：

- 可以依赖具体后端 SDK 或 runtime
- 不应直接操作微信 HTTP API

### 2.3 路由 / 编排层

职责：

- 识别后端切换命令
- 保存当前会话选中的 backend
- 根据会话状态选择 backend adapter

边界：

- 不属于 transport
- 也不属于某一个 backend

### 2.4 宿主 / 插件层

职责：

- 把当前项目挂到 OpenClaw 插件体系
- 注册 channel、CLI、配置 schema

边界：

- 这是“当前项目作为 OpenClaw 插件”的壳层
- 不是微信接入内核，也不是后端能力本身

### 2.5 混合待拆层

职责：

- 当前同时承担了 transport、routing、OpenClaw 后端调用等多类职责

边界：

- 这类文件是后续重构的重点

## 3. 当前代码归类

## 3.1 公共接入层

这些文件总体上属于微信 transport 公共能力层：

- [src/api/api.ts](/d:/work/code/openclaw-weixin/src/api/api.ts)
- [src/api/types.ts](/d:/work/code/openclaw-weixin/src/api/types.ts)
- [src/api/config-cache.ts](/d:/work/code/openclaw-weixin/src/api/config-cache.ts)
- [src/api/session-guard.ts](/d:/work/code/openclaw-weixin/src/api/session-guard.ts)
- [src/auth/login-qr.ts](/d:/work/code/openclaw-weixin/src/auth/login-qr.ts)
- [src/cdn/aes-ecb.ts](/d:/work/code/openclaw-weixin/src/cdn/aes-ecb.ts)
- [src/cdn/cdn-upload.ts](/d:/work/code/openclaw-weixin/src/cdn/cdn-upload.ts)
- [src/cdn/cdn-url.ts](/d:/work/code/openclaw-weixin/src/cdn/cdn-url.ts)
- [src/cdn/pic-decrypt.ts](/d:/work/code/openclaw-weixin/src/cdn/pic-decrypt.ts)
- [src/cdn/upload.ts](/d:/work/code/openclaw-weixin/src/cdn/upload.ts)
- [src/media/media-download.ts](/d:/work/code/openclaw-weixin/src/media/media-download.ts)
- [src/media/mime.ts](/d:/work/code/openclaw-weixin/src/media/mime.ts)
- [src/media/silk-transcode.ts](/d:/work/code/openclaw-weixin/src/media/silk-transcode.ts)
- [src/storage/state-dir.ts](/d:/work/code/openclaw-weixin/src/storage/state-dir.ts)
- [src/storage/sync-buf.ts](/d:/work/code/openclaw-weixin/src/storage/sync-buf.ts)
- [src/util/logger.ts](/d:/work/code/openclaw-weixin/src/util/logger.ts)
- [src/util/random.ts](/d:/work/code/openclaw-weixin/src/util/random.ts)
- [src/util/redact.ts](/d:/work/code/openclaw-weixin/src/util/redact.ts)
- [src/messaging/error-notice.ts](/d:/work/code/openclaw-weixin/src/messaging/error-notice.ts)
- [src/messaging/send-media.ts](/d:/work/code/openclaw-weixin/src/messaging/send-media.ts)

### 说明

- 这些文件大多只关注微信 API、媒体、状态目录或通用工具
- 即使其中个别函数名带有 `Weixin`，其本质仍是 transport 侧能力

## 3.2 公共接入层，但还未完全去 OpenClaw 耦合

这些文件本质仍应归入公共接入层，但当前还带有 OpenClaw 相关依赖：

- [src/auth/accounts.ts](/d:/work/code/openclaw-weixin/src/auth/accounts.ts)
- [src/messaging/send.ts](/d:/work/code/openclaw-weixin/src/messaging/send.ts)
- [src/messaging/inbound.ts](/d:/work/code/openclaw-weixin/src/messaging/inbound.ts)

### 原因

[src/auth/accounts.ts](/d:/work/code/openclaw-weixin/src/auth/accounts.ts)
- 本质上是微信账号、token、baseUrl 的存储与解析
- 但依赖了 `OpenClawConfig` 和 `normalizeAccountId`

[src/messaging/send.ts](/d:/work/code/openclaw-weixin/src/messaging/send.ts)
- 本质上是微信文本/媒体消息发送
- 但依赖了 `ReplyPayload` 和 `stripMarkdown`

[src/messaging/inbound.ts](/d:/work/code/openclaw-weixin/src/messaging/inbound.ts)
- 本质上是在入站消息和内部上下文之间转换
- 但当前上下文形状明显偏向 OpenClaw `MsgContext`

## 3.3 后端能力层

这些文件属于后端能力层：

- [src/backends/contracts.ts](/d:/work/code/openclaw-weixin/src/backends/contracts.ts)
- [src/backends/registry.ts](/d:/work/code/openclaw-weixin/src/backends/registry.ts)
- [src/backends/openclaw/adapter.ts](/d:/work/code/openclaw-weixin/src/backends/openclaw/adapter.ts)

### 当前状态

目前后端层已经建立了结构，已接入 `openclaw` 以及多种 `lightweight` backend。

[src/backends/openclaw/adapter.ts](/d:/work/code/openclaw-weixin/src/backends/openclaw/adapter.ts)
- 现在只封装了 OpenClaw 的最终 dispatch
- 还没有收拢 OpenClaw 的 routing、session、authorization、reply dispatcher 等逻辑

## 3.4 路由 / 编排层

这些文件不属于公共接入层，也不属于具体 backend：

- [src/router/backend-router.ts](/d:/work/code/openclaw-weixin/src/router/backend-router.ts)
- [src/router/backend-selection.ts](/d:/work/code/openclaw-weixin/src/router/backend-selection.ts)
- [src/messaging/slash-commands.ts](/d:/work/code/openclaw-weixin/src/messaging/slash-commands.ts)

### 说明

- 这一层的职责是“选择后端”
- 不应该下沉到微信 transport
- 也不应该塞进 `src/backends/openclaw/`

## 3.5 OpenClaw 宿主 / 插件层

这些文件属于“当前项目作为 OpenClaw 插件存在”的宿主层：

- [index.ts](/d:/work/code/openclaw-weixin/index.ts)
- [openclaw.plugin.json](/d:/work/code/openclaw-weixin/openclaw.plugin.json)
- [src/channel.ts](/d:/work/code/openclaw-weixin/src/channel.ts)
- [src/runtime.ts](/d:/work/code/openclaw-weixin/src/runtime.ts)
- [src/log-upload.ts](/d:/work/code/openclaw-weixin/src/log-upload.ts)
- [src/config/config-schema.ts](/d:/work/code/openclaw-weixin/src/config/config-schema.ts)

### 说明

- 这层是为了适配 OpenClaw 插件系统
- 它不是 transport 核心
- 也不是你们未来“多后端平级架构”的核心

## 3.6 混合待拆层

以下文件目前是最典型的混合层：

- [src/monitor/monitor.ts](/d:/work/code/openclaw-weixin/src/monitor/monitor.ts)
- [src/messaging/process-message.ts](/d:/work/code/openclaw-weixin/src/messaging/process-message.ts)
- [src/auth/pairing.ts](/d:/work/code/openclaw-weixin/src/auth/pairing.ts)

### [src/monitor/monitor.ts](/d:/work/code/openclaw-weixin/src/monitor/monitor.ts)

同时承担了：

- 微信 `getupdates` 长轮询
- 微信 `get_updates_buf` 同步点维护
- 把入站消息送入当前消息处理主链路
- 持有 OpenClaw runtime

结论：

- 它本质应拆成 transport monitor 和上层 dispatcher 两部分

### [src/messaging/process-message.ts](/d:/work/code/openclaw-weixin/src/messaging/process-message.ts)

这是当前项目里职责最重、耦合最深的文件。

它同时承担了：

- 微信消息解析
- 微信媒体下载
- 微信 typing
- OpenClaw command authorization
- OpenClaw DM authorization
- OpenClaw route 解析
- OpenClaw session 记录
- OpenClaw inbound context finalize
- backend router 调用
- 微信回复发送

结论：

- 它不是纯 transport
- 也不是纯 backend
- 它是当前重构的核心拆解对象

### [src/auth/pairing.ts](/d:/work/code/openclaw-weixin/src/auth/pairing.ts)

本质是在操作 OpenClaw 的 allowFrom / pairing store。

结论：

- 它不属于微信公共接入层
- 更接近 OpenClaw backend / 宿主兼容层

## 4. 当前残留在混合层中的 OpenClaw 后端代码

以下逻辑虽然还写在 [src/messaging/process-message.ts](/d:/work/code/openclaw-weixin/src/messaging/process-message.ts) 中，但从分层角度看，已经属于 OpenClaw 后端能力层：

- `resolveSenderCommandAuthorizationWithRuntime(...)`
- `resolveDirectDmAuthorizationOutcome(...)`
- `resolveAgentRoute(...)`
- `finalizeInboundContext(...)`
- `recordInboundSession(...)`
- `resolveHumanDelayConfig(...)`
- `createReplyDispatcherWithTyping(...)`

这部分后续应逐步迁入：

```text
src/backends/openclaw/
  adapter.ts
  auth.ts
  routing.ts
  session.ts
  context.ts
  reply-dispatch.ts
```

## 5. 建议的最终分层目录

```text
src/
  transport/
    weixin/
      api/
      auth/
      cdn/
      media/
      inbound/
      outbound/
      monitor/
  router/
    backend-router.ts
    backend-selection.ts
    slash-commands.ts
  backends/
    contracts.ts
    registry.ts
    openclaw/
      adapter.ts
      auth.ts
      routing.ts
      session.ts
      context.ts
      reply-dispatch.ts
    codex/
    claude/
    opencode/
    copilot/
    auggie/
    cursor/
  host/
    openclaw/
      plugin-entry.ts
      channel.ts
      runtime.ts
      cli.ts
```

## 6. 文件迁移优先级

### 第一优先级

- 继续拆 [src/messaging/process-message.ts](/d:/work/code/openclaw-weixin/src/messaging/process-message.ts)

目标：

- 把 OpenClaw-specific 逻辑继续迁到 `src/backends/openclaw/`
- 把微信消息处理主链路压缩成 transport + router

### 第二优先级

- 继续拆 [src/monitor/monitor.ts](/d:/work/code/openclaw-weixin/src/monitor/monitor.ts)

目标：

- 让 monitor 只负责微信长轮询和事件投递

### 第三优先级

- 去 OpenClaw 化 [src/auth/accounts.ts](/d:/work/code/openclaw-weixin/src/auth/accounts.ts)
- 去 OpenClaw 化 [src/messaging/send.ts](/d:/work/code/openclaw-weixin/src/messaging/send.ts)
- 重新定义 [src/messaging/inbound.ts](/d:/work/code/openclaw-weixin/src/messaging/inbound.ts) 的内部上下文

## 7. 结论

当前项目不是简单的“两层结构”，而是四层混在一起：

- 微信公共接入层
- 后端能力层
- 路由编排层
- OpenClaw 宿主层

再加上一批尚未拆开的混合层。

如果后续目标是“微信入口 + OpenClaw/Codex/Claude/Opencode/Copilot/Auggie/Cursor 平级后端”，那么重构方向应该是：

- 保留并沉淀公共接入层
- 持续把 OpenClaw-specific 逻辑抽进 `src/backends/openclaw/`
- 保持 router 独立
- 最后把 OpenClaw 宿主层削薄为一个兼容壳
