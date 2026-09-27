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

function seedFixture(): { categoryId: string; subcategoryId: string } {
  const category = createCategory({ name: "Food", type: "expense" });
  const subcategory = createSubcategory({
    name: "Groceries",
    category_id: category.id,
    monthly_goal: 400,
  });
  return { categoryId: category.id, subcategoryId: subcategory.id };
}

void test("taxonomy export parses back with matching ids and fingerprint", async (t) => {
  const dbPath = await useTempDatabase(t);
  const fixture = seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");

  const exported = await exportTaxonomyOds({ out });
  assert.ok(exported.categories >= 1);
  assert.ok(exported.subcategories >= 1);

  const parsed = parseTaxonomyWorkbook(out);
  assert.equal(parsed.meta.get("purpose"), "taxonomy");
  assert.ok(parsed.meta.get("fingerprint"));
  assert.ok(parsed.meta.get("created_at"));

  const liveFingerprint = computeTaxonomyFingerprint(
    getCategories(),
    getSubcategories(),
  );
  assert.equal(parsed.meta.get("fingerprint"), liveFingerprint);

  const catText = JSON.stringify(parsed.categoriesGrid);
  const subText = JSON.stringify(parsed.subcategoriesGrid);
  assert.ok(catText.includes(fixture.categoryId));
  assert.ok(subText.includes(fixture.subcategoryId));

  const pending = validateTaxonomyRows(parsed);
  assert.equal(pending.categoryCreates.length, 0);
  assert.equal(pending.categoryUpdates.length, 0);
  assert.equal(pending.categoryDeletes.length, 0);
  assert.equal(pending.subcategoryCreates.length, 0);
  assert.equal(pending.subcategoryUpdates.length, 0);
  assert.equal(pending.subcategoryDeletes.length, 0);
});

void test("taxonomy invalid color, type, and monthly goal applies zero rows", async (t) => {
  const dbPath = await useTempDatabase(t);
  seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");
  await exportTaxonomyOds({ out });
  const parsed = parseTaxonomyWorkbook(out);

  const categoriesBefore = getCategories().length;
  const subcategoriesBefore = getSubcategories().length;

  const catHeader = (parsed.categoriesGrid[0] ?? []).map((h) =>
    String(h ?? "").trim().toLowerCase(),
  );
  const subHeader = (parsed.subcategoriesGrid[0] ?? []).map((h) =>
    String(h ?? "").trim().toLowerCase(),
  );
  const catTypeCol = catHeader.indexOf("type");
  const subColorCol = subHeader.indexOf("color");
  const subGoalCol = subHeader.indexOf("monthly_goal");
  assert.ok(catTypeCol >= 0 && subColorCol >= 0 && subGoalCol >= 0);
  const catRow = parsed.categoriesGrid[1];
  const subRow = parsed.subcategoriesGrid[1];
  assert.ok(catRow && subRow);
  catRow[catTypeCol] = "bogus";
  subRow[subColorCol] = "not-a-color";
  subRow[subGoalCol] = -5;

  assert.throws(
    () => validateTaxonomyRows(parsed),
    /Invalid taxonomy rows; applied zero rows/,
  );
  assert.equal(getCategories().length, categoriesBefore);
  assert.equal(getSubcategories().length, subcategoriesBefore);
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

void test("taxonomy detects edits to existing rows and survives a restart", async (t) => {
  const dbPath = await useTempDatabase(t);
  seedFixture();
  const out = path.join(path.dirname(dbPath), "tax-review.fods");
  await exportTaxonomyOds({ out });
  // A process restart re-runs the seed; it must not bump updated_at.
  closeDbForTests();
  assert.doesNotThrow(() => validateTaxonomyRows(parseTaxonomyWorkbook(out)));

  const [category] = getCategories().filter((c) => !c.is_system);
  getDb()
    .prepare("UPDATE categories SET updated_at = ? WHERE id = ?")
    .run("2030-01-01T00:00:00.000Z", category.id);
  assert.throws(() => validateTaxonomyRows(parseTaxonomyWorkbook(out)), /stale/);
});
