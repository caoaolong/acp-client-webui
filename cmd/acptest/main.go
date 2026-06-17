package main

import (
	"acpcw/protocol"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"
	"time"
)

const (
	initializeReq = `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"clientInfo":{"name":"acp-client-webui","title":"AcpClientWebUI","version":"1.0.0"}}}`

	authenticateReq = `{"jsonrpc":"2.0","id":1,"method":"authenticate","params":{"methodId":"opencode-login"}}`

	sessionNewReq = `{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"D:\\project\\acp-client-webui","mcpServers":[]}}`
)

func main() {
	log.SetFlags(log.Ltime)

	cmd := exec.Command("opencode", "acp")

	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal(err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Fatal(err)
	}

	if err := cmd.Start(); err != nil {
		log.Fatal(err)
	}

	var (
		sessionMu sync.Mutex
		sessionID string
	)

	go readStdout(stdout, stdin, &sessionMu, &sessionID)
	go drainStderr(stderr)

	// 1. 发送 initialize
	if err := sendLine(stdin, initializeReq); err != nil {
		log.Fatal(err)
	}

	// 2. 3 秒后发送 authenticate
	time.Sleep(3 * time.Second)
	if err := sendLine(stdin, authenticateReq); err != nil {
		log.Fatal(err)
	}

	// 3. 3 秒后发送 session/new
	time.Sleep(3 * time.Second)
	if err := sendLine(stdin, sessionNewReq); err != nil {
		log.Fatal(err)
	}

	// 4. 等待从输出中获取 sessionId
	sid := waitSessionID(&sessionMu, &sessionID, 30*time.Second)
	if sid == "" {
		log.Fatal("未能从输出中获取 sessionId")
	}
	log.Printf("获取到 sessionId: %s", sid)

	// 5. 3 秒后发送 session/prompt
	time.Sleep(3 * time.Second)
	promptReq := buildPromptRequest(sid)
	if err := sendLine(stdin, promptReq); err != nil {
		log.Fatal(err)
	}

	// 6. 等待 10 秒后退出
	time.Sleep(10 * time.Second)
	log.Println("测试完成，退出")

	_ = cmd.Process.Kill()
}

func sendLine(w io.Writer, line string) error {
	log.Printf("[SEND] %s", line)
	_, err := fmt.Fprintf(w, "%s\n", line)
	return err
}

func readStdout(r io.Reader, stdin io.Writer, sessionMu *sync.Mutex, sessionID *string) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		fmt.Println(line)

		var resp protocol.Response
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}

		// 从 session/new 响应中提取 sessionId
		if protocol.IDEqual(resp.ID, 3) && resp.Error == nil && resp.Method == "" {
			var result protocol.SessionNewResult
			if err := resp.UnmarshalResult(&result); err == nil && result.SessionID != "" {
				sessionMu.Lock()
				*sessionID = result.SessionID
				sessionMu.Unlock()
			}
		}

		// 自动批准 agent 发来的权限等请求
		if resp.Method != "" && resp.ID != nil {
			reply := fmt.Sprintf(`{"jsonrpc":"2.0","id":%s,"result":{"outcome":"approved"}}`, formatID(resp.ID))
			_ = sendLine(stdin, reply)
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("读取 stdout 失败: %v", err)
	}
}

func drainStderr(r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		log.Printf("[STDERR] %s", scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		log.Printf("读取 stderr 失败: %v", err)
	}
}

func waitSessionID(sessionMu *sync.Mutex, sessionID *string, timeout time.Duration) string {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		sessionMu.Lock()
		sid := *sessionID
		sessionMu.Unlock()
		if sid != "" {
			return sid
		}
		time.Sleep(100 * time.Millisecond)
	}
	return ""
}

func buildPromptRequest(sessionID string) string {
	req := protocol.Request{
		JSONRPC: "2.0",
		ID:      4,
		Method:  "session/prompt",
		Params: protocol.SessionPromptParams{
			SessionID: sessionID,
			Prompt: []protocol.ContentBlock{
				{Type: "text", Text: "你好，请简单介绍一下你自己"},
			},
		},
	}
	data, _ := json.Marshal(req)
	return string(data)
}

func formatID(id any) string {
	switch v := id.(type) {
	case float64:
		if v == float64(int64(v)) {
			return fmt.Sprintf("%d", int64(v))
		}
		return fmt.Sprintf("%g", v)
	case json.Number:
		return v.String()
	default:
		b, _ := json.Marshal(id)
		return string(b)
	}
}
