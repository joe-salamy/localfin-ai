const STORAGE_KEY = 'localfin.flaggedWords.v1';
const STORAGE_VERSION = 1;

export const DEFAULT_FLAGGED_WORDS = ['interest', 'fee'] as const;

export interface FlaggedWordsSettings {
  version: number;
  updatedAt: string;
  words: string[];
}

export interface FlaggedWordMatch {
  name: string;
  words: string[];
}

export function normalizeFlaggedWords(words: Iterable<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const word of words) {
    const value = word.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

export function findFlaggedWords(name: string, words: string[]): string[] {
  const normalizedName = name.toLowerCase();
  if (!normalizedName) return [];
  return words.filter((word) => normalizedName.includes(word));
}

export function defaultFlaggedWordsSettings(): FlaggedWordsSettings {
  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    words: normalizeFlaggedWords(DEFAULT_FLAGGED_WORDS),
  };
}

export function readFlaggedWordsSettings(): FlaggedWordsSettings {
  if (typeof window === 'undefined') return defaultFlaggedWordsSettings();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultFlaggedWordsSettings();

  try {
    const parsed = JSON.parse(raw) as Partial<FlaggedWordsSettings>;
    const defaults = defaultFlaggedWordsSettings();
    return {
      version: STORAGE_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : defaults.updatedAt,
      words: Array.isArray(parsed.words)
        ? normalizeFlaggedWords(parsed.words.filter((word): word is string => typeof word === 'string'))
        : defaults.words,
    };
  } catch {
    return defaultFlaggedWordsSettings();
  }
}

export function writeFlaggedWordsSettings(settings: FlaggedWordsSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      words: normalizeFlaggedWords(settings.words),
    }),
  );
}
