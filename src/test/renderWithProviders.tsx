import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { Toaster } from "sonner";
import { ShortcutProvider } from "@/features/shortcuts/ShortcutProvider";
import { UndoRedoProvider } from "@/features/undo-redo/UndoRedoProvider";
import { DisplaySettingsProvider } from "@/features/display-settings/DisplaySettingsProvider";
import { FlaggedWordsProvider } from "@/features/flagged-words/FlaggedWordsProvider";

interface RenderWithProvidersOptions {
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider>
        <UndoRedoProvider>
          <DisplaySettingsProvider>
            <FlaggedWordsProvider>{ui}</FlaggedWordsProvider>
          </DisplaySettingsProvider>
        </UndoRedoProvider>
      </ShortcutProvider>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}
