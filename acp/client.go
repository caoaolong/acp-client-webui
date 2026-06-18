// Package acp 实现了一个最小可用的 Agent Client Protocol (ACP) 客户端。
//
// ACP 是 Zed 提出的、用于编辑器/客户端与 AI 编程 Agent 之间通信的开放协议，
// 基于 JSON-RPC 2.0，消息通过子进程的 stdin/stdout 以「每行一个 JSON 对象」
// 的形式传递（协议规定消息以 \n 分隔，且不能包含内嵌换行符）。
//
// 协议文档： https://agentclientprotocol.com
package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
)

// PermissionDecider 由调用方提供，决定如何响应 Agent 发来的
// session/request_permission 请求（例如：是否允许 Agent 执行某个工具调用）。
// 返回需要选择的 optionId；如果找不到合适选项，返回空字符串则表示拒绝（reject）。
type PermissionDecider func(toolCallID, toolTitle string, options []PermissionOption) string

// PermissionOption 对外暴露的权限选项（屏蔽内部 json 细节）。
type PermissionOption struct {
	OptionID string
	Name     string
	Kind     string // allow_once | allow_always | reject_once | reject_always
}

// RawMessage 表示一条原始 JSON-RPC 消息及其方向。
type RawMessage struct {
	Direction string          `json:"direction"` // "send" | "recv"
	Raw       json.RawMessage `json:"raw"`
}

// Client 是一个 ACP 客户端：把 OpenCode（或任何 ACP Agent）当作子进程启动，
// 通过其 stdin/stdout 进行 JSON-RPC 通信。
type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	writeMu sync.Mutex

	mu      sync.Mutex
	pending map[string]chan message
	nextID  int64

	// OnSessionUpdate 在收到 Agent 推送的 session/update 通知时被调用。
	OnSessionUpdate func(SessionUpdateParams)

	// OnPermissionRequest 在收到 Agent 的 session/request_permission 请求时被调用。
	// 不设置的话默认拒绝所有权限请求。
	OnPermissionRequest PermissionDecider

	// OnRawMessage 在每次发送或接收 JSON-RPC 消息时被调用，用于调试/日志。
	OnRawMessage func(RawMessage)

	// LogMessages 为 true 时在 stderr 打印收发的 JSON-RPC 消息（默认开启，设 ACP_LOG=0 关闭）。
	LogMessages bool

	closed atomic.Bool
	done   chan struct{}
}

