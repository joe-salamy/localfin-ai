import assert from "node:assert/strict";
import test from "node:test";
import { merchantKey, merchantKeysMatch } from "../../../shared/finance/merchantNames.js";
import { createAccount } from "../accounts.js";
import { createCategory, createSubcategory } from "../categories.js";
import { createTransaction } from "./create.js";
import { createCategoryLookup } from "./lookup.js";
import { useTempDatabase } from "../../tests/helpers.js";

void test("merchant keys match one merchant across bank formats, not shared bank boilerplate", () => {
  const same = (a: string, b: string): boolean => merchantKeysMatch(merchantKey(a), merchantKey(b));
  assert.ok(same("MTA*NYCT PAYGO", "MTA*NYCT PAYGO NEW YORK NYAPPLE PAY ENDING IN"));
  assert.ok(same("SQ *SANTA MONICA BREW WOR", "SQ *SANTA MONICA BREW SANTA MONICA CA0001152921516865460520"));
  assert.ok(same("TRADER JOE S #215", "TRADER JOE S #019 SAN FRANCISCOCAAPPLE PAY ENDING IN 8373"));
  assert.ok(same("BREAD &amp; BUTTER MARKET", "BREAD & BUTTER MARKET"));
  assert.ok(!same("ELECTRONIC WITHDRAWAL SOCAL GAS", "ELECTRONIC WITHDRAWAL LADWP"));
  assert.ok(!same("UNITED PACIFIC 194 LOS ANGELES CA", "UNITED 0162111979012 UNITED.COM TX"));
  // Keys under 8 letters never match fuzzily.
  assert.ok(!same("PURCHASE -VISA VENMO *A", "ELECTRONIC DEPOSIT VENMO"));
});

void test("category lookup: exact same-account tier first, then merchant key across accounts at 80%", async (t) => {
  await useTempDatabase(t);
  const card = createAccount({ name: "Card", type: "liability" });
  const other = createAccount({ name: "Other card", type: "liability" });
  const food = createCategory({ name: "Food", type: "expense" });
  const groceries = createSubcategory({ name: "Groceries", category_id: food.id });
  const trips = createSubcategory({ name: "Trips", category_id: food.id });
  const add = (accountId: string, name: string, subcategoryId: string, date: string): void => {
    createTransaction({ account_id: accountId, date, name, amount: 5, kind: "expense", subcategory_id: subcategoryId });
  };

  for (const date of ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]) {
    add(other.id, "MTA*NYCT PAYGO NEW YORK NYAPPLE PAY ENDING IN", trips.id, date);
  }
  add(other.id, "MTA*NYCT PAYGO NEW YORK NY", groceries.id, "2026-01-05");
  // 4 of 5 merchant rows agree: exactly the 80% floor.
  assert.deepEqual(createCategoryLookup()("MTA*NYCT PAYGO", card.id, "expense"), {
    subcategoryId: trips.id,
    source: "merchant",
  });
  // The merchant tier never crosses kinds.
  assert.equal(createCategoryLookup()("MTA*NYCT PAYGO", card.id, "income"), null);

  add(other.id, "MTA*NYCT PAYGO NEW YORK NY", groceries.id, "2026-01-06");
  assert.equal(createCategoryLookup()("MTA*NYCT PAYGO", card.id, "expense"), null);

  // An exact same-account history wins over the merchant tier.
  add(card.id, "MTA*NYCT PAYGO", groceries.id, "2026-01-07");
  assert.deepEqual(createCategoryLookup()("MTA*NYCT PAYGO", card.id, "expense"), {
    subcategoryId: groceries.id,
    source: "exact",
  });
});
