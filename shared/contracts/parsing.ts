import type { TransactionKind } from "./transactions.js";

/** One statement row, signed for the target account and ready to insert. */
export interface ParsedStatementRow {
  date: string;
  name: string;
  amount: number;
  kind: TransactionKind;
  /** Zero amount or a date that is not a valid YYYY-MM-DD. */
  needsReview: boolean;
  isDuplicate: boolean;
  originalLine: string;
}

export interface ParseStatementResult {
  transactions: ParsedStatementRow[];
  summary: {
    total: number;
    duplicates: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}
