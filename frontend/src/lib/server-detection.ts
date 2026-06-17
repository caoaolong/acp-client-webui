import { DetectAcpServer } from "../../wailsjs/go/main/App";
import { isWailsRuntime } from "@/acp/acp-wails-client";

export type AcpServerType = "qwen" | "opencode" | "cursor" | "custom";

export async function detectAcpServer(
  serverType: AcpServerType,
): Promise<string | null> {
  if (!isWailsRuntime()) {
    return null;
  }
  try {
    const result = await DetectAcpServer(serverType);
    return result.path ?? null;
  } catch (error) {
    console.error(`[server-detection] failed to detect ${serverType}:`, error);
    return null;
  }
}