// Start 启动 ACP Agent 子进程（例如 `opencode acp`）并完成传输层的初始化。
// 注意：这里只是建立了 stdio 管道，还没有进行 ACP 的 initialize 握手。
func Start(command string, args []string, dir string, env []string) (*Client, error) {
	cmd := exec.Command(command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if env != nil {
		cmd.Env = env
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("创建 stdin 管道失败: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("创建 stdout 管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("创建 stderr 管道失败: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 ACP Agent 进程失败（命令: %s %v）: %w", command, args, err)
	}

	c := &Client{
		cmd:         cmd,
		stdin:       stdin,
		stdout:      bufio.NewReaderSize(stdout, 1<<20), // ACP 单条消息可能较大（如完整对话回放），放大缓冲区
		pending:     make(map[string]chan message),
		done:        make(chan struct{}),
		LogMessages: os.Getenv("ACP_LOG") != "0",
	}

	go c.readLoop()
	go c.forwardStderr(stderr)

	return c, nil
}

// forwardStderr 把 Agent 进程的 stderr 原样转发出来，便于调试
// （ACP 规定 Agent 只能往 stdout 写协议消息，日志只能走 stderr）。
func (c *Client) forwardStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		fmt.Fprintf(os.Stderr, "[opencode] %s\n", scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Printf("读取 Agent stderr 时出错: %v", err)
	}
}

// readLoop 持续从 Agent 的 stdout 按行读取 JSON-RPC 消息并分发。
func (c *Client) readLoop() {
	defer close(c.done)
	for {
		line, err := c.stdout.ReadBytes('\n')
		if len(line) > 0 {
			c.handleLine(line)
		}
		if err != nil {
			if err != io.EOF {
				log.Printf("读取 Agent 输出时出错: %v", err)
			}
			return
		}
	}
}

func (c *Client) handleLine(line []byte) {
	if c.OnRawMessage != nil {
		raw := make(json.RawMessage, len(line))
		copy(raw, line)
		c.OnRawMessage(RawMessage{Direction: "recv", Raw: raw})
	}

	var msg message
	if err := json.Unmarshal(line, &msg); err != nil {
		log.Printf("收到无法解析的消息，已忽略: %s", string(line))
		return
	}

	switch {
	case msg.Method != "" && len(msg.ID) > 0 && string(msg.ID) != "null":
		// Agent -> Client 的请求（例如 session/request_permission）
		c.handleIncomingRequest(msg)
	case msg.Method != "":
		// Agent -> Client 的通知（例如 session/update）
		c.handleNotification(msg)
	case len(msg.ID) > 0:
		// 对我们之前某个请求的响应
		c.handleResponse(msg)
	default:
		log.Printf("收到无法识别的消息: %s", string(line))
	}
}

func (c *Client) handleResponse(msg message) {
	key := string(msg.ID)
	c.mu.Lock()
	ch, ok := c.pending[key]
	if ok {
		delete(c.pending, key)
	}
	c.mu.Unlock()
	if !ok {
		log.Printf("收到未知请求 id=%s 的响应，已丢弃", key)
		return
	}
	ch <- msg
	close(ch)
}

func (c *Client) handleNotification(msg message) {
	switch msg.Method {
	case "session/update":
		if c.OnSessionUpdate == nil {
			return
		}
		var params SessionUpdateParams
		if err := json.Unmarshal(msg.Params, &params); err != nil {
			log.Printf("解析 session/update 参数失败: %v", err)
			return
		}
		c.OnSessionUpdate(params)
	default:
		// 其它通知（未来协议扩展）忽略但打印一下方便调试。
		log.Printf("收到未处理的通知: %s", msg.Method)
	}
}

func (c *Client) handleIncomingRequest(msg message) {
	switch msg.Method {
	case "session/request_permission":
		c.handlePermissionRequest(msg)
	default:
		// 我们没有声明支持 fs/* 、terminal/* 等能力，
		// 所以正常情况下 Agent 不会调用到这里；兜底返回 Method not found。
		c.sendError(msg.ID, -32601, fmt.Sprintf("method not supported by this client: %s", msg.Method))
	}
}

func (c *Client) handlePermissionRequest(msg message) {
	var params requestPermissionParams
	if err := json.Unmarshal(msg.Params, &params); err != nil {
		c.sendError(msg.ID, -32602, "invalid params")
		return
	}

	options := make([]PermissionOption, 0, len(params.Options))
	for _, o := range params.Options {
		options = append(options, PermissionOption{OptionID: o.OptionID, Name: o.Name, Kind: o.Kind})
	}

	var chosen string
	if c.OnPermissionRequest != nil {
		chosen = c.OnPermissionRequest(params.ToolCall.ToolCallID, params.ToolCall.Title, options)
	}

	var outcome permissionOutcome
	if chosen != "" {
		outcome = permissionOutcome{Outcome: "selected", OptionID: chosen}
	} else {
		// 没有给出明确选择时，默认走「拒绝」选项（如果 Agent 提供了的话），
		// 这样不会让一次工具调用被悬空挂起。
		for _, o := range params.Options {
			if o.Kind == "reject_once" || o.Kind == "reject_always" {
				outcome = permissionOutcome{Outcome: "selected", OptionID: o.OptionID}
				break
			}
		}
		if outcome.Outcome == "" && len(params.Options) > 0 {
			outcome = permissionOutcome{Outcome: "selected", OptionID: params.Options[0].OptionID}
		}
	}

	c.sendResult(msg.ID, requestPermissionResult{Outcome: outcome})
}

// ---------- 底层发送原语 ----------

func (c *Client) writeMessage(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	data = append(data, '\n')

	if c.OnRawMessage != nil {
		raw := make(json.RawMessage, len(data)-1)
		copy(raw, data[:len(data)-1])
		c.OnRawMessage(RawMessage{Direction: "send", Raw: raw})
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err = c.stdin.Write(data)
	return err
}

func (c *Client) sendResult(id json.RawMessage, result interface{}) {
	resultBytes, err := json.Marshal(result)
	if err != nil {
		c.sendError(id, -32603, "internal error encoding result")
		return
	}
	_ = c.writeMessage(message{JSONRPC: "2.0", ID: id, Result: resultBytes})
}

func (c *Client) sendError(id json.RawMessage, code int, msgText string) {
	_ = c.writeMessage(message{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: msgText},
	})
}

// Call 发送一个 JSON-RPC 请求并阻塞等待响应（受 ctx 控制超时/取消）。
func (c *Client) Call(ctx context.Context, method string, params interface{}, result interface{}) error {
	id := atomic.AddInt64(&c.nextID, 1)
	idBytes, _ := json.Marshal(id)

	var paramsBytes json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("编码请求参数失败: %w", err)
		}
		paramsBytes = b
	}

	ch := make(chan message, 1)
	key := string(idBytes)
	c.mu.Lock()
	c.pending[key] = ch
	c.mu.Unlock()

	req := message{JSONRPC: "2.0", ID: idBytes, Method: method, Params: paramsBytes}
	if err := c.writeMessage(req); err != nil {
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		return fmt.Errorf("发送 %s 请求失败: %w", method, err)
	}

	select {
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
		return fmt.Errorf("等待 %s 响应超时/取消: %w", method, ctx.Err())
	case resp := <-ch:
		if resp.Error != nil {
			return fmt.Errorf("Agent 返回错误（%s）: [%d] %s", method, resp.Error.Code, resp.Error.Message)
		}
		if result != nil && len(resp.Result) > 0 {
			if err := json.Unmarshal(resp.Result, result); err != nil {
				return fmt.Errorf("解析 %s 响应失败: %w", method, err)
			}
		}
		return nil
	case <-c.done:
		return fmt.Errorf("与 Agent 的连接已关闭（等待 %s 响应时）", method)
	}
}

