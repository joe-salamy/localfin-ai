import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AkoyaAuthorizationResult,
  PlaidLinkTokenResult,
  ProviderConnectionSummary,
  ProviderSyncResult,
} from "@/types";

type PlaidTargetInstitution = "us_bank" | "discover";

interface CreatePlaidLinkTokenInput {
  targetInstitution: PlaidTargetInstitution;
}

interface ExchangePlaidPublicTokenInput {
  publicToken: string;
  targetInstitution: PlaidTargetInstitution;
  metadata: unknown;
}

interface StartAkoyaAuthorizationInput {
  targetInstitution: "fidelity";
}

interface SyncProviderConnectionsInput {
  connectionId?: string;
}

export function useAccountLinking() {
  const queryClient = useQueryClient();

  const connectionsQuery = useQuery({
    queryKey: queryKeys.accountLinking.connections(),
    queryFn: () =>
      apiGet<ProviderConnectionSummary[]>("/account-linking/connections"),
    select: (res) => res.data ?? [],
    staleTime: Infinity,
  });

  const invalidateRelated = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accountLinking.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);

  const createPlaidLinkToken = useMutation({
    mutationFn: (data: CreatePlaidLinkTokenInput) =>
      apiPost<PlaidLinkTokenResult>("/account-linking/plaid/link-token", data),
  });

  const exchangePlaidPublicToken = useMutation({
    mutationFn: (data: ExchangePlaidPublicTokenInput) =>
      apiPost<ProviderConnectionSummary>(
        "/account-linking/plaid/exchange",
        data,
      ),
    onSuccess: () => invalidateRelated(),
  });

  const startAkoyaAuthorization = useMutation({
    mutationFn: (data: StartAkoyaAuthorizationInput) =>
      apiPost<AkoyaAuthorizationResult>(
        "/account-linking/akoya/authorize",
        data,
      ),
  });

  const syncProviderConnections = useMutation({
    mutationFn: (data: SyncProviderConnectionsInput = {}) =>
      apiPost<ProviderSyncResult[]>("/account-linking/sync", data),
    onSuccess: () => invalidateRelated(),
  });

  const disconnectProviderConnection = useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ success: true }>(`/account-linking/connections/${id}`),
    onSuccess: () => invalidateRelated(),
  });

  return {
    connections: connectionsQuery.data ?? [],
    isLoading: connectionsQuery.isLoading,
    createPlaidLinkToken,
    exchangePlaidPublicToken,
    startAkoyaAuthorization,
    syncProviderConnections,
    disconnectProviderConnection,
  };
}
