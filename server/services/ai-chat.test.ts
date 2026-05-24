import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  actionFailureCanBeRetried,
  buildSearchUpdateFollowUp,
  executeAction,
  normalizeMaxAssistantTurns,
  prepareActionsForExecution,
  shouldContinueToolLoop,
} from "./ai-chat.js";
import { createAccount } from "./accounts.js";
import { createCategory, createSubcategory } from "./categories.js";
import { createTransaction, getTransactionsWithDetails } from "./transactions.js";
import { closeDbForTests } from "../db/index.js";
import type {
  Account,
  Category,
  Subcategory,
  TransactionWithDetails,
} from "../../src/types/index.js";

const account: Account = {
  id: "checking",
  name: "Test Checking",
  type: "asset",
  color: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
};

const creditCard: Account = {
  ...account,
  id: "credit-card",
  name: "Test Credit Card",
  type: "liability",
};

const food: Category = {
  id: "food",
  name: "Food",
  type: "expense",
  color: null,
  is_system: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  deleted_at: null,
};

const income: Category = {
  ...food,
  id: "income",
  name: "Income",
  type: "income",
};

const groceries: Subcategory = {
  id: "groceries",
  category_id: "food",
  name: "Groceries",
  monthly_goal: 650,
  color: null,
  is_system: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  deleted_at: null,
};

const reimbursements: Subcategory = {
  ...groceries,
  id: "reimbursements",
  category_id: "income",
  name: "Reimbursements",
  monthly_goal: null,
};

const hotels: Subcategory = {
  ...groceries,
  id: "hotels",
  name: "Hotels",
};

const flights: Subcategory = {
  ...groceries,
  id: "flights",
  name: "Flights",
};

const context = {
  accounts: [account, creditCard],
  categories: [food, income],
  subcategories: [groceries, reimbursements, hotels, flights],
  goals: [],
  recentTransactions: [],
};

const originalDbPath = process.env.LOCALFIN_DB_PATH;
const tempRoots: string[] = [];

function restoreEnvironment(): void {
  if (originalDbPath === undefined) {
    delete process.env.LOCALFIN_DB_PATH;
  } else {
    process.env.LOCALFIN_DB_PATH = originalDbPath;
  }
}

async function useTempDatabase(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "localfin-ai-chat-test-"));
  tempRoots.push(tempDir);
  process.env.LOCALFIN_DB_PATH = path.join(tempDir, "budget.db");
}

afterEach(async () => {
  closeDbForTests();
  restoreEnvironment();
  await Promise.all(
    tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function transaction(
  overrides: Partial<TransactionWithDetails>,
): TransactionWithDetails {
  return {
    id: "transaction",
    account_id: "credit-card",
    date: "2026-04-11",
    name: "Marriott Hotel",
    amount: -215.4,
    kind: "expense",
    subcategory_id: "hotels",
    comment: "work trip",
    is_initial_balance: false,
    ai_suggested: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    account_name: "Test Credit Card",
    account_type: "liability",
    subcategory_name: "Hotels",
    category_id: "food",
    category_name: "Food",
    category_type: "expense",
    ...overrides,
  };
}

test("assistant action planning normalizes expense transaction signs", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Checking",
          date: "2026-05-18",
          name: "H Mart",
          amount: 39.81,
          subcategory_name: "Groceries",
        },
      },
    ],
    "Add a valid 2026-05-18 H Mart grocery charge for 39.81 on Test Checking in Groceries.",
    "Done.",
    context,
  );

  assert.equal(actions[0]?.input.amount, -39.81);
});

test("assistant action planning preserves explicit positive reimbursement and searchable name", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Checking",
          date: "2026-05-07",
          name: "Delta flight refund",
          amount: 318.2,
          subcategory_name: "Reimbursements",
          comment: "Delta flight refund",
        },
      },
    ],
    "Also add a +318.20 reimbursement on Test Checking dated May 7 in Reimbursements with comment Delta flight refund.",
    "Done.",
    context,
  );

  assert.equal(actions[0]?.input.amount, 318.2);
  assert.equal(actions[0]?.input.name, "Reimbursement - Delta flight refund");
});

test("assistant action planning does not apply reimbursement sign to nearby expense", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Credit Card",
          date: "2026-05-03",
          name: "Delta flight",
          amount: 318.2,
          subcategory_name: "Flights",
          comment: "work trip",
        },
      },
    ],
    "May 3 Delta flight 318.20 flights for work trip. Also add a +318.20 reimbursement on Test Checking dated May 7.",
    "Done.",
    context,
  );

  assert.equal(actions[0]?.input.amount, -318.2);
});

