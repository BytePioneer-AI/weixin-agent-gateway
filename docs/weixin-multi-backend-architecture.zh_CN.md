# 微信多后端网关设计文档

## 1. 背景

当前官方 `openclaw-weixin` 插件的定位是：

- 负责微信登录、长轮询、消息发送、媒体上传下载
- 在插件内部直接把入站消息送入 OpenClaw 回复链路

这对“微信 -> OpenClaw”场景是合适的，但不适合下面这种目标架构：

- 微信只是入口
- OpenClaw、Codex、Claude Code、Opencode、GitHub Copilot、Auggie、Cursor CLI 是平级后端
- 上层统一做会话路由、命令切换、权限和状态管理

本设计的核心结论是：

- 保留并复用官方插件的“微信接入能力”
- 去掉它对 OpenClaw 运行时的强耦合
- 在其上方建立一个独立的多后端路由层

## 2. 目标

- 将“微信接入层”与“AI 后端层”解耦
- 让 OpenClaw、Codex、Claude Code、Opencode、GitHub Copilot、Auggie、Cursor CLI 成为平级后端
- 支持通过命令切换当前会话后端，例如 `/openclaw`、`/codex`、`/claude`、`/opencode`、`/copilot`、`/auggie`、`/cursor`
- 最大化复用官方 `openclaw-weixin` 的 transport 实现
- 将未来跟进官方更新的成本限制在微信 transport 层

## 3. 非目标

- 不做 OpenClaw 内部的伴生插件方案
- 不依赖 `@tencent-weixin/openclaw-weixin-cli` 作为运行时库
- 不要求与官方插件在包结构或插件 API 层完全兼容
- 不在第一阶段支持所有 OpenClaw 内建命令和所有 Codex/Claude CLI 交互特性

## 4. 设计原则

### 4.1 分层清晰

- 微信 transport 只负责连接微信
- 路由层只负责决定消息发往哪个后端
- 后端适配层只负责调用 OpenClaw / Codex / Claude Code

### 4.2 上游同步可控

- 只跟踪官方插件中与微信 transport 强相关的文件
- 不复用官方插件内部的 OpenClaw 分发逻辑
- 给 transport 层定义稳定的内部接口，隔离上层业务

### 4.3 上层统一

- 所有后端都遵循统一的 `BackendAdapter` 接口
- 命令切换、会话状态、权限控制由统一路由层负责

## 5. 总体架构

```text
                +----------------------+
                |      Weixin App      |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |  Weixin Transport    |
                |  - QR login          |
                |  - getupdates        |
                |  - sendmessage       |
                |  - media upload      |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |    Session Router    |
                |  - parse commands    |
                |  - choose backend    |
                |  - store state       |
                +----+-----------+-----+
                     |           |
         +-----------+           +------------------+
         |                                          |
         v                                          v
+------------------+                     +------------------+
| OpenClaw Adapter |                     |  Codex Adapter   |
| - HTTP / RPC     |                     | - service / CLI  |
+------------------+                     +------------------+
         |
         |                     +------------------+
         +-------------------->| Claude Adapter   |
                               | - service / CLI  |
                               +------------------+

```

### 5.1 必须拆分的原因

本项目必须把“微信接入”和“后端对接”拆成两个独立层次。

原因不是代码风格，而是架构目标决定的：

- 微信接入层的职责是连接微信，只关心登录、轮询、发送、媒体和 `context_token`
- 后端对接层的职责是连接 OpenClaw、Codex、Claude Code、Opencode、GitHub Copilot、Auggie、Cursor CLI，只关心路由、会话状态和后端调用
- 如果两者不拆开，微信入口就会被某一个后端实现绑死
- 一旦未来新增后端，或者替换 OpenClaw 的接入方式，改动会扩散到微信 transport 核心
- 与官方微信插件同步时，也会因为混入业务逻辑导致同步成本急剧上升

一句话定义：

- 微信接入层是“入口能力”
- OpenClaw / Codex / Claude Code 对接层是“后端能力”

这两类能力必须分层，而不能混在一个运行时对象里。

### 5.2 拆分前 / 拆分后

拆分前：

```text
Weixin
  -> openclaw-weixin plugin
     -> OpenClaw runtime
        -> OpenClaw backend
```

特点：

- 微信入口直接依附在 OpenClaw 插件体系内
- OpenClaw 既是宿主又是默认后端
- 很难把 Codex、Claude Code 放到真正平级的位置

拆分后：

```text
Weixin
  -> Weixin Transport
     -> Session Router
        -> OpenClaw Adapter
        -> Codex Adapter
        -> Claude Adapter
```

特点：

- 微信 transport 只负责接入微信
- Session Router 只负责会话选择和命令切换
- OpenClaw、Codex、Claude Code、Opencode、GitHub Copilot、Auggie、Cursor CLI 都只是平级 backend
- 后续新增 backend 不需要改微信 transport

### 5.3 拆分边界

应归入“微信接入层”的能力：

- 扫码登录
- 获取和保存 `bot_token`
- 长轮询 `getupdates`
- 发送 `sendmessage`
- 媒体上传下载
- `context_token` 读写

