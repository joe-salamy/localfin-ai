export interface PlaidProviderClient {
  createPlaidLinkToken(): Promise<unknown>;
  exchangePublicToken(publicToken: string): Promise<unknown>;
  getBalances(accessToken: string): Promise<unknown>;
  syncTransactions(input: {
    accessToken: string;
    cursor?: string | null;
    count?: number;
  }): Promise<unknown>;
  removeItem(accessToken: string): Promise<void>;
}

export interface AkoyaProviderClient {
  exchangeCodeForTokens(input: {
    code: string;
    redirectUri?: string;
  }): Promise<unknown>;
  refreshTokens(input: { refreshToken: string }): Promise<unknown>;
  getBalances(input: {
    idToken: string;
    providerId?: string;
  }): Promise<unknown>;
  getTransactions(input: {
    idToken: string;
    accountId: string;
    startTime: string;
    endTime: string;
    limit?: number;
    offset?: number;
    providerId?: string;
  }): Promise<unknown>;
  revokeToken(input: { refreshToken: string }): Promise<void>;
}
