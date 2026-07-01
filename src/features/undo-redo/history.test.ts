import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(historyAfterUndo.redoStack.map((item) => item.id), ["first"]);

  const historyAfterNewExecute = pushUndoAction(historyAfterUndo, second);

  assert.equal(peekUndoAction(historyAfterNewExecute), second);
  assert.deepEqual(historyAfterNewExecute.undoStack.map((item) => item.id), [
    "second",
  ]);
  assert.deepEqual(historyAfterNewExecute.redoStack, []);
});

test("undo moves only the most recent action to the redo stack", () => {
  const first = action("first");
  const second = action("second");
  const history = pushUndoAction(
    pushUndoAction(emptyUndoRedoHistory(), first),
    second,
  );

  const undone = moveUndoActionToRedo(history);

  assert.deepEqual(undone.undoStack.map((item) => item.id), ["first"]);
  assert.deepEqual(undone.redoStack.map((item) => item.id), ["second"]);
  assert.equal(peekUndoAction(undone), first);
  assert.equal(peekRedoAction(undone), second);
  assert.deepEqual(history.undoStack.map((item) => item.id), ["first", "second"]);
  assert.deepEqual(history.redoStack, []);
});

test("redo moves the most recent redo action back to undo history", () => {
  const first = action("first");
  const second = action("second");
  const history = moveUndoActionToRedo(
    moveUndoActionToRedo(
      pushUndoAction(pushUndoAction(emptyUndoRedoHistory(), first), second),
    ),
  );
  assert.deepEqual(history.redoStack.map((item) => item.id), ["second", "first"]);

  const redone = moveRedoActionToUndo(history);

  assert.deepEqual(redone.undoStack.map((item) => item.id), ["first"]);
  assert.deepEqual(redone.redoStack.map((item) => item.id), ["second"]);
  assert.equal(peekUndoAction(redone), first);
  assert.equal(peekRedoAction(redone), second);
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

  await assert.rejects(rejecting, /operation failed/);
  assert.deepEqual(withUndoAndRedo.undoStack.map((item) => item.id), ["first"]);
  assert.deepEqual(withUndoAndRedo.redoStack.map((item) => item.id), ["second"]);

  await assert.rejects(rejecting, /operation failed/);
  assert.deepEqual(withUndoAndRedo.undoStack.map((item) => item.id), ["first"]);
  assert.deepEqual(withUndoAndRedo.redoStack.map((item) => item.id), ["second"]);

  await assert.rejects(rejecting, /operation failed/);
  assert.deepEqual(withUndoAndRedo.undoStack.map((item) => item.id), ["first"]);
  assert.deepEqual(withUndoAndRedo.redoStack.map((item) => item.id), ["second"]);
});
