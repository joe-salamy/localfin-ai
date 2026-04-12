import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { Router } from '@/Router';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
