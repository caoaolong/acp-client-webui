# ACP Client WebUI

基于 [Wails](https://wails.io) 的 ACP（Agent Client Protocol）桌面客户端，前端使用 [@assistant-ui/react](https://www.assistant-ui.com/) 构建聊天界面。

## 架构

```
┌─────────────────────────────────────┐
│  React + assistant-ui (frontend/)   │
│  useAcpRuntime / Thread / ThreadList│
└──────────────┬──────────────────────┘
               │ Wails Bindings + Events
┌──────────────▼──────────────────────┐
│  Go App (app.go)                    │
│  Start / NewSession / Prompt / ...  │
└──────────────┬──────────────────────┘
               │ acp.Client (stdio JSON-RPC)
┌──────────────▼──────────────────────┐
│  ACP Agent (qwen --acp / opencode)  │
└─────────────────────────────────────┘
```

核心 ACP 协议逻辑位于 `acp/` 包，与 CLI 示例（`cmd/cli/`）共用，未做改动。

## 环境要求

- Go 1.23+
- Node.js 18+
- [Wails CLI v2](https://wails.io/docs/gettingstarted/installation)
- 已安装 ACP Agent（默认 `qwen --acp`，可在设置中配置）

## 开发

```bash
# 安装前端依赖
cd frontend && npm install && cd ..

# 生成 Wails TypeScript 绑定（修改 Go 绑定后需重新执行）
wails generate module

# 启动开发模式（热重载）
wails dev
```

## 构建

```bash
wails build
```

产物位于 `build/bin/`。

## CLI 模式

保留原有命令行客户端：

```bash
go run ./cmd/cli -message "你好"
go run ./cmd/cli -cmd qwen -args "--acp" -cwd .
```

## 配置

| 环境变量 | 说明 |
|---------|------|
| `ACP_AGENT_COMMAND` | Agent 可执行文件（默认 `qwen`） |
| `ACP_AGENT_ARGS` | 逗号分隔参数（默认 `--acp`） |
| `ACP_CWD` | 默认工作目录 |
| `VITE_ACP_CWD` | 前端构建时的工作目录 |

也可在应用「设置 → 服务器」中配置 Agent 路径与参数。
