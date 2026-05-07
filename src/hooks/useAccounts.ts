import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { AccountWithBalance, CreateAccountData } from '@/types/index';

export function useAccounts() {
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounts.list(),
    queryFn: () => apiGet<AccountWithBalance[]>('/accounts'),
    select: (res) => res.data ?? [],
    staleTime: Infinity,
  });

  const invalidateRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const createAccount = useMutation({
    mutationFn: (data: CreateAccountData) =>
      apiPost<AccountWithBalance>('/accounts', data),
    onSuccess: () => invalidateRelated(),
  });

  const updateAccount = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CreateAccountData>) =>
      apiPut<AccountWithBalance>(`/accounts/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => apiDelete(`/accounts/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  return {
    accounts: accountsQuery.data ?? [],
    isLoading: accountsQuery.isLoading,
    createAccount,
    updateAccount,
    deleteAccount,
  };
}
