import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  mapAkoyaAccountTypeToLocal,
  mapAkoyaTransactionToLocal,
  mapPlaidAccountTypeToLocal,
  mapPlaidTransactionToLocal,
} from "./services/provider-mappers.js";

void test("maps Plaid asset debit to LocalFin expense", () => {
  const draft = mapPlaidTransactionToLocal({
    accountType: "asset",
    transaction: {
      account_id: "plaid-account-1",
      transaction_id: "plaid-tx-1",
      date: "2026-06-01",
      name: "Coffee Shop",
      amount: 12.34,
    },
  });

  assert.equal(draft.amount, -12.34);
  assert.equal(draft.kind, "expense");
});

void test("maps Plaid asset credit to LocalFin income", () => {
  const draft = mapPlaidTransactionToLocal({
    accountType: "asset",
    transaction: {
      account_id: "plaid-account-1",
      transaction_id: "plaid-tx-2",
      date: "2026-06-02",
      name: "Refund",
      amount: -25,
    },
  });

  assert.equal(draft.amount, 25);
  assert.equal(draft.kind, "income");
});

void test("maps Plaid liability charge to LocalFin expense", () => {
  const draft = mapPlaidTransactionToLocal({
    accountType: "liability",
    transaction: {
      account_id: "plaid-card-1",
      transaction_id: "plaid-tx-3",
      date: "2026-06-03",
      name: "Card Charge",
      amount: 44.5,
    },
  });

  assert.equal(draft.amount, 44.5);
  assert.equal(draft.kind, "expense");
});

void test("maps Plaid liability payment to LocalFin income", () => {
  const draft = mapPlaidTransactionToLocal({
    accountType: "liability",
    transaction: {
      account_id: "plaid-card-1",
      transaction_id: "plaid-tx-4",
      date: "2026-06-04",
      name: "Card Payment",
      amount: -100,
    },
  });

  assert.equal(draft.amount, -100);
  assert.equal(draft.kind, "income");
});

void test("maps Akoya missing transaction ID to deterministic SHA-256 fallback", () => {
  const transaction = {
    postedTimestamp: "2026-06-05T12:30:00.000Z",
    description: "Dividend",
    amount: "7.25",
    debitCreditMemo: "CREDIT",
  };
  const first = mapAkoyaTransactionToLocal({
    accountType: "asset",
    providerAccountId: "akoya-account-1",
    transaction,
  });
  const second = mapAkoyaTransactionToLocal({
    accountType: "asset",
    providerAccountId: "akoya-account-1",
    transaction,
  });
  const expected = crypto
    .createHash("sha256")
    .update("akoya:akoya-account-1:2026-06-05:Dividend:7.25")
    .digest("hex");

  assert.equal(first.provider_transaction_id, expected);
  assert.equal(second.provider_transaction_id, expected);
});

void test("maps provider account types to LocalFin account types", () => {
  assert.equal(mapPlaidAccountTypeToLocal("credit"), "liability");
  assert.equal(mapPlaidAccountTypeToLocal("depository"), "asset");
  assert.equal(mapAkoyaAccountTypeToLocal("investment"), "asset");
});
