# 微信多后端接入插件

> 本项目目前仍处于早期版本，体验上可能还有一些问题。后续会持续迭代和优化，提供更顺畅的微信接入 Codex、Claude Code、OpenCode、GitHub Copilot、Auggie、Cursor CLI 等能力。
> 本项目由 AgentAPI 方案转入 ACP，连接 Agent 会更加稳定。

这是一个基于腾讯微信插件演进而来的项目，本项目的 OpenClaw 接入方案与腾讯官方保持一致。

当前项目仍然以 **OpenClaw 微信插件** 形态运行，但已经开始支持“一个微信入口，对接多个后端”：

- `openclaw`
- `codex`
- `claude`
- `opencode`
- `copilot`
- `auggie`
- `cursor`

### 样例展示

| 样例 1 | 样例 2 |
| --- | --- |
| <img src="docs/img/1.jpg" alt="样例 1" width="260" /> | <img src="docs/img/2.jpg" alt="样例 2" width="260" /> |

## 当前状态

目前它还不是一个完全脱离 OpenClaw 的独立服务，但在切换到 lightweight backend 时已经不再依赖 OpenClaw reply runtime，也不会消耗 OpenClaw Token。

当前运行方式：

```text
微信
  -> weixin-agent-gateway 插件
  -> 路由层
  -> openclaw / codex / claude / opencode / copilot / auggie / cursor
```

## 开发计划

- [ ] 支持独立运行；当 OpenClaw 未启动或异常退出时，可借助其他编程工具拉起 OpenClaw
- [ ] 补充更多各 backend 的原生命令，提供更顺滑的接入体验
- [ ] 新建会话
- [ ] 连续输出的形式显示思考过程

## 安装插件

### 一键安装

```bash
npx -y @bytepioneer-ai/weixin-agent-gateway install
```

安装器会自动：

- 安装或更新本插件
- 尝试禁用官方 `openclaw-weixin` 插件
- 启用本插件
- 触发微信扫码登录
- 尝试安装 Codex ACP wrapper（如果本机未安装）
- 尝试安装 Claude ACP wrapper（如果本机未安装）

当前一键安装主要覆盖插件本体、微信登录，以及 `codex` / `claude` 的 wrapper 安装。
`opencode` / `copilot` / `auggie` / `cursor` 仍建议按下面步骤手动安装对应 CLI。

### 手动安装

#### 1. 安装插件

```bash
openclaw plugins install "@bytepioneer-ai/weixin-agent-gateway"
```

#### 2. 启用插件

```bash
openclaw config set plugins.entries.openclaw-weixin.enabled false
openclaw config set plugins.entries.weixin-agent-gateway.enabled true
```

#### 3. 微信扫码登录

```bash
openclaw channels login --channel weixin-agent-gateway
```

扫码成功后，登录凭证会保存在本地。

#### 4. 重启 OpenClaw Gateway

```bash
openclaw gateway restart
```

#### 5. 安装对应 ACP 命令

Codex:

```bash
npm install -g @zed-industries/codex-acp
```

Claude Code:

```bash
npm install -g @zed-industries/claude-agent-acp
```

OpenCode:

```bash
npm install -g opencode-ai
```

Auggie:

```bash
npm install -g @augmentcode/auggie
```

GitHub Copilot:

```bash
npm install -g @github/copilot
```

Cursor CLI:

请先安装 Cursor CLI。如果你的环境里 ACP 入口命令不是默认的 `cursor-agent`，可以设置：

```bash
export WEIXIN_CURSOR_ACP_BIN="agent"
```

## Backend 登录准备

首次使用前，建议先在你准备运行 `openclaw gateway` 的工作目录里手动执行对应命令，完成登录或信任确认流程。

- `codex`: 先执行一次 `codex`
- `claude`: 先执行一次 `claude`
- `opencode`: 先执行一次 `opencode auth login`，或手动启动 `opencode`
- `copilot`: 先执行一次 `copilot login`
- `auggie`: 先执行一次 `auggie login`
- `cursor`: 先执行一次 `cursor-agent login`，或设置 `CURSOR_API_KEY`

## 可选环境变量

如果命令不在 `PATH` 中，可以显式设置可执行文件路径：

```bash
export WEIXIN_CODEX_ACP_BIN="codex-acp"
export WEIXIN_CLAUDE_ACP_BIN="claude-agent-acp"
export WEIXIN_OPENCODE_ACP_BIN="opencode"
export WEIXIN_COPILOT_ACP_BIN="copilot"
export WEIXIN_AUGGIE_ACP_BIN="auggie"
export WEIXIN_CURSOR_ACP_BIN="cursor-agent"
```

这些 lightweight ACP backend 也支持覆盖启动参数与工作目录：

```bash
export WEIXIN_OPENCODE_ACP_ARGS="acp"
export WEIXIN_COPILOT_ACP_ARGS="--acp --stdio"
export WEIXIN_AUGGIE_ACP_ARGS="--acp"
export WEIXIN_CURSOR_ACP_ARGS="acp"

export WEIXIN_OPENCODE_ACP_CWD="/path/to/workdir"
export WEIXIN_COPILOT_ACP_CWD="/path/to/workdir"
export WEIXIN_AUGGIE_ACP_CWD="/path/to/workdir"
export WEIXIN_CURSOR_ACP_CWD="/path/to/workdir"
```

如果需要关闭默认的自动工具权限批准，可以设置：

```bash
export WEIXIN_CODEX_ACP_PERMISSION_MODE="cancel"
export WEIXIN_CLAUDE_ACP_PERMISSION_MODE="cancel"
export WEIXIN_OPENCODE_ACP_PERMISSION_MODE="cancel"
export WEIXIN_COPILOT_ACP_PERMISSION_MODE="cancel"
export WEIXIN_AUGGIE_ACP_PERMISSION_MODE="cancel"
export WEIXIN_CURSOR_ACP_PERMISSION_MODE="cancel"
```

## 使用方法

### 切换后端

在微信里发送：

```text
/openclaw
/codex
/claude
/opencode
/copilot
/auggie
/cursor
```

也可以查看或切换当前后端：

```text
/backend
/backend codex
/backend claude
/backend opencode
/backend copilot
/backend auggie
/backend cursor
```

## 鸣谢

- `@tencent-weixin/openclaw-weixin`，本项目由此改编而来。
- [`@zed-industries/codex-acp`](https://github.com/zed-industries/codex-acp)，本项目当前通过它接入 Codex。
- [`Agent Client Protocol`](https://agentclientprotocol.com/) 与 [`@zed-industries/claude-agent-acp`](https://www.npmjs.com/package/@zed-industries/claude-agent-acp)，本项目当前通过它们接入 Claude Code。
- OpenCode、GitHub Copilot CLI、Auggie CLI、Cursor CLI 的官方 ACP / CLI 能力，为本项目的 lightweight backend 接入提供了基础。