// Notify 发送一个无需响应的 JSON-RPC 通知（例如 session/cancel）。
func (c *Client) Notify(method string, params interface{}) error {
	var paramsBytes json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return err
		}
		paramsBytes = b
	}
	return c.writeMessage(message{JSONRPC: "2.0", Method: method, Params: paramsBytes})
}

// ---------- ACP 高层方法 ----------

// Initialize 执行 ACP 握手：协商协议版本与双方能力。
func (c *Client) Initialize(ctx context.Context, clientInfo ClientInfo, caps ClientCapabilities) (*InitializeResult, error) {
	params := InitializeParams{
		ProtocolVersion:    1,
		ClientCapabilities: caps,
		ClientInfo:         clientInfo,
	}
	var result InitializeResult
	if err := c.Call(ctx, "initialize", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// NewSession 创建一个新的会话（对应一次独立的对话上下文）。
func (c *Client) NewSession(ctx context.Context, cwd string, mcpServers []McpServer) (string, error) {
	if mcpServers == nil {
		mcpServers = []McpServer{}
	}
	params := NewSessionParams{Cwd: cwd, McpServers: mcpServers}
	var result NewSessionResult
	if err := c.Call(ctx, "session/new", params, &result); err != nil {
		return "", err
	}
	return result.SessionID, nil
}

// Prompt 向指定会话发送一条用户消息，并阻塞等待本轮对话结束（StopReason）。
// 在等待期间，Agent 推送的流式内容会通过 OnSessionUpdate 回调实时输出。
func (c *Client) Prompt(ctx context.Context, sessionID string, blocks []ContentBlock) (string, error) {
	params := PromptParams{SessionID: sessionID, Prompt: blocks}
	var result PromptResult
	if err := c.Call(ctx, "session/prompt", params, &result); err != nil {
		return "", err
	}
	return result.StopReason, nil
}

// Cancel 取消当前会话正在进行的处理。
func (c *Client) Cancel(sessionID string) error {
	return c.Notify("session/cancel", CancelParams{SessionID: sessionID})
}

// Close 关闭与 Agent 的连接：关闭 stdin（让 Agent 收到 EOF 后自行退出），
// 并等待进程结束；超时后强制 Kill。
func (c *Client) Close() error {
	if !c.closed.CompareAndSwap(false, true) {
		return nil
	}
	_ = c.stdin.Close()

	waitDone := make(chan error, 1)
	go func() { waitDone <- c.cmd.Wait() }()

	select {
	case err := <-waitDone:
		return err
	case <-c.done:
		// stdout 已经 EOF，再给进程一点时间自然退出
		select {
		case err := <-waitDone:
			return err
		default:
			_ = c.cmd.Process.Kill()
			return <-waitDone
		}
	}
}

// ParseUpdateKind 是一个小工具函数，方便上层代码读出 session/update
// 中 update 对象的判别字段（"sessionUpdate"）。
func ParseUpdateKind(update json.RawMessage) string {
	var k updateKind
	_ = json.Unmarshal(update, &k)
	return k.SessionUpdate
}

// DecodeMessageChunk 把 update 解析为 agent_message_chunk / agent_thought_chunk /
// user_message_chunk 共用的结构。
func DecodeMessageChunk(update json.RawMessage) (messageID string, content ContentBlock, err error) {
	var u messageChunkUpdate
	if err = json.Unmarshal(update, &u); err != nil {
		return "", ContentBlock{}, err
	}
	return u.MessageID, u.Content, nil
}

// DecodeToolCall 把 update 解析为 tool_call / tool_call_update 共用的结构。
func DecodeToolCall(update json.RawMessage) (ToolCallInfo, error) {
	var u toolCallUpdate
	err := json.Unmarshal(update, &u)
	return ToolCallInfo{ToolCallID: u.ToolCallID, Title: u.Title, Kind: u.Kind, Status: u.Status}, err
}

// ToolCallInfo 对外暴露的工具调用信息（屏蔽内部 json 细节）。
type ToolCallInfo struct {
	ToolCallID string
	Title      string
	Kind       string
	Status     string
}

// PlanItem 对外暴露的计划条目。
type PlanItem struct {
	Content  string
	Priority string
	Status   string
}

// DecodePlan 把 update 解析为 plan 结构。
func DecodePlan(update json.RawMessage) ([]PlanItem, error) {
	var u planUpdate
	if err := json.Unmarshal(update, &u); err != nil {
		return nil, err
	}
	items := make([]PlanItem, 0, len(u.Entries))
	for _, e := range u.Entries {
		items = append(items, PlanItem{Content: e.Content, Priority: e.Priority, Status: e.Status})
	}
	return items, nil
}

// UsageInfo 对外暴露的用量信息。
type UsageInfo struct {
	Used     int
	Size     int
	HasCost  bool
	Amount   float64
	Currency string
}

// DecodeUsage 把 update 解析为 usage_update 结构。
func DecodeUsage(update json.RawMessage) (UsageInfo, error) {
	var u usageUpdate
	if err := json.Unmarshal(update, &u); err != nil {
		return UsageInfo{}, err
	}
	info := UsageInfo{Used: u.Used, Size: u.Size}
	if u.Cost != nil {
		info.HasCost = true
		info.Amount = u.Cost.Amount
		info.Currency = u.Cost.Currency
	}
	return info, nil
}
