#!/usr/bin/env node
/**
 * ACP Sidecar：Tauri 与 opencode acp（stdio JSON-RPC）之间的桥接进程。
 * - stdin：Tauri 发来的命令（换行分隔 JSON）
 * - stdout：响应与事件（换行分隔 JSON）
 */
import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function emit(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function parseAgentArgs() {
  const raw = process.env.ACP_AGENT_ARGS;
  if (!raw) return ["acp"];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : ["acp"];
  } catch {
    return raw.split(/\s+/).filter(Boolean);
  }
}

class BridgeClient {
  #permissionWaiters = new Map();

  async sessionUpdate(params) {
    emit({ type: "event", event: "session_update", data: params });
  }

  async requestPermission(params) {
    const requestId = crypto.randomUUID();
    emit({
      type: "event",
      event: "permission_request",
      data: { requestId, ...params },
    });
    return new Promise((resolve) => {
      this.#permissionWaiters.set(requestId, resolve);
    });
  }

  resolvePermission(requestId, optionId) {
    const resolve = this.#permissionWaiters.get(requestId);
    if (!resolve) return;
    this.#permissionWaiters.delete(requestId);
    resolve({
      outcome: { outcome: "selected", optionId },
    });
  }

  cancelPermission(requestId) {
    const resolve = this.#permissionWaiters.get(requestId);
    if (!resolve) return;
    this.#permissionWaiters.delete(requestId);
    resolve({
      outcome: { outcome: "cancelled" },
    });
  }

  async readTextFile(params) {
    const content = await fs.readFile(params.path, "utf-8");
    return { content };
  }

  async writeTextFile(params) {
    const dir = path.dirname(params.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(params.path, params.content, "utf-8");
    return {};
  }
}

let connection = null;
let agentProcess = null;
let bridgeClient = new BridgeClient();
let defaultCwd = process.env.ACP_CWD ?? process.cwd();
const sessions = new Map();

function resolveAgentCommand(params = {}) {
  return params.agentCommand ?? process.env.ACP_AGENT_COMMAND ?? "opencode";
}

function resolveAgentArgs(params = {}) {
  if (Array.isArray(params.agentArgs)) {
    return params.agentArgs.map(String);
  }
  return parseAgentArgs();
}

async function startAgent(params = {}) {
  if (connection) {
    return { alreadyStarted: true };
  }

  const agentCommand = resolveAgentCommand(params);
  const agentArgs = resolveAgentArgs(params);
  defaultCwd = params.cwd ?? process.env.ACP_CWD ?? process.cwd();

  agentProcess = spawn(agentCommand, agentArgs, {
    cwd: defaultCwd,
    stdio: ["pipe", "pipe", "inherit"],
    shell: process.platform === "win32",
    env: process.env,
  });

  agentProcess.on("exit", (code, signal) => {
    emit({
      type: "event",
      event: "agent_exit",
      data: { code, signal },
    });
    connection = null;
    agentProcess = null;
  });

  const input = Writable.toWeb(agentProcess.stdin);
  const output = Readable.toWeb(agentProcess.stdout);
  const stream = acp.ndJsonStream(input, output);
  bridgeClient = new BridgeClient();
  connection = new acp.ClientSideConnection((_agent) => bridgeClient, stream);

  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  });

  return initResult;
}

async function handleCommand(cmd) {
  const { id, method, params = {} } = cmd;
  try {
    let result;
    switch (method) {
      case "start":
        result = await startAgent(params);
        break;
      case "newSession": {
        if (!connection) throw new Error("ACP agent not started");
        const sessionResult = await connection.newSession({
          cwd: params.cwd ?? defaultCwd,
          mcpServers: [],
        });
        sessions.set(sessionResult.sessionId, {
          cwd: params.cwd ?? defaultCwd,
          title: params.title ?? "New Chat",
          createdAt: Date.now(),
        });
        result = sessionResult;
        break;
      }
      case "prompt": {
        if (!connection) throw new Error("ACP agent not started");
        result = await connection.prompt({
          sessionId: params.sessionId,
          prompt: [{ type: "text", text: params.text }],
        });
        break;
      }
      case "cancel": {
        if (!connection) throw new Error("ACP agent not started");
        await connection.cancel({ sessionId: params.sessionId });
        result = { ok: true };
        break;
      }
      case "listSessions":
        result = {
          sessions: [...sessions.entries()].map(([sessionId, meta]) => ({
            sessionId,
            ...meta,
          })),
        };
        break;
      case "deleteSession":
        sessions.delete(params.sessionId);
        result = { ok: true };
        break;
      case "permissionResponse":
        bridgeClient.resolvePermission(params.requestId, params.optionId);
        result = { ok: true };
        break;
      case "permissionCancel":
        bridgeClient.cancelPermission(params.requestId);
        result = { ok: true };
        break;
      case "shutdown":
        agentProcess?.kill();
        emit({ type: "response", id, result: { ok: true } });
        process.exit(0);
        return;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    emit({ type: "response", id, result });
  } catch (error) {
    emit({
      type: "response",
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

emit({ type: "ready" });

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let cmd;
  try {
    cmd = JSON.parse(trimmed);
  } catch (error) {
    emit({
      type: "event",
      event: "bridge_error",
      data: {
        message: error instanceof Error ? error.message : String(error),
        line: trimmed,
      },
    });
    return;
  }
  void handleCommand(cmd);
});
