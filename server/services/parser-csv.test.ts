import assert from "node:assert/strict";
import test from "node:test";
import { createAccount } from "../services/accounts.js";
import { createTransaction } from "../services/transactions.js";
import { parseStatement } from "./parser.js";
import { useTempDatabase } from "../tests/helpers.js";


void test("parser: chase sale/payment/return/fee map to kinds and liability signs", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Chase Sapphire Preferred", type: "liability" });
  const text = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "09/12/2026,09/13/2026,TRADER JOE S #215,Food,Sale,-48.23,",
    "09/13/2026,09/13/2026,Payment Thank You - Web,,Payment,2275.30,",
    "09/11/2026,09/12/2026,Fangfrisch Return,,Return,25.00,",
    "09/10/2026,09/11/2026,ANNUAL MEMBERSHIP FEE,,Fee,-95.00,",
  ].join("\n");
  const result = parseStatement(text, account.id);
  assert.equal(result.format, "chase");
  assert.equal(result.transactions.length, 4);
  const byName = Object.fromEntries(result.transactions.map((r) => [r.name, r]));
  assert.equal(byName["TRADER JOE S #215"]?.kind, "expense");
  assert.equal(byName["TRADER JOE S #215"]?.amount, 48.23);
  assert.equal(byName["Payment Thank You - Web"]?.kind, "transfer");
  assert.equal(byName["Payment Thank You - Web"]?.amount, -2275.3);
  assert.equal(byName["Fangfrisch Return"]?.kind, "income");
  assert.equal(byName["Fangfrisch Return"]?.amount, -25);
  assert.equal(byName["ANNUAL MEMBERSHIP FEE"]?.kind, "expense");
  assert.equal(byName["ANNUAL MEMBERSHIP FEE"]?.amount, 95);
});

void test("parser: usbank debit/credit/payment-name map to kinds and asset signs", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "U.S. Bank Smartly Checking", type: "asset" });
  const text = [
    '"Date","Transaction","Name","Memo","Amount"',
    '"2026-07-13","CREDIT","ELECTRONIC DEPOSIT VENMO","x","36.00"',
    '"2026-07-13","DEBIT","DEBIT PURCHASE -VISA STORE","x","-17.00"',
    '"2026-07-23","DEBIT","MOBILE BANKING PAYMENT TO CREDIT CARD 8067","x","-955.93"',
  ].join("\n");
  const result = parseStatement(text, account.id);
  assert.equal(result.format, "usbank");
  assert.equal(result.transactions.length, 3);
  const byName = Object.fromEntries(result.transactions.map((r) => [r.name, r]));
  assert.equal(byName["ELECTRONIC DEPOSIT VENMO"]?.kind, "income");
  assert.equal(byName["ELECTRONIC DEPOSIT VENMO"]?.amount, 36);
  assert.equal(byName["PURCHASE -VISA STORE"]?.kind, "expense");
  assert.equal(byName["PURCHASE -VISA STORE"]?.amount, -17);
  assert.equal(byName["MOBILE BANKING PAYMENT TO CREDIT CARD 8067"]?.kind, "transfer");
  assert.equal(byName["MOBILE BANKING PAYMENT TO CREDIT CARD 8067"]?.amount, -955.93);
});

void test("parser: discover purchase/payment/awards map to kinds and liability signs", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Discover Card", type: "liability" });
  const text = [
    "Trans. Date,Post Date,Description,Amount,Category",
    '09/05/2026,09/06/2026,"CHIPOTLE 1084 LOS ANGELES CA",23.87,"Restaurants"',
    '09/06/2026,09/06/2026,"AUTOMATIC STATEMENT CREDIT",-30.07,"Awards and Rebate Credits"',
    '09/07/2026,09/08/2026,"INTERNET PAYMENT - THANK YOU",-500.00,"Payments and Credits"',
  ].join("\n");
  const result = parseStatement(text, account.id);
  assert.equal(result.format, "discover");
  assert.equal(result.transactions.length, 3);
  const byName = Object.fromEntries(result.transactions.map((r) => [r.name, r]));
  assert.equal(byName["CHIPOTLE 1084 LOS ANGELES CA"]?.kind, "expense");
  assert.equal(byName["CHIPOTLE 1084 LOS ANGELES CA"]?.amount, 23.87);
  assert.equal(byName["AUTOMATIC STATEMENT CREDIT"]?.kind, "income");
  assert.equal(byName["AUTOMATIC STATEMENT CREDIT"]?.amount, -30.07);
  assert.equal(byName["INTERNET PAYMENT - THANK YOU"]?.kind, "transfer");
  assert.equal(byName["INTERNET PAYMENT - THANK YOU"]?.amount, -500);
});

void test("parser: unknown headers abort with headers-seen error before writes", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Fidelity Brokerage", type: "asset" });
  const result = parseStatement("foo,bar,baz\n1,2,3", account.id);
  assert.equal(result.transactions.length, 0);
  assert.equal(result.format, null);
  assert.match(result.errors.join("\n"), /Unknown CSV format/);
});

void test("parser: count dedup creates one of two same-key rows, then zero on re-ingest", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Chase Sapphire Preferred", type: "liability" });
  createTransaction({
    account_id: account.id,
    date: "2026-09-12",
    name: "TRADER JOE S #215",
    amount: 48.23,
    kind: "expense",
  });
  const header = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo";
  const row = "09/12/2026,09/13/2026,TRADER JOE S #215,Food,Sale,-48.23,";
  const first = parseStatement([header, row, row].join("\n"), account.id);
  assert.equal(first.transactions.length, 2);
  assert.equal(first.transactions.filter((r) => r.isDuplicate).length, 1);
  assert.equal(first.transactions.filter((r) => !r.isDuplicate).length, 1);
  const created = first.transactions.filter((r) => !r.isDuplicate);
  for (const r of created) {
    createTransaction({
      account_id: account.id,
      date: r.date,
      name: r.name,
      amount: r.amount,
      kind: r.kind,
    });
  }
  const second = parseStatement([header, row, row].join("\n"), account.id);
  assert.equal(second.transactions.filter((r) => !r.isDuplicate).length, 0);
  assert.equal(second.transactions.filter((r) => r.isDuplicate).length, 2);
});

void test("parser: Chase HTML entities are decoded and dedup against stored decoded names", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Chase Sapphire Preferred", type: "liability" });
  const text = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "10/05/2026,10/06/2026,EMILES PASTRY &amp; CAFE LLC,Food,Sale,-12.50,",
  ].join("\n");
  const first = parseStatement(text, account.id);
  assert.equal(first.transactions[0]?.name, "EMILES PASTRY & CAFE LLC");
  assert.equal(first.transactions[0]?.isDuplicate, false);
  createTransaction({ account_id: account.id, date: "2026-10-05", name: "EMILES PASTRY & CAFE LLC", amount: 12.5, kind: "expense" });
  assert.equal(parseStatement(text, account.id).transactions[0]?.isDuplicate, true);
});