应归入“后端对接层”的能力：

- `/openclaw`、`/codex`、`/claude`、`/opencode`、`/copilot`、`/auggie`、`/cursor` 命令解析
- 当前会话 backend 选择
- OpenClaw / Codex / Claude Code 适配
- 长任务状态管理
- 输出摘要、分段和错误提示

边界规则：

- 微信接入层不能感知 OpenClaw 内部 session / agent 细节
- 后端对接层不能直接操作微信 HTTP API
- 两层之间只通过规范化的入站/出站消息结构交互

## 6. 关键模块划分

### 6.1 Weixin Transport Core

职责：

- 扫码登录
- 保存 `bot_token`、`ilink_bot_id`、`baseUrl`
- 长轮询 `getupdates`
- 发送文本、图片、文件
- 管理 `context_token`

建议直接复用或轻度改造的官方模块：

- `src/auth/login-qr.ts`
- `src/auth/accounts.ts`
- `src/api/api.ts`
- `src/api/types.ts`
- `src/monitor/monitor.ts`
- `src/messaging/inbound.ts`
- `src/messaging/send.ts`
- `src/messaging/send-media.ts`
- `src/cdn/upload.ts`
- `src/media/media-download.ts`

### 6.2 Session Router

职责：

- 识别斜杠命令
- 维护会话当前 backend
- 对普通消息做路由
- 在回复前做统一格式化、分段、错误处理

职责边界：

- 不直接操作微信 API
- 不直接依赖 OpenClaw 插件运行时
- 不持有任何微信鉴权和发送实现

### 6.3 Backend Adapters

每个 backend 都是同级实现：

- `OpenClawAdapter`
- `CodexAdapter`
- `ClaudeCodeAdapter`

统一接口建议：

```ts
export interface BackendAdapter {
  id: string;
  send(input: BackendInput): Promise<BackendOutput>;
  reset?(session: SessionRef): Promise<void>;
  interrupt?(session: SessionRef): Promise<void>;
  supportsStreaming?: boolean;
}
```

### 6.4 State Store

至少维护以下状态：

- `account_store`
- `context_token_store`
- `backend_selection_store`
- `conversation_state_store`
- `job_store`

其中：

- `context_token` 需要按 `accountId + peerId` 快速查找
- `backend_selection` 需要按“微信会话”维度存储
- 长任务需要单独 job 状态，避免路由层阻塞

## 7. 与官方插件的边界

### 7.1 应保留的能力

- 微信登录流程
- 请求头和鉴权规则
- `getupdates` / `sendmessage` / `getuploadurl`
- CDN 上传下载和媒体解密
- `context_token` 回传机制

### 7.2 应移除的 OpenClaw 耦合

以下模块不应作为核心依赖保留：

- `index.ts`
- `src/channel.ts`
- `src/runtime.ts`
- `src/messaging/process-message.ts`

原因：

- 这些文件的职责是把 transport 挂接进 OpenClaw 插件体系
- 不是微信接入本身的必要组成部分

### 7.3 不建议依赖官方 CLI 包

`@tencent-weixin/openclaw-weixin-cli` 是安装器，不是运行时 SDK。

它适合：

- 安装官方插件
- 扫码登录
- 重启 OpenClaw Gateway

它不适合：

- 作为上层网关内部依赖
- 在运行时动态装载微信 transport 能力

## 8. 建议目录结构

建议新项目结构如下：

```text
src/
  app/
    main.ts
    bootstrap.ts
  transport/
    weixin/
      auth/
      api/
      cdn/
      media/
      monitor/
      inbound/
      outbound/
      account-store.ts
      context-token-store.ts
      transport.ts
  router/
    command-parser.ts
    router.ts
    session-selection.ts
    reply-policy.ts
  backends/
    contracts.ts
    openclaw/
      adapter.ts
      client.ts
    codex/
      adapter.ts
      client.ts
    claude/
      adapter.ts
      client.ts
    opencode/
      adapter.ts
      client.ts
    copilot/
      adapter.ts
      client.ts
    auggie/
      adapter.ts
      client.ts
    cursor/
      adapter.ts
      client.ts
  state/
    kv.ts
    sessions.ts
    jobs.ts
  ops/
    logging.ts
    metrics.ts
    health.ts
```

## 9. 核心数据模型

### 9.1 入站消息

```ts
type InboundEnvelope = {
  channel: "weixin";
  accountId: string;
  peerId: string;
  senderId: string;
  messageId: string;
  contextToken: string;
  text?: string;
  media?: MediaRef[];
  timestamp: number;
};
```

### 9.2 会话选择

```ts
type BackendSelection = {
  channel: "weixin";
  accountId: string;
  peerId: string;
  backend: "openclaw" | "codex" | "claude" | "opencode" | "copilot" | "auggie" | "cursor";
  updatedAt: number;
};
```

### 9.3 出站消息

```ts
type OutboundEnvelope = {
  channel: "weixin";
  accountId: string;
  peerId: string;
  contextToken: string;
  text?: string;
  media?: MediaUpload[];
};
```

