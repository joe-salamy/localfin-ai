import { createContext } from "react";
import type { DisplaySettings } from "./storage";

export interface DisplaySettingsContextValue extends DisplaySettings {
  setAmountGradientEnabled: (enabled: boolean) => void;
  setGradientColor: (
    key: "negativeColor" | "neutralColor" | "positiveColor",
    color: string,
  ) => void;
  resetAmountGradientSettings: () => void;
}

export const DisplaySettingsContext =
  createContext<DisplaySettingsContextValue | null>(null);
