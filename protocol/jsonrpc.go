// Package protocol 提供 ACP JSON-RPC 消息的基础类型，供集成测试等低层工具使用。
package protocol

import "encoding/json"

// Request 是 JSON-RPC 2.0 请求。
type Request struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// Response 是 JSON-RPC 2.0 响应（也用于解析 Agent 发来的请求）。
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError 对应 JSON-RPC 2.0 的 error 对象。
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SessionNewResult 是 session/new 的响应体。
type SessionNewResult struct {
	SessionID string `json:"sessionId"`
}

// SessionPromptParams 是 session/prompt 的请求参数。
type SessionPromptParams struct {
	SessionID string         `json:"sessionId"`
	Prompt    []ContentBlock `json:"prompt"`
}

// ContentBlock 是 prompt 中的内容块。
type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// UnmarshalResult 将 result 字段解码到 v。
func (r *Response) UnmarshalResult(v any) error {
	if len(r.Result) == 0 {
		return nil
	}
	return json.Unmarshal(r.Result, v)
}

// IDEqual 判断 JSON-RPC id 是否等于整数 n（JSON 数字默认解析为 float64）。
func IDEqual(id any, n int) bool {
	switch v := id.(type) {
	case float64:
		return int64(v) == int64(n)
	case int:
		return v == n
	case int64:
		return v == int64(n)
	case json.Number:
		i, err := v.Int64()
		return err == nil && i == int64(n)
	default:
		return false
	}
}
