import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { normalizeColor } from '@/lib/colors';
import { DisplaySettingsContext } from './DisplaySettingsContext';
import {
  defaultDisplaySettings,
  readDisplaySettings,
  writeDisplaySettings,
} from './storage';
import type { DisplaySettings } from './storage';

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DisplaySettings>(() => readDisplaySettings());

  const updateSettings = useCallback((next: DisplaySettings) => {
    setSettings(next);
    writeDisplaySettings(next);
  }, []);

  const setAmountGradientEnabled = useCallback((enabled: boolean) => {
    updateSettings({ ...settings, amountGradientEnabled: enabled });
  }, [settings, updateSettings]);

  const setGradientColor = useCallback((
    key: 'negativeColor' | 'neutralColor' | 'positiveColor',
    color: string,
  ) => {
    updateSettings({ ...settings, [key]: normalizeColor(color) ?? settings[key] });
  }, [settings, updateSettings]);

  const resetAmountGradientSettings = useCallback(() => {
    updateSettings(defaultDisplaySettings());
  }, [updateSettings]);

  const value = useMemo(() => ({
    ...settings,
    setAmountGradientEnabled,
    setGradientColor,
    resetAmountGradientSettings,
  }), [
    resetAmountGradientSettings,
    setAmountGradientEnabled,
    setGradientColor,
    settings,
  ]);

  return (
    <DisplaySettingsContext.Provider value={value}>
      {children}
    </DisplaySettingsContext.Provider>
  );
}
