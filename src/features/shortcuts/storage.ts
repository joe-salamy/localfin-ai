import type { CommandId, ShortcutBinding } from './commands';
import { DEFAULT_COMMANDS } from './commands';

const STORAGE_KEY = 'localfin.shortcuts.v1';
const STORAGE_VERSION = 1;

export interface StoredShortcutSettings {
  version: number;
  updatedAt: string;
  overrides: Partial<Record<CommandId, string | null>>;
  showShortcutHints: boolean;
  disableSingleKeyShortcuts: boolean;
}

export type ShortcutOverrides = Partial<Record<CommandId, ShortcutBinding | null>>;

export function defaultStoredShortcutSettings(): StoredShortcutSettings {
  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    overrides: {},
    showShortcutHints: true,
    disableSingleKeyShortcuts: false,
  };
}

function isCommandId(value: string): value is CommandId {
  return DEFAULT_COMMANDS.some((command) => command.id === value);
}

export function readShortcutSettings(): StoredShortcutSettings {
  if (typeof window === 'undefined') return defaultStoredShortcutSettings();

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultStoredShortcutSettings();

  try {
    const parsed = JSON.parse(raw) as Partial<StoredShortcutSettings>;
    const overrides: StoredShortcutSettings['overrides'] = {};
    for (const [id, value] of Object.entries(parsed.overrides ?? {})) {
      if (isCommandId(id) && (typeof value === 'string' || value === null)) {
        overrides[id] = value;
      }
    }

    return {
      version: STORAGE_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      overrides,
      showShortcutHints: parsed.showShortcutHints !== false,
      disableSingleKeyShortcuts: Boolean(parsed.disableSingleKeyShortcuts),
    };
  } catch {
    return defaultStoredShortcutSettings();
  }
}

export function writeShortcutSettings(settings: StoredShortcutSettings): void {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...settings,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function toShortcutOverrides(settings: StoredShortcutSettings): ShortcutOverrides {
  const overrides: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(settings.overrides)) {
    if (!isCommandId(id)) continue;
    overrides[id] = value === null ? null : { key: value };
  }
  return overrides;
}

export function buildShortcutSettings(
  overrides: ShortcutOverrides,
  showShortcutHints: boolean,
  disableSingleKeyShortcuts: boolean,
): StoredShortcutSettings {
  const storedOverrides: StoredShortcutSettings['overrides'] = {};
  for (const [id, binding] of Object.entries(overrides)) {
    if (!isCommandId(id)) continue;
    storedOverrides[id] = binding?.key ?? null;
  }

  return {
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    overrides: storedOverrides,
    showShortcutHints,
    disableSingleKeyShortcuts,
  };
}
