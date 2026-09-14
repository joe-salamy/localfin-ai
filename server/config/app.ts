import path from "node:path";

export const SERVER_CONFIG = {
  port: 3001,
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
  openapi: "/api/openapi",
  openapiJson: "/api/openapi.json",
} as const;

export const ENV_KEYS = {
  localfinDataDirectory: "LOCALFIN_DATA_DIR",
  localfinDatabasePath: "LOCALFIN_DB_PATH",
} as const;

export const DATABASE_CONFIG = {
  dataDirectory: path.resolve(process.cwd(), "data"),
  fileName: "budget.db",
  baselineSchemaFileName: "baseline.sql",
} as const;
