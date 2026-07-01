import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CommandId, CommandScope, ShortcutBinding } from "./commands";
import { DEFAULT_COMMANDS, getCommandDefinition } from "./commands";
import {
  isEditableElement,
  isSingleCharacterShortcut,
  normalizeKeyboardEvent,
  validateShortcut,
} from "./normalize";
import { ShortcutContext } from "./ShortcutContext";
import type { ShortcutContextValue } from "./ShortcutContext";
import {
  buildShortcutSettings,
  readShortcutSettings,
  toShortcutOverrides,
  writeShortcutSettings,
} from "./storage";
import { shouldSkipShortcutDispatch } from "./dispatch";
import type { ShortcutOverrides } from "./storage";

interface RegisteredHandler {
  id: number;
  commandId: CommandId;
  handler: () => void;
  scope: CommandScope;
  enabled: boolean;
}

let nextHandlerId = 1;
let nextScopeId = 1;
const EMPTY_SHORTCUTS: readonly ShortcutBinding[] = [];

function scopesOverlap(left: CommandScope, right: CommandScope): boolean {
  return left === right || left === "global" || right === "global";
}

function isScopeActive(
  scope: CommandScope,
  activeScopes: CommandScope[],
): boolean {
  return scope === "global" || activeScopes.includes(scope);
}


