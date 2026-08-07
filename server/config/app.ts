import path from "node:path";

export const SERVER_CONFIG = {
  port: 3001,
  defaultCorsOrigins: "http://localhost:5173,http://127.0.0.1:5173",
  jsonLimit: "1mb",
} as const;

export const API_ROUTES = {
  health: "/api/health",
  accounts: "/api/accounts",
  categories: "/api/categories",
  subcategories: "/api/subcategories",
  tags: "/api/tags",
  transactions: "/api/transactions",
  dashboard: "/api/dashboard",
  goals: "/api/goals",
  ai: "/api/ai",
  parser: "/api/parser",
  accountLinking: "/api/account-linking",
} as const;

export const HTTP_HEADERS = {
  contentType: "Content-Type",
  cacheControl: "Cache-Control",
  connection: "Connection",
  sseContentType: "text/event-stream",
  sseCacheControl: "no-cache, no-transform",
  sseConnection: "keep-alive",
} as const;

export const DATE_CONFIG = {
  isoDateFormat: "yyyy-MM-dd",
  shortMonthDayFormat: "MMM d",
  monthYearFormat: "MMM yyyy",
} as const;

export const ENV_KEYS = {
  corsOrigin: "CORS_ORIGIN",
  openRouterApiKey: "OPENROUTER_API_KEY",
  localfinDataDirectory: "LOCALFIN_DATA_DIR",
  localfinDatabasePath: "LOCALFIN_DB_PATH",
  localfinProviderSecret: "LOCALFIN_PROVIDER_SECRET",
  plaidClientId: "PLAID_CLIENT_ID",
  plaidSecret: "PLAID_SECRET",
  plaidEnv: "PLAID_ENV",
  plaidRedirectUri: "PLAID_REDIRECT_URI",
  akoyaClientId: "AKOYA_CLIENT_ID",
  akoyaClientSecret: "AKOYA_CLIENT_SECRET",
  akoyaAuthBaseUrl: "AKOYA_AUTH_BASE_URL",
  akoyaApiBaseUrl: "AKOYA_API_BASE_URL",
  akoyaRedirectUri: "AKOYA_REDIRECT_URI",
  akoyaConnector: "AKOYA_CONNECTOR",
  akoyaProviderId: "AKOYA_PROVIDER_ID",
  akoyaApiVersion: "AKOYA_API_VERSION",
  frontendBaseUrl: "FRONTEND_BASE_URL",
} as const;

export const DATABASE_CONFIG = {
  dataDirectory: path.resolve(process.cwd(), "data"),
  fileName: "budget.db",
  baselineSchemaFileName: "baseline.sql",
} as const;

export const PROVIDER_CONFIG = {
  frontendBaseUrl: "http://localhost:5173",
  plaidEnv: "sandbox",
  plaidAllowedEnvs: ["sandbox", "development", "production"],
  plaidClientName: "LocalFin AI",
  plaidProducts: ["transactions"],
  plaidCountryCodes: ["US"],
  plaidLanguage: "en",
  plaidClientUserId: "localfin-default-user",
  plaidDaysRequested: 90,
  akoyaAuthBaseUrl: "https://sandbox-idp.ddp.akoya.com",
  akoyaApiBaseUrl: "https://sandbox-products.ddp.akoya.com",
  akoyaApiVersion: "v3",
  akoyaConnector: "mikomo",
  akoyaProviderId: "mikomo",
  akoyaScope: "openid offline_access profile",
} as const;

export const AI_CONFIG = {
  batchSize: 25,
  contextSize: 100,
  maxConcurrentLLMRequests: 5,
} as const;

export const AI_MODELS = {
  transactionCategorization: "deepseek/deepseek-v4-flash",
  assistantChat: "deepseek/deepseek-v4-flash",
} as const;

export const OPENROUTER_CONFIG = {
  apiKeyPlaceholder: "your_openrouter_api_key_here",
  logDirectory: path.resolve(process.cwd(), "logs", "jsonl"),
  logFileTimeZone: "America/Los_Angeles",
  maxLogIdLength: 120,
} as const;

export function getOpenRouterApiKey(): string {
  const apiKey = process.env[ENV_KEYS.openRouterApiKey];
  if (!apiKey || apiKey === OPENROUTER_CONFIG.apiKeyPlaceholder) {
    throw new Error(
      `${ENV_KEYS.openRouterApiKey} not configured. Set it in .env file.`,
    );
  }
  return apiKey;
}

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];
