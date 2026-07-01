import { useCallback, useContext } from "react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { amountGradientColor } from "@/lib/colors";
import { DisplaySettingsContext } from "./DisplaySettingsContext";

export type SuccessToast = (message: string) => string | number | undefined;

export function useDisplaySettings() {
  const value = useContext(DisplaySettingsContext);
  if (!value) {
    throw new Error(
      "useDisplaySettings must be used within DisplaySettingsProvider",
    );
  }
  return value;
}

export function useSuccessToast(): SuccessToast {
  const { successConfirmationPopupsEnabled } = useDisplaySettings();

  return useCallback<SuccessToast>(
    (message) => {
      if (!successConfirmationPopupsEnabled) return undefined;
      return toast.success(message);
    },
    [successConfirmationPopupsEnabled],
  );
}

export function useAmountGradient(amounts: number[]) {
  const settings = useDisplaySettings();
  const maxAbsAmount = Math.max(
    0,
    ...amounts.map((amount) => Math.abs(amount)),
  );

  return (amount: number): CSSProperties | undefined => {
    if (!settings.amountGradientEnabled) return undefined;
    const color = amountGradientColor(
      amount,
      maxAbsAmount,
      settings.negativeColor,
      settings.neutralColor,
      settings.positiveColor,
    );
    if (!color) return undefined;
    return { color };
  };
}
