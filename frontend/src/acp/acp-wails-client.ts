import type { AcpBridgeEvent } from "./types";
import {
  Cancel,
  DeleteSession,
  ListSessions,
  NewSession,
  PermissionResponse,
  Prompt,
  Start,
  Stop,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";

export function isWailsRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "go" in window &&
    typeof (window as { go?: unknown }).go === "object"
  );
}

export async function ensureAcpBridge(): Promise<void> {
  // Wails 后端在 Startup 时已就绪，无需额外 sidecar。
}

export async function startAcpAgent(params?: {
  cwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
}): Promise<unknown> {
  return Start({
    cwd: params?.cwd ?? "",
    agentCommand: params?.agentCommand ?? "",
    agentArgs: params?.agentArgs ?? [],
  });
}

export async function stopAcpAgent(): Promise<void> {
  return Stop();
}

export async function createAcpSession(params?: {
  cwd?: string;
  title?: string;
}): Promise<{ sessionId: string }> {
  const result = await NewSession({
    cwd: params?.cwd ?? "",
    title: params?.title ?? "",
  });
  return { sessionId: result.sessionId };
}

export async function promptAcpSession(
  sessionId: string,
  text: string,
): Promise<unknown> {
  return Prompt({ sessionId, text });
}

export async function cancelAcpSession(sessionId: string): Promise<unknown> {
  return Cancel({ sessionId });
}

export async function listAcpSessions(): Promise<{
  sessions: Array<{
    sessionId: string;
    title?: string;
    createdAt?: number;
  }>;
}> {
  const result = await ListSessions();
  return {
    sessions: result.sessions.map((session) => ({
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt,
    })),
  };
}

export async function deleteAcpSession(sessionId: string): Promise<unknown> {
  return DeleteSession({ sessionId });
}

export async function respondAcpPermission(
  requestId: string,
  optionId?: string,
): Promise<unknown> {
  return PermissionResponse({
    requestId,
    optionId: optionId,
  });
}

export function listenAcpEvents(
  handler: (event: AcpBridgeEvent) => void,
): () => void {
  return EventsOn("acp-event", (payload: AcpBridgeEvent) => {
    handler(payload);
  });
}
