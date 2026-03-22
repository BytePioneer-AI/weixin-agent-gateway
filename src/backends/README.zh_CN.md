# 后端接入说明

## 1. 目的

这份文档说明：

- 其他后端如何接入当前系统
- 文本输入 / 文本输出如何走通
- 图片输入 / 媒体输出如何走通
- 需要实现哪些函数和能力

当前架构已经支持两类 backend：

- `openclaw`
  复杂 backend，需要 route / session / reply dispatcher
- `lightweight`
  轻量 backend，只需要处理文本和图片输入，返回文本和媒体输出

`codex`、`claude code`、`opencode`、`github copilot`、`auggie`、`cursor cli` 这类后端，建议按 `lightweight` 模式接入。

## 2. 当前主链路

当前消息处理链路在：

- [../messaging/process-message.ts](/d:/work/code/openclaw-weixin/src/messaging/process-message.ts)

主流程是：

1. 微信入站消息进入 `processOneMessage(...)`
2. 解析文本和媒体
3. 根据会话状态选择 backend
4. 如果 backend 是 `lightweight`
   - 构建轻量输入对象
   - 调用 `backendAdapter.reply(input)`
   - 将返回结果统一发回微信
5. 如果 backend 是 `openclaw`
   - 走 OpenClaw 专有链路

## 3. 轻量 backend 的输入

轻量 backend 输入结构定义在：

- [contracts.ts](/d:/work/code/openclaw-weixin/src/backends/contracts.ts)

具体类型：

```ts
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
```

这个对象由下面的函数构建：

- [lightweight/input.ts](/d:/work/code/openclaw-weixin/src/backends/lightweight/input.ts)

当前输入含义：

- `text`
  用户发来的文本内容
- `imagePaths`
  当前消息中已经下载到本地的图片路径列表
- `peerId`
  当前微信会话对象
- `senderId`
  发送者微信 ID

注意：

- 现在轻量 backend 只拿到图片本地路径，不拿 OpenClaw 的复杂上下文
- 如果当前消息没有图片，`imagePaths` 为空数组

## 4. 轻量 backend 的输出

轻量 backend 输出结构定义在：

- [contracts.ts](/d:/work/code/openclaw-weixin/src/backends/contracts.ts)

具体类型：

```ts
export type WeixinLightweightBackendOutput = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};
```

输出含义：

- `text`
  要回复给微信用户的文本
- `mediaUrl`
  单个媒体地址或本地文件路径
- `mediaUrls`
  多个媒体地址，当前系统默认取第一个

发送动作不需要 backend 自己完成。  
主链路会统一调用微信发送能力：

- [../transport/weixin/outbound/delivery.ts](/d:/work/code/openclaw-weixin/src/transport/weixin/outbound/delivery.ts)

所以 backend 只需要“返回结果”，不需要自己调用 `sendMessageWeixin(...)`。

## 5. 需要实现的最小能力

如果要新增一个轻量 backend，例如 `codex`，最少需要做 4 件事。

### 5.1 新增 backend id

修改：

- [contracts.ts](/d:/work/code/openclaw-weixin/src/backends/contracts.ts)

需要确保：

- `WEIXIN_BACKEND_IDS` 包含 `codex`
- `IMPLEMENTED_WEIXIN_BACKEND_IDS` 包含 `codex`
- `WEIXIN_BACKEND_LABELS` 里有 `codex`

### 5.2 实现 adapter

新建文件，例如：

```text
src/backends/codex/adapter.ts
```

实现方式：

```ts
import type { WeixinBackendAdapter } from "../contracts.js";

export const codexBackendAdapter: WeixinBackendAdapter = {
  id: "codex",
  mode: "lightweight",
  async reply(input) {
    const text = input.text.trim();
    const images = input.imagePaths;

    // 在这里调用你自己的 codex service / CLI 包装层
    const resultText = `收到文本: ${text}`;

    return {
      text: resultText,
    };
  },
};
```

### 5.3 注册 backend

修改：

- [registry.ts](/d:/work/code/openclaw-weixin/src/backends/registry.ts)

把新 adapter 加入注册表。

示意：

```ts
import { codexBackendAdapter } from "./codex/adapter.js";

const backendAdapters = {
  openclaw: openclawBackendAdapter,
  codex: codexBackendAdapter,
} as const;
```

### 5.4 开启命令切换

修改：

- [../messaging/slash-commands.ts](/d:/work/code/openclaw-weixin/src/messaging/slash-commands.ts)

当前 `/codex`、`/claude`、`/opencode`、`/copilot`、`/auggie`、`/cursor` 都已经可以切换会话 backend。  
新增 backend 时，需要同步补齐对应的 slash command 或 `/backend <name>` 切换入口。

## 6. 轻量 backend 实际会用到哪些函数

对于 `codex` / `claude code` / `opencode` / `github copilot` / `auggie` / `cursor cli` 这类轻量 backend，真正需要关心的函数很少。

