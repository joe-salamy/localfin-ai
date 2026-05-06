import path from 'node:path';

export const SERVER_CONFIG = {
  port: 3001,
  defaultCorsOrigins: 'http://localhost:5173,http://127.0.0.1:5173',
  jsonLimit: '1mb',
} as const;

export const API_ROUTES = {
  health: '/api/health',
  accounts: '/api/accounts',
  categories: '/api/categories',
  subcategories: '/api/subcategories',
  transactions: '/api/transactions',
  dashboard: '/api/dashboard',
  goals: '/api/goals',
  ai: '/api/ai',
  parser: '/api/parser',
} as const;

export const HTTP_HEADERS = {
  contentType: 'Content-Type',
  cacheControl: 'Cache-Control',
  connection: 'Connection',
  sseContentType: 'text/event-stream',
  sseCacheControl: 'no-cache, no-transform',
  sseConnection: 'keep-alive',
} as const;

export const DATE_CONFIG = {
  isoDateFormat: 'yyyy-MM-dd',
  shortMonthDayFormat: 'MMM d',
  monthYearFormat: 'MMM yyyy',
} as const;

export const ENV_KEYS = {
  corsOrigin: 'CORS_ORIGIN',
  openRouterApiKey: 'OPENROUTER_API_KEY',
} as const;

export const DATABASE_CONFIG = {
  dataDirectory: path.resolve(process.cwd(), 'data'),
  fileName: 'budget.db',
  schemaFileName: 'schema.sql',
} as const;

export const AI_CONFIG = {
  batchSize: 25,
  contextSize: 100,
  maxConcurrentLLMRequests: 5,
} as const;

export const AI_MODELS = {
  transactionCategorization: 'google/gemini-3.1-flash-lite-preview',
  assistantChat: 'google/gemini-3.1-flash-lite-preview',
} as const;

export const OPENROUTER_CONFIG = {
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKeyPlaceholder: 'your_openrouter_api_key_here',
  defaultOperation: 'openrouter.chat_completion',
  providerName: 'openrouter',
  logDirectory: path.resolve(process.cwd(), 'logs'),
  maxLogIdLength: 120,
} as const;

export type AIModel = (typeof AI_MODELS)[keyof typeof AI_MODELS];
