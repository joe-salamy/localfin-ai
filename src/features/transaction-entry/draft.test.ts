import { describe, expect, test } from "vitest";
import {
  applyCellValue,
  initialRows,
  isRowValid,
  type TransactionRow,
} from "./draft";

const accounts = [{ id: "checking", name: "Checking", type: "asset" as const }];
const categories = [{
  id: "expense",
  name: "Expenses",
  type: "expense" as const,
  color: null,
  is_system: false,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
}];
const subcategories = [{
  id: "groceries",
  category_id: "expense",
  name: "Groceries",
  monthly_goal: null,
  color: null,
  is_system: false,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
}];
const tags = [{
  id: "trip",
  name: "Trip",
  type: "trip" as const,
  color: null,
  created_at: "2026-01-01",
  updated_at: null,
  deleted_at: null,
}];

function row(): TransactionRow {
  return {
    ...initialRows(1)[0]!,
    date: "07/13/2026",
    name: "Market",
    amount: "10.00",
    account_id: "checking",
  };
}

describe("transaction entry draft", () => {
  test("starts with five independent blank rows", () => {
    const rows = initialRows();
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((item) => item.id)).size).toBe(5);
    rows[0]!.tag_ids.push("trip");
    expect(rows[1]!.tag_ids).toEqual([]);
  });

  test("paste normalizes amount, category, and tags", () => {
    const amount = applyCellValue(
      row(),
      "amount",
      "$12.34",
      accounts,
      categories,
      subcategories,
      tags,
      "paste",
    );
    expect(amount).toMatchObject({ applied: true, row: { amount: "-12.34" } });

    const category = applyCellValue(
      amount.row,
      "subcategory_id",
      "Groceries",
      accounts,
      categories,
      subcategories,
      tags,
      "paste",
    );
    expect(category.row.subcategory_id).toBe("groceries");

    const tagged = applyCellValue(
      category.row,
      "tag_ids",
      "Trip",
      accounts,
      categories,
      subcategories,
      tags,
      "paste",
    );
    expect(tagged.row.tag_ids).toEqual(["trip"]);
    expect(isRowValid(tagged.row)).toBeTruthy();
  });

  test("rejects malformed amounts and reports unknown tags", () => {
    const malformed = applyCellValue(
      row(),
      "amount",
      "1,2",
      accounts,
      categories,
      subcategories,
      tags,
      "paste",
    );
    expect(malformed).toMatchObject({
      applied: false,
      row: { amount: "10.00" },
    });

    const tagged = applyCellValue(
      row(),
      "tag_ids",
      "Trip, Missing",
      accounts,
      categories,
      subcategories,
      tags,
      "paste",
    );
    expect(tagged).toMatchObject({
      applied: true,
      row: { tag_ids: ["trip"] },
      unknownTags: ["Missing"],
    });
  });

  test("clear preserves kind but clears editable cells", () => {
    expect(
      applyCellValue(
        row(),
        "kind",
        "",
        accounts,
        categories,
        subcategories,
        tags,
        "clear",
      ),
    ).toMatchObject({ applied: false, row: { kind: "expense" } });
    expect(
      applyCellValue(
        row(),
        "amount",
        "",
        accounts,
        categories,
        subcategories,
        tags,
        "clear",
      ),
    ).toMatchObject({ applied: true, row: { amount: "" } });
  });
});
