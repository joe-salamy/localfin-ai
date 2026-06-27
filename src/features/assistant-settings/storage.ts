const STORAGE_KEY = "localfin.assistant.v1";
const STORAGE_VERSION = 1;

export const DEFAULT_MAX_ASSISTANT_TURNS = 5;
export const MIN_MAX_ASSISTANT_TURNS = 1;
export const MAX_MAX_ASSISTANT_TURNS = 10;

export interface AssistantSettings {
  version: number;
  updatedAt: string;
  maxAssistantTurns: number;
}

export function normalizeMaxAssistantTurns(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_MAX_ASSISTANT_TURNS;
  return Math.min(
    Math.max(Math.trunc(numericValue), MIN_MAX_ASSISTANT_TURNS),
    MAX_MAX_ASSISTANT_TURNS,
  );
}

export function defaultAssistantSettings(): AssistantSettings {
  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    maxAssistantTurns: DEFAULT_MAX_ASSISTANT_TURNS,
  };
}

export function readAssistantSettings(): AssistantSettings {
  if (typeof window === "undefined") return defaultAssistantSettings();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultAssistantSettings();

  try {
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return {
      version: STORAGE_VERSION,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
      maxAssistantTurns: normalizeMaxAssistantTurns(parsed.maxAssistantTurns),
    };
  } catch {
    return defaultAssistantSettings();
  }
}

export function writeAssistantSettings(settings: AssistantSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }),
  );
}
