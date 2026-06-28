import assert from "node:assert/strict";
import test from "node:test";
import {
  actionFailureCanBeRetried,
  buildSearchUpdateFollowUp,
  normalizeMaxAssistantTurns,
  prepareActionsForExecution,
  shouldContinueToolLoop,
} from "./services/ai-chat.js";
import type { AIAction, ExecutedAction } from "./services/ai-chat.js";
import type { PlanningContext } from "./services/ai-chat/types.js";

function planningContext(): PlanningContext {
  return {
    accounts: [
      {
        id: "account-checking",
        name: "Checking",
        type: "asset",
        initial_balance: 0,
        color: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    categories: [
      {
        id: "category-food",
        name: "Food",
        type: "expense",
        color: null,
        is_system: false,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    subcategories: [
      {
        id: "subcategory-groceries",
        category_id: "category-food",
        name: "Groceries",
        monthly_goal: 500,
        color: null,
        is_system: false,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
      },
    ],
    goals: [],
    tags: [],
    recentTransactions: [
      {
        id: "transaction-uber",
        account_id: "account-checking",
        account_name: "Checking",
        account_type: "asset",
        date: "2026-05-20",
        name: "Uber Trip Downtown",
        amount: -21.5,
        kind: "expense",
        subcategory_id: "subcategory-groceries",
        subcategory_name: "Groceries",
        category_id: "category-food",
        category_name: "Food",
        category_type: "expense",
        comment: "client pickup",
        tags: [],
        ai_suggested: false,
        is_initial_balance: false,
        created_at: "2026-05-20T00:00:00.000Z",
        updated_at: "2026-05-20T00:00:00.000Z",
        deleted_at: null,
      },
    ],
  };
}

test("normalizeMaxAssistantTurns defaults, truncates, and clamps values", () => {
  assert.equal(normalizeMaxAssistantTurns(undefined), 5);
  assert.equal(normalizeMaxAssistantTurns("not a number"), 5);
  assert.equal(normalizeMaxAssistantTurns(0), 1);
  assert.equal(normalizeMaxAssistantTurns(2.9), 2);
  assert.equal(normalizeMaxAssistantTurns(99), 10);
});

test("actionFailureCanBeRetried identifies resolvable reference failures", () => {
  const retryable: ExecutedAction = {
    type: "update_transaction",
    input: {},
    status: "error",
    error: "update_transaction references ambiguous subcategory: Groceries",
  };
  const terminal: ExecutedAction = {
    type: "create_transaction",
    input: {},
    status: "error",
    error: "create_transaction requires date in YYYY-MM-DD format",
  };

  assert.equal(actionFailureCanBeRetried(retryable), true);
  assert.equal(actionFailureCanBeRetried(terminal), false);
});

test("shouldContinueToolLoop continues after search-only updates and retriable failures", () => {
  const searchOnly: ExecutedAction[] = [
    {
      type: "search_transactions",
      input: { searchQuery: "Uber" },
      status: "success",
      result: [],
    },
  ];
  const completedUpdate: ExecutedAction[] = [
    ...searchOnly,
    {
      type: "update_transaction",
      input: { id: "transaction-uber", comment: "client rideshare" },
      status: "success",
      result: {},
    },
  ];
  const retriableFailure: ExecutedAction[] = [
    {
      type: "update_subcategory",
      input: { current_name: "Groceries" },
      status: "error",
      error: "update_subcategory requires id or current_name",
    },
  ];

  assert.equal(
    shouldContinueToolLoop("Find Uber and update its comment.", searchOnly),
    true,
  );
  assert.equal(
    shouldContinueToolLoop(
      "Find Uber and update its comment.",
      completedUpdate,
    ),
    false,
  );
  assert.equal(
    shouldContinueToolLoop("Move Groceries.", retriableFailure),
    true,
  );
});

test("prepareActionsForExecution preserves transaction normalization and search repair", () => {
  const context = planningContext();
  const createAction: AIAction = {
    type: "create_transaction",
    input: {
      account_name: "Checking",
      date: "2026-05-24",
      name: "Corner Market",
      amount: 18.44,
      subcategory_name: "Groceries",
    },
  };
  const updateAction: AIAction = {
    type: "update_transaction",
    input: {
      id: "transaction-uber",
      comment: "client rideshare",
    },
  };

  const preparedCreate = prepareActionsForExecution(
    [createAction],
    "Add Corner Market for 18.44 in Groceries.",
    "Added it.",
    context,
  );
  assert.equal(preparedCreate[0]?.input.amount, -18.44);

  const preparedUpdate = prepareActionsForExecution(
    [updateAction],
    "Update Uber Trip Downtown comment to client rideshare.",
    "Updated it.",
    context,
  );
  assert.deepEqual(
    preparedUpdate.map((action) => action.type),
    ["search_transactions", "update_transaction"],
  );
  assert.match(
    String(preparedUpdate[0]?.input.searchQuery),
    /name:"Uber Trip Downtown"/,
  );
});

test("search repair extracts tag names before target prepositions", () => {
  const context = planningContext();
  const target = {
    ...context.recentTransactions[0]!,
    id: "transaction-cabo",
    name: "Cabo Hotel",
  };

  const followUp = buildSearchUpdateFollowUp(
    [{ type: "search_transactions", input: { searchQuery: '"Cabo Hotel"' } }],
    "Find the Cabo Hotel transaction and update it to add tag Reimbursable to it.",
    {
      action: {
        type: "search_transactions",
        input: { searchQuery: '"Cabo Hotel"' },
      },
      executedAction: {
        type: "search_transactions",
        input: { searchQuery: '"Cabo Hotel"' },
        status: "success",
        result: [target],
      },
    },
    context.subcategories,
  );

  assert.equal(followUp?.type, "update_transaction");
  assert.deepEqual(followUp?.input.add_tag_names, ["Reimbursable"]);
});
