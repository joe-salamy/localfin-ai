import { useContext } from 'react';
import type { CSSProperties } from 'react';
import { amountGradientColor } from '@/lib/colors';
import { DisplaySettingsContext } from './DisplaySettingsContext';

export function useDisplaySettings() {
  const value = useContext(DisplaySettingsContext);
  if (!value) {
    throw new Error('useDisplaySettings must be used within DisplaySettingsProvider');
  }
  return value;
}

export function useAmountGradient(amounts: number[]) {
  const settings = useDisplaySettings();
  const maxAbsAmount = Math.max(0, ...amounts.map((amount) => Math.abs(amount)));

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