export function ShortcutProvider({ children }: { children: ReactNode }) {
  const initialSettings = useMemo(() => readShortcutSettings(), []);
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() =>
    toShortcutOverrides(initialSettings),
  );
  const [showShortcutHints, setShowShortcutHintsState] = useState(
    initialSettings.showShortcutHints,
  );
  const [disableSingleKeyShortcuts, setDisableSingleKeyShortcutsState] =
    useState(initialSettings.disableSingleKeyShortcuts);
  const handlersRef = useRef<RegisteredHandler[]>([]);
  const scopesRef = useRef<Array<{ id: number; scope: CommandScope }>>([]);

  const shortcuts = useMemo(() => {
    const resolved = new Map<CommandId, readonly ShortcutBinding[]>();
    for (const command of DEFAULT_COMMANDS) {
      const override = overrides[command.id];
      const bindings =
        override === undefined
          ? command.defaultBindings
          : override
            ? [override]
            : EMPTY_SHORTCUTS;
      resolved.set(command.id, bindings);
    }
    return resolved;
  }, [overrides]);

  const persist = useCallback(
    (
      nextOverrides: ShortcutOverrides,
      showHints: boolean,
      disableSingleKeys: boolean,
    ) => {
      writeShortcutSettings(
        buildShortcutSettings(nextOverrides, showHints, disableSingleKeys),
      );
    },
    [],
  );

  const getShortcuts = useCallback(
    (commandId: CommandId) => shortcuts.get(commandId) ?? EMPTY_SHORTCUTS,
    [shortcuts],
  );

  const getShortcut = useCallback(
    (commandId: CommandId) => getShortcuts(commandId)[0] ?? null,
    [getShortcuts],
  );

  const setShortcut = useCallback(
    (commandId: CommandId, binding: ShortcutBinding | null) => {
      setOverrides((current) => {
        const next = { ...current, [commandId]: binding };
        persist(next, showShortcutHints, disableSingleKeyShortcuts);
        return next;
      });
    },
    [disableSingleKeyShortcuts, persist, showShortcutHints],
  );

  const resetShortcut = useCallback(
    (commandId: CommandId) => {
      setOverrides((current) => {
        const next = { ...current };
        delete next[commandId];
        persist(next, showShortcutHints, disableSingleKeyShortcuts);
        return next;
      });
    },
    [disableSingleKeyShortcuts, persist, showShortcutHints],
  );

  const resetAllShortcuts = useCallback(() => {
    setOverrides({});
    setShowShortcutHintsState(true);
    setDisableSingleKeyShortcutsState(false);
    persist({}, true, false);
  }, [persist]);

  const setDisableSingleKeyShortcuts = useCallback(
    (disabled: boolean) => {
      setDisableSingleKeyShortcutsState(disabled);
      persist(overrides, showShortcutHints, disabled);
    },
    [overrides, persist, showShortcutHints],
  );

  const setShowShortcutHints = useCallback(
    (shown: boolean) => {
      setShowShortcutHintsState(shown);
      persist(overrides, shown, disableSingleKeyShortcuts);
    },
    [disableSingleKeyShortcuts, overrides, persist],
  );

  const getConflicts = useCallback(
    (commandId: CommandId, bindings: readonly ShortcutBinding[]) => {
      if (bindings.length === 0) return [];
      const command = getCommandDefinition(commandId);
      return DEFAULT_COMMANDS.flatMap((candidate) => {
        if (candidate.id === commandId) return [];
        if (!scopesOverlap(command.scope, candidate.scope)) return [];

        return (shortcuts.get(candidate.id) ?? EMPTY_SHORTCUTS)
          .filter((candidateBinding) =>
            bindings.some((binding) => binding.key === candidateBinding.key),
          )
          .map((candidateBinding) => ({
            command: candidate,
            binding: candidateBinding,
          }));
      });
    },
    [shortcuts],
  );

  const registerShortcutHandler: ShortcutContextValue["registerShortcutHandler"] =
    useCallback((commandId, handler, options) => {
      const definition = getCommandDefinition(commandId);
      const registered: RegisteredHandler = {
        id: nextHandlerId,
        commandId,
        handler,
        scope: options?.scope ?? definition.scope,
        enabled: options?.enabled ?? true,
      };
      nextHandlerId += 1;
      handlersRef.current = [...handlersRef.current, registered];

      return () => {
        handlersRef.current = handlersRef.current.filter(
          (item) => item.id !== registered.id,
        );
      };
    }, []);

  const pushScope = useCallback((scope: CommandScope) => {
    const id = nextScopeId;
    nextScopeId += 1;
    scopesRef.current = [...scopesRef.current, { id, scope }];
    return () => {
      scopesRef.current = scopesRef.current.filter((item) => item.id !== id);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const binding = normalizeKeyboardEvent(event);
      if (!binding) return;
      if (shouldSkipShortcutDispatch(event, binding)) return;

      const activeScopes = scopesRef.current.map((item) => item.scope);
      const matchingCommands = DEFAULT_COMMANDS.filter((command) => {
        const commandBindings = shortcuts.get(command.id) ?? EMPTY_SHORTCUTS;
        const commandBinding = commandBindings.find(
          (candidate) => candidate.key === binding.key,
        );
        if (!commandBinding) return false;
        if (
          disableSingleKeyShortcuts &&
          isSingleCharacterShortcut(commandBinding)
        )
          return false;
        if (!isScopeActive(command.scope, activeScopes)) return false;
        if (isEditableElement(event.target) && !command.inputSafe) return false;
        return validateShortcut(commandBinding, command.scope).ok;
      }).sort((left, right) => {
        const leftIndex = activeScopes.lastIndexOf(left.scope);
        const rightIndex = activeScopes.lastIndexOf(right.scope);
        return rightIndex - leftIndex;
      });

      for (const command of matchingCommands) {
        const handler = handlersRef.current
          .slice()
          .reverse()
          .find(
            (candidate) =>
              candidate.commandId === command.id &&
              candidate.enabled &&
              isScopeActive(candidate.scope, activeScopes),
          );

        if (!handler) continue;
        if (command.preventDefault !== false) event.preventDefault();
        handler.handler();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disableSingleKeyShortcuts, shortcuts]);

  const value = useMemo<ShortcutContextValue>(
    () => ({
      commands: DEFAULT_COMMANDS,
      getShortcut,
      getShortcuts,
      setShortcut,
      resetShortcut,
      resetAllShortcuts,
      getConflicts,
      registerShortcutHandler,
      pushScope,
      showShortcutHints,
      setShowShortcutHints,
      disableSingleKeyShortcuts,
      setDisableSingleKeyShortcuts,
    }),
    [
      disableSingleKeyShortcuts,
      getConflicts,
      getShortcut,
      getShortcuts,
      pushScope,
      registerShortcutHandler,
      resetAllShortcuts,
      resetShortcut,
      setDisableSingleKeyShortcuts,
      setShowShortcutHints,
      setShortcut,
      showShortcutHints,
    ],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}
