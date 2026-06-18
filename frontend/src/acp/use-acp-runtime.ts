import {
  ExportedMessageRepository,
  useAuiState,
  useExternalStoreRuntime,
  useRemoteThreadListRuntime,
  type AssistantRuntime,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAcpSession,
  createAcpSession,
  deleteAcpSession,
  ensureAcpBridge,
  isWailsRuntime,
  listenAcpEvents,
  listAcpSessions,
  promptAcpSession,
  respondAcpPermission,
  startAcpAgent,
} from "./acp-wails-client";
import {
  appendUserMessage,
  applySessionUpdate,
  beginAssistantResponse,
  finishAssistantResponse,
  toThreadMessageLike,
} from "./map-session-update";
import type {
  AcpPermissionRequest,
  AcpSessionNotification,
  AcpThreadState,
} from "./types";
import { createEmptyThreadState } from "./types";
import { logPacket, logMergedPacket } from "@/store/packet-log";
import type { AcpBridgeEvent } from "./types";

function getEventSummary(event: AcpBridgeEvent): string {
  if (event.type !== "event") return event.type;
  const data = event.data as Record<string, unknown> | undefined;
  switch (event.event) {
    case "session_update":
      return `Session: ${String(data?.sessionId ?? "").slice(0, 8)}...`;
    case "permission_request":
      return `Request: ${String(data?.requestId ?? "").slice(0, 8)}...`;
    case "agent_exit":
      return "Agent process exited";
    case "bridge_closed":
      return "Bridge connection closed";
    default:
      return event.event;
  }
}

const ACP_RUNTIME_EXTRAS = Symbol("acp-runtime-extras");

type AcpRuntimeExtras = {
  readonly [ACP_RUNTIME_EXTRAS]: true;
  state: AcpThreadState;
  permissions: AcpPermissionRequest[];
  replyPermission: (requestId: string, optionId?: string) => Promise<void>;
};

export type UseAcpRuntimeOptions = {
  cwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
};

const EMPTY_THREAD_STATE = createEmptyThreadState("__pending__");
const NOOP_ON_NEW = () =>
  Promise.reject(new Error("ACP session is still initializing"));
const EMPTY_PERMISSIONS: AcpPermissionRequest[] = [];
const NOOP_REPLY_PERMISSION = async (
  _requestId: string,
  _optionId?: string,
) => {
  throw new Error("ACP runtime is not ready yet");
};

type ThreadStore = {
  states: Map<string, AcpThreadState>;
  listeners: Set<() => void>;
  setState: (
    sessionId: string,
    updater: (current: AcpThreadState) => AcpThreadState,
  ) => void;
  getState: (sessionId: string) => AcpThreadState;
  subscribe: (listener: () => void) => () => void;
};

