import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, apiStream } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { EnrichedTransaction } from "@/types";

interface CategorizeTransaction {
  name: string;
  account_id: string;
  account_name: string;
  amount: number;
}

interface CategorizeResult {
  transaction_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  confidence: number;
  source: "lookup" | "ai" | "none";
}

interface ParseStatementRequest {
  text: string;
  accountId: string;
}

interface ParseStatementResult {
  transactions: EnrichedTransaction[];
  summary: {
    total: number;
    duplicates: number;
    fromLookup: number;
    fromAI: number;
    uncategorized: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}

export interface ChatRequest {
  conversationId: string;
  message: string;
  currentPage?: string;
}

export interface ChatActionResult {
  type: string;
  input: Record<string, unknown>;
  status: "success" | "error";
  result?: unknown;
  error?: string;
}

export interface ChatResult {
  conversationId: string;
  requestId: string;
  message: string;
  actions: ChatActionResult[];
  logFile: string;
}

export type PlannedChatAction = Omit<ChatActionResult, "status" | "result" | "error">;

export type ChatStreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "thinking"; message: string }
  | { type: "actions_planned"; actions: PlannedChatAction[] }
  | { type: "action_started"; index: number; action: PlannedChatAction }
  | { type: "action_finished"; index: number; action: ChatActionResult }
  | { type: "final"; data: ChatResult }
  | { type: "error"; message: string };

export function useAI() {
  const queryClient = useQueryClient();

  const invalidateFinanceData = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.subcategories.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
      ]),
    [queryClient],
  );

  const categorize = useMutation({
    mutationFn: (data: {
      transactions: CategorizeTransaction[];
      conversationId: string;
    }) => apiPost<CategorizeResult[]>("/ai/categorize", data),
  });

  const parseStatement = useMutation({
    mutationFn: (data: ParseStatementRequest) =>
      apiPost<ParseStatementResult>("/parser/parse-statement", data),
  });

  const chat = useMutation({
    mutationFn: (data: ChatRequest) => apiPost<ChatResult>("/ai/chat", data),
    onSuccess: () => invalidateFinanceData(),
  });

  const streamChat = useCallback(
    async (
      data: ChatRequest,
      onEvent: (event: ChatStreamEvent) => void,
      signal?: AbortSignal,
    ) => {
      await apiStream<ChatStreamEvent>(
        "/ai/chat/stream",
        data,
        (event) => {
          onEvent(event);
          if (
            event.type === "final" &&
            event.data.actions.some((action) => action.status === "success")
          ) {
            void invalidateFinanceData();
          }
        },
        signal,
      );
    },
    [invalidateFinanceData],
  );

  return {
    categorize,
    parseStatement,
    chat,
    streamChat,
  };
}
