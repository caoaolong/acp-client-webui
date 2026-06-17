import {
  isWailsRuntime,
  listenAcpEvents,
  startAcpAgent,
  stopAcpAgent,
} from "@/acp/acp-wails-client";
import { useEffect, useState } from "react";

type BridgeStatus =
  | "wails_required"
  | "starting"
  | "bridge_ready"
  | "agent_ready"
  | "agent_exit"
  | "bridge_closed"
  | "error";

export function AcpStatus() {
  const [status, setStatus] = useState<BridgeStatus>(
    isWailsRuntime() ? "starting" : "wails_required",
  );
  const [detail, setDetail] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (!isWailsRuntime()) return;

    const unlisten = listenAcpEvents((event) => {
      if (event.type === "ready") {
        setStatus("bridge_ready");
        return;
      }

      if (event.type !== "event") return;

      switch (event.event) {
        case "bridge_ready":
          setStatus("bridge_ready");
          break;
        case "agent_ready":
          setStatus("agent_ready");
          setDetail(null);
          break;
        case "agent_exit":
          setStatus("agent_exit");
          setDetail(
            (event.data as { code?: number | null })?.code != null
              ? `exit code ${(event.data as { code?: number }).code}`
              : "agent exited",
          );
          break;
        case "bridge_closed":
          setStatus("bridge_closed");
          break;
        case "bridge_error":
          setStatus("error");
          setDetail(
            (event.data as { message?: string })?.message ?? "bridge error",
          );
          break;
        default:
          break;
      }
    });

    return () => {
      unlisten();
    };
  }, []);

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      if (status === "agent_ready") {
        // Stop the agent
        await stopAcpAgent();
        setStatus("agent_exit");
        setDetail("manually stopped");
      } else if (
        status === "agent_exit" ||
        status === "error" ||
        status === "bridge_closed"
      ) {
        // Start the agent
        setStatus("starting");
        setDetail(null);
        await startAcpAgent();
      }
    } catch (error) {
      setDetail(error instanceof Error ? error.message : "Unknown error");
      setStatus("error");
    } finally {
      setIsToggling(false);
    }
  };

  const label = {
    wails_required: "需要 Wails 桌面端",
    starting: "启动 ACP Agent…",
    bridge_ready: "后端已连接",
    agent_ready: "ACP Agent 就绪 (stdio)",
    agent_exit: "Agent 已退出",
    bridge_closed: "连接已断开",
    error: "桥接错误",
  }[status];

  const tone =
    status === "agent_ready"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "starting" || status === "bridge_ready"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  const isClickable =
    status !== "starting" &&
    status !== "wails_required" &&
    status !== "bridge_ready";
  const buttonLabel = status === "agent_ready" ? "停止" : "启动";

  return (
    <button
      onClick={handleToggle}
      disabled={isToggling || !isClickable}
      className={`rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs transition-colors ${
        isClickable && !isToggling
          ? "hover:bg-muted/40 cursor-pointer"
          : "cursor-default"
      } disabled:opacity-50`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block size-1.5 rounded-full ${
              status === "agent_ready"
                ? "bg-emerald-500"
                : status === "starting" || status === "bridge_ready"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-muted-foreground/50"
            }`}
          />
          <span className={tone}>{label}</span>
        </div>
        {isClickable && (
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-background/50 rounded border border-border/40 whitespace-nowrap">
            {isToggling ? "…" : buttonLabel}
          </span>
        )}
      </div>
      {detail ? (
        <p className="text-muted-foreground mt-1 truncate text-xs">{detail}</p>
      ) : null}
      <p className="text-muted-foreground mt-1 text-xs">
        传输：JSON-RPC 2.0 / stdio
      </p>
    </button>
  );
}
