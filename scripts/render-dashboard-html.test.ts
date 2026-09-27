import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { closeDbForTests, getDb } from "../server/db/index.js";
import { MIGRATIONS } from "../server/db/migrations.js";
import {
  createAccount,
  deleteAccount,
} from "../server/services/accounts.js";
import {
  createCategory,
  createSubcategory,
} from "../server/services/categories.js";
import { createTransaction } from "../server/services/transactions/create.js";
import {
  renderDashboardHtml,
  renderDashboardHtmlFile,
} from "./render-dashboard-html.ts";
import { useTempDatabase } from "../server/tests/helpers.js";


function parsePayload(html: string): {
  accounts: Array<{ id: string }>;
  subcategories: Array<{ id: string }>;
  transactions: Array<{ id: string }>;
} {
  const match = html.match(
    /<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, "payload script tag present");
  return JSON.parse(match[1]) as {
    accounts: Array<{ id: string }>;
    subcategories: Array<{ id: string }>;
    transactions: Array<{ id: string }>;
  };
}

class StubElement {
  value = "";
  textContent = "";
  innerHTML = "";
  hidden = false;
  clientWidth = 0;
  attributes: Record<string, string> = {};
  handlers: Record<string, Array<(ev?: unknown) => void>> = {};
  classes = new Set<string>();
  classList = {
    add: (...names: string[]) => {
      for (const name of names) this.classes.add(name);
    },
    remove: (...names: string[]) => {
      for (const name of names) this.classes.delete(name);
    },
  };
  addEventListener(type: string, fn: (ev?: unknown) => void): void {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  removeAttribute(name: string): void {
    delete this.attributes[name];
  }
  fire(type: string): void {
    for (const fn of this.handlers[type] ?? []) fn();
  }
}

function runDashboardClient(html: string, width = 720): Map<string, StubElement> {
  const payload = html.match(
    /<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/,
  );
  assert.ok(payload, "payload script tag present");
  const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  assert.ok(script, "executable client script present");
  const clientJs = script[1];
  assert.ok(clientJs, "client script body present");
  const start = html.match(/id="ds-start" value="([^"]*)"/)?.[1] ?? "";
  const end = html.match(/id="ds-end" value="([^"]*)"/)?.[1] ?? "";
  const generated =
    html.match(/id="generated-at" datetime="([^"]*)"/)?.[1] ?? "";
  const ids = [
    "dashboard-data",
    "ds-start",
    "ds-end",
    "range-error",
    "range-retained",
    "overview",
    "active-range",
    "networth",
    "networth-data",
    "sankey",
    "flow-breakdown",
    "accounts",
    "generated-at",
    "preset-label",
  ];
  const els = new Map<string, StubElement>();
  for (const id of ids) els.set(id, new StubElement());
  els.get("dashboard-data")!.textContent = payload[1];
  els.get("ds-start")!.value = start;
  els.get("ds-end")!.value = end;
  els.get("networth")!.clientWidth = width;
  if (generated) els.get("generated-at")!.attributes.datetime = generated;
  const domReady: Array<() => void> = [];
  const doc: Record<string, unknown> = {
    title: "",
    getElementById: (id: string) => els.get(id) ?? null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (type: string, fn: () => void) => {
      if (type === "DOMContentLoaded") domReady.push(fn);
    },
  };
  const win: Record<string, unknown> = {
    innerWidth: 1440,
    addEventListener: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
  };
  const sandbox: vm.Context = { document: doc, window: win };
  vm.createContext(sandbox);
  vm.runInContext(clientJs, sandbox);
  for (const fn of domReady) fn();
  return els;
}

