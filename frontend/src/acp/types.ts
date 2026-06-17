export type AcpBridgeEvent =
  | {
      type: "event";
      event: string;
      data?: unknown;
    }
  | {
      type: "response";
      id: string;
      result?: unknown;
      error?: string;
    }
  | {
      type: "ready";
    };

export type AcpSessionMeta = {
  sessionId: string;
  cwd?: string;
  title?: string;
  createdAt?: number;
};

export type AcpPermissionRequest = {
  requestId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    kind?: string;
    status?: string;
  };
  options: Array<{
    optionId: string;
    name: string;
    kind: string;
  }>;
};

export type AcpSessionNotification = {
  sessionId: string;
  update: {
    sessionUpdate: string;
    [key: string]: unknown;
  };
};

export type AcpThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "reasoning";
        text: string;
      }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
        argsText: string;
        result?: unknown;
        isError?: boolean;
      }
  >;
  createdAt?: Date;
};

export type AcpThreadState = {
  sessionId: string;
  messages: AcpThreadMessage[];
  isRunning: boolean;
  lastEventAt: number | null;
  error: string | null;
};

export function createEmptyThreadState(sessionId: string): AcpThreadState {
  return {
    sessionId,
    messages: [],
    isRunning: false,
    lastEventAt: null,
    error: null,
  };
}
