import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { createAccount } from "./accounts.js";
import { createCategory, createSubcategory } from "./categories.js";
import { parseStatement } from "./parser.js";
import { createTransaction } from "./transactions.js";
import { closeDbForTests } from "../db/index.js";

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }
}

async function useIsolatedDb(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-parser-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("statement parsing normalizes credit-card expenses as positive account deltas", async () => {
  await useIsolatedDb();
  const creditCard = createAccount({
    name: "Parser Credit Card",
    type: "liability",
  });
  const category = createCategory({
    name: "Parser Essentials",
    type: "expense",
  });
  const subcategory = createSubcategory({
    category_id: category.id,
    name: "Parser Coffee",
  });
  createTransaction({
    account_id: creditCard.id,
    date: "2026-05-01",
    name: "Coffee Shop",
    amount: 4,
    kind: "expense",
    subcategory_id: subcategory.id,
  });

  const result = await parseStatement(
    "05/02/2026 Coffee Shop -4.00",
    creditCard.id,
  );

  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]?.kind, "expense");
  assert.equal(result.transactions[0]?.amount, 4);
  assert.equal(result.transactions[0]?.subcategory_id, subcategory.id);
});