// The API refuses to delete a subcategory that still has transactions, but
// databases from before that rule can contain such rows; the report must
// still embed those transactions as uncategorized.
function softDeleteSubcategoryWithTransactions(id: string): void {
  getDb()
    .prepare("UPDATE subcategories SET deleted_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

function buildFinancialFixture(): void {
  const asset = createAccount({
    name: "FixtureChecking",
    type: "asset",
    initial_balance: 1000,
  });
  const liability = createAccount({
    name: "FixtureCard",
    type: "liability",
    initial_balance: 200,
  });
  const income = createCategory({ name: "FixturePay", type: "income" });
  const salary = createSubcategory({
    name: "FixtureSalary",
    category_id: income.id,
  });
  const spending = createCategory({ name: "FixtureLiving", type: "expense" });
  const food = createSubcategory({
    name: "FixtureFood",
    category_id: spending.id,
  });
  const obsolete = createSubcategory({
    name: "FixtureObsolete",
    category_id: spending.id,
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-01-05",
    name: "Groceries",
    amount: 50,
    kind: "expense",
    subcategory_id: food.id,
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-09-02",
    name: "Paycheck",
    amount: 1000,
    kind: "income",
    subcategory_id: salary.id,
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-09-15",
    name: "Rent share",
    amount: 300,
    kind: "expense",
    subcategory_id: food.id,
  });
  createTransaction({
    account_id: liability.id,
    date: "2026-09-16",
    name: "Card rebate",
    amount: 20,
    kind: "income",
    subcategory_id: salary.id,
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-09-16",
    name: "Untagged dinner",
    amount: 40,
    kind: "expense",
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-09-16",
    name: "Obsolete tool",
    amount: 10,
    kind: "expense",
    subcategory_id: obsolete.id,
  });
  softDeleteSubcategoryWithTransactions(obsolete.id);
  createTransaction({
    account_id: asset.id,
    date: "2026-09-16",
    name: "Move to savings",
    amount: -100,
    kind: "transfer",
  });
  createTransaction({
    account_id: liability.id,
    date: "2026-09-16",
    name: "Card payment",
    amount: -100,
    kind: "transfer",
  });
  createTransaction({
    account_id: asset.id,
    date: "2026-09-16",
    name: "Correction",
    amount: 5,
    kind: "adjustment",
  });
  const doomed = createAccount({
    name: "FixtureDoomed",
    type: "asset",
    initial_balance: 0,
  });
  createTransaction({
    account_id: doomed.id,
    date: "2026-09-16",
    name: "Doomed spend",
    amount: 999,
    kind: "expense",
  });
  deleteAccount(doomed.id);
}

void test("dashboard embeds full history with client-side selector", async (t) => {
  await useTempDatabase(t);
  const checking = createAccount({
    name: "DashChecking",
    type: "asset",
    initial_balance: 1000,
  });
  createAccount({
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

  const html = renderDashboardHtml("2026-06-01", "2026-09-15");
  const payload = parsePayload(html);
  const ids = payload.transactions.map((txn) => txn.id);
  assert.ok(ids.includes(inside.id), "in-window txn embedded");
  assert.ok(ids.includes(outside.id), "out-of-window txn embedded");

  assert.ok(!html.includes("<script src"), "zero external scripts");
  assert.ok(!html.includes('src="http'), "zero remote sources");
});

void test("dashboard fails read-only on missing database without creating files", async (t) => {
  const dbPath = await useTempDatabase(t);
  const tempDir = path.dirname(dbPath);
  const missing = path.join(tempDir, "missing-parent", "budget.db");
  const out = path.join(tempDir, "missing-parent", "dashboard-out.html");
  process.env.LOCALFIN_DB_PATH = missing;
  await assert.rejects(
    renderDashboardHtmlFile("2026-01-01", "2026-09-16", out),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /Unable to open dashboard database read-only: /);
      assert.ok(message.includes(missing), "error names resolved path");
      return true;
    },
  );
  assert.equal(existsSync(missing), false, "no database created");
  assert.equal(existsSync(out), false, "no report output created");
});

void test("dashboard rendering leaves database bytes and rows unchanged", async (t) => {
  const dbPath = await useTempDatabase(t);
  const checking = createAccount({
    name: "StableChecking",
    type: "asset",
    initial_balance: 1000,
  });
  const pay = createCategory({ name: "StablePay", type: "income" });
  const salary = createSubcategory({
    name: "StableSalary",
    category_id: pay.id,
  });
  createTransaction({
    account_id: checking.id,
    date: "2026-04-01",
    name: "Paycheck",
    amount: 500,
    kind: "income",
    subcategory_id: salary.id,
  });
  closeDbForTests();

  const hashFile = (): string =>
    createHash("sha256").update(readFileSync(dbPath)).digest("hex");
  const readState = (): string => {
    const inspect = new Database(dbPath, { readonly: true });
    try {
      const ledger = inspect
        .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
        .all();
      const accounts = (
        inspect.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
          n: number;
        }
      ).n;
      const transactions = (
        inspect.prepare("SELECT COUNT(*) AS n FROM transactions").get() as {
          n: number;
        }
      ).n;
      return JSON.stringify({ ledger, accounts, transactions });
    } finally {
      inspect.close();
    }
  };
  const beforeHash = hashFile();
  const beforeState = readState();

  renderDashboardHtml("2026-01-01", "2026-12-31");
  closeDbForTests();

  assert.equal(hashFile(), beforeHash, "database bytes unchanged");
  assert.equal(readState(), beforeState, "rows and ledger unchanged");
});

void test("dashboard fails on incomplete migration ledger without adding rows", async (t) => {
  const dbPath = await useTempDatabase(t);
  createAccount({
    name: "LedgerChecking",
    type: "asset",
    initial_balance: 100,
  });
  closeDbForTests();

  const setup = new Database(dbPath);
  setup
    .prepare("DELETE FROM schema_migrations WHERE version = ?")
    .run(MIGRATIONS.length);
  const beforeLedger = setup
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all();
  const beforeAccounts = (
    setup.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
      n: number;
    }
  ).n;
  setup.close();

  assert.throws(
    () => renderDashboardHtml("2026-01-01", "2026-09-16"),
    /Dashboard database schema is not current/,
  );

  const inspect = new Database(dbPath, { readonly: true });
  try {
    const afterLedger = inspect
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all();
    const afterAccounts = (
      inspect.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
        n: number;
      }
    ).n;
    assert.deepEqual(afterLedger, beforeLedger, "no schema rows added");
    assert.equal(afterAccounts, beforeAccounts, "no seed rows added");
  } finally {
    inspect.close();
  }
});

