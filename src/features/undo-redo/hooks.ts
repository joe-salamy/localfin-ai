import { useContext } from "react";
import { UndoRedoContext } from "./UndoRedoContext";

export function useUndoRedo() {
  const context = useContext(UndoRedoContext);
  if (!context) {
    throw new Error("useUndoRedo must be used within UndoRedoProvider");
  }
  return context;
}
