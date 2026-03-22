# 微信多后端接入插件

> 本项目目前仍处于早期版本，体验上可能还有一些问题。后续会持续迭代和优化，提供更顺畅的微信接入 Codex、Claude Code 等能力。
>
> 当前问题：Codex、Claude Code 在输出内容时，可能存在排版较乱的情况，后续会优化处理。

这是一个基于腾讯微信插件演进而来的项目，本项目的OpenClaw接入方案与腾讯官方保持一致。

当前项目仍然以 **OpenClaw 微信插件** 形态运行，但已经开始支持“一个微信入口，对接多个后端”：

- `openclaw`
- `codex`
- `claude`

### 样例展示

| 样例 1 | 样例 2 |
| --- | --- |
| <img src="docs/img/1.jpg" alt="样例 1" width="260" /> | <img src="docs/img/2.jpg" alt="样例 2" width="260" /> |


## 当前状态

目前它还不是一个完全脱离 OpenClaw 的独立服务，但在切换后端时已经不再依赖 OpenClaw，也不会消耗 OpenClaw Token。

后续将逐步实现脱离 OpenClaw 的独立运行，并在微信侧接入 OpenClaw、Codex、Claude Code、OpenCode 等更多后端。

当前运行方式：

```text
微信
  -> weixin-agent-gateway 插件
  -> 路由层
  -> openclaw / codex / claude
```



## 开发计划

- [ ] 支持独立运行；当 OpenClaw 未启动或异常退出时，可借助其他编程工具拉起 OpenClaw
- [ ] 补充更多 Codex / Claude Code 原生命令，提供更顺滑的接入体验
- [ ] 新建会话
- [ ] 支持更多编程工具后端
- [ ] 连续输出的形式显示思考过程





## 安装插件

需要本机已经安装 OpenClaw，并且 `openclaw` 命令可用。

如果你要使用 `codex` / `claude`：

- 安装器会自动安装 `agentapi`（如果本机缺失）
- 插件会优先按本地默认地址自动探测并尝试拉起 AgentAPI
- 但 `codex` / `claude` 本身仍需要先登录可用

AgentAPI 只是远程控制层，不负责登录。

### 一键安装

```bash
npx -y @bytepioneer-ai/weixin-agent-gateway install
```

安装器会自动：

- 安装或更新本插件
- 尝试禁用官方 `openclaw-weixin` 插件
- 启用本插件
- 触发微信扫码登录
- 下载 AgentAPI（如果本机未安装）

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

## 发布 npm

当前仓库现在只发布一个 npm 包：

- `@bytepioneer-ai/weixin-agent-gateway`

这个包同时包含：

- OpenClaw 插件本体
- 安装 / 初始化 CLI

发布前先执行：

```bash
npm login
```

根目录已经提供统一发布脚本：

```bash
npm run publish:npm:dry-run
npm run publish:npm
```

默认会发布根包，并使用 public access。

发布脚本默认会附带 `--ignore-scripts`。

如果需要带 tag 或 OTP，可以直接调用脚本：

```bash
node ./scripts/publish-npm.mjs --tag next --otp 123456
```

如果你需要显式执行 npm lifecycle scripts，可以追加：

```bash
node ./scripts/publish-npm.mjs --with-scripts
```

## 使用方法

### 切换后端

在微信里发送：

```text
/openclaw
/codex
/claude
```

也可以查看当前后端：

```text
/backend
```

## 鸣谢

- `@tencent-weixin/openclaw-weixin`，本项目由此改编而来。
- [`coder/agentapi`](https://github.com/coder/agentapi)，本项目使用它来实现对多个 AI IDE 的控制。
