import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiStream } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { readAssistantSettings } from "@/features/assistant-settings/storage";
import type { EnrichedTransaction, TransactionKind } from "@/types";

interface CategorizeTransaction {
  name: string;
  account_id: string;
  account_name: string;
  amount: number;
  date?: string;
}

interface CategorizeResult {
  transaction_name: string;
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  source: "lookup" | "transfer" | "ai" | "none";
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
  maxAssistantTurns?: number;
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

export interface AgentConversation {
  id: string;
  title: string;
  current_page: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  request_id: string | null;
  actions: ChatActionResult[] | null;
  log_file: string | null;
  status: "success" | "partial" | "error";
  created_at: string;
}

export type PlannedChatAction = Omit<ChatActionResult, "status" | "result" | "error">;

export type ChatStreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "thinking"; message: string }
  | { type: "reasoning_delta"; message: string }
  | { type: "reasoning_details"; details: Record<string, unknown>[] }
  | { type: "response_delta"; content: string }
  | { type: "actions_planned"; actions: PlannedChatAction[] }
  | { type: "action_started"; index: number; action: PlannedChatAction }
  | { type: "action_finished"; index: number; action: ChatActionResult }
  | { type: "final"; data: ChatResult }
  | { type: "error"; message: string };

export function useAI() {
  const queryClient = useQueryClient();

  const withAssistantSettings = useCallback((data: ChatRequest): ChatRequest => ({
    ...data,
    maxAssistantTurns:
      data.maxAssistantTurns ?? readAssistantSettings().maxAssistantTurns,
  }), []);

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
    mutationFn: (data: ChatRequest) =>
      apiPost<ChatResult>("/ai/chat", withAssistantSettings(data)),
    onSuccess: () =>
      Promise.all([
        invalidateFinanceData(),
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
      ]),
  });

  const conversations = useQuery({
    queryKey: queryKeys.ai.conversations(),
    queryFn: () => apiGet<AgentConversation[]>("/ai/conversations"),
    select: (response) => response.data ?? [],
  });

  const createConversation = useMutation({
    mutationFn: (data: { currentPage?: string }) =>
      apiPost<AgentConversation>("/ai/conversations", data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
  });

  const deleteConversation = useMutation({
    mutationFn: (conversationId: string) =>
      apiDelete<{ id: string }>(`/ai/conversations/${conversationId}`),
    onSuccess: (_data, conversationId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
        queryClient.removeQueries({
          queryKey: queryKeys.ai.conversationMessages(conversationId),
        }),
      ]),
  });

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      const cached = queryClient.getQueryData<AgentMessage[]>(
        queryKeys.ai.conversationMessages(conversationId),
      );
      if (cached) return cached;

      const response = await queryClient.fetchQuery({
        queryKey: queryKeys.ai.conversationMessages(conversationId),
        queryFn: async () => {
          const response = await apiGet<AgentMessage[]>(
            `/ai/conversations/${conversationId}/messages`,
          );
          return response.data ?? [];
        },
      });
      return response;
    },
    [queryClient],
  );

  const streamChat = useCallback(
    async (
      data: ChatRequest,
      onEvent: (event: ChatStreamEvent) => void,
      signal?: AbortSignal,
    ) => {
      await apiStream<ChatStreamEvent>(
        "/ai/chat/stream",
        withAssistantSettings(data),
        (event) => {
          onEvent(event);
          if (
            event.type === "final" &&
            event.data.actions.some((action) => action.status === "success")
          ) {
            void invalidateFinanceData();
          }
          if (event.type === "final") {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.ai.conversations(),
            });
            queryClient.removeQueries({
              queryKey: queryKeys.ai.conversationMessages(event.data.conversationId),
            });
          }
        },
        signal,
      );
    },
    [invalidateFinanceData, queryClient, withAssistantSettings],
  );

  return {
    categorize,
    parseStatement,
    chat,
    streamChat,
    conversations,
    createConversation,
    deleteConversation,
    loadConversationMessages,
  };
}
