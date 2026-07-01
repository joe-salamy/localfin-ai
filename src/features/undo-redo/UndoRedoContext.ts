import { createContext } from "react";

export interface UndoableAction {
  id: string;
  label: string;
  apply: () => void | Promise<void>;
  undo: () => void | Promise<void>;
  redo?: () => void | Promise<void>;
}

export interface UndoRedoContextValue {
  execute: (action: UndoableAction) => Promise<boolean>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  isRunning: boolean;
}

export const UndoRedoContext = createContext<UndoRedoContextValue | null>(null);
