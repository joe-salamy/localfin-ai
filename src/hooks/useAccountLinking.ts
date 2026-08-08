import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { invalidateFinanceQueries } from "@/lib/queryInvalidation";
import {
  akoyaAuthorizationResultSchema,
  plaidLinkTokenResultSchema,
  providerConnectionSummarySchema,
  providerSyncResultSchema,
} from "@shared/contracts";
import type {
  AkoyaAuthorizationResult,
  PlaidLinkTokenResult,
  ProviderConnectionSummary,
  ProviderSyncResult,
  TargetInstitution,
} from "@shared/contracts";

type PlaidTargetInstitution = Extract<
  TargetInstitution,
  "us_bank" | "discover"
>;

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
      apiGet<ProviderConnectionSummary[]>(
        "/account-linking/connections",
        providerConnectionSummarySchema.array(),
      ),
    select: (res) => res.data ?? [],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidateRelated = () =>
    invalidateFinanceQueries(queryClient, "providers");

  const createPlaidLinkToken = useMutation({
    mutationFn: (data: CreatePlaidLinkTokenInput) =>
      apiPost<PlaidLinkTokenResult>(
        "/account-linking/plaid/link-token",
        data,
        plaidLinkTokenResultSchema,
      ),
  });

  const exchangePlaidPublicToken = useMutation({
    mutationFn: (data: ExchangePlaidPublicTokenInput) =>
      apiPost<ProviderConnectionSummary>(
        "/account-linking/plaid/exchange",
        data,
        providerConnectionSummarySchema,
      ),
    onSuccess: () => invalidateRelated(),
  });

  const startAkoyaAuthorization = useMutation({
    mutationFn: (data: StartAkoyaAuthorizationInput) =>
      apiPost<AkoyaAuthorizationResult>(
        "/account-linking/akoya/authorize",
        data,
        akoyaAuthorizationResultSchema,
      ),
  });

  const syncProviderConnections = useMutation({
    mutationFn: (data: SyncProviderConnectionsInput = {}) =>
      apiPost<ProviderSyncResult[]>(
        "/account-linking/sync",
        data,
        providerSyncResultSchema.array(),
      ),
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
