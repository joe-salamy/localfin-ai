import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { EnrichedTransaction } from '@/types';

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
  source: 'correction' | 'lookup' | 'ai' | 'none';
}

interface ParseStatementRequest {
  text: string;
  accountId: string;
  conversationId: string;
}

interface ParseStatementResult {
  transactions: EnrichedTransaction[];
  summary: {
    total: number;
    duplicates: number;
    fromLookup: number;
    fromCorrection: number;
    fromAI: number;
    uncategorized: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}

interface SaveCorrectionData {
  transaction_name: string;
  account_id: string;
  ai_suggested_subcategory_id?: string | null;
  user_corrected_subcategory_id: string;
}

interface ChatRequest {
  conversationId: string;
  message: string;
  currentPage?: string;
}

export interface ChatActionResult {
  type: string;
  input: Record<string, unknown>;
  status: 'success' | 'error';
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

export function useAI() {
  const queryClient = useQueryClient();

  const invalidateFinanceData = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subcategories.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const categorize = useMutation({
    mutationFn: (data: { transactions: CategorizeTransaction[]; conversationId: string }) =>
      apiPost<CategorizeResult[]>('/ai/categorize', data),
  });

  const parseStatement = useMutation({
    mutationFn: (data: ParseStatementRequest) =>
      apiPost<ParseStatementResult>('/parser/parse-statement', data),
  });

  const saveCorrection = useMutation({
    mutationFn: (data: SaveCorrectionData) =>
      apiPost('/ai/corrections', data),
  });

  const chat = useMutation({
    mutationFn: (data: ChatRequest) =>
      apiPost<ChatResult>('/ai/chat', data),
    onSuccess: () => invalidateFinanceData(),
  });

  return {
    categorize,
    parseStatement,
    saveCorrection,
    chat,
  };
}
