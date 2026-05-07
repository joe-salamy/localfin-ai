import { useCallback, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Navbar } from './Navbar';
import { ChatSidePanel } from '@/components/features/ChatSidePanel';
import { useShortcut } from '@/features/shortcuts/hooks';

export function AppLayout() {
  const [chatOpen, setChatOpen] = useState(false);
  const assistantInputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  useShortcut('global.dashboard', useCallback(() => navigate('/'), [navigate]));
  useShortcut('global.setup', useCallback(() => navigate('/setup'), [navigate]));
  useShortcut('global.addTransactions', useCallback(() => navigate('/transactions/input'), [navigate]));
  useShortcut('global.transactionHistory', useCallback(() => navigate('/transactions/history'), [navigate]));
  useShortcut('global.settings', useCallback(() => navigate('/settings'), [navigate]));
  useShortcut('global.keyboardShortcuts', useCallback(() => {
    navigate('/settings#keyboard-shortcuts');
    window.setTimeout(() => document.getElementById('keyboard-shortcuts')?.focus(), 0);
  }, [navigate]));
  useShortcut('global.toggleAssistant', useCallback(() => {
    setChatOpen((open) => !open);
  }, []));
  useShortcut('global.focusAssistant', useCallback(() => {
    setChatOpen(true);
    window.setTimeout(() => assistantInputRef.current?.focus(), 0);
  }, []));
  useShortcut('global.close', useCallback(() => {
    setChatOpen(false);
  }, []), { enabled: chatOpen });

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <div className="min-w-0 flex-1">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </main>
      </div>
      <ChatSidePanel open={chatOpen} onOpenChange={setChatOpen} inputRef={assistantInputRef} />
    </div>
  );
}
