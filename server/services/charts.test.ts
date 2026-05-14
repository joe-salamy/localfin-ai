import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { closeDbForTests, getDb } from "../db/index.js";
import { prepareNetWorthData, prepareSankeyData } from "./charts.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createChartTestDatabase() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-sankey-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");

  const db = getDb();

  db.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, ?)").run(
    "checking",
    "Checking",
    "asset",
  );

  const insertCategory = db.prepare(
    "INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?)",
  );
  insertCategory.run("income-cat", "Project Income", "income", "#22c55e");
  insertCategory.run("expense-cat", "Project Expenses", "expense", "#ef4444");

  const insertSubcategory = db.prepare(
    "INSERT INTO subcategories (id, category_id, name, color) VALUES (?, ?, ?, ?)",
  );
  insertSubcategory.run("income-consulting", "income-cat", "Consulting", "#16a34a");
  insertSubcategory.run("expense-consulting", "expense-cat", "Consulting", "#dc2626");
  insertSubcategory.run("expense-hosting", "expense-cat", "Hosting", "#f97316");

  const insertTransaction = db.prepare(
    "INSERT INTO transactions (id, account_id, date, name, amount, kind, subcategory_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertTransaction.run(
    "income-1",
    "checking",
    "2026-05-01",
    "Client payment",
    1200,
    "income",
    "income-consulting",
  );
  insertTransaction.run(
    "expense-1",
    "checking",
    "2026-05-02",
    "Contractor payment",
    -300,
    "expense",
    "expense-consulting",
  );
  insertTransaction.run(
    "expense-2",
    "checking",
    "2026-05-03",
    "Server bill",
    -100,
    "expense",
    "expense-hosting",
  );

  return db;
}

test("prepareSankeyData keeps all subcategories while using clean display labels", async () => {
  await createChartTestDatabase();

  const data = prepareSankeyData("2026-05-01", "2026-05-31");
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));

  assert.equal(nodesById.get("Consulting (income)")?.displayName, "Consulting");
  assert.equal(nodesById.get("Consulting (expense)")?.displayName, "Consulting");
  assert.equal(nodesById.get("Hosting (expense)")?.displayName, "Hosting");

  assert.ok(nodesById.has("Consulting (income)"));
  assert.ok(nodesById.has("Consulting (expense)"));

  assert.ok(
    data.links.some(
      (link) =>
        link.source === "Consulting (income)" &&
        link.target === "income-category:income-cat" &&
        link.value === 1200,
    ),
  );
  assert.ok(
    data.links.some(
      (link) =>
        link.source === "expense-category:expense-cat" &&
        link.target === "Consulting (expense)" &&
        link.value === 300,
    ),
  );
  assert.ok(
    data.links.some(
      (link) =>
        link.source === "expense-category:expense-cat" &&
        link.target === "Hosting (expense)" &&
        link.value === 100,
    ),
  );
});

test("prepareNetWorthData clamps all-time requests to the first transaction date", async () => {
  await createChartTestDatabase();

  const data = prepareNetWorthData("0001-01-01", "2026-05-31");

  assert.equal(data.at(0)?.date, "2026-05-01");
  assert.equal(data.length, 5);
});
