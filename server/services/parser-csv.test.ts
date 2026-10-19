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

void test("parser: fidelity brokerage and Roth variants map actions to kinds and asset signs", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Fidelity Brokerage", type: "asset" });
  const simpleHeader = "Run Date,Action,Symbol,Description,Type,Amount ($)";
  const simple = parseStatement(
    [
      simpleHeader,
      "09/15/2026,YOU BOUGHT AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash),AVGE,AVANTIS ETF,Cash,-7468.50",
      "09/14/2026,DIVIDEND RECEIVED AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash),AVGE,AVANTIS ETF,Cash,111.52",
      "09/15/2026,CASH CONTRIBUTION CURRENT YEAR (Cash),,No Description,Cash,7500",
      "08/19/2026,Electronic Funds Transfer Paid (Cash),,No Description,Cash,-5000",
    ].join("\n"),
    account.id,
  );
  assert.equal(simple.format, "fidelity");
  assert.equal(simple.transactions.length, 4);
  const simpleByName = Object.fromEntries(simple.transactions.map((r) => [r.name, r]));
  assert.equal(simpleByName["YOU BOUGHT AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash)"]?.kind, "transfer");
  assert.equal(simpleByName["YOU BOUGHT AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash)"]?.amount, -7468.5);
  assert.equal(simpleByName["DIVIDEND RECEIVED AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash)"]?.kind, "income");
  assert.equal(simpleByName["DIVIDEND RECEIVED AVANTIS ALL EQUITY MARKETS ETF (AVGE) (Cash)"]?.amount, 111.52);
  assert.equal(simpleByName["CASH CONTRIBUTION CURRENT YEAR (Cash)"]?.kind, "transfer");
  assert.equal(simpleByName["Electronic Funds Transfer Paid (Cash)"]?.kind, "transfer");
  const enrichedHeader =
    "Run Date,Action,Symbol,Description,Type,Exchange Quantity,Exchange Currency,Currency,Price,Quantity,Exchange Rate,Commission,Fees,Accrued Interest,Amount,Cash Balance,Settlement Date";
  const enriched = parseStatement(
    [
      enrichedHeader,
      '09/30/2026,YOU SOLD ISHARES TRUST CORE 60/40 BALANCED AL... (AOR) (Cash),AOR,ISHARES TRUST,Cash,0,,USD,68.69,-72,0,,,0.11,4945.58,8786.85,09/16/2026',
      '09/30/2026,REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash),SPAXX,SPAXX,Cash,0,,USD,1,28.11,0,,,,-28.11,8869.23,',
      '09/15/2026,TRANSFERRED TO VS 261-229059-1 CURRENT CONTRIBUTION (Cash),,No Description,Cash,0,,USD,,0,0,,,,-7500,3841.27,',
    ].join("\n"),
    account.id,
  );
  assert.equal(enriched.format, "fidelity");
  assert.equal(enriched.transactions.length, 3);
  const enrichedByName = Object.fromEntries(enriched.transactions.map((r) => [r.name.slice(0, 8), r]));
  assert.equal(enrichedByName["YOU SOLD"]?.kind, "transfer");
  assert.equal(enrichedByName["YOU SOLD"]?.amount, 4945.58);
  assert.equal(enrichedByName["REINVEST"]?.kind, "transfer");
  assert.equal(enrichedByName["REINVEST"]?.amount, -28.11);
  assert.equal(enrichedByName["TRANSFER"]?.kind, "transfer");
  assert.equal(enrichedByName["TRANSFER"]?.amount, -7500);
});

void test("parser: fidelity unknown actions abort the line with an error", async (t) => {
  await useTempDatabase(t);
  const account = createAccount({ name: "Fidelity Roth IRA", type: "asset" });
  const result = parseStatement(
    [
      "Run Date,Action,Symbol,Description,Type,Amount ($)",
      "09/15/2026,SOMETHING WEIRD HAPPENED (Cash),,No Description,Cash,10",
    ].join("\n"),
    account.id,
  );
  assert.equal(result.format, "fidelity");
  assert.equal(result.transactions.length, 0);
  assert.match(result.errors.join("\n"), /Unknown Fidelity Action/);
});
