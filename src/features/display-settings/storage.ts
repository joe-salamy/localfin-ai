import {
  DEFAULT_AMOUNT_GRADIENT_SETTINGS,
  normalizeColor,
} from "../../lib/colors";

const STORAGE_KEY = "localfin.display.v1";
const STORAGE_VERSION = 1;

export interface DisplaySettings {
  version: number;
  updatedAt: string;
  amountGradientEnabled: boolean;
  successConfirmationPopupsEnabled: boolean;
  negativeColor: string;
  neutralColor: string;
  positiveColor: string;
}

export function defaultDisplaySettings(): DisplaySettings {
  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    ...DEFAULT_AMOUNT_GRADIENT_SETTINGS,
    successConfirmationPopupsEnabled: true,
  };
}

export function readDisplaySettings(): DisplaySettings {
  if (typeof window === "undefined") return defaultDisplaySettings();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultDisplaySettings();

  try {
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    const defaults = defaultDisplaySettings();
    return {
      version: STORAGE_VERSION,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : defaults.updatedAt,
      amountGradientEnabled: Boolean(parsed.amountGradientEnabled),
      successConfirmationPopupsEnabled:
        parsed.successConfirmationPopupsEnabled !== false,
      negativeColor:
        normalizeColor(parsed.negativeColor) ?? defaults.negativeColor,
      neutralColor:
        normalizeColor(parsed.neutralColor) ?? defaults.neutralColor,
      positiveColor:
        normalizeColor(parsed.positiveColor) ?? defaults.positiveColor,
    };
  } catch {
    return defaultDisplaySettings();
  }
}

export function writeDisplaySettings(settings: DisplaySettings): void {
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
