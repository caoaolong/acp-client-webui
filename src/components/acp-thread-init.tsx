import { useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

/**
 * 新建线程在 ACP session 创建完成前没有 sessionId，
 * 占位运行时会禁用输入框。切换到 status === "new" 时主动 initialize。
 */
export function AcpThreadInit() {
  const aui = useAui();
  const status = useAuiState((s) => s.threadListItem.status);
  const threadId = useAuiState((s) => s.threadListItem.id);
  const initForRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "new") {
      initForRef.current = null;
      return;
    }
    if (initForRef.current === threadId) return;
    initForRef.current = threadId;

    void aui.threadListItem().initialize().catch((error) => {
      console.error("[ACP] session initialize failed", error);
      initForRef.current = null;
    });
  }, [aui, status, threadId]);

  return null;
}
