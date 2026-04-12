import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  TransactionFilters,
  TransactionWithDetails,
  CreateTransactionData,
} from '@/types/index';

function buildQueryString(filters?: TransactionFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams(
    Object.entries(filters)
      .filter(([_, v]) => v != null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return params ? `?${params}` : '';
}

export function useTransactions(filters?: TransactionFilters) {
  const queryClient = useQueryClient();

  const transactionsQuery = useQuery({
    queryKey: queryKeys.transactions.list(filters as Record<string, unknown>),
    queryFn: () =>
      apiGet<TransactionWithDetails[]>(
        `/transactions${buildQueryString(filters)}`,
      ),
    select: (res) => res.data ?? [],
  });

  const invalidateRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const createTransaction = useMutation({
    mutationFn: (data: CreateTransactionData) =>
      apiPost<TransactionWithDetails>('/transactions', data),
    onSuccess: () => invalidateRelated(),
  });

  const updateTransaction = useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<CreateTransactionData>) =>
      apiPut<TransactionWithDetails>(`/transactions/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => apiDelete(`/transactions/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  const bulkUpdateTransactions = useMutation({
    mutationFn: (data: { ids: string[]; updates: Partial<CreateTransactionData> }) =>
      apiPut<void>('/transactions/bulk', data),
    onSuccess: () => invalidateRelated(),
  });

  const bulkDeleteTransactions = useMutation({
    mutationFn: (ids: string[]) => apiDelete<void>('/transactions/bulk', { ids }),
    onSuccess: () => invalidateRelated(),
  });

  const bulkCreateTransactions = useMutation({
    mutationFn: (transactions: CreateTransactionData[]) =>
      apiPost<TransactionWithDetails[]>('/transactions/bulk', { transactions }),
    onSuccess: () => invalidateRelated(),
  });

  const checkDuplicates = useMutation({
    mutationFn: (
      transactions: Array<{ date: string; name: string; amount: number; account_id: string }>,
    ) => apiPost<Array<{ isDuplicate: boolean }>>('/transactions/check-duplicates', { transactions }),
  });

  const checkTransferMatch = useMutation({
    mutationFn: (data: {
      date: string;
      amount: number;
      account_id: string;
    }) => apiPost<TransactionWithDetails[]>('/transactions/check-transfer', data),
  });

  return {
    transactions: transactionsQuery.data ?? [],
    isLoading: transactionsQuery.isLoading,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    bulkUpdateTransactions,
    bulkDeleteTransactions,
    bulkCreateTransactions,
    checkDuplicates,
    checkTransferMatch,
  };
}

export function useRecentActivity() {
  const query = useQuery({
    queryKey: queryKeys.transactions.recentActivity(),
    queryFn: () => apiGet<TransactionWithDetails[]>('/transactions/recent-activity'),
    select: (res) => res.data ?? [],
  });

  return {
    recentActivity: query.data ?? [],
    isLoading: query.isLoading,
  };
}
