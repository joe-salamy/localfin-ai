import { useCallback, useState } from "react";
import { useUndoRedo } from "@/features/undo-redo/hooks";
import {
  cloneRows,
  initialRows,
  type DraftSnapshot,
  type TransactionRow,
} from "./draft";

export function useTransactionDraft() {
  const { execute } = useUndoRedo();
  const [rows, setRows] = useState<TransactionRow[]>(initialRows);
  const [duplicatesChecked, setDuplicatesChecked] = useState(false);
  const [statementText, setStatementText] = useState("");
  const [statementAccountId, setStatementAccountId] = useState("");
  const [parseSummary, setParseSummary] = useState<string | null>(null);

  const captureSnapshot = useCallback(
    (overrides?: Partial<DraftSnapshot>): DraftSnapshot => ({
      rows: cloneRows(overrides?.rows ?? rows),
      duplicatesChecked: overrides?.duplicatesChecked ?? duplicatesChecked,
      parseSummary:
        overrides && "parseSummary" in overrides
          ? (overrides.parseSummary ?? null)
          : parseSummary,
      statementText: overrides?.statementText ?? statementText,
      statementAccountId: overrides?.statementAccountId ?? statementAccountId,
    }),
    [duplicatesChecked, parseSummary, rows, statementAccountId, statementText],
  );

  const restoreSnapshot = useCallback((snapshot: DraftSnapshot) => {
    setRows(cloneRows(snapshot.rows));
    setDuplicatesChecked(snapshot.duplicatesChecked);
    setParseSummary(snapshot.parseSummary);
    setStatementText(snapshot.statementText);
    setStatementAccountId(snapshot.statementAccountId);
  }, []);

  const executeSnapshotAction = useCallback(
    (
      label: string,
      before: DraftSnapshot,
      after: DraftSnapshot,
      onInitialApply?: () => void,
    ) =>
      execute({
        id: crypto.randomUUID(),
        label,
        apply: () => {
          restoreSnapshot(after);
          onInitialApply?.();
        },
        undo: () => restoreSnapshot(before),
        redo: () => restoreSnapshot(after),
      }),
    [execute, restoreSnapshot],
  );

  const resetDuplicates = useCallback(() => setDuplicatesChecked(false), []);

  return {
    rows,
    setRows,
    duplicatesChecked,
    setDuplicatesChecked,
    resetDuplicates,
    statementText,
    setStatementText,
    statementAccountId,
    setStatementAccountId,
    parseSummary,
    setParseSummary,
    captureSnapshot,
    restoreSnapshot,
    executeSnapshotAction,
  };
}
