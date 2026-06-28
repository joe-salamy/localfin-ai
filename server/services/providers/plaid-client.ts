import {
  Configuration,
  PlaidApi,
} from 'plaid';
import type {
  AccountBase,
  AccountsGetResponse,
  CountryCode,
  ItemPublicTokenExchangeResponse,
  LinkTokenCreateRequest,
  LinkTokenCreateResponse,
  Products,
  RemovedTransaction,
  Transaction,
  TransactionsSyncResponse,
} from 'plaid';
import { ENV_KEYS, PROVIDER_CONFIG } from '../../config/app.js';

export type PlaidAccount = AccountBase;
export type PlaidTransaction = Transaction;
export type PlaidRemovedTransaction = RemovedTransaction;

export interface PlaidLinkTokenResult {
  link_token: string;
  expiration: string | null;
}

export interface PlaidPublicTokenExchangeResult {
  accessToken: string;
  itemId: string;
  requestId: string;
}

export interface PlaidSyncTransactionsInput {
  accessToken: string;
  cursor?: string | null;
  count?: number;
}

type PlaidEnv = (typeof PROVIDER_CONFIG.plaidAllowedEnvs)[number];

const PLAID_BASE_URLS: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

function getRequiredEnv(envKey: string): string {
  const value = process.env[envKey]?.trim();
  if (!value) {
    throw new Error(`${envKey} is required before linking Plaid accounts.`);
  }
  return value;
}

function getPlaidEnv(): PlaidEnv {
  const configured = process.env[ENV_KEYS.plaidEnv]?.trim() || PROVIDER_CONFIG.plaidEnv;
  if (PROVIDER_CONFIG.plaidAllowedEnvs.includes(configured as PlaidEnv)) {
    return configured as PlaidEnv;
  }
  throw new Error(`${ENV_KEYS.plaidEnv} must be one of ${PROVIDER_CONFIG.plaidAllowedEnvs.join(', ')}.`);
}

function redactProviderText(value: string): string {
  return value
    .replace(/("(?:access_token|refresh_token|id_token|public_token|token|secret)"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/((?:access_token|refresh_token|id_token|public_token|token|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function providerError(action: string, error: unknown): Error {
  if (isRecord(error) && isRecord(error.response)) {
    const status = typeof error.response.status === 'number' ? ` status ${error.response.status}` : '';
    const data = 'data' in error.response ? error.response.data : undefined;
    const message = typeof data === 'string' ? data : JSON.stringify(data ?? {});
    return new Error(`Plaid ${action} failed${status}: ${redactProviderText(message)}`);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Plaid ${action} failed: ${redactProviderText(message)}`);
}

function getPlaidClient(): PlaidApi {
  const clientId = getRequiredEnv(ENV_KEYS.plaidClientId);
  const secret = getRequiredEnv(ENV_KEYS.plaidSecret);
  const configuration = new Configuration({
    basePath: PLAID_BASE_URLS[getPlaidEnv()],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

export async function createPlaidLinkToken(): Promise<PlaidLinkTokenResult> {
  const redirectUri = process.env[ENV_KEYS.plaidRedirectUri]?.trim();
  const request: LinkTokenCreateRequest = {
    client_name: PROVIDER_CONFIG.plaidClientName,
    language: PROVIDER_CONFIG.plaidLanguage,
    country_codes: [...PROVIDER_CONFIG.plaidCountryCodes] as CountryCode[],
    user: { client_user_id: PROVIDER_CONFIG.plaidClientUserId },
    products: [...PROVIDER_CONFIG.plaidProducts] as Products[],
    transactions: { days_requested: PROVIDER_CONFIG.plaidDaysRequested },
    redirect_uri: redirectUri || undefined,
  };

  try {
    const response = await getPlaidClient().linkTokenCreate(request);
    const data: LinkTokenCreateResponse = response.data;
    return {
      link_token: data.link_token,
      expiration: data.expiration ?? null,
    };
  } catch (error) {
    throw providerError('link token creation', error);
  }
}

export async function exchangePublicToken(publicToken: string): Promise<PlaidPublicTokenExchangeResult> {
  try {
    const response = await getPlaidClient().itemPublicTokenExchange({ public_token: publicToken });
    const data: ItemPublicTokenExchangeResponse = response.data;
    return {
      accessToken: data.access_token,
      itemId: data.item_id,
      requestId: data.request_id,
    };
  } catch (error) {
    throw providerError('public token exchange', error);
  }
}

export async function getBalances(accessToken: string): Promise<AccountsGetResponse> {
  try {
    const response = await getPlaidClient().accountsBalanceGet({ access_token: accessToken });
    return response.data;
  } catch (error) {
    throw providerError('balance retrieval', error);
  }
}

export async function syncTransactions(input: PlaidSyncTransactionsInput): Promise<TransactionsSyncResponse> {
  try {
    const response = await getPlaidClient().transactionsSync({
      access_token: input.accessToken,
      cursor: input.cursor ?? undefined,
      count: input.count ?? 500,
      options: { days_requested: PROVIDER_CONFIG.plaidDaysRequested },
    });
    return response.data;
  } catch (error) {
    throw providerError('transactions sync', error);
  }
}

export async function removeItem(accessToken: string): Promise<void> {
  try {
    await getPlaidClient().itemRemove({ access_token: accessToken });
  } catch (error) {
    throw providerError('item removal', error);
  }
}
