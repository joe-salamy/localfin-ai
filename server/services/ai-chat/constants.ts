export const DEFAULT_MAX_ASSISTANT_TURNS = 5;
export const MIN_MAX_ASSISTANT_TURNS = 1;
export const MAX_MAX_ASSISTANT_TURNS = 10;
export const DEFAULT_BULK_TRANSACTION_LIMIT = 100;
export const MAX_BULK_TRANSACTION_LIMIT = 500;

export function normalizeMaxAssistantTurns(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_MAX_ASSISTANT_TURNS;
  return Math.min(
    Math.max(Math.trunc(numericValue), MIN_MAX_ASSISTANT_TURNS),
    MAX_MAX_ASSISTANT_TURNS,
  );
}
