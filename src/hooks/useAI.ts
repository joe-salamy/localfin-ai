import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiStream } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateFinanceQueries } from "@/lib/queryInvalidation";
import { readAssistantSettings } from "@/features/assistant-settings/storage";
import {
  agentConversationSchema,
  agentMessageSchema,
  categorizeResultSchema,
  chatResultSchema,
  chatStreamEventSchema,
  parseStatementResultSchema,
  type AccountType,
  type AgentConversation,
  type AgentMessage,
  type CategorizeResult,
  type ChatRequest,
  type ChatResult,
  type ChatStreamEvent,
  type ParseStatementResult,
} from "@shared/contracts";
export type {
  AgentConversation,
  AgentMessage,
  ChatActionResult,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  PlannedChatAction,
} from "@shared/contracts";

interface CategorizeTransaction {
  name: string;
  account_id: string;
  account_name: string;
  account_type?: AccountType;
  amount: number;
  date?: string;
}


interface ParseStatementRequest {
  text: string;
  accountId: string;
}


export function useAI() {
  const queryClient = useQueryClient();

  const withAssistantSettings = useCallback(
    (data: ChatRequest): ChatRequest => ({
      ...data,
      maxAssistantTurns:
        data.maxAssistantTurns ?? readAssistantSettings().maxAssistantTurns,
    }),
    [],
  );

  const invalidateFinanceData = useCallback(
    () => invalidateFinanceQueries(queryClient, "all"),
    [queryClient],
  );

  const categorize = useMutation({
    mutationFn: (data: {
      transactions: CategorizeTransaction[];
      conversationId: string;
    }) =>
      apiPost<CategorizeResult[]>(
        "/ai/categorize",
        data,
        categorizeResultSchema.array(),
      ),
  });

  const parseStatement = useMutation({
    mutationFn: (data: ParseStatementRequest) =>
      apiPost<ParseStatementResult>(
        "/parser/parse-statement",
        data,
        parseStatementResultSchema,
      ),
  });

  const chat = useMutation({
    mutationFn: (data: ChatRequest) =>
      apiPost<ChatResult>(
        "/ai/chat",
        withAssistantSettings(data),
        chatResultSchema,
      ),
    onSuccess: () =>
      Promise.all([
        invalidateFinanceData(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.ai.conversations(),
        }),
      ]),
  });

  const conversations = useQuery({
    queryKey: queryKeys.ai.conversations(),
    queryFn: () =>
      apiGet<AgentConversation[]>(
        "/ai/conversations",
        agentConversationSchema.array(),
      ),
    select: (response) => response.data ?? [],
  });

  const createConversation = useMutation({
    mutationFn: (data: { currentPage?: string }) =>
      apiPost<AgentConversation>(
        "/ai/conversations",
        data,
        agentConversationSchema,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
  });

  const deleteConversation = useMutation({
    mutationFn: (conversationId: string) =>
      apiDelete<{ id: string }>(`/ai/conversations/${conversationId}`),
    onSuccess: (_data, conversationId) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.ai.conversations(),
        }),
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
            agentMessageSchema.array(),
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
              queryKey: queryKeys.ai.conversationMessages(
                event.data.conversationId,
              ),
            });
          }
        },
        signal,
        chatStreamEventSchema,
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
