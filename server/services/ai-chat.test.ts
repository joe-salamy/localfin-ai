import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchUpdateFollowUp,
  prepareActionsForExecution,
} from "./ai-chat.js";
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
  color: null,
  monthly_goal: 650,
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
  recentTransactions: [],
};

function transaction(
  overrides: Partial<TransactionWithDetails>,
): TransactionWithDetails {
  return {
    id: "transaction",
    account_id: "credit-card",
    date: "2026-04-11",
    name: "Marriott Hotel",
    amount: -215.4,
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
