import * as akoyaClient from "../providers/akoya-client.js";
import * as plaidClient from "../providers/plaid-client.js";
import type {
  AkoyaAuthorizationResult,
  PlaidLinkTokenResult,
  ProviderConnectionSummary,
  ProviderSyncResult,
} from "../../../shared/contracts/index.js";
import type {
  AkoyaProviderClient,
  PlaidProviderClient,
} from "../providers/types.js";
import { listProviderConnections } from "./connections.js";
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
} from "./plaid.js";
import {
  createAkoyaAuthorizationUrl,
  handleAkoyaCallback,
} from "./akoya.js";
import {
  disconnectProviderConnection,
  syncProviderConnections,
} from "./sync.js";

export interface AccountLinkingDependencies {
  plaid: PlaidProviderClient;
  akoya: AkoyaProviderClient;
}

export interface AccountLinkingService {
  listProviderConnections(): ProviderConnectionSummary[];
  createPlaidLinkToken(
    targetInstitution: "us_bank" | "discover",
  ): Promise<PlaidLinkTokenResult>;
  exchangePlaidPublicToken(input: {
    publicToken: string;
    targetInstitution: "us_bank" | "discover";
    metadata: unknown;
  }): Promise<ProviderConnectionSummary>;
  createAkoyaAuthorizationUrl(
    targetInstitution: "fidelity",
  ): AkoyaAuthorizationResult;
  handleAkoyaCallback(input: {
    code: string;
    state: string;
  }): Promise<ProviderConnectionSummary>;
  syncProviderConnections(input?: {
    connectionId?: string;
  }): Promise<ProviderSyncResult[]>;
  disconnectProviderConnection(connectionId: string): Promise<void>;
}

export function createAccountLinkingService(
  dependencies: AccountLinkingDependencies,
): AccountLinkingService {
  return {
    listProviderConnections,
    createPlaidLinkToken: (targetInstitution) =>
      createPlaidLinkToken(targetInstitution, dependencies),
    exchangePlaidPublicToken: (input) =>
      exchangePlaidPublicToken(input, dependencies),
    createAkoyaAuthorizationUrl,
    handleAkoyaCallback: (input) => handleAkoyaCallback(input, dependencies),
    syncProviderConnections: (input) =>
      syncProviderConnections(input, dependencies),
    disconnectProviderConnection: (connectionId) =>
      disconnectProviderConnection(connectionId, dependencies),
  };
}

export const accountLinkingService = createAccountLinkingService({
  plaid: plaidClient,
  akoya: akoyaClient,
});