### 必须理解的函数 / 类型

- [contracts.ts](/d:/work/code/openclaw-weixin/src/backends/contracts.ts)
  - `WeixinBackendAdapter`
  - `WeixinLightweightBackendInput`
  - `WeixinLightweightBackendOutput`

- [lightweight/input.ts](/d:/work/code/openclaw-weixin/src/backends/lightweight/input.ts)
  - `buildWeixinLightweightBackendInput(...)`

- [registry.ts](/d:/work/code/openclaw-weixin/src/backends/registry.ts)
  - backend 注册表

### 不需要直接调用的函数

这些由主链路统一处理，轻量 backend 一般不应直接调用：

- [../messaging/send.ts](/d:/work/code/openclaw-weixin/src/messaging/send.ts)
- [../messaging/send-media.ts](/d:/work/code/openclaw-weixin/src/messaging/send-media.ts)
- [../transport/weixin/outbound/delivery.ts](/d:/work/code/openclaw-weixin/src/transport/weixin/outbound/delivery.ts)
- [../transport/weixin/outbound/typing.ts](/d:/work/code/openclaw-weixin/src/transport/weixin/outbound/typing.ts)

### 明确不需要的 OpenClaw 能力

轻量 backend 不需要自己实现这些：

- `resolveAgentRoute(...)`
- `recordInboundSession(...)`
- `finalizeInboundContext(...)`
- `dispatchReplyFromConfig(...)`
- OpenClaw 的 command authorization
- OpenClaw 的 reply dispatcher

这些能力只属于 `openclaw` backend。

## 7. 图片输入如何接入

当前系统对图片的处理方式是：

1. 微信消息中的图片先下载并解密
2. 保存为本地文件
3. 本地路径放进 `imagePaths`
4. 轻量 backend 直接读取这些本地路径

对应实现位置：

- 图片下载： [../media/media-download.ts](/d:/work/code/openclaw-weixin/src/media/media-download.ts)
- 输入构建： [lightweight/input.ts](/d:/work/code/openclaw-weixin/src/backends/lightweight/input.ts)

对后端开发者来说，你只需要处理：

- `input.imagePaths`

如果你的后端服务需要 URL 而不是本地文件：

- 你可以在 adapter 里自行上传或转换
- 当前系统不会自动把本地图片再转成公网 URL

## 8. 文本输出如何接入

轻量 backend 返回：

```ts
return {
  text: "你的回复文本",
};
```

之后主链路会自动：

1. 调用统一 deliverer
2. 转成微信可发送格式
3. 发回微信

因此文本输出接入的核心要求只有一个：

- `reply(input)` 返回 `text`

## 9. 媒体输出如何接入

如果后端希望返回图片或文件，可以返回：

```ts
return {
  text: "这里是说明文字",
  mediaUrl: "https://example.com/image.png",
};
```

或者：

```ts
return {
  mediaUrl: "C:/tmp/output.png",
};
```

当前支持两种媒体来源：

- 本地文件路径
- `http/https` 远程地址

发送时会自动：

- 下载远程图片
- 或读取本地文件
- 上传到微信 CDN
- 回发到微信

相关实现：

- [../transport/weixin/outbound/delivery.ts](/d:/work/code/openclaw-weixin/src/transport/weixin/outbound/delivery.ts)
- [../messaging/send-media.ts](/d:/work/code/openclaw-weixin/src/messaging/send-media.ts)

## 10. 错误处理策略

轻量 backend 抛出异常时：

- 主链路会调用统一错误处理器
- 尝试给微信用户发送错误提示

相关实现：

- [../transport/weixin/outbound/delivery.ts](/d:/work/code/openclaw-weixin/src/transport/weixin/outbound/delivery.ts)

因此建议：

- adapter 内部只在真正失败时抛错
- 如果只是“无结果”，可以返回 `void` 或空文本

## 11. 最小接入模板

下面是一份最小可用模板：

```ts
import type { WeixinBackendAdapter } from "../contracts.js";

export const demoBackendAdapter: WeixinBackendAdapter = {
  id: "codex",
  mode: "lightweight",
  async reply(input) {
    const prompt = input.text.trim();
    const images = input.imagePaths;

    if (!prompt && images.length === 0) {
      return { text: "未收到可处理的输入。" };
    }

    // 在这里调用你的后端
    const result = `收到 ${prompt ? "文本" : "图片"} 输入`;

    return {
      text: result,
    };
  },
};
```

## 12. 当前建议

对于 `codex` / `claude code` / `opencode` / `github copilot` / `auggie` / `cursor cli`，建议采用下面的接入策略：

- 实现 `mode: "lightweight"` adapter
- 只消费：
  - `input.text`
  - `input.imagePaths`
- 只返回：
  - `text`
  - 可选 `mediaUrl`

不要让它们复用 OpenClaw backend 的 route/session/dispatcher 逻辑。  
这样接入最简单，也最符合当前需求。
