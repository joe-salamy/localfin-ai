import { getDb } from "../db/index.js";

interface FirstTransactionDateRow {
  first_date: string | null;
}

export function clampStartDateToFirstTransaction(
  startDate: string,
  fallbackStartDate = startDate,
): string {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT MIN(date) AS first_date
       FROM transactions
       WHERE deleted_at IS NULL`,
    )
    .get() as FirstTransactionDateRow;

  if (!row.first_date) return fallbackStartDate;
  return startDate < row.first_date ? row.first_date : startDate;
}
