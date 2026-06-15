import type {
  AcpSessionNotification,
  AcpThreadMessage,
  AcpThreadState,
} from "./types";

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getTextFromContent(content: unknown): string {
  if (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    (content as { type?: string }).type === "text" &&
    "text" in content &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text;
  }
  return "";
}

function ensureAssistantMessage(state: AcpThreadState): AcpThreadMessage {
  const last = state.messages.at(-1);
  if (last?.role === "assistant") return last;

  const message: AcpThreadMessage = {
    id: createId("assistant"),
    role: "assistant",
    content: [],
    createdAt: new Date(),
  };
  state.messages.push(message);
  return message;
}

function appendTextPart(
  message: AcpThreadMessage,
  type: "text" | "reasoning",
  chunk: string,
) {
  if (!chunk) return;
  const lastPart = message.content.at(-1);
  if (lastPart && lastPart.type === type) {
    lastPart.text += chunk;
    return;
  }
  message.content.push({ type, text: chunk });
}

function upsertToolCall(
  message: AcpThreadMessage,
  update: Record<string, unknown>,
) {
  const toolCallId =
    typeof update.toolCallId === "string" ? update.toolCallId : createId("tool");
  const existing = message.content.find(
    (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
  );

  const title = typeof update.title === "string" ? update.title : "Tool";
  const rawInput =
    typeof update.rawInput === "object" && update.rawInput !== null
      ? (update.rawInput as Record<string, unknown>)
      : {};
  const status = typeof update.status === "string" ? update.status : "pending";

  if (existing && existing.type === "tool-call") {
    existing.toolName = title;
    existing.args = rawInput;
    existing.argsText = JSON.stringify(rawInput);
    if (status === "failed" || status === "error") {
      existing.isError = true;
    }
    return;
  }

  message.content.push({
    type: "tool-call",
    toolCallId,
    toolName: title,
    args: rawInput,
    argsText: JSON.stringify(rawInput),
    isError: status === "failed" || status === "error",
  });
}

export function applySessionUpdate(
  state: AcpThreadState,
  notification: AcpSessionNotification,
): AcpThreadState {
  const update = notification.update;
  const next: AcpThreadState = {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      content: message.content.map((part) => ({ ...part })),
    })),
    lastEventAt: Date.now(),
  };

  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const assistant = ensureAssistantMessage(next);
      appendTextPart(assistant, "text", getTextFromContent(update.content));
      break;
    }
    case "agent_thought_chunk": {
      const assistant = ensureAssistantMessage(next);
      appendTextPart(assistant, "reasoning", getTextFromContent(update.content));
      break;
    }
    case "user_message_chunk": {
      const chunk = getTextFromContent(update.content);
      if (!chunk) break;
      const last = next.messages.at(-1);
      if (last?.role === "user") {
        const textPart = last.content.find((part) => part.type === "text");
        if (textPart && textPart.type === "text") {
          textPart.text += chunk;
        } else {
          last.content.push({ type: "text", text: chunk });
        }
      } else {
        next.messages.push({
          id: createId("user"),
          role: "user",
          content: [{ type: "text", text: chunk }],
          createdAt: new Date(),
        });
      }
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const assistant = ensureAssistantMessage(next);
      upsertToolCall(assistant, update);
      break;
    }
    default:
      break;
  }

  return next;
}

export function appendUserMessage(
  state: AcpThreadState,
  text: string,
): AcpThreadState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: createId("user"),
        role: "user",
        content: [{ type: "text", text }],
        createdAt: new Date(),
      },
    ],
    isRunning: true,
    error: null,
  };
}

export function beginAssistantResponse(state: AcpThreadState): AcpThreadState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: createId("assistant"),
        role: "assistant",
        content: [],
        createdAt: new Date(),
      },
    ],
    isRunning: true,
  };
}

export function finishAssistantResponse(
  state: AcpThreadState,
  stopReason?: string,
): AcpThreadState {
  return {
    ...state,
    isRunning: false,
    error: stopReason === "error" ? "Agent stopped with error" : null,
  };
}

export function toThreadMessageLike(messages: AcpThreadMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
}