test("assistant action planning preserves explicit positive expense adjustment near unrelated reimbursement", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Checking",
          date: "2026-05-04",
          name: "Grocery correction",
          amount: 12,
          subcategory_name: "Groceries",
        },
      },
    ],
    "Add a +12 grocery correction on Test Checking dated May 4 in Groceries. Also remember the separate reimbursement from work.",
    "Done.",
    context,
  );

  assert.equal(actions[0]?.input.amount, 12);
});

test("assistant action planning preserves both card payment comments", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "create_transaction",
        input: {
          account_name: "Test Checking",
          date: "2026-05-16",
          name: "Test Credit Card payment",
          amount: -400,
          comment: "payment",
        },
      },
      {
        type: "create_transaction",
        input: {
          account_name: "Test Credit Card",
          date: "2026-05-16",
          name: "Test Checking payment",
          amount: 400,
          comment: "payment to Test Credit Card",
        },
      },
    ],
    "Add a Test Checking card payment of -400 with comment payment to Test Credit Card, and a matching +400 on Test Credit Card with comment payment from checking.",
    "Done.",
    context,
  );

  assert.equal(actions[0]?.input.comment, "payment to Test Credit Card");
  assert.equal(actions[1]?.input.comment, "payment from checking");
});

test("assistant action planning turns verbal create refusal into visible failure", () => {
  const actions = prepareActionsForExecution(
    [],
    "Add a 2026-05-09 Mystery Shop charge for 22.22 to account Vacation Wallet in Groceries.",
    "The account Vacation Wallet could not be found.",
    context,
  );

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "report_failure");
});

test("assistant action planning does not synthesize failure for deletion refusals", () => {
  const actions = prepareActionsForExecution(
    [],
    "Delete the Marriott Hotel transaction.",
    "Deletion is unavailable from chat.",
    context,
  );

  assert.deepEqual(actions, []);
});

test("assistant action planning inserts search before direct transaction update", () => {
  const directUpdateContext = {
    ...context,
    recentTransactions: [
      transaction({
        id: "lyft",
        name: "Lyft Airport",
        date: "2026-04-10",
        account_name: "Test Credit Card",
      }),
    ],
  };
  const actions = prepareActionsForExecution(
    [
      {
        type: "update_transaction",
        input: {
          id: "lyft",
          comment: "airport transfer - reimbursable",
        },
      },
    ],
    "Find the rideshare transaction matching (uber OR lyft) and update the airport ride.",
    "Done.",
    directUpdateContext,
  );

  assert.equal(actions[0]?.type, "search_transactions");
  assert.equal(actions[1]?.type, "update_transaction");
});

test("assistant action planning builds search-only update follow-up", () => {
  const searchAction = {
    type: "search_transactions",
    input: { searchQuery: 'comment:"work trip" OR name:"hotel"' },
  };
  const followUp = buildSearchUpdateFollowUp(
    [searchAction],
    "Search comment:\"work trip\" OR name:\"hotel\", then update the hotel transaction so its comment says 'work trip reimbursable' and the subcategory is Hotels.",
    {
      action: searchAction,
      executedAction: {
        ...searchAction,
        status: "success",
        result: [
          transaction({ id: "marriott", name: "Marriott Hotel" }),
          transaction({ id: "lyft", name: "Lyft Airport" }),
        ],
      },
    },
    [groceries, reimbursements, hotels],
  );

  assert.equal(followUp?.type, "update_transaction");
  assert.equal(followUp?.input.id, "marriott");
  assert.equal(followUp?.input.comment, "work trip reimbursable");
  assert.equal(followUp?.input.subcategory_name, "Hotels");
});

test("assistant action planning pairs subcategory monthly goal updates with existing goals", () => {
  const actions = prepareActionsForExecution(
    [
      {
        type: "update_subcategory",
        input: { id: "groceries", name: "Groceries", monthly_goal: 700 },
      },
    ],
    "Increase the Groceries monthly goal to 700.",
    "Done.",
    {
      ...context,
      goals: [
        {
          id: "groceries-goal",
          subcategory_id: "groceries",
          subcategory_name: "Groceries",
          amount: 650,
          period: "monthly",
          start_date: "2026-04-01",
          end_date: null,
          category_name: "Food",
          category_type: "expense",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          deleted_at: null,
        },
      ],
    },
  );

  assert.equal(actions[0]?.type, "update_subcategory");
  assert.equal(actions[1]?.type, "update_goal");
  assert.equal(actions[1]?.input.id, "groceries-goal");
  assert.equal(actions[1]?.input.amount, 700);
});

test("assistant max turn setting defaults and clamps", () => {
  assert.equal(normalizeMaxAssistantTurns(undefined), 5);
  assert.equal(normalizeMaxAssistantTurns(0), 1);
  assert.equal(normalizeMaxAssistantTurns(99), 10);
  assert.equal(normalizeMaxAssistantTurns(4.8), 4);
});

