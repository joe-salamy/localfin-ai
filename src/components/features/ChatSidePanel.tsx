import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageSquare, Send, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAI } from '@/hooks/useAI';
import type { ChatActionResult, ChatStreamEvent, PlannedChatAction } from '@/hooks/useAI';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatActionResult[];
  reasoning?: string[];
}

interface ChatSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type StreamAction =
  | (PlannedChatAction & { status: 'pending' })
  | ChatActionResult;

interface StreamState {
  requestId?: string;
  status: string;
  actions: StreamAction[];
  reasoning: string[];
  responseDraft: string;
}

function actionLabel(action: PlannedChatAction | ChatActionResult) {
  return action.type.replace(/_/g, ' ');
}

function upsertStreamAction(actions: StreamAction[], index: number, action: StreamAction) {
  const next = [...actions];
  next[index] = action;
  return next;
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function reasoningDetailText(detail: Record<string, unknown>) {
  if (typeof detail.summary === 'string' && detail.summary.trim()) {
    return detail.summary.trim();
  }

  if (typeof detail.text === 'string' && detail.text.trim()) {
    return detail.text.trim();
  }

  if (typeof detail.data === 'string' && detail.data.trim()) {
    return `[${typeof detail.type === 'string' ? detail.type : 'reasoning.encrypted'}] ${detail.data}`;
  }

  return compactJson(detail);
}

function actionStatusText(action: StreamAction | ChatActionResult) {
  if (action.status === 'pending') return 'Pending';
  return action.status === 'success' ? 'Succeeded' : 'Failed';
}

export function ChatSidePanel({ open, onOpenChange }: ChatSidePanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [conversationId] = useState(() => crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);
  const streamStateRef = useRef<StreamState | null>(null);
  const { pathname } = useLocation();
  const { streamChat } = useAI();

  const logHint = useMemo(() => `logs/*-${conversationId}.jsonl`, [conversationId]);
  const isStreaming = streamState !== null;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const updateStreamState = (
    update: StreamState | null | ((prev: StreamState | null) => StreamState | null),
  ) => {
    setStreamState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      streamStateRef.current = next;
      return next;
    });
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'started':
        updateStreamState({
          requestId: event.requestId,
          status: 'Starting assistant request...',
          actions: [],
          reasoning: [],
          responseDraft: '',
        });
        return;
      case 'thinking':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          actions: prev?.actions ?? [],
          reasoning: prev?.reasoning ?? [],
          responseDraft: prev?.responseDraft ?? '',
          status: event.message,
        }));
        return;
      case 'reasoning_delta':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          actions: prev?.actions ?? [],
          reasoning: [...(prev?.reasoning ?? []), event.message],
          responseDraft: prev?.responseDraft ?? '',
          status: 'Streaming model reasoning...',
        }));
        return;
      case 'reasoning_details':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          actions: prev?.actions ?? [],
          reasoning: [...(prev?.reasoning ?? []), ...event.details.map(reasoningDetailText)],
          responseDraft: prev?.responseDraft ?? '',
          status: 'Streaming model reasoning details...',
        }));
        return;
      case 'response_delta':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          actions: prev?.actions ?? [],
          reasoning: prev?.reasoning ?? [],
          responseDraft: `${prev?.responseDraft ?? ''}${event.content}`,
          status: 'Streaming assistant response...',
        }));
        return;
      case 'actions_planned':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          status: event.actions.length > 0 ? 'Preparing tool calls...' : 'Writing response...',
          actions: event.actions.map((action) => ({ ...action, status: 'pending' })),
          reasoning: prev?.reasoning ?? [],
          responseDraft: prev?.responseDraft ?? '',
        }));
        return;
      case 'action_started':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          status: `Running ${actionLabel(event.action)}...`,
          reasoning: prev?.reasoning ?? [],
          responseDraft: prev?.responseDraft ?? '',
          actions: upsertStreamAction(prev?.actions ?? [], event.index, {
            ...event.action,
            status: 'pending',
          }),
        }));
        return;
      case 'action_finished':
        updateStreamState((prev) => ({
          requestId: prev?.requestId,
          status: event.action.status === 'success' ? 'Tool call finished.' : 'Tool call failed.',
          reasoning: prev?.reasoning ?? [],
          responseDraft: prev?.responseDraft ?? '',
          actions: upsertStreamAction(prev?.actions ?? [], event.index, event.action),
        }));
        return;
      case 'final': {
        const data = event.data;
        const reasoning = streamStateRef.current?.requestId === data.requestId ? streamStateRef.current.reasoning : [];
        setMessages((prev) => [
          ...prev,
          {
            id: data.requestId,
            role: 'assistant',
            content: data.message,
            actions: data.actions,
            reasoning,
          },
        ]);
        updateStreamState(null);
        const failed = data.actions.filter((action) => action.status === 'error').length;
        if (failed > 0) {
          toast.warning(`${failed} assistant action failed.`);
        }
        return;
      }
      case 'error':
        updateStreamState(null);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.message,
          },
        ]);
        toast.error(event.message);
        return;
      default:
        return;
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    updateStreamState({ status: 'Starting assistant request...', actions: [], reasoning: [], responseDraft: '' });
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
      const message = err instanceof Error ? err.message : 'Assistant request failed.';
      updateStreamState(null);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: message,
        },
      ]);
      toast.error(message);
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn(
          'fixed bottom-4 right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-secondary',
          open && 'hidden',
        )}
        aria-label="Open AI assistant"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {open && (
        <aside className="fixed inset-0 z-50 flex flex-col border-l border-border bg-background shadow-2xl md:sticky md:inset-auto md:top-0 md:h-screen md:w-[28rem] md:shrink-0">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
            <Bot className="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">LocalFin AI</div>
              <div className="truncate text-xs text-muted-foreground">{logHint}</div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Close AI assistant"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
                Ask about your finances or tell me to create/update accounts, categories, goals, or transactions.
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'rounded-md px-3 py-2 text-sm',
                  message.role === 'user'
                    ? 'ml-8 bg-primary text-primary-foreground'
                    : 'mr-8 border border-border bg-card text-foreground',
                )}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
                    {message.actions.map((action, index) => (
                      <details key={`${action.type}-${index}`} className="rounded border border-border p-2">
                        <summary className="flex cursor-pointer items-start gap-1.5">
                          {action.status === 'success' ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            {actionLabel(action)} - {actionStatusText(action)}
                            {action.error ? `: ${action.error}` : ''}
                          </span>
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px] leading-relaxed">
                          {compactJson({ input: action.input, result: action.result ?? null, error: action.error ?? null })}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
                {message.reasoning && message.reasoning.length > 0 && (
                  <details className="mt-2 border-t border-border pt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Reasoning stream</summary>
                    <div className="mt-2 max-h-48 space-y-2 overflow-auto rounded bg-secondary p-2">
                      {message.reasoning.map((entry, index) => (
                        <div key={`${message.id}-reasoning-${index}`} className="whitespace-pre-wrap">
                          {entry}
                        </div>
                      ))}
                    </div>
                  </details>
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
                      <details key={`${action.type}-${index}`} open className="rounded border border-border p-2">
                        <summary className="flex cursor-pointer items-start gap-1.5">
                          {action.status === 'pending' ? (
                            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : action.status === 'success' ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                          )}
                          <span className="min-w-0 flex-1">
                            {actionLabel(action)} - {actionStatusText(action)}
                            {'error' in action && action.error ? `: ${action.error}` : ''}
                          </span>
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px] leading-relaxed">
                          {compactJson({
                            input: action.input,
                            result: 'result' in action ? action.result ?? null : null,
                            error: 'error' in action ? action.error ?? null : null,
                          })}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
                {streamState.reasoning.length > 0 && (
                  <details open className="mt-2 border-t border-border pt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Reasoning stream</summary>
                    <div className="mt-2 max-h-48 space-y-2 overflow-auto rounded bg-secondary p-2">
                      {streamState.reasoning.map((entry, index) => (
                        <div key={`stream-reasoning-${index}`} className="whitespace-pre-wrap">
                          {entry}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {streamState.responseDraft && (
                  <details className="mt-2 border-t border-border pt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Raw response stream</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px] leading-relaxed">
                      {streamState.responseDraft}
                    </pre>
                  </details>
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask or request an update..."
                disabled={isStreaming}
                className="h-24 min-w-0 flex-1 resize-none rounded border border-border bg-input px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" loading={isStreaming} aria-label="Send message" className="shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
}
