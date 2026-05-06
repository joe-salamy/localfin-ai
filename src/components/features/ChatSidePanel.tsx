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
}

function actionLabel(action: PlannedChatAction | ChatActionResult) {
  return action.type.replace(/_/g, ' ');
}

function upsertStreamAction(actions: StreamAction[], index: number, action: StreamAction) {
  const next = [...actions];
  next[index] = action;
  return next;
}

export function ChatSidePanel({ open, onOpenChange }: ChatSidePanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [conversationId] = useState(() => crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);
  const { pathname } = useLocation();
  const { streamChat } = useAI();

  const logHint = useMemo(() => `logs/${conversationId}.jsonl`, [conversationId]);
  const isStreaming = streamState !== null;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleStreamEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'started':
        setStreamState({
          requestId: event.requestId,
          status: 'Starting assistant request...',
          actions: [],
        });
        return;
      case 'thinking':
        setStreamState((prev) => ({
          requestId: prev?.requestId,
          actions: prev?.actions ?? [],
          status: event.message,
        }));
        return;
      case 'actions_planned':
        setStreamState((prev) => ({
          requestId: prev?.requestId,
          status: event.actions.length > 0 ? 'Preparing tool calls...' : 'Writing response...',
          actions: event.actions.map((action) => ({ ...action, status: 'pending' })),
        }));
        return;
      case 'action_started':
        setStreamState((prev) => ({
          requestId: prev?.requestId,
          status: `Running ${actionLabel(event.action)}...`,
          actions: upsertStreamAction(prev?.actions ?? [], event.index, {
            ...event.action,
            status: 'pending',
          }),
        }));
        return;
      case 'action_finished':
        setStreamState((prev) => ({
          requestId: prev?.requestId,
          status: event.action.status === 'success' ? 'Tool call finished.' : 'Tool call failed.',
          actions: upsertStreamAction(prev?.actions ?? [], event.index, event.action),
        }));
        return;
      case 'final': {
        const data = event.data;
        setMessages((prev) => [
          ...prev,
          {
            id: data.requestId,
            role: 'assistant',
            content: data.message,
            actions: data.actions,
          },
        ]);
        setStreamState(null);
        const failed = data.actions.filter((action) => action.status === 'error').length;
        if (failed > 0) {
          toast.warning(`${failed} assistant action failed.`);
        }
        return;
      }
      case 'error':
        setStreamState(null);
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
    setStreamState({ status: 'Starting assistant request...', actions: [] });
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
      setStreamState(null);
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
          <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
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
                      <div key={`${action.type}-${index}`} className="flex items-start gap-1.5">
                        {action.status === 'success' ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                        )}
                        <span className="min-w-0 flex-1">
                          {actionLabel(action)}
                          {action.error ? `: ${action.error}` : ''}
                        </span>
                      </div>
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
                      <div key={`${action.type}-${index}`} className="flex items-start gap-1.5">
                        {action.status === 'pending' ? (
                          <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : action.status === 'success' ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-income" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-500" />
                        )}
                        <span className="min-w-0 flex-1">
                          {actionLabel(action)}
                          {'error' in action && action.error ? `: ${action.error}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card p-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask or request an update..."
                disabled={isStreaming}
                className="h-9 min-w-0 flex-1 rounded border border-border bg-input px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" loading={isStreaming} aria-label="Send message">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </aside>
      )}
    </>
  );
}