void test("dashboard fails on future migration ledger without adding rows", async (t) => {
  const dbPath = await useTempDatabase(t);
  createAccount({
    name: "FutureChecking",
    type: "asset",
    initial_balance: 100,
  });
  closeDbForTests();

  const setup = new Database(dbPath);
  setup
    .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
    .run(MIGRATIONS.length + 1, "future-probe");
  const beforeLedger = setup
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all();
  const beforeAccounts = (
    setup.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
      n: number;
    }
  ).n;
  setup.close();

  assert.throws(
    () => renderDashboardHtml("2026-01-01", "2026-09-16"),
    /Dashboard database schema is not current/,
  );

  const inspect = new Database(dbPath, { readonly: true });
  try {
    const afterLedger = inspect
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all();
    const afterAccounts = (
      inspect.prepare("SELECT COUNT(*) AS n FROM accounts").get() as {
        n: number;
      }
    ).n;
    assert.deepEqual(afterLedger, beforeLedger, "no schema rows added");
    assert.equal(afterAccounts, beforeAccounts, "no seed rows added");
  } finally {
    inspect.close();
  }
});

void test("dashboard payload excludes deleted accounts but keeps null and deleted taxonomy", async (t) => {
  await useTempDatabase(t);
  const active = createAccount({
    name: "PayloadActive",
    type: "asset",
    initial_balance: 0,
  });
  const food = createCategory({ name: "PayloadFood", type: "expense" });
  const groceries = createSubcategory({
    name: "PayloadGroceries",
    category_id: food.id,
  });
  const obsolete = createSubcategory({
    name: "PayloadObsolete",
    category_id: food.id,
  });
  const categorized = createTransaction({
    account_id: active.id,
    date: "2026-05-01",
    name: "Categorized",
    amount: 25,
    kind: "expense",
    subcategory_id: groceries.id,
  });
  const nullSub = createTransaction({
    account_id: active.id,
    date: "2026-05-02",
    name: "Null sub",
    amount: 30,
    kind: "expense",
  });
  const doomedSub = createTransaction({
    account_id: active.id,
    date: "2026-05-03",
    name: "Doomed sub",
    amount: 35,
    kind: "expense",
    subcategory_id: obsolete.id,
  });
  softDeleteSubcategoryWithTransactions(obsolete.id);
  const doomed = createAccount({
    name: "PayloadDoomed",
    type: "asset",
    initial_balance: 0,
  });
  const doomedTxn = createTransaction({
    account_id: doomed.id,
    date: "2026-05-04",
    name: "Doomed txn",
    amount: 999,
    kind: "expense",
  });
  deleteAccount(doomed.id);

  const html = renderDashboardHtml("2026-01-01", "2026-12-31");
  const payload = parsePayload(html);
  const ids = payload.transactions.map((txn) => txn.id);
  assert.ok(ids.includes(categorized.id), "categorized txn embedded");
  assert.ok(ids.includes(nullSub.id), "null-subcategory txn embedded");
  assert.ok(ids.includes(doomedSub.id), "deleted-subcategory txn embedded");
  assert.ok(!ids.includes(doomedTxn.id), "deleted-account txn excluded");
  assert.ok(
    !payload.accounts.some((account) => account.id === doomed.id),
    "deleted account excluded",
  );
  assert.ok(
    !payload.subcategories.some((sub) => sub.id === obsolete.id),
    "deleted subcategory excluded",
  );
});

