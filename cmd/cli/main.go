// Command opencode-acp-client 是一个最小可用的 ACP（Agent Client Protocol）客户端示例。
//
// 它会把 OpenCode 当作 ACP Agent 启动（默认执行 `opencode acp`），通过 stdio
// 与之进行 JSON-RPC 2.0 通信，完成：
//
//  1. initialize  —— 协议版本与能力协商
//  2. session/new —— 创建一个新会话
//  3. session/prompt —— 发送一句问候语
//  4. 实时打印 Agent 通过 session/update 推送回来的流式响应
//  5. 打印本轮对话的结束原因（StopReason）
//
// 用法示例：
//
//	go run ./cmd/cli -message "你好，介绍一下你自己"
//	go run ./cmd/cli -cmd /usr/local/bin/opencode -cwd /path/to/project
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"acpcw/acp"
)

func main() {
	var (
		command   = flag.String("cmd", "qwen", "OpenCode 可执行文件路径（默认从 PATH 中查找 opencode）")
		extraArgs = flag.String("args", "--acp", "传给可执行文件的参数，逗号分隔（默认 \"acp\"，对应 `opencode acp`）")
		cwd       = flag.String("cwd", ".", "会话的工作目录（会被转换为绝对路径）")
		message   = flag.String("message", "你好，OpenCode！请用一句话介绍一下你自己。", "发送给 Agent 的问候语")
		timeout   = flag.Duration("timeout", 120*time.Second, "等待 Agent 完成本轮响应的超时时间")
		verbose   = flag.Bool("verbose", false, "打印未识别的 session/update 原始 JSON，便于调试")
	)
	flag.Parse()

	absCwd, err := filepath.Abs(*cwd)
	if err != nil {
		log.Fatalf("解析工作目录失败: %v", err)
	}

	args := strings.Split(*extraArgs, ",")
	for i := range args {
		args[i] = strings.TrimSpace(args[i])
	}

	fmt.Printf("==> 启动 ACP Agent: %s %s\n", *command, strings.Join(args, " "))
	fmt.Printf("==> 会话工作目录: %s\n\n", absCwd)

	client, err := acp.Start(*command, args, "", os.Environ())
	if err != nil {
		log.Fatalf("启动 OpenCode ACP 进程失败: %v\n"+
			"请确认 opencode 已安装并在 PATH 中，或使用 -cmd 指定完整路径。", err)
	}
	defer client.Close()

	printer := &updatePrinter{verbose: *verbose}
	client.OnSessionUpdate = printer.handle

	// 没有声明 fs/terminal 能力时，正常情况下 Agent 不会请求执行需要这些能力的
	// 工具；但为了不让对话被未知的权限请求挂起，这里统一自动允许一次性操作。
	client.OnPermissionRequest = func(toolCallID, title string, options []acp.PermissionOption) string {
		fmt.Printf("\n[权限请求] 工具调用 %q（%s）请求授权，可选项: %v\n", title, toolCallID, options)
		for _, o := range options {
			if o.Kind == "allow_once" {
				fmt.Printf("[权限请求] 已自动选择: %s\n", o.Name)
				return o.OptionID
			}
		}
		if len(options) > 0 {
			return options[0].OptionID
		}
		return ""
	}

	// 支持 Ctrl+C 优雅取消：发送 session/cancel 后再退出。
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	var sessionIDForCancel string
	go func() {
		<-sigCh
		fmt.Println("\n==> 收到中断信号，正在取消当前请求...")
		if sessionIDForCancel != "" {
			_ = client.Cancel(sessionIDForCancel)
		}
		cancel()
	}()

	// ---------- 1. initialize ----------
	initResult, err := client.Initialize(ctx, acp.ClientInfo{
		Name:    "go-acp-client",
		Title:   "Go ACP Demo Client",
		Version: "0.1.0",
	}, acp.ClientCapabilities{
		FS:       acp.FSCapability{ReadTextFile: false, WriteTextFile: false},
		Terminal: false,
	})
	if err != nil {
		log.Fatalf("initialize 失败: %v", err)
	}
	fmt.Printf("==> 协议握手成功（protocolVersion=%d）\n", initResult.ProtocolVersion)
	if initResult.AgentInfo.Name != "" {
		fmt.Printf("    Agent: %s", initResult.AgentInfo.Name)
		if initResult.AgentInfo.Version != "" {
			fmt.Printf(" v%s", initResult.AgentInfo.Version)
		}
		fmt.Println()
	}
	if len(initResult.AuthMethods) > 0 {
		fmt.Printf("    注意: Agent 报告了 %d 种认证方式；如果后续创建会话失败，\n"+
			"          请先在终端执行 `opencode auth login` 完成登录。\n", len(initResult.AuthMethods))
	}
	fmt.Println()

	// ---------- 2. session/new ----------
	sessionID, err := client.NewSession(ctx, absCwd, nil)
	if err != nil {
		log.Fatalf("创建会话失败: %v", err)
	}
	sessionIDForCancel = sessionID
	fmt.Printf("==> 会话已创建: %s\n\n", sessionID)

	// ---------- 3. session/prompt ----------
	fmt.Printf("👤 我: %s\n\n", *message)
	fmt.Print("🤖 OpenCode: ")

	stopReason, err := client.Prompt(ctx, sessionID, []acp.ContentBlock{acp.TextBlock(*message)})
	printer.endLine()
	if err != nil {
		log.Fatalf("\n发送问候失败: %v", err)
	}

	fmt.Printf("\n==> 本轮对话结束，stopReason = %s\n", stopReason)
}

