import { createContext } from "react";
import type { FlaggedWordMatch, FlaggedWordsSettings } from "./storage";

export interface FlaggedWordsContextValue extends FlaggedWordsSettings {
  setFlaggedWords: (words: string[]) => void;
  resetFlaggedWords: () => void;
  findMatches: (name: string) => string[];
  findTransactionMatches: (
    transactions: Array<{ name: string }>,
  ) => FlaggedWordMatch[];
}

export const FlaggedWordsContext =
  createContext<FlaggedWordsContextValue | null>(null);
