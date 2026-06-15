import { useOpenCodeThreadState } from "@assistant-ui/react-opencode";
import { useEffect, useMemo, useState } from "react";

const OPENCODE_BASE_URL =
  import.meta.env.VITE_OPENCODE_BASE_URL ?? "http://localhost:4096";

type SseStatus = "offline" | "idle" | "live" | "waiting";

const STATUS_META: Record<
  SseStatus,
  { dotClass: string; label: string }
> = {
  offline: { dotClass: "bg-destructive", label: "服务离线" },
  idle: { dotClass: "bg-muted-foreground/40", label: "SSE 空闲" },
  live: { dotClass: "bg-green-500", label: "事件活跃" },
  waiting: { dotClass: "bg-amber-500 animate-pulse", label: "等待事件" },
};

/**
 * 根据 OpenCode 线程状态与 /global/health 显示 SSE 事件是否到达。
 * - 事件活跃：3s 内收到过 SSE 驱动的事件
 * - 等待事件：正在生成但长时间无事件（可能 SSE 未连接）
 */
export function OpenCodeSseStatus() {
  const [serverOk, setServerOk] = useState(true);
  const [, setTick] = useState(0);

  const lastEventAt = useOpenCodeThreadState((s) => s.sync.lastEventAt);
  const runState = useOpenCodeThreadState((s) => s.runState);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${OPENCODE_BASE_URL}/global/health`);
        setServerOk(res.ok);
      } catch {
        setServerOk(false);
      }
    };

    void checkHealth();
    const id = window.setInterval(checkHealth, 15_000);
    return () => window.clearInterval(id);
  }, []);

  const status: SseStatus = useMemo(() => {
    if (!serverOk) return "offline";

    const isActiveRun =
      runState.type === "streaming" ||
      runState.type === "cancelling" ||
      runState.type === "reverting";

    const eventAgeMs = lastEventAt ? Date.now() - lastEventAt : Number.POSITIVE_INFINITY;

    if (eventAgeMs < 3000) return "live";
    if (isActiveRun) return "waiting";
    return "idle";
  }, [serverOk, lastEventAt, runState.type]);

  const meta = STATUS_META[status];
  const secondsSinceEvent =
    lastEventAt !== undefined
      ? Math.max(0, Math.round((Date.now() - lastEventAt) / 1000))
      : null;

  return (
    <div
      className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
      title="基于 /event SSE 事件时间戳；生成中若长期显示「等待事件」请检查 Network 里 /event 连接"
    >
      <span
        className={`size-2 shrink-0 rounded-full ${meta.dotClass}`}
        aria-hidden
      />
      <span>{meta.label}</span>
      {secondsSinceEvent !== null ? (
        <span className="text-muted-foreground/60">· {secondsSinceEvent}s前</span>
      ) : null}
    </div>
  );
}
