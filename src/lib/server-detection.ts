import { invoke } from "@tauri-apps/api/core";

export type AcpServerType = "opencode" | "cursor" | "custom";

export async function detectAcpServer(
  serverType: AcpServerType,
): Promise<string | null> {
  try {
    const result = (await invoke("detect_acp_server", {
      serverType,
    })) as string | null;
    return result;
  } catch (error) {
    console.error(`[server-detection] failed to detect ${serverType}:`, error);
    return null;
  }
}
