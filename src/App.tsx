import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { Router } from '@/Router';
import { ShortcutProvider } from '@/features/shortcuts/ShortcutProvider';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider>
        <Router />
      </ShortcutProvider>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