void test("dashboard client shows consistent YTD totals with end date and uncategorized amounts", async (t) => {
  await useTempDatabase(t);
  buildFinancialFixture();

  const html = renderDashboardHtml("2026-01-01", "2026-09-16");
  const els = runDashboardClient(html);
  const overview = els.get("overview")!.innerHTML;
  assert.ok(overview.includes("$1,020.00"), "visible income total");
  assert.ok(overview.includes("$400.00"), "visible expense total");
  assert.ok(overview.includes("+$620.00"), "visible surplus total");
  assert.ok(overview.includes("$1,505.00"), "visible assets total");
  assert.ok(overview.includes("$80.00"), "visible liabilities total");
  assert.ok(overview.includes("$1,425.00"), "visible net worth total");

  const breakdown = els.get("flow-breakdown")!.innerHTML;
  assert.ok(
    breakdown.includes("Uncategorized expenses"),
    "uncategorized group shown",
  );
  assert.ok(breakdown.includes("$50.00"), "uncategorized expenses total");
  assert.ok(!breakdown.includes("FixtureDoomed"), "deleted account absent");

  const dataTable = els.get("networth-data")!.innerHTML;
  assert.ok(dataTable.includes("2026-09-16"), "final sample date present");
  assert.ok(dataTable.includes("$1,425.00"), "final sample value present");

  for (const region of [
    overview,
    breakdown,
    dataTable,
    els.get("sankey")!.innerHTML,
    els.get("networth")!.innerHTML,
  ]) {
    assert.ok(!region.includes("NaN"), "rendered values are finite");
    assert.ok(!region.includes("Infinity"), "rendered values are finite");
  }
});

void test("dashboard client recovers out-of-window activity from embedded history", async (t) => {
  await useTempDatabase(t);
  buildFinancialFixture();

  const html = renderDashboardHtml("2026-03-01", "2026-09-16");
  const els = runDashboardClient(html);
  assert.ok(
    els.get("flow-breakdown")!.innerHTML.includes("$350.00"),
    "march view excludes january expense",
  );

  els.get("ds-start")!.value = "2026-01-01";
  els.get("ds-start")!.fire("change");
  els.get("ds-end")!.fire("change");

  const overview = els.get("overview")!.innerHTML;
  assert.ok(overview.includes("$400.00"), "january activity recovered");
  assert.ok(overview.includes("+$620.00"), "surplus recovered");
});

