import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpBridgeEvent } from "./types";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function ensureAcpBridge(): Promise<void> {
  await invoke("acp_ensure_bridge");
}

export async function startAcpAgent(params?: {
  cwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
}): Promise<unknown> {
  return invoke("acp_start", { params: params ?? {} });
}

export async function createAcpSession(params?: {
  cwd?: string;
  title?: string;
}): Promise<{ sessionId: string }> {
  const result = (await invoke("acp_new_session", {
    params: params ?? {},
  })) as { sessionId: string };
  return result;
}

export async function promptAcpSession(
  sessionId: string,
  text: string,
): Promise<unknown> {
  return invoke("acp_prompt", {
    params: { sessionId, text },
  });
}

export async function cancelAcpSession(sessionId: string): Promise<unknown> {
  return invoke("acp_cancel", {
    params: { sessionId },
  });
}

export async function listAcpSessions(): Promise<{
  sessions: Array<{
    sessionId: string;
    title?: string;
    createdAt?: number;
  }>;
}> {
  return invoke("acp_list_sessions") as Promise<{
    sessions: Array<{
      sessionId: string;
      title?: string;
      createdAt?: number;
    }>;
  }>;
}

export async function deleteAcpSession(sessionId: string): Promise<unknown> {
  return invoke("acp_delete_session", {
    params: { sessionId },
  });
}

export async function respondAcpPermission(
  requestId: string,
  optionId?: string,
): Promise<unknown> {
  return invoke("acp_permission_response", {
    params: { requestId, optionId },
  });
}

export function listenAcpEvents(
  handler: (event: AcpBridgeEvent) => void,
): Promise<UnlistenFn> {
  return listen<AcpBridgeEvent>("acp-event", (payload) => {
    handler(payload.payload);
  });
}
