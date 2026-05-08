import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { Router } from '@/Router';
import { ShortcutProvider } from '@/features/shortcuts/ShortcutProvider';
import { DisplaySettingsProvider } from '@/features/display-settings/DisplaySettingsProvider';
import { FlaggedWordsProvider } from '@/features/flagged-words/FlaggedWordsProvider';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider>
        <DisplaySettingsProvider>
          <FlaggedWordsProvider>
            <Router />
          </FlaggedWordsProvider>
        </DisplaySettingsProvider>
      </ShortcutProvider>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
