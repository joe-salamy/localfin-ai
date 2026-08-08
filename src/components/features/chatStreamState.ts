import type {
  AgentMessage,
  ChatActionResult,
  ChatStreamEvent,
  PlannedChatAction,
} from "../../../shared/contracts/index.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatActionResult[];
}

export type StreamAction =
  | (PlannedChatAction & { status: "pending" })
  | ChatActionResult;

export interface StreamState {
  requestId?: string;
  status: string;
  actions: StreamAction[];
}

export interface ChatUiState {
  messages: ChatMessage[];
  stream: StreamState | null;
}

export type ChatUiAction =
  | ChatStreamEvent
  | { type: "request_started"; requestId?: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "messages_loaded"; messages: ChatMessage[] }
  | { type: "confirmation_result"; message: ChatMessage }
  | { type: "conversation_reset" }
  | { type: "transport_error"; id: string; message: string };

function upsertStreamAction(
  actions: StreamAction[],
  index: number,
  action: StreamAction,
): StreamAction[] {
  const next = [...actions];
  next[index] = action;
  return next;
}

function streamWith(
  state: ChatUiState,
  update: Partial<StreamState>,
): ChatUiState {
  return {
    ...state,
    stream: {
      requestId: state.stream?.requestId,
      status: state.stream?.status ?? "Starting assistant request...",
      actions: state.stream?.actions ?? [],
      ...update,
    },
  };
}

export function messageFromPersisted(message: AgentMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    actions: message.actions ?? undefined,
  };
}

export function initialChatUiState(): ChatUiState {
  return { messages: [], stream: null };
}

export function chatUiReducer(
  state: ChatUiState,
  action: ChatUiAction,
): ChatUiState {
  switch (action.type) {
    case "request_started":
      return {
        ...state,
        stream: {
          requestId: action.requestId,
          status: "Starting assistant request...",
          actions: [],
        },
      };
    case "user_message":
      return { ...state, messages: [...state.messages, action.message] };
    case "messages_loaded":
      return { messages: action.messages, stream: null };
    case "confirmation_result":
      return {
        messages: [...state.messages, action.message],
        stream: null,
      };
    case "conversation_reset":
      return initialChatUiState();
    case "started":
      return {
        ...state,
        stream: {
          requestId: action.requestId,
          status: "Starting assistant request...",
          actions: [],
        },
      };
    case "thinking":
      return streamWith(state, { status: action.message });
    case "actions_planned":
      return streamWith(state, {
        status:
          action.actions.length > 0
            ? "Preparing tool calls..."
            : "Writing response...",
        actions: action.actions.map((planned) => ({
          ...planned,
          status: "pending",
        })),
      });
    case "confirmation_requested":
      return streamWith(state, {
        requestId: action.requestId,
        status: "Approval required",
        actions: action.actions.map((planned) => ({
          ...planned,
          status: "pending",
        })),
      });
    case "action_started":
      return streamWith(state, {
        status: `Running ${action.action.type.replace(/_/g, " ")}...`,
        actions: upsertStreamAction(state.stream?.actions ?? [], action.index, {
          ...action.action,
          status: "pending",
        }),
      });
    case "action_finished":
      return streamWith(state, {
        status:
          action.action.status === "success"
            ? "Tool call finished."
            : "Tool call failed.",
        actions: upsertStreamAction(
          state.stream?.actions ?? [],
          action.index,
          action.action,
        ),
      });
    case "final":
      return {
        messages: [
          ...state.messages,
          {
            id: action.data.requestId,
            role: "assistant",
            content: action.data.message,
            actions: action.data.actions,
          },
        ],
        stream: null,
      };
    case "error":
      return {
        messages: [
          ...state.messages,
          {
            id: state.stream?.requestId ?? "assistant-error",
            role: "assistant",
            content: action.message,
          },
        ],
        stream: null,
      };
    case "transport_error":
      return {
        messages: [
          ...state.messages,
          { id: action.id, role: "assistant", content: action.message },
        ],
        stream: null,
      };
    default:
      return state;
  }
}