void test("dashboard client renders single-day deficit with funding gap", async (t) => {
  await useTempDatabase(t);
  buildFinancialFixture();

  const html = renderDashboardHtml("2026-09-16", "2026-09-16");
  const els = runDashboardClient(html);
  const overview = els.get("overview")!.innerHTML;
  assert.ok(overview.includes("$20.00"), "single-day income");
  assert.ok(overview.includes("$50.00"), "single-day expenses");
  assert.ok(overview.includes("-$30.00"), "single-day deficit");

  const breakdown = els.get("flow-breakdown")!.innerHTML;
  assert.ok(breakdown.includes("Funding gap"), "gap labeled");
  assert.ok(breakdown.includes("$30.00"), "gap amount");

  const dataTable = els.get("networth-data")!.innerHTML;
  assert.ok(
    dataTable.includes("2026-09-16") && dataTable.includes("$1,425.00"),
    "single-day data row",
  );
  assert.ok(
    els.get("networth")!.innerHTML.includes("<circle"),
    "single-day chart marker",
  );
});

void test("dashboard client reports empty range without a flow diagram", async (t) => {
  await useTempDatabase(t);
  getDb();
  closeDbForTests();

  const html = renderDashboardHtml("2026-01-01", "2026-09-16");
  const els = runDashboardClient(html);
  assert.ok(
    els.get("sankey")!.innerHTML.includes("No income or expense activity"),
    "empty flow message",
  );
  assert.ok(
    els.get("overview")!.innerHTML.includes("$0.00"),
    "zero monetary totals",
  );
  for (const region of [
    els.get("overview")!.innerHTML,
    els.get("flow-breakdown")!.innerHTML,
    els.get("networth")!.innerHTML,
  ]) {
    assert.ok(!region.includes("NaN"), "rendered values are finite");
    assert.ok(!region.includes("Infinity"), "rendered values are finite");
  }
});

void test("dashboard client reports income-only range as surplus without a gap", async (t) => {
  await useTempDatabase(t);
  const cash = createAccount({
    name: "OnlyCash",
    type: "asset",
    initial_balance: 0,
  });
  const pay = createCategory({ name: "OnlyPay", type: "income" });
  const salary = createSubcategory({
    name: "OnlySalary",
    category_id: pay.id,
  });
  createTransaction({
    account_id: cash.id,
    date: "2026-04-01",
    name: "Gift",
    amount: 100,
    kind: "income",
    subcategory_id: salary.id,
  });

  const html = renderDashboardHtml("2026-01-01", "2026-12-31");
  const els = runDashboardClient(html);
  const overview = els.get("overview")!.innerHTML;
  assert.ok(overview.includes("Surplus"), "surplus labeled");
  assert.ok(overview.includes("+$100.00"), "surplus amount");
  const breakdown = els.get("flow-breakdown")!.innerHTML;
  assert.ok(breakdown.includes("Funding gap"), "gap total explicit");
  assert.ok(breakdown.includes("$0.00"), "zero funding gap");
  assert.ok(!overview.includes("NaN"), "rendered values are finite");
});

void test("dashboard client reports expense-only range as funding gap", async (t) => {
  await useTempDatabase(t);
  const cash = createAccount({
    name: "GapCash",
    type: "asset",
    initial_balance: 0,
  });
  const food = createCategory({ name: "GapFood", type: "expense" });
  const groceries = createSubcategory({
    name: "GapGroceries",
    category_id: food.id,
  });
  createTransaction({
    account_id: cash.id,
    date: "2026-04-01",
    name: "Groceries",
    amount: 100,
    kind: "expense",
    subcategory_id: groceries.id,
  });

  const html = renderDashboardHtml("2026-01-01", "2026-12-31");
  const els = runDashboardClient(html);
  const overview = els.get("overview")!.innerHTML;
  assert.ok(overview.includes("Deficit"), "deficit labeled");
  assert.ok(overview.includes("-$100.00"), "deficit amount");
  const breakdown = els.get("flow-breakdown")!.innerHTML;
  assert.ok(breakdown.includes("Funding gap"), "gap labeled");
  assert.ok(breakdown.includes("$100.00"), "gap amount");
  assert.ok(
    breakdown.includes("No income in this range"),
    "empty income message",
  );
  assert.ok(!overview.includes("NaN"), "rendered values are finite");
});
