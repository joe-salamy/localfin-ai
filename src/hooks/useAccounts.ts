import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateFinanceQueries } from "@/lib/queryInvalidation";
import type { Account,
AccountWithBalance,
CreateAccountData,
ReconcileAccountData,
ReconcileAccountResult, } from "@shared/contracts"

export function useAccounts() {
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounts.list(),
    queryFn: () => apiGet<AccountWithBalance[]>("/accounts"),
    select: (res) => res.data ?? [],
    staleTime: Infinity,
  });

  const invalidateRelated = () =>
    invalidateFinanceQueries(queryClient, "accounts");

  const createAccount = useMutation({
    mutationFn: (data: CreateAccountData) =>
      apiPost<AccountWithBalance>("/accounts", data),
    onSuccess: () => invalidateRelated(),
  });

  const updateAccount = useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<CreateAccountData>) =>
      apiPut<AccountWithBalance>(`/accounts/${id}`, data),
    onSuccess: () => invalidateRelated(),
  });

  const reconcileAccount = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & ReconcileAccountData) =>
      apiPost<ReconcileAccountResult>(`/accounts/${id}/reconcile`, data),
    onSuccess: () => invalidateRelated(),
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => apiDelete(`/accounts/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  const restoreAccount = useMutation({
    mutationFn: (id: string) => apiPost<Account>(`/accounts/${id}/restore`, {}),
    onSuccess: () => invalidateRelated(),
  });

  return {
    accounts: accountsQuery.data ?? [],
    isLoading: accountsQuery.isLoading,
    createAccount,
    updateAccount,
    reconcileAccount,
    deleteAccount,
    restoreAccount,
  };
}
