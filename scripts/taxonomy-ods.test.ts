import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDbForTests, getDb } from "../server/db/index.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
} from "../server/services/categories.js";
import {
  createSpendingGoal,
  getSpendingGoals,
} from "../server/services/goals.js";
import {
  computeTaxonomyFingerprint,
  exportTaxonomyOds,
} from "./export-taxonomy-ods.ts";
import {
  parseTaxonomyWorkbook,
  validateTaxonomyRows,
} from "./apply-taxonomy-ods.ts";

const originalDbPath = process.env.LOCALFIN_DB_PATH;

async function useTempDatabase(
  t: { after: (fn: () => void | Promise<void>) => void },
  prefix = "localfin-taxonomy-test-",
): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  closeDbForTests();
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
  t.after(async () => {
    closeDbForTests();
    if (originalDbPath === undefined) {
      delete process.env.LOCALFIN_DB_PATH;
    } else {
      process.env.LOCALFIN_DB_PATH = originalDbPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });
  return process.env.LOCALFIN_DB_PATH;
}

function seedFixture(): {
  categoryId: string;
  subcategoryId: string;
  goalId: string;
} {
  const category = createCategory({ name: "Food", type: "expense" });
  const subcategory = createSubcategory({
    name: "Groceries",
    category_id: category.id,
  });
  const goal = createSpendingGoal({
    subcategory_id: subcategory.id,
    amount: 400,
    period: "monthly",
    start_date: "2026-01-01",
    end_date: null,
  });
  return {
    categoryId: category.id,
    subcategoryId: subcategory.id,
    goalId: goal.id,
  };
}

void test("taxonomy export parses back with matching ids and fingerprint", async (t) => {
  const dbPath = await useTempDatabase(t);
  const fixture = seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");

  const exported = await exportTaxonomyOds({ out });
  assert.ok(exported.categories >= 1);
  assert.ok(exported.subcategories >= 1);
  assert.equal(exported.goals, 1);

  const parsed = parseTaxonomyWorkbook(out);
  assert.equal(parsed.meta.get("purpose"), "taxonomy");
  assert.ok(parsed.meta.get("fingerprint"));
  assert.ok(parsed.meta.get("created_at"));

  const liveFingerprint = computeTaxonomyFingerprint(
    getCategories(),
    getSubcategories(),
    getSpendingGoals(),
  );
  assert.equal(parsed.meta.get("fingerprint"), liveFingerprint);

  const catText = JSON.stringify(parsed.categoriesGrid);
  const subText = JSON.stringify(parsed.subcategoriesGrid);
  const goalText = JSON.stringify(parsed.goalsGrid);
  assert.ok(catText.includes(fixture.categoryId));
  assert.ok(subText.includes(fixture.subcategoryId));
  assert.ok(goalText.includes(fixture.goalId));

  const pending = validateTaxonomyRows(parsed);
  assert.equal(pending.categoryCreates.length, 0);
  assert.equal(pending.categoryUpdates.length, 0);
  assert.equal(pending.categoryDeletes.length, 0);
  assert.equal(pending.subcategoryCreates.length, 0);
  assert.equal(pending.subcategoryUpdates.length, 0);
  assert.equal(pending.subcategoryDeletes.length, 0);
  assert.equal(pending.goalCreates.length, 0);
  assert.equal(pending.goalUpdates.length, 0);
  assert.equal(pending.goalDeletes.length, 0);
});

void test("taxonomy invalid color, type, and period applies zero rows", async (t) => {
  const dbPath = await useTempDatabase(t);
  seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");
  await exportTaxonomyOds({ out });
  const parsed = parseTaxonomyWorkbook(out);

  const categoriesBefore = getCategories().length;
  const subcategoriesBefore = getSubcategories().length;
  const goalsBefore = getSpendingGoals().length;

  const catHeader = (parsed.categoriesGrid[0] ?? []).map((h) =>
    String(h ?? "").trim().toLowerCase(),
  );
  const subHeader = (parsed.subcategoriesGrid[0] ?? []).map((h) =>
    String(h ?? "").trim().toLowerCase(),
  );
  const goalHeader = (parsed.goalsGrid[0] ?? []).map((h) =>
    String(h ?? "").trim().toLowerCase(),
  );
  const catTypeCol = catHeader.indexOf("type");
  const subColorCol = subHeader.indexOf("color");
  const goalPeriodCol = goalHeader.indexOf("period");
  assert.ok(catTypeCol >= 0 && subColorCol >= 0 && goalPeriodCol >= 0);
  const catRow = parsed.categoriesGrid[1];
  const subRow = parsed.subcategoriesGrid[1];
  const goalRow = parsed.goalsGrid[1];
  assert.ok(catRow && subRow && goalRow);
  catRow[catTypeCol] = "bogus";
  subRow[subColorCol] = "not-a-color";
  goalRow[goalPeriodCol] = "fortnightly";

  assert.throws(
    () => validateTaxonomyRows(parsed),
    /Invalid taxonomy rows; applied zero rows/,
  );
  assert.equal(getCategories().length, categoriesBefore);
  assert.equal(getSubcategories().length, subcategoriesBefore);
  assert.equal(getSpendingGoals().length, goalsBefore);
});

void test("taxonomy stale fingerprint aborts with re-export instruction", async (t) => {
  const dbPath = await useTempDatabase(t);
  seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");
  await exportTaxonomyOds({ out });
  // New row changes the fingerprint deterministically (no clock dependency).
  createCategory({ name: "StaleProbe", type: "expense" });

  const parsed = parseTaxonomyWorkbook(out);
  assert.throws(() => validateTaxonomyRows(parsed), /stale/);
});

void test("taxonomy tolerates system-row updated_at drift when counts match", async (t) => {
  const dbPath = await useTempDatabase(t);
  seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");
  await exportTaxonomyOds({ out });
  // Simulate the seed's per-start system-row touch (server/db/seed.ts bumps
  // system updated_at on every getDb); counts are unchanged so validation
  // must still pass with zero pending ops.
  const db = getDb();
  db.prepare("UPDATE categories SET updated_at = ? WHERE is_system = 1").run(
    "2030-01-01T00:00:00.000Z",
  );
  db.prepare(
    "UPDATE subcategories SET updated_at = ? WHERE is_system = 1",
  ).run("2030-01-01T00:00:00.000Z");
  const parsed = parseTaxonomyWorkbook(out);
  const pending = validateTaxonomyRows(parsed);
  assert.equal(pending.categoryCreates.length, 0);
  assert.equal(pending.categoryUpdates.length, 0);
  assert.equal(pending.subcategoryCreates.length, 0);
  assert.equal(pending.subcategoryUpdates.length, 0);
  assert.equal(pending.goalCreates.length, 0);
  assert.equal(pending.goalUpdates.length, 0);
});
