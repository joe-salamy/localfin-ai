import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  Transaction,
  TransactionFilters,
  TransactionWithDetails,
  RecentAccountTransaction,
  CreateTransactionData,
  UpdateTransactionData,
  BulkTransactionUpdateData,
  RunSuspectScanRequest,
  RunSuspectScanResponse,
  SuspectFindingFilters,
  SuspectFindingStatus,
  SuspectTransactionFinding,
} from '@/types/index';

function buildQueryString(filters?: TransactionFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }
    params.set(key, String(value));
  });

  const query = params.toString();
  return query ? `?${query}` : '';
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
    }: { id: string } & UpdateTransactionData) =>
      apiPut<TransactionWithDetails>(`/transactions/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteTransaction = useMutation({
    mutationFn: (id: string) => apiDelete(`/transactions/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  const bulkUpdateTransactions = useMutation({
    mutationFn: (data: { ids: string[]; updates: BulkTransactionUpdateData }) =>
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
    ) => apiPost<boolean[]>('/transactions/check-duplicates', { transactions }),
  });

  const checkTransferMatch = useMutation({
    mutationFn: (data: {
      date: string;
      amount: number;
      account_id: string;
    }) => apiPost<Transaction | null>('/transactions/check-transfer', data),
  });

  return {
    transactions: transactionsQuery.data ?? [],
    isLoading: transactionsQuery.isLoading,
    error: transactionsQuery.error,
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
    queryFn: () => apiGet<RecentAccountTransaction[]>('/transactions/recent-activity'),
    select: (res) => res.data ?? [],
  });

  return {
    recentActivity: query.data ?? [],
    isLoading: query.isLoading,
  };
}

function buildSuspectFindingQueryString(filters?: SuspectFindingFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value != null) params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function useSuspectTransactionFindings(filters?: SuspectFindingFilters) {
  const queryClient = useQueryClient();

  const findingsQuery = useQuery({
    queryKey: queryKeys.transactions.suspectFindings(filters as Record<string, unknown>),
    queryFn: () =>
      apiGet<SuspectTransactionFinding[]>(
        `/transactions/suspect-findings${buildSuspectFindingQueryString(filters)}`,
      ),
    select: (res) => res.data ?? [],
  });

  const runSuspectScan = useMutation({
    mutationFn: (data: RunSuspectScanRequest) =>
      apiPost<RunSuspectScanResponse>('/transactions/suspect-scan', data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
  });

  const updateFindingStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SuspectFindingStatus }) =>
      apiPut<SuspectTransactionFinding>(`/transactions/suspect-findings/${id}`, { status }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
  });

  return {
    findings: findingsQuery.data ?? [],
    isLoading: findingsQuery.isLoading,
    error: findingsQuery.error,
    runSuspectScan,
    updateFindingStatus,
  };
}
