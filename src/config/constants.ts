export const APP_NAME = 'AI Budget App';
export const APP_VERSION = '0.1.0';

export const DATE_FORMAT = 'yyyy-MM-dd';
export const DISPLAY_DATE_FORMAT = 'MMM d, yyyy';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_DATE_RANGE_DAYS = 90;

// AI configuration
export const AI_BATCH_SIZE = 25;
export const AI_CONTEXT_SIZE = 100;

export const API_BASE_PATH = '/api';
export const SSE_ACCEPT_HEADER = 'text/event-stream';
export const SERVER_UNREACHABLE_MESSAGE =
  'Cannot reach the LocalFin server. Start the app with npm run dev and open http://localhost:5173.';
export const INVALID_SERVER_RESPONSE_MESSAGE = 'LocalFin server returned an invalid response.';

// System UUIDs (must match seed data)
export const SYSTEM_CATEGORIES = {
  INCOME_UNASSIGNED: '00000000-0000-0000-0000-000000000001',
  EXPENSE_UNASSIGNED: '00000000-0000-0000-0000-000000000002',
} as const;

export const SYSTEM_SUBCATEGORIES = {
  INCOME_UNASSIGNED: '00000000-0000-0000-0000-000000000003',
  EXPENSE_UNASSIGNED: '00000000-0000-0000-0000-000000000004',
} as const;
