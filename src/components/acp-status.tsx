import { isTauriRuntime } from "@/acp/acp-tauri-client";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type BridgeStatus =
  | "tauri_required"
  | "starting"
  | "bridge_ready"
  | "agent_ready"
  | "agent_exit"
  | "bridge_closed"
  | "error";

export function AcpStatus() {
  const [status, setStatus] = useState<BridgeStatus>(
    isTauriRuntime() ? "starting" : "tauri_required",
  );
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    void listen("acp-event", (payload) => {
      const event = payload.payload as {
        type?: string;
        event?: string;
        data?: { message?: string; code?: number | null };
      };

      if (event.type === "event") {
        switch (event.event) {
          case "bridge_ready":
            setStatus("bridge_ready");
            break;
          case "agent_exit":
            setStatus("agent_exit");
            setDetail(
              event.data?.code != null
                ? `exit code ${event.data.code}`
                : "agent exited",
            );
            break;
          case "bridge_closed":
            setStatus("bridge_closed");
            break;
          case "bridge_error":
            setStatus("error");
            setDetail(event.data?.message ?? "bridge error");
            break;
          default:
            break;
        }
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (status === "bridge_ready") {
      setStatus("agent_ready");
    }
  }, [status]);

  const label = {
    tauri_required: "需要 Tauri 桌面端",
    starting: "启动 ACP Sidecar…",
    bridge_ready: "Sidecar 已连接",
    agent_ready: "ACP Agent 就绪 (stdio)",
    agent_exit: "Agent 已退出",
    bridge_closed: "Sidecar 已断开",
    error: "桥接错误",
  }[status];

  const tone =
    status === "agent_ready"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "starting" || status === "bridge_ready"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs">
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
      {detail ? (
        <p className="text-muted-foreground mt-1 truncate">{detail}</p>
      ) : null}
      <p className="text-muted-foreground mt-1">传输：JSON-RPC 2.0 / stdio</p>
    </div>
  );
}
