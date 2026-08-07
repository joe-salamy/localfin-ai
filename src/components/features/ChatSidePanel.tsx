import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { useAI } from "@/hooks/useAI";
import type {
  AgentConversation,
  ChatActionResult,
  ChatStreamEvent,
} from "@/hooks/useAI";
import {
  chatUiReducer,
  initialChatUiState,
  messageFromPersisted,
  type ChatMessage,
  type StreamAction,
} from "@/components/features/chatStreamState";
import { cn } from "@/lib/utils";
import { ShortcutHint } from "@/features/shortcuts/ShortcutHint";
import {
  useShortcut,
  useShortcutMetadata,
  useShortcutScope,
} from "@/features/shortcuts/hooks";

function actionLabel(action: StreamAction | ChatActionResult) {
  return action.type.replace(/_/g, " ");
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function actionStatusText(action: StreamAction) {
  if (action.status === "pending") return "Pending";
  return action.status === "success" ? "Succeeded" : "Failed";
}

function formatConversationTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
interface ChatSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function ChatSidePanel({
  open,
  onOpenChange,
  inputRef,
}: ChatSidePanelProps) {
  const [input, setInput] = useState("");
  const [uiState, dispatch] = useReducer(
    chatUiReducer,
    undefined,
    initialChatUiState,
  );
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState<
    string | null
  >(null);
  const abortRef = useRef<AbortController | null>(null);
  const { pathname } = useLocation();
  const {
    conversations,
    createConversation,
    deleteConversation,
    loadConversationMessages,
    streamChat,
  } = useAI();

  const { messages, stream: streamState } = uiState;
  const conversationList = conversations.data ?? [];
  const selectedConversation = conversationList.find(
    (item) => item.id === conversationId,
  );
  const isStreaming = streamState !== null;
  const toggleShortcut = useShortcutMetadata("global.toggleAssistant");

  useShortcutScope("assistant", open);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleStreamEvent = useCallback((event: ChatStreamEvent) => {
    dispatch(event);
    if (event.type === "final") {
      const failed = event.data.actions.filter(
        (action) => action.status === "error",
      ).length;
      if (failed > 0) {
        toast.warning(`${failed} assistant action failed.`);
      }
    }
    if (event.type === "error") {
      toast.error(event.message);
    }
  }, []);

  const startNewConversation = useCallback(async () => {
    if (isStreaming) return;
    try {
      const response = await createConversation.mutateAsync({
        currentPage: pathname,
      });
      if (!response.data)
        throw new Error("Assistant conversation was not created.");
      setConversationId(response.data.id);
      dispatch({ type: "conversation_reset" });
      setInput("");
      setHistoryOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create conversation.",
      );
    }
  }, [createConversation, isStreaming, pathname]);

  const selectConversation = useCallback(
    async (conversation: AgentConversation) => {
      if (isStreaming) return;
      setLoadingConversationId(conversation.id);
      try {
        const loaded = await loadConversationMessages(conversation.id);
        setConversationId(conversation.id);
        dispatch({
          type: "messages_loaded",
          messages: loaded.map(messageFromPersisted),
        });
        setInput("");
        setHistoryOpen(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not load conversation.",
        );
      } finally {
        setLoadingConversationId(null);
      }
    },
    [isStreaming, loadConversationMessages],
  );

  const removeConversation = useCallback(
    async (conversation: AgentConversation) => {
      if (isStreaming) return;
      try {
        await deleteConversation.mutateAsync(conversation.id);
        if (conversation.id === conversationId) {
          setConversationId(crypto.randomUUID());
          dispatch({ type: "conversation_reset" });
          setInput("");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not delete conversation.",
        );
      }
    },
    [conversationId, deleteConversation, isStreaming],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const transportErrorId = crypto.randomUUID();
    dispatch({ type: "user_message", message: userMessage });
    dispatch({ type: "request_started" });
    setInput("");
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      await streamChat(
        {
          conversationId,
          message: text,
          currentPage: pathname,
        },
        handleStreamEvent,
        abortController.signal,
      );
    } catch (err) {
      if (abortController.signal.aborted) return;
      const message =
        err instanceof Error ? err.message : "Assistant request failed.";
      dispatch({ type: "transport_error", id: transportErrorId, message });
      toast.error(message);
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
    }
  }, [
    conversationId,
    handleStreamEvent,
    input,
    isStreaming,
    pathname,
    streamChat,
  ]);

  useShortcut(
    "assistant.send",
    () => {
      void sendMessage();
    },
    { enabled: open && Boolean(input.trim()) && !isStreaming },
  );

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-secondary",
          open && "hidden",
        )}
        aria-label="Open AI assistant"
        aria-keyshortcuts={toggleShortcut.ariaKeyShortcuts}
        title={`Open AI assistant (${toggleShortcut.label})`}
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {open && (
        <aside className="fixed inset-0 z-50 flex flex-col border-l border-border bg-background shadow-2xl md:sticky md:inset-auto md:top-0 md:h-screen md:w-[28rem] md:shrink-0">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
            <Bot className="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {selectedConversation?.title ?? "LocalFin AI"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Conversation history"
              title="Conversation history"
            >
              <History className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                void startNewConversation();
              }}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="New conversation"
              title="New conversation"
              disabled={isStreaming}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close AI assistant"
              aria-keyshortcuts={toggleShortcut.ariaKeyShortcuts}
              title={`Close AI assistant (${toggleShortcut.label})`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {historyOpen && (
            <div className="max-h-72 shrink-0 overflow-y-auto border-b border-border bg-card px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Conversations
                </div>
                {conversations.isLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              {conversationList.length === 0 && (
                <div className="rounded border border-border bg-background p-2 text-xs text-muted-foreground">
                  No saved conversations yet.
                </div>
              )}
              <div className="space-y-1">
                {conversationList.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={cn(
                      "flex items-start gap-1 rounded border border-transparent p-1",
                      conversation.id === conversationId &&
                        "border-border bg-background",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void selectConversation(conversation);
                      }}
                      disabled={
                        isStreaming || loadingConversationId === conversation.id
                      }
                      className="min-w-0 flex-1 rounded px-2 py-1 text-left hover:bg-secondary disabled:opacity-60"
                    >
                      <div className="truncate text-sm font-medium">
                        {conversation.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {formatConversationTime(conversation.updated_at)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void removeConversation(conversation);
                      }}
                      disabled={isStreaming || deleteConversation.isPending}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
                      aria-label={`Delete ${conversation.title}`}
                      title="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                Ask about your finances or tell me to create/update accounts,
                categories, goals, or transactions.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-8 bg-primary text-primary-foreground"
                    : "mr-8 border border-border bg-card text-foreground",
                )}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {message.actions.map((action, index) => (
                      <details
                        key={`${action.type}-${index}`}
                        className="rounded border border-border p-2"
                      >
                        <summary className="flex cursor-pointer items-start gap-1.5">
                          {action.status === "success" ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            {actionLabel(action)} - {actionStatusText(action)}
                            {action.error ? `: ${action.error}` : ""}
                          </span>
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px] leading-relaxed">
                          {compactJson({
                            input: action.input,
                            result: action.result ?? null,
                            error: action.error ?? null,
                          })}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {streamState && (
              <div className="mr-8 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{streamState.status}</span>
                </div>
                {streamState.actions.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {streamState.actions.map((action, index) => (
                      <details
                        key={`${action.type}-${index}`}
                        open
                        className="rounded border border-border p-2"
                      >
                        <summary className="flex cursor-pointer items-start gap-1.5">
                          {action.status === "pending" ? (
                            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : action.status === "success" ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            {actionLabel(action)} - {actionStatusText(action)}
                            {"error" in action && action.error
                              ? `: ${action.error}`
                              : ""}
                          </span>
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px] leading-relaxed">
                          {compactJson({
                            input: action.input,
                            result:
                              "result" in action
                                ? (action.result ?? null)
                                : null,
                            error:
                              "error" in action ? (action.error ?? null) : null,
                          })}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card p-3">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask or request an update..."
                disabled={isStreaming}
                className="h-24 min-w-0 flex-1 resize-none rounded border border-border bg-input px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="submit"
                size="sm"
                loading={isStreaming}
                aria-label="Send message"
                className="shrink-0"
              >
                <Send className="h-4 w-4" />
                <ShortcutHint commandId="assistant.send" />
              </Button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
}
