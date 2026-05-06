import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { ChatSidePanel } from '@/components/features/ChatSidePanel';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
      <ChatSidePanel />
    </div>
  );
}
