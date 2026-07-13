
import { expect, test } from "vitest"
import type { UndoableAction } from "./UndoRedoContext";
import {
  emptyUndoRedoHistory,
  moveRedoActionToUndo,
  moveUndoActionToRedo,
  peekRedoAction,
  peekUndoAction,
  pushUndoAction,
} from "./history";

function action(id: string): UndoableAction {
  return {
    id,
    label: id,
    apply: () => undefined,
    undo: () => undefined,
  };
}

test("successful execute pushes an undo action and clears redo history", () => {
  const first = action("first");
  const second = action("second");
  const historyAfterUndo = moveUndoActionToRedo(
    pushUndoAction(emptyUndoRedoHistory(), first),
  );
  expect(historyAfterUndo.redoStack.map((item) => item.id)).toEqual(["first"]);

  const historyAfterNewExecute = pushUndoAction(historyAfterUndo, second);

  expect(peekUndoAction(historyAfterNewExecute)).toBe(second);
  expect(historyAfterNewExecute.undoStack.map((item) => item.id)).toEqual(["second"]);
  expect(historyAfterNewExecute.redoStack).toEqual([]);
});

test("undo moves only the most recent action to the redo stack", () => {
  const first = action("first");
  const second = action("second");
  const history = pushUndoAction(
    pushUndoAction(emptyUndoRedoHistory(), first),
    second,
  );

  const undone = moveUndoActionToRedo(history);

  expect(undone.undoStack.map((item) => item.id)).toEqual(["first"]);
  expect(undone.redoStack.map((item) => item.id)).toEqual(["second"]);
  expect(peekUndoAction(undone)).toBe(first);
  expect(peekRedoAction(undone)).toBe(second);
  expect(history.undoStack.map((item) => item.id)).toEqual(["first", "second"]);
  expect(history.redoStack).toEqual([]);
});

test("redo moves the most recent redo action back to undo history", () => {
  const first = action("first");
  const second = action("second");
  const history = moveUndoActionToRedo(
    moveUndoActionToRedo(
      pushUndoAction(pushUndoAction(emptyUndoRedoHistory(), first), second),
    ),
  );
  expect(history.redoStack.map((item) => item.id)).toEqual(["second", "first"]);

  const redone = moveRedoActionToUndo(history);

  expect(redone.undoStack.map((item) => item.id)).toEqual(["first"]);
  expect(redone.redoStack.map((item) => item.id)).toEqual(["second"]);
  expect(peekUndoAction(redone)).toBe(first);
  expect(peekRedoAction(redone)).toBe(second);
});

test("failed execute, undo, and redo attempts leave stacks unchanged", async () => {
  const first = action("first");
  const second = action("second");
  const withUndoAndRedo = moveUndoActionToRedo(
    pushUndoAction(pushUndoAction(emptyUndoRedoHistory(), first), second),
  );
  const rejecting = async () => {
    throw new Error("operation failed");
  };

  await expect(rejecting).rejects.toThrow(/operation failed/);
  expect(withUndoAndRedo.undoStack.map((item) => item.id)).toEqual(["first"]);
  expect(withUndoAndRedo.redoStack.map((item) => item.id)).toEqual(["second"]);

  await expect(rejecting).rejects.toThrow(/operation failed/);
  expect(withUndoAndRedo.undoStack.map((item) => item.id)).toEqual(["first"]);
  expect(withUndoAndRedo.redoStack.map((item) => item.id)).toEqual(["second"]);

  await expect(rejecting).rejects.toThrow(/operation failed/);
  expect(withUndoAndRedo.undoStack.map((item) => item.id)).toEqual(["first"]);
  expect(withUndoAndRedo.redoStack.map((item) => item.id)).toEqual(["second"]);
});