function createThreadStore(): ThreadStore {
  const states = new Map<string, AcpThreadState>();
  const listeners = new Set<() => void>();

  return {
    states,
    listeners,
    getState(sessionId) {
      return states.get(sessionId) ?? createEmptyThreadState(sessionId);
    },
    setState(sessionId, updater) {
      const current =
        states.get(sessionId) ?? createEmptyThreadState(sessionId);
      states.set(sessionId, updater(current));
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useThreadStoreState(
  store: ThreadStore,
  sessionId: string | undefined,
) {
  const [, forceRender] = useState(0);
  useEffect(() => store.subscribe(() => forceRender((v) => v + 1)), [store]);
  if (!sessionId) return EMPTY_THREAD_STATE;
  return store.getState(sessionId);
}

function useAcpThreadRuntime(
  sessionId: string | undefined,
  store: ThreadStore,
  ready: boolean,
  bridgeError: string | null,
  permissions: AcpPermissionRequest[],
  replyPermission: (requestId: string, optionId?: string) => Promise<void>,
) {
  const state = useThreadStoreState(store, sessionId);

  const messageRepository = useMemo(
    () =>
      ExportedMessageRepository.fromArray(
        toThreadMessageLike(state.messages) as ThreadMessageLike[],
      ),
    [state.messages],
  );

  const extras = useMemo<AcpRuntimeExtras>(
    () => ({
      [ACP_RUNTIME_EXTRAS]: true as const,
      state,
      permissions,
      replyPermission,
    }),
    [state, permissions, replyPermission],
  );

  const disabled = !sessionId || !ready || !!bridgeError;

  const enabledRuntime = useExternalStoreRuntime<ThreadMessage>({
    isLoading: false,
    isRunning: state.isRunning,
    messageRepository,
    extras,
    onNew: async (message) => {
      if (!sessionId) return;
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) return;

      store.setState(sessionId, (current) => appendUserMessage(current, text));
      store.setState(sessionId, (current) => beginAssistantResponse(current));
      logPacket("request", "prompt", `Session: ${sessionId.slice(0, 8)}...`, { sessionId, text });
      try {
        const result = (await promptAcpSession(sessionId, text)) as {
          stopReason?: string;
        };
        logPacket("response", "prompt_result", `Stop: ${result.stopReason ?? "unknown"}`, result);
        store.setState(sessionId, (current) =>
          finishAssistantResponse(current, result.stopReason),
        );
      } catch (error) {
        logPacket("response", "prompt_error", error instanceof Error ? error.message : String(error), { error: error instanceof Error ? error.message : String(error) });
        store.setState(sessionId, (current) => ({
          ...finishAssistantResponse(current, "error"),
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    },
    onCancel: async () => {
      if (!sessionId) return;
      logPacket("request", "cancel", `Session: ${sessionId.slice(0, 8)}...`, { sessionId });
      await cancelAcpSession(sessionId);
      store.setState(sessionId, (current) => ({
        ...current,
        isRunning: false,
      }));
    },
  });

  const fallbackRuntime = useExternalStoreRuntime<ThreadMessage>({
    isDisabled: true,
    isLoading: !ready || !!bridgeError,
    messageRepository: ExportedMessageRepository.fromArray([]),
    onNew: NOOP_ON_NEW,
  });

  return disabled ? fallbackRuntime : enabledRuntime;
}

function useAcpRuntimeHook(
  store: ThreadStore,
  ready: boolean,
  bridgeError: string | null,
  permissions: AcpPermissionRequest[],
  replyPermission: (requestId: string, optionId?: string) => Promise<void>,
) {
  const sessionId = useAuiState(
    (state) => state.threadListItem.externalId ?? state.threadListItem.remoteId,
  );

  return useAcpThreadRuntime(
    sessionId,
    store,
    ready,
    bridgeError,
    permissions,
    replyPermission,
  );
}

export function useAcpRuntime(
  options: UseAcpRuntimeOptions = {},
): AssistantRuntime {
  const [ready, setReady] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<AcpPermissionRequest[]>([]);
  const storeRef = useRef<ThreadStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createThreadStore();
  }
  const store = storeRef.current;

  const replyPermission = useCallback(
    async (requestId: string, optionId?: string) => {
      logPacket("request", "permission_response", `Request: ${requestId.slice(0, 8)}...`, { requestId, optionId });
      await respondAcpPermission(requestId, optionId);
      setPermissions((current) =>
        current.filter((item) => item.requestId !== requestId),
      );
    },
    [],
  );

  useEffect(() => {
    if (!isWailsRuntime()) {
      setBridgeError("ACP 模式需要在 Wails 桌面应用中运行");
      return;
    }

    let unlisten: (() => void) | undefined;

    const boot = async () => {
      try {
        logPacket("request", "ensure_bridge", "Ensure ACP bridge ready", {});
        await ensureAcpBridge();
        logPacket("response", "ensure_bridge_ok", "Bridge ready", {});

        logPacket("request", "start_agent", "Start ACP agent", {
          cwd: options.cwd,
          agentCommand: options.agentCommand,
          agentArgs: options.agentArgs,
        });
        await startAcpAgent({
          cwd: options.cwd,
          agentCommand: options.agentCommand,
          agentArgs: options.agentArgs,
        });
        logPacket("response", "start_agent_ok", "Agent started", {});
        setReady(true);
        setBridgeError(null);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logPacket("response", "boot_error", msg, { error: msg });
        setBridgeError(msg);
      }
    };

    void boot();
    unlisten = listenAcpEvents((event) => {
      if (event.type === "event") {
        const eventData = event.data as Record<string, unknown> | undefined;

        if (event.event === "raw_message") {
          const direction = eventData?.direction as string;
          const raw = eventData?.raw as Record<string, unknown> | undefined;
          if (raw) {
            const method = raw.method as string | undefined;
            const id = raw.id;
            const hasResult = raw.result !== undefined;
            const hasError = raw.error !== undefined;

            const params = raw.params as Record<string, unknown> | undefined;
            const update = params?.update as Record<string, unknown> | undefined;
            const sessionUpdate = update?.sessionUpdate as string | undefined;
            if (sessionUpdate === "agent_message_chunk") return;

            let packetDir: "request" | "response" | "event";
            let typeName: string;
            let summary: string;

            if (method && id !== undefined) {
              packetDir = direction === "send" ? "request" : "event";
              typeName = method;
              summary = direction === "send" ? `→ ${method}` : `← ${method}`;
            } else if (method) {
              packetDir = "event";
              typeName = method;
              summary = direction === "send" ? `→ ${method}` : `← ${method}`;
            } else if (id !== undefined && (hasResult || hasError)) {
              packetDir = "response";
              typeName = `response #${id}`;
              const err = raw.error as Record<string, unknown> | undefined;
              summary = err ? `← error: ${err.message}` : `← response #${id}`;
            } else {
              packetDir = "event";
              typeName = "unknown";
              summary = direction;
            }

            logPacket(packetDir, typeName, summary, raw);
          }
          return;
        }

        const sessionId = eventData?.sessionId as string | undefined;
        const update = eventData?.update as Record<string, unknown> | undefined;
        const sessionUpdate = update?.sessionUpdate as string | undefined;

        if (sessionUpdate === "agent_message_chunk" && sessionId) {
          const content = update?.content as Record<string, unknown> | undefined;
          const chunkText = (content?.text as string) ?? "";
          const mergeKey = `agent_message_chunk:${sessionId}`;
          logMergedPacket(
            mergeKey,
            "event",
            "agent_message_chunk",
            `Session: ${sessionId.slice(0, 8)}...`,
            event.data,
            chunkText,
          );
        } else {
          logPacket("event", event.event, getEventSummary(event), event.data);
        }
      } else if (event.type === "response") {
        logPacket("response", `response_${event.id}`, event.error ?? "OK", event);
      } else if (event.type === "ready") {
        logPacket("event", "ready", "ACP bridge ready", event);
      }

      if (event.type !== "event") return;

      if (event.event === "session_update") {
        const notification = event.data as AcpSessionNotification;
        store.setState(notification.sessionId, (current) =>
          applySessionUpdate(current, notification),
        );
      }

      if (event.event === "permission_request") {
        const request = event.data as AcpPermissionRequest;
        setPermissions((current) => [...current, request]);
      }

      if (event.event === "agent_exit") {
        setBridgeError("ACP Agent 进程已退出");
        setReady(false);
      }

      if (event.event === "bridge_closed") {
        setBridgeError("ACP 连接已断开");
        setReady(false);
      }
    });

    return () => {
      unlisten?.();
    };
  }, [options.agentArgs, options.agentCommand, options.cwd, store]);

  const adapter = useMemo(
    () => ({
      list: async () => {
        logPacket("request", "list_sessions", "List all sessions", {});
        const result = await listAcpSessions();
        logPacket("response", "list_sessions_result", `${result.sessions.length} sessions`, result);
        return {
          threads: result.sessions.map((session) => ({
            status: "regular" as const,
            remoteId: session.sessionId,
            externalId: session.sessionId,
            title: session.title ?? "New Chat",
          })),
        };
      },
      initialize: async () => {
        logPacket("request", "create_session", "Create new session", { cwd: options.cwd });
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const result = await createAcpSession({
              cwd: options.cwd,
              title: "New Chat",
            });
            logPacket("response", "create_session_result", `Session: ${result.sessionId.slice(0, 8)}...`, result);
            store.states.set(
              result.sessionId,
              createEmptyThreadState(result.sessionId),
            );
            return {
              remoteId: result.sessionId,
              externalId: result.sessionId,
            };
          } catch (error) {
            lastError =
              error instanceof Error ? error : new Error(String(error));
            if (lastError.message.includes("ACP Agent 未启动") && attempt < 9) {
              await new Promise((resolve) =>
                setTimeout(resolve, 200 * (attempt + 1)),
              );
              continue;
            }
            logPacket("response", "create_session_error", lastError.message, { error: lastError.message });
            throw error;
          }
        }
        throw (
          lastError || new Error("Unknown error during session initialization")
        );
      },
      rename: async () => {},
      archive: async () => {},
      unarchive: async () => {},
      delete: async (remoteId: string) => {
        logPacket("request", "delete_session", `Session: ${remoteId.slice(0, 8)}...`, { sessionId: remoteId });
        await deleteAcpSession(remoteId);
        store.states.delete(remoteId);
      },
      fetch: async (remoteId: string) => ({
        status: "regular" as const,
        remoteId,
        externalId: remoteId,
        title: "Chat",
      }),
      generateTitle: async () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    }),
    [options.cwd, store],
  );

  return useRemoteThreadListRuntime({
    allowNesting: true,
    adapter,
    runtimeHook: () =>
      useAcpRuntimeHook(
        store,
        ready,
        bridgeError,
        permissions,
        replyPermission,
      ),
  });
}

export function useAcpPermissions() {
  const pending = useAuiState((state) => {
    const extras = state.thread.extras as AcpRuntimeExtras | undefined;
    if (!extras || !(ACP_RUNTIME_EXTRAS in extras)) return EMPTY_PERMISSIONS;
    return extras.permissions;
  });
  const reply = useAuiState((state) => {
    const extras = state.thread.extras as AcpRuntimeExtras | undefined;
    if (!extras || !(ACP_RUNTIME_EXTRAS in extras))
      return NOOP_REPLY_PERMISSION;
    return extras.replyPermission;
  });
  return useMemo(() => ({ pending, reply }), [pending, reply]);
}

export function useAcpBridgeError() {
  return useMemo(() => ({ isWails: isWailsRuntime() }), []);
}