// updatePrinter 负责把 session/update 通知里的各种内容实时打印到终端。
type updatePrinter struct {
	verbose   bool
	streaming bool // 上一次输出是否是「未换行的流式文本」
}

func (p *updatePrinter) endLine() {
	if p.streaming {
		fmt.Println()
		p.streaming = false
	}
}

func (p *updatePrinter) handle(params acp.SessionUpdateParams) {
	kind := acp.ParseUpdateKind(params.Update)
	switch kind {
	case "agent_message_chunk":
		_, content, err := acp.DecodeMessageChunk(params.Update)
		if err == nil && content.Type == "text" {
			fmt.Print(content.Text)
			p.streaming = true
		}

	case "agent_thought_chunk":
		_, content, err := acp.DecodeMessageChunk(params.Update)
		if err == nil && content.Type == "text" {
			p.endLine()
			fmt.Printf("💭 [思考] %s\n", content.Text)
		}

	case "user_message_chunk":
		// 这是 session/load 回放历史消息时才会出现的内容，正常的问候流程不会收到。

	case "tool_call":
		info, err := acp.DecodeToolCall(params.Update)
		if err == nil {
			p.endLine()
			fmt.Printf("🔧 [工具调用] %s (kind=%s, status=%s)\n", info.Title, info.Kind, info.Status)
		}

	case "tool_call_update":
		info, err := acp.DecodeToolCall(params.Update)
		if err == nil {
			p.endLine()
			fmt.Printf("🔧 [工具调用更新] id=%s status=%s\n", info.ToolCallID, info.Status)
		}

	case "plan":
		items, err := acp.DecodePlan(params.Update)
		if err == nil {
			p.endLine()
			fmt.Println("📋 [计划]")
			for _, it := range items {
				fmt.Printf("   - (%s/%s) %s\n", it.Priority, it.Status, it.Content)
			}
		}

	case "usage_update":
		usage, err := acp.DecodeUsage(params.Update)
		if err == nil {
			p.endLine()
			if usage.HasCost {
				fmt.Printf("📊 [用量] 已用 token: %d / %d，费用: %.4f %s\n",
					usage.Used, usage.Size, usage.Amount, usage.Currency)
			} else {
				fmt.Printf("📊 [用量] 已用 token: %d / %d\n", usage.Used, usage.Size)
			}
		}

	default:
		if p.verbose {
			p.endLine()
			raw, _ := json.MarshalIndent(params.Update, "", "  ")
			fmt.Printf("⚠️  [未处理的 update: %s]\n%s\n", kind, string(raw))
		}
	}
}
