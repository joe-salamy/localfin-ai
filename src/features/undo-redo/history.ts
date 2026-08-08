import type { UndoableAction } from "./UndoRedoContext";

export interface UndoRedoHistory {
  undoStack: readonly UndoableAction[];
  redoStack: readonly UndoableAction[];
}

export function emptyUndoRedoHistory(): UndoRedoHistory {
  return {
    undoStack: [],
    redoStack: [],
  };
}

const MAX_UNDO_HISTORY_ENTRIES = 100;

export function pushUndoAction(
  history: UndoRedoHistory,
  action: UndoableAction,
): UndoRedoHistory {
  const undoStack = [...history.undoStack, action];
  return {
    undoStack: undoStack.slice(-MAX_UNDO_HISTORY_ENTRIES),
    redoStack: [],
  };
}

export function peekUndoAction(
  history: UndoRedoHistory,
): UndoableAction | null {
  return history.undoStack.at(-1) ?? null;
}

export function peekRedoAction(
  history: UndoRedoHistory,
): UndoableAction | null {
  return history.redoStack.at(-1) ?? null;
}

export function moveUndoActionToRedo(
  history: UndoRedoHistory,
): UndoRedoHistory {
  const action = peekUndoAction(history);
  if (!action) return history;

  return {
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, action],
  };
}

export function moveRedoActionToUndo(
  history: UndoRedoHistory,
): UndoRedoHistory {
  const action = peekRedoAction(history);
  if (!action) return history;

  return {
    undoStack: [...history.undoStack, action],
    redoStack: history.redoStack.slice(0, -1),
  };
}
