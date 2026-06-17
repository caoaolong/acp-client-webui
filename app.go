package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"acpcw/acp"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是 Wails 绑定到前端的应用结构体，封装 ACP 客户端生命周期。
type App struct {
	ctx context.Context

	mu              sync.Mutex
	client          *acp.Client
	defaultCwd      string
	sessions        map[string]SessionMeta
	permissionChans map[string]chan string
}

// SessionMeta 记录本地会话元数据。
type SessionMeta struct {
	SessionID string `json:"sessionId"`
	Cwd       string `json:"cwd,omitempty"`
	Title     string `json:"title,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
}

// StartParams 启动 ACP Agent 的参数。
type StartParams struct {
	Cwd          string   `json:"cwd"`
	AgentCommand string   `json:"agentCommand"`
	AgentArgs    []string `json:"agentArgs"`
}

// NewSessionParams 创建会话的参数。
type NewSessionParams struct {
	Cwd   string `json:"cwd"`
	Title string `json:"title"`
}

// NewSessionResult 创建会话的返回值。
type NewSessionResult struct {
	SessionID string `json:"sessionId"`
}

// PromptParams 发送消息的参数。
type PromptParams struct {
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
}

// PromptResult 发送消息的返回值。
type PromptResult struct {
	StopReason string `json:"stopReason"`
}

// SessionIDParams 按会话 ID 操作的参数。
type SessionIDParams struct {
	SessionID string `json:"sessionId"`
}

// ListSessionsResult 会话列表。
type ListSessionsResult struct {
	Sessions []SessionMeta `json:"sessions"`
}

// PermissionResponseParams 权限响应参数。
type PermissionResponseParams struct {
	RequestID string  `json:"requestId"`
	OptionID  *string `json:"optionId"`
}

// DetectServerResult 服务器探测结果。
type DetectServerResult struct {
	Path *string `json:"path"`
}

// NewApp 创建应用实例。
func NewApp() *App {
	return &App{
		sessions:        make(map[string]SessionMeta),
		permissionChans: make(map[string]chan string),
	}
}

// Startup Wails 生命周期：保存 context 并通知前端 bridge 已就绪。
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	runtime.EventsEmit(ctx, "acp-event", map[string]interface{}{
		"type": "ready",
	})
}

// Shutdown 关闭 ACP 连接。
func (a *App) Shutdown(ctx context.Context) {
	a.mu.Lock()
	client := a.client
	a.client = nil
	a.mu.Unlock()
	if client != nil {
		_ = client.Close()
	}
}

func (a *App) emitEvent(event string, data interface{}) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "acp-event", map[string]interface{}{
		"type":  "event",
		"event": event,
		"data":  data,
	})
}

func (a *App) requireClient() (*acp.Client, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.client == nil {
		return nil, fmt.Errorf("ACP Agent 未启动")
	}
	return a.client, nil
}

// Start 启动 ACP Agent 并完成 initialize 握手。
func (a *App) Start(params StartParams) (map[string]interface{}, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.client != nil {
		return map[string]interface{}{"alreadyStarted": true}, nil
	}

	command := params.AgentCommand
	if command == "" {
		command = os.Getenv("ACP_AGENT_COMMAND")
	}
	if command == "" {
		command = "qwen"
	}

	args := params.AgentArgs
	if len(args) == 0 {
		if raw := os.Getenv("ACP_AGENT_ARGS"); raw != "" {
			args = strings.Split(raw, ",")
			for i := range args {
				args[i] = strings.TrimSpace(args[i])
			}
		} else {
			args = []string{"--acp"}
		}
	}

	cwd := params.Cwd
	if cwd == "" {
		cwd = os.Getenv("ACP_CWD")
	}
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return nil, fmt.Errorf("解析工作目录失败: %w", err)
	}

	client, err := acp.Start(command, args, absCwd, os.Environ())
	if err != nil {
		return nil, err
	}

	client.OnSessionUpdate = func(p acp.SessionUpdateParams) {
		var update map[string]interface{}
		_ = json.Unmarshal(p.Update, &update)
		a.emitEvent("session_update", map[string]interface{}{
			"sessionId": p.SessionID,
			"update":    update,
		})
	}

	client.OnPermissionRequest = func(toolCallID, title string, options []acp.PermissionOption) string {
		requestID := uuid.New().String()
		ch := make(chan string, 1)

		a.mu.Lock()
		a.permissionChans[requestID] = ch
		a.mu.Unlock()

		opts := make([]map[string]string, 0, len(options))
		for _, o := range options {
			opts = append(opts, map[string]string{
				"optionId": o.OptionID,
				"name":     o.Name,
				"kind":     o.Kind,
			})
		}

		a.emitEvent("permission_request", map[string]interface{}{
			"requestId": requestID,
			"toolCall": map[string]string{
				"toolCallId": toolCallID,
				"title":      title,
			},
			"options": opts,
		})

		select {
		case chosen := <-ch:
			return chosen
		case <-a.ctx.Done():
			return ""
		}
	}

	initCtx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()

	initResult, err := client.Initialize(initCtx, acp.ClientInfo{
		Name:    "acp-client-webui",
		Title:   "ACP Client WebUI",
		Version: "0.1.0",
	}, acp.ClientCapabilities{
		FS:       acp.FSCapability{ReadTextFile: false, WriteTextFile: false},
		Terminal: false,
	})
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	a.client = client
	a.defaultCwd = absCwd

	// 发送事件通知前端 Agent 已启动
	a.emitEvent("agent_ready", map[string]interface{}{
		"protocolVersion": initResult.ProtocolVersion,
		"agentInfo":       initResult.AgentInfo,
	})

	return map[string]interface{}{
		"protocolVersion": initResult.ProtocolVersion,
		"agentInfo":       initResult.AgentInfo,
	}, nil
}

// Stop 停止 ACP Agent 连接。
func (a *App) Stop() error {
	a.mu.Lock()
	client := a.client
	a.client = nil
	a.mu.Unlock()
	if client != nil {
		return client.Close()
	}
	return nil
}

// NewSession 创建新的 ACP 会话。
func (a *App) NewSession(params NewSessionParams) (*NewSessionResult, error) {
	client, err := a.requireClient()
	if err != nil {
		return nil, err
	}

	cwd := params.Cwd
	if cwd == "" {
		cwd = a.defaultCwd
	}
	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return nil, fmt.Errorf("解析工作目录失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(a.ctx, 60*time.Second)
	defer cancel()

	sessionID, err := client.NewSession(ctx, absCwd, nil)
	if err != nil {
		return nil, err
	}

	title := params.Title
	if title == "" {
		title = "New Chat"
	}

	a.mu.Lock()
	a.sessions[sessionID] = SessionMeta{
		SessionID: sessionID,
		Cwd:       absCwd,
		Title:     title,
		CreatedAt: time.Now().UnixMilli(),
	}
	a.mu.Unlock()

	return &NewSessionResult{SessionID: sessionID}, nil
}

// Prompt 向会话发送用户消息。
func (a *App) Prompt(params PromptParams) (*PromptResult, error) {
	client, err := a.requireClient()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(a.ctx, 5*time.Minute)
	defer cancel()

	stopReason, err := client.Prompt(ctx, params.SessionID, []acp.ContentBlock{
		acp.TextBlock(params.Text),
	})
	if err != nil {
		return nil, err
	}

	return &PromptResult{StopReason: stopReason}, nil
}

// Cancel 取消当前会话正在进行的处理。
func (a *App) Cancel(params SessionIDParams) error {
	client, err := a.requireClient()
	if err != nil {
		return err
	}
	return client.Cancel(params.SessionID)
}

// ListSessions 返回本地记录的会话列表。
func (a *App) ListSessions() (*ListSessionsResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	sessions := make([]SessionMeta, 0, len(a.sessions))
	for _, meta := range a.sessions {
		sessions = append(sessions, meta)
	}
	return &ListSessionsResult{Sessions: sessions}, nil
}

// DeleteSession 从本地记录中删除会话。
func (a *App) DeleteSession(params SessionIDParams) error {
	a.mu.Lock()
	delete(a.sessions, params.SessionID)
	a.mu.Unlock()
	return nil
}

// PermissionResponse 响应 Agent 的权限请求。
func (a *App) PermissionResponse(params PermissionResponseParams) error {
	a.mu.Lock()
	ch, ok := a.permissionChans[params.RequestID]
	if ok {
		delete(a.permissionChans, params.RequestID)
	}
	a.mu.Unlock()

	if !ok {
		return fmt.Errorf("未知的权限请求: %s", params.RequestID)
	}

	if params.OptionID != nil {
		ch <- *params.OptionID
	} else {
		ch <- ""
	}
	return nil
}

// DetectAcpServer 在 PATH 和常见安装路径中查找 ACP 服务器可执行文件。
func (a *App) DetectAcpServer(serverType string) (*DetectServerResult, error) {
	path, err := detectServerExecutable(serverType)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return &DetectServerResult{Path: nil}, nil
	}
	return &DetectServerResult{Path: &path}, nil
}
