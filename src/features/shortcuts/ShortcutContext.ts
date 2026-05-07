import { createContext } from 'react';
import type { CommandDefinition, CommandId, CommandScope, ShortcutBinding } from './commands';

export interface ShortcutConflict {
  command: CommandDefinition;
  binding: ShortcutBinding;
}

export interface ShortcutContextValue {
  commands: readonly CommandDefinition[];
  getShortcut: (commandId: CommandId) => ShortcutBinding | null;
  setShortcut: (commandId: CommandId, binding: ShortcutBinding | null) => void;
  resetShortcut: (commandId: CommandId) => void;
  resetAllShortcuts: () => void;
  getConflicts: (commandId: CommandId, binding: ShortcutBinding | null) => ShortcutConflict[];
  registerShortcutHandler: (
    commandId: CommandId,
    handler: () => void,
    options?: { enabled?: boolean; scope?: CommandScope },
  ) => () => void;
  pushScope: (scope: CommandScope) => () => void;
  disableSingleKeyShortcuts: boolean;
  setDisableSingleKeyShortcuts: (disabled: boolean) => void;
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null);
