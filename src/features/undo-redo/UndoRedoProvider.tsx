import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useShortcut } from "@/features/shortcuts/hooks";
import { UndoRedoContext } from "./UndoRedoContext";
import type { UndoableAction, UndoRedoContextValue } from "./UndoRedoContext";
import {
  emptyUndoRedoHistory,
  moveRedoActionToUndo,
  moveUndoActionToRedo,
  peekRedoAction,
  peekUndoAction,
  pushUndoAction,
} from "./history";
import type { UndoRedoHistory } from "./history";

export function UndoRedoProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<UndoRedoHistory>(() =>
    emptyUndoRedoHistory(),
  );
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const beginRun = useCallback(() => {
    if (runningRef.current) return false;
    runningRef.current = true;
    setIsRunning(true);
    return true;
  }, []);

  const finishRun = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  const execute = useCallback(
    async (action: UndoableAction) => {
      if (!beginRun()) return false;

      try {
        await action.apply();
        setHistory((current) => pushUndoAction(current, action));
        return true;
      } catch {
        return false;
      } finally {
        finishRun();
      }
    },
    [beginRun, finishRun],
  );

  const runUndo = useCallback(
    async (toastOnFailure: boolean) => {
      const action = peekUndoAction(history);
      if (!action || !beginRun()) return false;

      try {
        await action.undo();
        setHistory((current) => moveUndoActionToRedo(current));
        return true;
      } catch {
        if (toastOnFailure) toast.error(`Failed to undo ${action.label}.`);
        return false;
      } finally {
        finishRun();
      }
    },
    [beginRun, finishRun, history],
  );

  const runRedo = useCallback(
    async (toastOnFailure: boolean) => {
      const action = peekRedoAction(history);
      if (!action || !beginRun()) return false;

      try {
        await (action.redo ?? action.apply)();
        setHistory((current) => moveRedoActionToUndo(current));
        return true;
      } catch {
        if (toastOnFailure) toast.error(`Failed to redo ${action.label}.`);
        return false;
      } finally {
        finishRun();
      }
    },
    [beginRun, finishRun, history],
  );

  const undo = useCallback(() => runUndo(false), [runUndo]);
  const redo = useCallback(() => runRedo(false), [runRedo]);
  const canUndo = history.undoStack.length > 0;
  const canRedo = history.redoStack.length > 0;
  const undoFromKeyboard = useCallback(() => {
    void runUndo(true);
  }, [runUndo]);
  const redoFromKeyboard = useCallback(() => {
    void runRedo(true);
  }, [runRedo]);

  useShortcut("global.undo", undoFromKeyboard, {
    enabled: canUndo && !isRunning,
  });
  useShortcut("global.redo", redoFromKeyboard, {
    enabled: canRedo && !isRunning,
  });

  const value = useMemo<UndoRedoContextValue>(
    () => ({
      execute,
      undo,
      redo,
      canUndo,
      canRedo,
      isRunning,
    }),
    [canRedo, canUndo, execute, isRunning, redo, undo],
  );

  return (
    <UndoRedoContext.Provider value={value}>
      {children}
    </UndoRedoContext.Provider>
  );
}
