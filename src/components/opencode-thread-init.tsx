import { useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

/**
 * 新建线程在 OpenCode session 创建完成前没有 sessionId，
 * useOpenCodeRuntime 会返回 isDisabled 的占位运行时，导致输入框不可编辑。
 * 切换到 status === "new" 的线程时主动 initialize，提前创建 session。
 */
export function OpenCodeThreadInit() {
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
      console.error("[OpenCode] session initialize failed", error);
      initForRef.current = null;
    });
  }, [aui, status, threadId]);

  return null;
}
