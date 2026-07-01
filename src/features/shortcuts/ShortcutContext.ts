import { createContext } from "react";
import type {
  CommandDefinition,
  CommandId,
  CommandScope,
  ShortcutBinding,
} from "./commands";

export interface ShortcutConflict {
  command: CommandDefinition;
  binding: ShortcutBinding;
}

export interface ShortcutContextValue {
  commands: readonly CommandDefinition[];
  getShortcut: (commandId: CommandId) => ShortcutBinding | null;
  getShortcuts: (commandId: CommandId) => readonly ShortcutBinding[];
  setShortcut: (commandId: CommandId, binding: ShortcutBinding | null) => void;
  resetShortcut: (commandId: CommandId) => void;
  resetAllShortcuts: () => void;
  getConflicts: (
    commandId: CommandId,
    bindings: readonly ShortcutBinding[],
  ) => ShortcutConflict[];
  registerShortcutHandler: (
    commandId: CommandId,
    handler: () => void,
    options?: { enabled?: boolean; scope?: CommandScope },
  ) => () => void;
  pushScope: (scope: CommandScope) => () => void;
  showShortcutHints: boolean;
  setShowShortcutHints: (shown: boolean) => void;
  disableSingleKeyShortcuts: boolean;
  setDisableSingleKeyShortcuts: (disabled: boolean) => void;
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null);
