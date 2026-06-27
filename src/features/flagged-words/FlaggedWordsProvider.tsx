import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FlaggedWordsContext } from "./FlaggedWordsContext";
import {
  buildFlaggedWordsSettings,
  defaultFlaggedWordsSettings,
  findFlaggedWords,
  readFlaggedWordsSettings,
  writeFlaggedWordsSettings,
} from "./storage";
import type { FlaggedWordMatch, FlaggedWordsSettings } from "./storage";

export function FlaggedWordsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<FlaggedWordsSettings>(() =>
    readFlaggedWordsSettings(),
  );

  const updateSettings = useCallback((next: FlaggedWordsSettings) => {
    setSettings(next);
    writeFlaggedWordsSettings(next);
  }, []);

  const setFlaggedWords = useCallback(
    (words: string[]) => {
      updateSettings(buildFlaggedWordsSettings(words));
    },
    [updateSettings],
  );

  const resetFlaggedWords = useCallback(() => {
    updateSettings(defaultFlaggedWordsSettings());
  }, [updateSettings]);

  const findMatches = useCallback(
    (name: string) => {
      return findFlaggedWords(name, settings.words);
    },
    [settings.words],
  );

  const findTransactionMatches = useCallback(
    (transactions: Array<{ name: string }>): FlaggedWordMatch[] => {
      return transactions
        .map((transaction) => ({
          name: transaction.name,
          words: findFlaggedWords(transaction.name, settings.words),
        }))
        .filter((match) => match.words.length > 0);
    },
    [settings.words],
  );

  const value = useMemo(
    () => ({
      ...settings,
      setFlaggedWords,
      resetFlaggedWords,
      findMatches,
      findTransactionMatches,
    }),
    [
      findMatches,
      findTransactionMatches,
      resetFlaggedWords,
      setFlaggedWords,
      settings,
    ],
  );

  return (
    <FlaggedWordsContext.Provider value={value}>
      {children}
    </FlaggedWordsContext.Provider>
  );
}
