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

void test("normalizeMaxAssistantTurns defaults, truncates, and clamps values", () => {
  assert.equal(normalizeMaxAssistantTurns(undefined), 5);
  assert.equal(normalizeMaxAssistantTurns("not a number"), 5);
  assert.equal(normalizeMaxAssistantTurns(0), 1);
  assert.equal(normalizeMaxAssistantTurns(2.9), 2);
  assert.equal(normalizeMaxAssistantTurns(99), 10);
});

void test("actionFailureCanBeRetried identifies resolvable reference failures", () => {
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

void test("shouldContinueToolLoop continues after search-only updates and retriable failures", () => {
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
  const calculated: ExecutedAction[] = [
    {
      type: "calculate",
      input: { expression: "2 + 2" },
      status: "success",
      result: { expression: "2 + 2", result: 4 },
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
  assert.equal(
    shouldContinueToolLoop("What is 2 + 2?", calculated),
    true,
  );
});

void test("prepareActionsForExecution preserves transaction normalization and search repair", () => {
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

void test("search repair extracts tag names before target prepositions", () => {
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

void test("transaction preparation preserves signed amounts and explicit dates", () => {
  const context = planningContext();
  const expense: AIAction = {
    type: "create_transaction",
    input: {
      account_name: "Checking",
      date: "2026-04-30",
      name: "Groceries",
      amount: 42,
      subcategory_name: "Groceries",
    },
  };

  const explicitlyPositive = prepareActionsForExecution(
    [expense],
    "Record Groceries for +42 dated 2026-04-30.",
    "Recorded it.",
    context,
  );
  const explicitlyNegative = prepareActionsForExecution(
    [expense],
    "Record Groceries for -42 dated 2026-04-30.",
    "Recorded it.",
    context,
  );

  assert.equal(explicitlyPositive[0]?.input.amount, 42);
  assert.equal(explicitlyNegative[0]?.input.amount, -42);
  assert.equal(explicitlyPositive[0]?.input.date, "2026-04-30");
});

void test("missing goals become create actions while existing goals update in order", () => {
  const context = planningContext();
  const missingGoal: AIAction = {
    type: "update_goal",
    input: {
      subcategory_name: "Groceries",
      amount: 600,
      period: "monthly",
      start_date: "2026-06-01",
    },
  };
  const created = prepareActionsForExecution(
    [missingGoal],
    "Set a new monthly goal for Groceries.",
    "Set it.",
    context,
  );
  assert.deepEqual(created.map((action) => action.type), ["create_goal"]);
  assert.equal(created[0]?.input.subcategory_id, "subcategory-groceries");

  const withGoal: PlanningContext = {
    ...context,
    goals: [
      {
        id: "goal-groceries",
        subcategory_id: "subcategory-groceries",
        amount: 500,
        period: "monthly",
        start_date: "2026-05-01",
        end_date: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        deleted_at: null,
        subcategory_name: "Groceries",
        category_name: "Food",
        category_type: "expense",
      },
    ],
  };
  const updateSubcategory: AIAction = {
    type: "update_subcategory",
    input: {
      id: "subcategory-groceries",
      monthly_goal: 650,
    },
  };
  const updated = prepareActionsForExecution(
    [updateSubcategory],
    "Update the Groceries monthly budget target to 650.",
    "Updated it.",
    withGoal,
  );
  assert.deepEqual(updated.map((action) => action.type), [
    "update_subcategory",
    "update_goal",
  ]);
  assert.equal(updated[1]?.input.id, "goal-groceries");
});

void test("transaction update search insertion occurs only without a prior search", () => {
  const context = planningContext();
  const update: AIAction = {
    type: "update_transaction",
    input: { id: "transaction-uber", comment: "business travel" },
  };
  const search: AIAction = {
    type: "search_transactions",
    input: { searchQuery: "Uber" },
  };

  assert.deepEqual(
    prepareActionsForExecution(
      [update],
      "Update Uber.",
      "Updated it.",
      context,
    ).map((action) => action.type),
    ["search_transactions", "update_transaction"],
  );
  assert.deepEqual(
    prepareActionsForExecution(
      [search, update],
      "Find and update Uber.",
      "Updated it.",
      context,
    ).map((action) => action.type),
    ["search_transactions", "update_transaction"],
  );
});

void test("search-only repair reports ambiguous and empty result failures", () => {
  const context = planningContext();
  const searchAction: AIAction = {
    type: "search_transactions",
    input: { searchQuery: "Uber" },
  };
  const second = {
    ...context.recentTransactions[0]!,
    id: "transaction-second",
  };

  for (const result of [[], [context.recentTransactions[0]!, second]]) {
    const followUp = buildSearchUpdateFollowUp(
      [searchAction],
      "Find Uber and update its comment to \"travel\".",
      {
        action: searchAction,
        executedAction: {
          ...searchAction,
          status: "success",
          result,
        },
      },
      context.subcategories,
    );
    assert.equal(followUp?.type, "report_failure");
    assert.match(String(followUp?.input.reason), /choose one transaction/i);
  }
});

void test("search-only repair reconstructs comment category and tag updates", () => {
  const context = planningContext();
  const target = context.recentTransactions[0]!;
  const searchAction: AIAction = {
    type: "search_transactions",
    input: { searchQuery: "Uber" },
  };
  const followUp = buildSearchUpdateFollowUp(
    [searchAction],
    'Find Uber and update its comment to "travel", set subcategory to Groceries and add tag Reimbursable to it.',
    {
      action: searchAction,
      executedAction: {
        ...searchAction,
        status: "success",
        result: [target],
      },
    },
    context.subcategories,
  );

  assert.equal(followUp?.type, "update_transaction");
  assert.equal(followUp?.input.comment, "travel");
  assert.equal(followUp?.input.subcategory_name, "Groceries");
  assert.deepEqual(followUp?.input.add_tag_names, ["Reimbursable"]);
});
