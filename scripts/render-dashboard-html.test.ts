import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDbForTests } from "../server/db/index.js";
import { createAccount } from "../server/services/accounts.js";
import {
  createCategory,
  createSubcategory,
} from "../server/services/categories.js";
import { createTransaction } from "../server/services/transactions/create.js";
import { renderDashboardHtml } from "./render-dashboard-html.ts";

const originalDbPath = process.env.LOCALFIN_DB_PATH;

async function useTempDatabase(
  t: { after: (fn: () => void | Promise<void>) => void },
  prefix = "localfin-dashboard-test-",
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

void test("dashboard embeds full history with client-side selector", async (t) => {
  await useTempDatabase(t);
  const checking = createAccount({
    name: "DashChecking",
    type: "asset",
    initial_balance: 1000,
  });
  const savings = createAccount({
    name: "DashSavings",
    type: "asset",
    initial_balance: 500,
  });
  const pay = createCategory({ name: "DashPay", type: "income" });
  const salary = createSubcategory({
    name: "DashSalary",
    category_id: pay.id,
  });
  const food = createCategory({ name: "DashFood", type: "expense" });
  const groceries = createSubcategory({
    name: "DashGroceries",
    category_id: food.id,
  });
  const inside = createTransaction({
    account_id: checking.id,
    date: "2026-07-01",
    name: "Paycheck",
    amount: 500,
    kind: "income",
    subcategory_id: salary.id,
  });
  const outside = createTransaction({
    account_id: checking.id,
    date: "2026-01-05",
    name: "Old groceries",
    amount: 50,
    kind: "expense",
    subcategory_id: groceries.id,
  });
  void savings;

  const html = renderDashboardHtml("2026-06-01", "2026-09-15");

  const match = html.match(
    /<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, "payload script tag present");
  const payload = JSON.parse(match[1]) as {
    transactions: Array<{ id: string }>;
  };
  const ids = payload.transactions.map((txn) => txn.id);
  assert.ok(ids.includes(inside.id), "in-window txn embedded");
  assert.ok(ids.includes(outside.id), "out-of-window txn embedded");

  assert.ok(html.includes('id="ds-start"'), "start date input present");
  assert.ok(html.includes('id="ds-end"'), "end date input present");
  assert.ok(html.includes('id="accounts"'), "accounts container present");
  assert.ok(html.includes('id="sankey"'), "sankey container present");
  assert.ok(!html.includes("<script src"), "zero external scripts");
  assert.ok(!html.includes('src="http'), "zero remote sources");
});
