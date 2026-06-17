package acp

import "encoding/json"

// ---------- JSON-RPC 2.0 信封 ----------
//
// ACP（Agent Client Protocol）是基于 JSON-RPC 2.0 的协议，消息分三类：
//   1. Request：  携带 id + method，期待对方返回 Response
//   2. Response： 携带 id（无 method），是对某个 Request 的应答
//   3. Notification：携带 method（无 id），单向通知，无需应答
//
// message 结构体把三种情况合并在一起，靠字段是否存在来判断消息类型。
type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError 对应 JSON-RPC 2.0 的 error 对象。
type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	return e.Message
}

// ---------- initialize ----------

type ClientInfo struct {
	Name    string `json:"name"`
	Title   string `json:"title,omitempty"`
	Version string `json:"version"`
}

type FSCapability struct {
	ReadTextFile  bool `json:"readTextFile"`
	WriteTextFile bool `json:"writeTextFile"`
}

type ClientCapabilities struct {
	FS       FSCapability `json:"fs"`
	Terminal bool         `json:"terminal"`
}

type InitializeParams struct {
	ProtocolVersion    int                `json:"protocolVersion"`
	ClientCapabilities ClientCapabilities `json:"clientCapabilities"`
	ClientInfo         ClientInfo         `json:"clientInfo"`
}

type PromptCapabilities struct {
	Image           bool `json:"image,omitempty"`
	Audio           bool `json:"audio,omitempty"`
	EmbeddedContext bool `json:"embeddedContext,omitempty"`
}

type AgentCapabilities struct {
	LoadSession        bool                `json:"loadSession,omitempty"`
	PromptCapabilities *PromptCapabilities `json:"promptCapabilities,omitempty"`
}

type AgentInfo struct {
	Name    string `json:"name,omitempty"`
	Title   string `json:"title,omitempty"`
	Version string `json:"version,omitempty"`
}

type InitializeResult struct {
	ProtocolVersion   int               `json:"protocolVersion"`
	AgentCapabilities AgentCapabilities `json:"agentCapabilities"`
	AgentInfo         AgentInfo         `json:"agentInfo"`
	AuthMethods       []json.RawMessage `json:"authMethods,omitempty"`
}

// ---------- session/new ----------

type EnvVariable struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// McpServer 这里只实现了 stdio 传输方式（ACP 要求所有 Agent 必须支持）。
type McpServer struct {
	Name    string        `json:"name"`
	Command string        `json:"command"`
	Args    []string      `json:"args"`
	Env     []EnvVariable `json:"env"`
}

type NewSessionParams struct {
	Cwd        string      `json:"cwd"`
	McpServers []McpServer `json:"mcpServers"`
}

type NewSessionResult struct {
	SessionID string `json:"sessionId"`
}

// ---------- session/prompt ----------

// ContentBlock 这里只实现了最基础、所有 Agent 都必须支持的 "text" 类型，
// 足以完成打招呼场景。如果需要发送图片/资源等，可以在这里扩展字段。
type ContentBlock struct {
	Type string `json:"type"` // "text"
	Text string `json:"text,omitempty"`
}

func TextBlock(text string) ContentBlock {
	return ContentBlock{Type: "text", Text: text}
}

type PromptParams struct {
	SessionID string         `json:"sessionId"`
	Prompt    []ContentBlock `json:"prompt"`
}

type PromptResult struct {
	StopReason string `json:"stopReason"`
}

// ---------- session/cancel ----------

type CancelParams struct {
	SessionID string `json:"sessionId"`
}

// ---------- session/update（Agent -> Client 的通知） ----------

type SessionUpdateParams struct {
	SessionID string          `json:"sessionId"`
	Update    json.RawMessage `json:"update"`
}

// updateKind 用来读出 update 对象里的 "sessionUpdate" 判别字段。
type updateKind struct {
	SessionUpdate string `json:"sessionUpdate"`
}

type messageChunkUpdate struct {
	MessageID string       `json:"messageId,omitempty"`
	Content   ContentBlock `json:"content"`
}

type toolCallUpdate struct {
	ToolCallID string `json:"toolCallId"`
	Title      string `json:"title,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Status     string `json:"status,omitempty"`
}

type planEntry struct {
	Content  string `json:"content"`
	Priority string `json:"priority,omitempty"`
	Status   string `json:"status,omitempty"`
}

type planUpdate struct {
	Entries []planEntry `json:"entries"`
}

type usageUpdate struct {
	Used int `json:"used"`
	Size int `json:"size"`
	Cost *struct {
		Amount   float64 `json:"amount"`
		Currency string  `json:"currency"`
	} `json:"cost,omitempty"`
}

// ---------- session/request_permission（Agent -> Client 的请求） ----------

type permissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}

type requestPermissionParams struct {
	SessionID string             `json:"sessionId"`
	ToolCall  toolCallUpdate     `json:"toolCall"`
	Options   []permissionOption `json:"options"`
}

type permissionOutcome struct {
	Outcome  string `json:"outcome"` // "selected" | "cancelled"
	OptionID string `json:"optionId,omitempty"`
}

type requestPermissionResult struct {
	Outcome permissionOutcome `json:"outcome"`
}
