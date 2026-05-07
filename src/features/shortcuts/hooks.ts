import { useContext, useEffect } from 'react';
import type { CommandId, CommandScope } from './commands';
import { ShortcutContext } from './ShortcutContext';
import type { ShortcutContextValue } from './ShortcutContext';
import { ariaKeyShortcut, displayShortcut } from './normalize';

export function useShortcuts(): ShortcutContextValue {
  const context = useContext(ShortcutContext);
  if (!context) {
    throw new Error('useShortcuts must be used within ShortcutProvider');
  }
  return context;
}

export function useShortcut(
  commandId: CommandId,
  handler: () => void,
  options: { enabled?: boolean; scope?: CommandScope } = {},
): void {
  const { registerShortcutHandler } = useShortcuts();
  const enabled = options.enabled ?? true;
  const scope = options.scope;

  useEffect(() => {
    return registerShortcutHandler(commandId, handler, { enabled, scope });
  }, [commandId, enabled, handler, registerShortcutHandler, scope]);
}

export function useShortcutScope(scope: CommandScope, enabled = true): void {
  const { pushScope } = useShortcuts();

  useEffect(() => {
    if (!enabled) return undefined;
    return pushScope(scope);
  }, [enabled, pushScope, scope]);
}

export function useShortcutMetadata(commandId: CommandId): {
  label: string;
  ariaKeyShortcuts: string | undefined;
} {
  const { getShortcut } = useShortcuts();
  const binding = getShortcut(commandId);
  return {
    label: displayShortcut(binding),
    ariaKeyShortcuts: ariaKeyShortcut(binding),
  };
}
