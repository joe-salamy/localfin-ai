import { useContext } from "react";
import { FlaggedWordsContext } from "./FlaggedWordsContext";

export function useFlaggedWords() {
  const value = useContext(FlaggedWordsContext);
  if (!value) {
    throw new Error("useFlaggedWords must be used within FlaggedWordsProvider");
  }
  return value;
}
