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
  parser: "/api/parser",
  accountLinking: "/api/account-linking",
  openapi: "/api/openapi",
  openapiJson: "/api/openapi.json",
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