## 10. 关键时序

### 10.1 登录时序

```text
Operator -> Weixin Transport: start login
Weixin Transport -> ILINK: get_bot_qrcode
Operator -> Weixin App: scan QR
Weixin Transport -> ILINK: get_qrcode_status
ILINK -> Weixin Transport: bot_token / bot_id / user_id / baseurl
Weixin Transport -> State Store: save account
```

### 10.2 普通消息时序

```text
Weixin -> Transport: inbound update
Transport -> Router: normalized inbound envelope
Router -> State Store: load backend selection
Router -> Adapter: dispatch message
Adapter -> Router: backend output
Router -> Transport: outbound envelope
Transport -> Weixin: sendmessage
```

### 10.3 命令切换时序

```text
User -> Weixin: /codex（或 /claude /opencode /copilot /auggie /cursor）
Weixin -> Transport: inbound update
Transport -> Router: command envelope
Router -> State Store: set backend = codex
Router -> Transport: ack message
Transport -> Weixin: sendmessage
```

## 11. 核心约束

### 11.1 `context_token` 是强约束

当前微信链路要求回复必须带回 `context_token`。

这意味着：

- transport 必须缓存最近一次入站消息的 `context_token`
- 长任务回包必须仍然能拿到有效 token
- 进程重启后，未完成任务可能无法继续原会话回包

### 11.2 微信接口不是公开标准协议

风险：

- 上游接口可能变化
- 鉴权头、上传流程、字段结构可能调整
- 需要持续跟踪官方插件更新

### 11.3 CLI 后端不适合作为第一层直接依赖

如果直接调用 `codex` 或 `claude code` CLI：

- 交互式审批难以映射到微信
- 长日志输出需要摘要或分块
- 子进程崩溃恢复较难

建议：

- 用 sidecar service 包装 CLI
- 上层只调用稳定 API

## 12. 与官方更新同步策略

### 12.1 上游镜像边界

把官方仓库中的代码分成两类：

- `transport-upstream`
- `app-local`

其中：

- `transport-upstream` 允许定期同步
- `app-local` 只维护本地业务逻辑

### 12.2 同步清单

优先跟踪：

- `src/auth/*`
- `src/api/*`
- `src/cdn/*`
- `src/media/*`
- `src/monitor/*`
- `src/messaging/inbound.ts`
- `src/messaging/send.ts`
- `src/messaging/send-media.ts`

默认不跟踪：

- `index.ts`
- `src/channel.ts`
- `src/runtime.ts`
- `src/messaging/process-message.ts`

### 12.3 同步方式

建议：

- 将官方插件作为上游源仓库
- 对 transport 目录做定期 diff
- 每次同步后跑一组 transport 回归测试

回归测试至少覆盖：

- 登录成功
- getupdates 正常取回消息
- 文本发送成功
- 图片发送成功
- 上游字段变化时的兼容告警

## 13. 部署建议

### 13.1 进程划分

建议至少拆为两个进程：

- `weixin-gateway`
- `backend-workers`

好处：

- 微信轮询与后端执行隔离
- 某个后端故障不会直接拖死 transport
- CLI 类型后端可以单独限流和沙箱化

### 13.2 存储

建议：

- 账号和配置用持久化 KV
- `context_token` 用内存 + 可选短期持久化
- 会话 backend 选择必须持久化

### 13.3 观测

至少记录：

- 微信 API 错误率
- 登录状态
- 每 backend 的调用时延和失败率
- 命令切换成功率
- 因 `context_token` 丢失导致的发送失败

## 14. 实施阶段

### Phase 1：抽出微信 transport

- 复制官方 transport 相关模块
- 去掉 OpenClaw plugin 注册和回复分发
- 建立统一 `Transport` 接口

### Phase 2：接 OpenClaw backend

- 先只接 OpenClaw
- 验证 transport 与 router 边界
- 验证 `context_token` 生命周期

### Phase 3：接 Codex / Claude / Opencode / Copilot / Auggie / Cursor

- 通过 service adapter 接入
- 加上 `/codex`、`/claude`、`/opencode`、`/copilot`、`/auggie`、`/cursor`、`/openclaw`
- 实现按会话切换

### Phase 4：增强运维能力

- 健康检查
- 指标和告警
- 异常恢复
- 自动化上游同步检查

## 15. 最终决策

推荐采用以下方案：

- 把官方 `openclaw-weixin` 视为“微信 transport 上游实现”
- 不把它继续作为 OpenClaw 插件成品直接运行
- 抽取 transport 内核，建立你们自己的微信网关
- 在上层路由 OpenClaw、Codex、Claude Code、Opencode、GitHub Copilot、Auggie、Cursor CLI 这些平级后端

这个方案的优点是：

- 架构目标与产品目标一致
- OpenClaw 不再是宿主，而是后端之一
- 未来跟进官方更新时，只需要同步 transport 层

这个方案的代价是：

- 需要自己维护 transport 分叉
- 需要额外设计状态、任务和后端适配层
- 需要为 `context_token` 和长任务设计补偿机制
