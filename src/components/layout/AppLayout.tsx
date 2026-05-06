import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { ChatSidePanel } from '@/components/features/ChatSidePanel';

export function AppLayout() {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <div className="min-w-0 flex-1">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </main>
      </div>
      <ChatSidePanel open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
