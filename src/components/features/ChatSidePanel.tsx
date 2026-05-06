import { useMemo, useState } from 'react';
import { Bot, MessageSquare, Send, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { useAI } from '@/hooks/useAI';
import type { ChatActionResult } from '@/hooks/useAI';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatActionResult[];
}

function actionLabel(action: ChatActionResult) {
  return action.type.replace(/_/g, ' ');
}

export function ChatSidePanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId] = useState(() => crypto.randomUUID());
  const { pathname } = useLocation();
  const { chat } = useAI();

  const logHint = useMemo(() => `logs/${conversationId}.jsonl`, [conversationId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const result = await chat.mutateAsync({
        conversationId,
        message: text,
        currentPage: pathname,
      });
      const data = result.data;
      if (!data) return;
      setMessages((prev) => [
        ...prev,
        {
          id: data.requestId,
          role: 'assistant',
          content: data.message,
          actions: data.actions,
        },
      ]);
      const failed = data.actions.filter((action) => action.status === 'error').length;
      if (failed > 0) {
        toast.warning(`${failed} assistant action failed.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Assistant request failed.';
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: message,
        },
      ]);
      toast.error(message);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-secondary"
        aria-label="Open AI assistant"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
            <Bot className="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">LocalFin AI</div>
              <div className="truncate text-xs text-muted-foreground">{logHint}</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
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
                className="h-9 min-w-0 flex-1 rounded border border-border bg-input px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm" loading={chat.isPending} aria-label="Send message">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
