import { ENV_KEYS, PROVIDER_CONFIG } from "../../config/app.js";

export interface AkoyaRuntimeConfig {
  clientId: string;
  clientSecret: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  redirectUri: string;
  connector: string;
  providerId: string;
  apiVersion: string;
  scope: string;
}

export interface AkoyaTokenResponse {
  id_token: string;
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface ExchangeCodeForTokensInput {
  code: string;
  redirectUri?: string;
}

export interface RefreshTokensInput {
  refreshToken: string;
}

export interface GetAkoyaBalancesInput {
  idToken: string;
  providerId?: string;
}

export interface GetAkoyaTransactionsInput {
  idToken: string;
  accountId: string;
  startTime: string;
  endTime: string;
  limit?: number;
  offset?: number;
  providerId?: string;
}

export interface RevokeTokenInput {
  refreshToken: string;
}

function readEnv(envKey: string, fallback?: string): string {
  const value = process.env[envKey]?.trim() || fallback;
  if (!value) {
    throw new Error(`${envKey} is required before linking Akoya accounts.`);
  }
  return value;
}

function redactProviderText(value: string): string {
  return value
    .replace(
      /("(?:access_token|refresh_token|id_token|public_token|token|secret)"\s*:\s*")[^"]+(")/gi,
      "$1[REDACTED]$2",
    )
    .replace(
      /((?:access_token|refresh_token|id_token|public_token|token|secret)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getAkoyaRuntimeConfig(): AkoyaRuntimeConfig {
  const connector = readEnv(
    ENV_KEYS.akoyaConnector,
    PROVIDER_CONFIG.akoyaConnector,
  );
  return {
    clientId: readEnv(ENV_KEYS.akoyaClientId),
    clientSecret: readEnv(ENV_KEYS.akoyaClientSecret),
    authBaseUrl: trimTrailingSlash(
      readEnv(ENV_KEYS.akoyaAuthBaseUrl, PROVIDER_CONFIG.akoyaAuthBaseUrl),
    ),
    apiBaseUrl: trimTrailingSlash(
      readEnv(ENV_KEYS.akoyaApiBaseUrl, PROVIDER_CONFIG.akoyaApiBaseUrl),
    ),
    redirectUri: readEnv(ENV_KEYS.akoyaRedirectUri),
    connector,
    providerId: readEnv(
      ENV_KEYS.akoyaProviderId,
      connector || PROVIDER_CONFIG.akoyaProviderId,
    ),
    apiVersion: readEnv(
      ENV_KEYS.akoyaApiVersion,
      PROVIDER_CONFIG.akoyaApiVersion,
    ),
    scope: PROVIDER_CONFIG.akoyaScope,
  };
}

async function readResponseText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as unknown;
    return JSON.stringify(body);
  }
  return response.text();
}

async function parseJsonResponse<T>(
  providerAction: string,
  response: Response,
): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  const body = await readResponseText(response);
  throw new Error(
    `Akoya ${providerAction} failed status ${response.status}: ${redactProviderText(body)}`,
  );
}

function createBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

export async function exchangeCodeForTokens(
  input: ExchangeCodeForTokensInput,
): Promise<AkoyaTokenResponse> {
  const config = getAkoyaRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri ?? config.redirectUri,
    code: input.code,
  });

  const response = await fetch(`${config.authBaseUrl}/token`, {
    method: "POST",
    headers: {
      Authorization: createBasicAuthHeader(
        config.clientId,
        config.clientSecret,
      ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseJsonResponse<AkoyaTokenResponse>(
    "authorization code exchange",
    response,
  );
}

export async function refreshTokens(
  input: RefreshTokensInput,
): Promise<AkoyaTokenResponse> {
  const config = getAkoyaRuntimeConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(`${config.authBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseJsonResponse<AkoyaTokenResponse>("token refresh", response);
}

export async function getBalances(
  input: GetAkoyaBalancesInput,
): Promise<unknown> {
  const config = getAkoyaRuntimeConfig();
  const providerId = encodeURIComponent(input.providerId ?? config.providerId);
  const apiVersion = encodeURIComponent(config.apiVersion);
  const response = await fetch(
    `${config.apiBaseUrl}/balances/${apiVersion}/${providerId}?mode=standard`,
    {
      headers: { Authorization: `Bearer ${input.idToken}` },
    },
  );
  return parseJsonResponse<unknown>("balance retrieval", response);
}

export async function getTransactions(
  input: GetAkoyaTransactionsInput,
): Promise<unknown> {
  const config = getAkoyaRuntimeConfig();
  const providerId = encodeURIComponent(input.providerId ?? config.providerId);
  const accountId = encodeURIComponent(input.accountId);
  const apiVersion = encodeURIComponent(config.apiVersion);
  const params = new URLSearchParams({
    mode: "standard",
    startTime: input.startTime,
    endTime: input.endTime,
    limit: String(input.limit ?? 500),
    offset: String(input.offset ?? 0),
  });
  const response = await fetch(
    `${config.apiBaseUrl}/transactions/${apiVersion}/${providerId}/${accountId}?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${input.idToken}` },
    },
  );
  return parseJsonResponse<unknown>("transactions retrieval", response);
}

export async function revokeToken(input: RevokeTokenInput): Promise<void> {
  const config = getAkoyaRuntimeConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    token: input.refreshToken,
    token_type_hint: "refresh_token",
  });

  const response = await fetch(`${config.authBaseUrl}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (response.ok || response.status === 404 || response.status === 501) {
    return;
  }

  const responseBody = await readResponseText(response);
  throw new Error(
    `Akoya token revocation failed status ${response.status}: ${redactProviderText(responseBody)}`,
  );
}
