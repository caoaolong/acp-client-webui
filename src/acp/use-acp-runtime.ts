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
  isTauriRuntime,
  listenAcpEvents,
  listAcpSessions,
  promptAcpSession,
  respondAcpPermission,
  startAcpAgent,
} from "./acp-tauri-client";
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

const ACP_RUNTIME_EXTRAS = Symbol("acp-runtime-extras");

type AcpRuntimeExtras = {
  readonly [ACP_RUNTIME_EXTRAS]: true;
  state: AcpThreadState;
  permissions: AcpPermissionRequest[];
  replyPermission: (
    requestId: string,
    optionId?: string,
  ) => Promise<void>;
};

export type UseAcpRuntimeOptions = {
  cwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
};

const EMPTY_THREAD_STATE = createEmptyThreadState("__pending__");
const NOOP_ON_NEW = () =>
  Promise.reject(new Error("ACP session is still initializing"));

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
      const current = states.get(sessionId) ?? createEmptyThreadState(sessionId);
      states.set(sessionId, updater(current));
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useThreadStoreState(store: ThreadStore, sessionId: string | undefined) {
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
      try {
        const result = (await promptAcpSession(sessionId, text)) as {
          stopReason?: string;
        };
        store.setState(sessionId, (current) =>
          finishAssistantResponse(current, result.stopReason),
        );
      } catch (error) {
        store.setState(sessionId, (current) => ({
          ...finishAssistantResponse(current, "error"),
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    },
    onCancel: async () => {
      if (!sessionId) return;
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

export function useAcpRuntime(options: UseAcpRuntimeOptions = {}): AssistantRuntime {
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
      await respondAcpPermission(requestId, optionId);
      setPermissions((current) =>
        current.filter((item) => item.requestId !== requestId),
      );
    },
    [],
  );

  useEffect(() => {
    if (!isTauriRuntime()) {
      setBridgeError("ACP 模式需要在 Tauri 桌面应用中运行");
      return;
    }

    let unlisten: (() => void) | undefined;

    const boot = async () => {
      try {
        await ensureAcpBridge();
        await startAcpAgent({
          cwd: options.cwd,
          agentCommand: options.agentCommand,
          agentArgs: options.agentArgs,
        });
        setReady(true);
        setBridgeError(null);
      } catch (error) {
        setBridgeError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    void boot();
    void listenAcpEvents((event) => {
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
        setBridgeError("ACP Sidecar 已断开");
        setReady(false);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [options.agentArgs, options.agentCommand, options.cwd, store]);

  const adapter = useMemo(
    () => ({
      list: async () => {
        const result = await listAcpSessions();
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
        const result = await createAcpSession({
          cwd: options.cwd,
          title: "New Chat",
        });
        store.states.set(
          result.sessionId,
          createEmptyThreadState(result.sessionId),
        );
        return {
          remoteId: result.sessionId,
          externalId: result.sessionId,
        };
      },
      rename: async () => {},
      archive: async () => {},
      unarchive: async () => {},
      delete: async (remoteId: string) => {
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
  return useAuiState((state) => {
    const extras = state.thread.extras as AcpRuntimeExtras | undefined;
    if (!extras || !(ACP_RUNTIME_EXTRAS in extras)) {
      return {
        pending: [] as AcpPermissionRequest[],
        reply: async () => {
          throw new Error("ACP runtime is not ready yet");
        },
      };
    }
    return {
      pending: extras.permissions,
      reply: extras.replyPermission,
    };
  });
}

export function useAcpBridgeError() {
  return useAuiState(() => ({
    isTauri: isTauriRuntime(),
  }));
}