test("assistant action execution resolves unique subcategory names passed as ids", async () => {
  await useTempDatabase();
  const testAccount = createAccount({ name: "Resolver Checking", type: "asset" });
  const category = createCategory({
    name: "Resolver Essentials",
    type: "expense",
  });
  const rent = createSubcategory({
    name: "Resolver Rent",
    category_id: category.id,
  });
  const other = createSubcategory({
    name: "Resolver Other",
    category_id: category.id,
  });
  createTransaction({
    account_id: testAccount.id,
    date: "2026-05-01",
    name: "Resolver ZELLE INSTANT PMT",
    amount: -1561,
    subcategory_id: other.id,
  });

  const result = executeAction({
    type: "bulk_update_transactions",
    input: {
      account_name: "Resolver Checking",
      searchQuery: 'name:"Resolver ZELLE INSTANT PMT"',
      updates: { subcategory_id: "Resolver Rent" },
    },
  });

  assert.equal(result.status, "success");
  assert.equal((result.result as { updated_count: number }).updated_count, 1);
  const transactions = getTransactionsWithDetails({
    searchQuery: 'name:"Resolver ZELLE INSTANT PMT"',
    accountId: testAccount.id,
  });
  assert.equal(transactions[0]?.subcategory_id, rent.id);
});

test("assistant action execution rejects unknown ids instead of passing them through", async () => {
  await useTempDatabase();
  const testAccount = createAccount({
    name: "Unknown Id Checking",
    type: "asset",
  });
  const category = createCategory({
    name: "Unknown Id Essentials",
    type: "expense",
  });
  const other = createSubcategory({
    name: "Unknown Id Other",
    category_id: category.id,
  });
  createTransaction({
    account_id: testAccount.id,
    date: "2026-05-01",
    name: "Unknown Id Coffee",
    amount: -5,
    subcategory_id: other.id,
  });

  const result = executeAction({
    type: "bulk_update_transactions",
    input: {
      account_name: "Unknown Id Checking",
      searchQuery: 'name:"Unknown Id Coffee"',
      updates: { subcategory_id: "not-a-real-subcategory-id" },
    },
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /unknown subcategory/i);
  assert.equal(actionFailureCanBeRetried(result), true);
});

test("assistant action execution reports unknown account ids as recoverable references", async () => {
  await useTempDatabase();
  const category = createCategory({
    name: "Unknown Account Essentials",
    type: "expense",
  });
  const subcategory = createSubcategory({
    name: "Unknown Account Other",
    category_id: category.id,
  });

  const result = executeAction({
    type: "create_transaction",
    input: {
      account_id: "not-a-real-account-id",
      date: "2026-05-01",
      name: "Unknown Account Coffee",
      amount: -5,
      subcategory_id: subcategory.id,
    },
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /unknown account/i);
  assert.equal(actionFailureCanBeRetried(result), true);
});

test("assistant action execution reports ambiguous name-in-id references", async () => {
  await useTempDatabase();
  const testAccount = createAccount({
    name: "Ambiguous Ref Checking",
    type: "asset",
  });

  const result = executeAction({
    type: "create_transaction",
    input: {
      account_id: testAccount.id,
      date: "2026-05-01",
      name: "Ambiguous Ref Fee",
      amount: -5,
      subcategory_id: "Unassigned",
    },
  });

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /ambiguous subcategory "Unassigned"/i);
  assert.match(result.error ?? "", /Candidates:/);
  assert.equal(actionFailureCanBeRetried(result), true);
});

test("assistant action execution can reassign a transaction to transfer", async () => {
  await useTempDatabase();
  const testAccount = createAccount({ name: "Kind Checking", type: "asset" });
  const category = createCategory({ name: "Kind Essentials", type: "expense" });
  const other = createSubcategory({
    name: "Kind Other",
    category_id: category.id,
  });
  const transaction = createTransaction({
    account_id: testAccount.id,
    date: "2026-05-01",
    name: "Kind Card Payment",
    amount: -250,
    subcategory_id: other.id,
  });

  const result = executeAction({
    type: "update_transaction",
    input: {
      id: transaction.id,
      kind: "transfer",
    },
  });

  assert.equal(result.status, "success");
  const updated = getTransactionsWithDetails({ searchQuery: 'name:"Kind Card Payment"' });
  assert.equal(updated[0]?.kind, "transfer");
  assert.equal(updated[0]?.subcategory_id, null);
});

test("assistant action execution can reassign a transaction to adjustment", async () => {
  await useTempDatabase();
  const testAccount = createAccount({ name: "Adjustment Kind Checking", type: "asset" });
  const category = createCategory({ name: "Adjustment Kind Essentials", type: "expense" });
  const other = createSubcategory({
    name: "Adjustment Kind Other",
    category_id: category.id,
  });
  const transaction = createTransaction({
    account_id: testAccount.id,
    date: "2026-05-01",
    name: "Manual Value Change",
    amount: 125,
    subcategory_id: other.id,
  });

  const result = executeAction({
    type: "update_transaction",
    input: {
      id: transaction.id,
      kind: "adjustment",
    },
  });

  assert.equal(result.status, "success");
  const updated = getTransactionsWithDetails({ searchQuery: 'name:"Manual Value Change"' });
  assert.equal(updated[0]?.kind, "adjustment");
  assert.equal(updated[0]?.subcategory_id, null);
});

test("assistant tool loop continues only for recoverable failed actions", () => {
  assert.equal(
    shouldContinueToolLoop("Add coffee on my Missing Card account.", [
      {
        type: "create_transaction",
        input: { account_id: "Missing Card", name: "Coffee" },
        status: "error",
        error: 'create_transaction references an unknown account',
      },
    ]),
    true,
  );
  assert.equal(
    shouldContinueToolLoop("Change the coffee transaction to Groceries.", [
      {
        type: "update_transaction",
        input: { id: "coffee", subcategory_id: "Groceries" },
        status: "error",
        error: 'update_transaction references an unknown subcategory',
      },
    ]),
    true,
  );
  assert.equal(
    shouldContinueToolLoop("Add a transaction dated 2026-02-31.", [
      {
        type: "create_transaction",
        input: { date: "2026-02-31" },
        status: "error",
        error: "create_transaction requires date to be a valid YYYY-MM-DD date",
      },
    ]),
    false,
  );
  assert.equal(
    shouldContinueToolLoop("Create this and change that.", [
      {
        type: "create_transaction",
        input: { id: "created" },
        status: "success",
      },
      {
        type: "update_transaction",
        input: { id: "target", subcategory_id: "Missing" },
        status: "error",
        error: 'update_transaction references an unknown subcategory',
      },
    ]),
    false,
  );
});

test("assistant bulk update action updates every matching transaction", async () => {
  await useTempDatabase();
  const testAccount = createAccount({ name: "Bulk Checking", type: "asset" });
  const category = createCategory({ name: "Bulk Essentials", type: "expense" });
  createSubcategory({
    name: "Bulk Rent",
    category_id: category.id,
  });
  const other = createSubcategory({
    name: "Bulk Other",
    category_id: category.id,
  });

  createTransaction({
    account_id: testAccount.id,
    date: "2026-05-01",
    name: "ZELLE INSTANT PMT TO Nick",
    amount: -1561,
    subcategory_id: other.id,
  });
  createTransaction({
    account_id: testAccount.id,
    date: "2026-04-01",
    name: "ZELLE INSTANT PMT TO Nick",
    amount: -1561,
    subcategory_id: other.id,
  });
  createTransaction({
    account_id: testAccount.id,
    date: "2026-04-02",
    name: "MONTHLY MAINTENANCE FEE",
    amount: -12,
    subcategory_id: other.id,
  });

  const result = executeAction({
    type: "bulk_update_transactions",
    input: {
      account_name: "Bulk Checking",
      searchQuery: 'name:"ZELLE INSTANT PMT"',
      updates: { subcategory_name: "Bulk Rent" },
    },
  });

  assert.equal(result.status, "success");
  assert.equal((result.result as { matched_count: number }).matched_count, 2);
  assert.equal((result.result as { updated_count: number }).updated_count, 2);

  const zelleTransactions = getTransactionsWithDetails({
    searchQuery: 'name:"ZELLE INSTANT PMT"',
    accountId: testAccount.id,
  });
  assert.equal(zelleTransactions.length, 2);
  assert.ok(
    zelleTransactions.every(
      (transaction) => transaction.subcategory_name === "Bulk Rent",
    ),
  );

  const feeTransactions = getTransactionsWithDetails({
    searchQuery: 'name:"MONTHLY MAINTENANCE FEE"',
    accountId: testAccount.id,
  });
  assert.equal(feeTransactions[0]?.subcategory_name, "Bulk Other");
});

test("assistant bulk update action returns zero counts for no matches", async () => {
  await useTempDatabase();
  const testAccount = createAccount({ name: "Empty Bulk Checking", type: "asset" });
  const category = createCategory({ name: "Empty Bulk Essentials", type: "expense" });
  createSubcategory({
    name: "Empty Bulk Rent",
    category_id: category.id,
  });

  const result = executeAction({
    type: "bulk_update_transactions",
    input: {
      account_name: testAccount.name,
      searchQuery: 'name:"NO MATCH"',
      updates: { subcategory_name: "Empty Bulk Rent" },
    },
  });

  assert.equal(result.status, "success");
  assert.equal((result.result as { matched_count: number }).matched_count, 0);
  assert.equal((result.result as { updated_count: number }).updated_count, 0);
});
