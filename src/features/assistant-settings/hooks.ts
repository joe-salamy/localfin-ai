import { useCallback, useState } from 'react';
import {
  defaultAssistantSettings,
  normalizeMaxAssistantTurns,
  readAssistantSettings,
  writeAssistantSettings,
} from './storage';

export function useAssistantSettings() {
  const [settings, setSettings] = useState(() => readAssistantSettings());

  const setMaxAssistantTurns = useCallback((value: number) => {
    const next = {
      ...settings,
      maxAssistantTurns: normalizeMaxAssistantTurns(value),
    };
    setSettings(next);
    writeAssistantSettings(next);
  }, [settings]);

  const resetAssistantSettings = useCallback(() => {
    const next = defaultAssistantSettings();
    setSettings(next);
    writeAssistantSettings(next);
  }, []);

  return {
    ...settings,
    setMaxAssistantTurns,
    resetAssistantSettings,
  };
}
