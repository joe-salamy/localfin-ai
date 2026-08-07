import type Database from "better-sqlite3";
import type {
  Account,
  CategoryType,
  ChatActionResult,
  ChatResult,
  ChatStreamEvent,
  GoalPeriod,
  Subcategory,
} from "../../shared/contracts/index.js";

export type AgentEvalAction = ChatActionResult;

export interface AgentSnapshotAccount {
  id: string;
  name: string;
  type: string;
  current_balance: number;
  deleted_at: string | null;
}

export interface AgentSnapshotCategory {
  id: string;
  name: string;
  type: string;
  is_system: number;
  deleted_at: string | null;
}

export interface AgentSnapshotSubcategory {
  id: string;
  name: string;
  monthly_goal: number | null;
  category_name: string;
  category_type: string;
  deleted_at: string | null;
}

export interface AgentSnapshotTransaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  kind: string;
  account_name: string;
  account_type: string;
  subcategory_name: string | null;
  category_name: string | null;
  category_type: string | null;
  comment: string | null;
  deleted_at: string | null;
}

export interface AgentSnapshotGoal {
  id: string;
  amount: number;
  period: string;
  start_date: string;
  end_date: string | null;
  subcategory_name: string;
  category_name: string;
  deleted_at: string | null;
}

export interface AgentSnapshot {
  accounts: AgentSnapshotAccount[];
  categories: AgentSnapshotCategory[];
  subcategories: AgentSnapshotSubcategory[];
  transactions: AgentSnapshotTransaction[];
  goals: AgentSnapshotGoal[];
  deletedRows: {
    accounts: number;
    categories: number;
    subcategories: number;
    transactions: number;
    goals: number;
  };
}

export interface AgentEvalSeedAccount {
  name: string;
  type: "asset" | "liability";
  initial_balance?: number;
}

export interface AgentEvalSeedCategory {
  name: string;
  type: CategoryType;
  subcategories: { name: string; monthly_goal?: number | null }[];
}

export interface AgentEvalSeedTransaction {
  account: string;
  date: string;
  name: string;
  amount: number;
  subcategory?: string;
  comment?: string | null;
}

export interface AgentEvalSeedGoal {
  subcategory: string;
  amount: number;
  period: GoalPeriod;
  start_date: string;
  end_date?: string | null;
}

export interface AgentEvalSeed {
  accounts?: AgentEvalSeedAccount[];
  categories?: AgentEvalSeedCategory[];
  transactions?: AgentEvalSeedTransaction[];
  goals?: AgentEvalSeedGoal[];
}

export interface AgentEvalServices {
  createAccount: (data: AgentEvalSeedAccount) => Account;
  createCategory: (data: { name: string; type: CategoryType }) => {
    id: string;
    name: string;
  };
  createSubcategory: (data: {
    name: string;
    category_id: string;
    monthly_goal?: number | null;
  }) => Subcategory;
  createTransaction: (data: {
    account_id: string;
    date: string;
    name: string;
    amount: number;
    subcategory_id?: string | null;
    comment?: string | null;
  }) => unknown;
  createSpendingGoal: (data: {
    subcategory_id: string;
    amount: number;
    period: GoalPeriod;
    start_date: string;
    end_date?: string | null;
  }) => unknown;
}

export interface AgentEvalContext {
  result: ChatResult;
  actions: AgentEvalAction[];
  snapshot: AgentSnapshot;
  streamEvents: ChatStreamEvent[];
}

export interface AgentEvalAssertionResult {
  name: string;
  status: "pass" | "fail";
  details?: string;
}

export interface AgentEvalAssertion {
  name: string;
  check: (context: AgentEvalContext) => AgentEvalAssertionResult;
}

export function normalizeAgentText(value: string): string {
  return value.trim().toLowerCase();
}

export function agentTextIncludes(
  actual: string | null | undefined,
  expected: string,
): boolean {
  return normalizeAgentText(actual ?? "").includes(normalizeAgentText(expected));
}

export function agentNumberEquals(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 0.005;
}

export function normalizedAgentAmount(
  amount: number,
  transaction: AgentSnapshotTransaction,
): number {
  if (transaction.kind === "transfer") return amount;

  const absoluteAmount = Math.abs(amount);
  if (
    (transaction.account_type === "asset" && transaction.kind === "expense") ||
    (transaction.account_type === "liability" && transaction.kind === "income")
  ) {
    return -absoluteAmount;
  }
  return absoluteAmount;
}

function pass(name: string, details?: string): AgentEvalAssertionResult {
  return { name, status: "pass", details };
}

function fail(name: string, details: string): AgentEvalAssertionResult {
  return { name, status: "fail", details };
}

export function assertActionCount(
  type: string,
  minimum: number,
): AgentEvalAssertion {
  return {
    name: `at least ${minimum} ${type} action(s)`,
    check: ({ actions }) => {
      const count = actions.filter((action) => action.type === type).length;
      return count >= minimum
        ? pass(`at least ${minimum} ${type} action(s)`, `found ${count}`)
        : fail(`at least ${minimum} ${type} action(s)`, `found ${count}`);
    },
  };
}

export function assertNoAction(type: string): AgentEvalAssertion {
  return {
    name: `no ${type} action`,
    check: ({ actions }) =>
      actions.some((action) => action.type === type)
        ? fail(`no ${type} action`, `${type} was returned`)
        : pass(`no ${type} action`),
  };
}

export function assertAllActionsSucceeded(): AgentEvalAssertion {
  return {
    name: "all actions succeeded",
    check: ({ actions }) => {
      const failed = actions.filter((action) => action.status === "error");
      return failed.length === 0
        ? pass("all actions succeeded")
        : fail(
            "all actions succeeded",
            failed
              .map((action) => `${action.type}: ${action.error}`)
              .join("; "),
          );
    },
  };
}

export function assertAnyActionFailed(): AgentEvalAssertion {
  return {
    name: "at least one action failed",
    check: ({ actions }) =>
      actions.some((action) => action.status === "error")
        ? pass("at least one action failed")
        : fail("at least one action failed", "no action reported an error"),
  };
}

export function assertSearchBeforeUpdate(): AgentEvalAssertion {
  return {
    name: "search/update or bulk update path used",
    check: ({ actions }) => {
      const bulkIndex = actions.findIndex(
        (action) => action.type === "bulk_update_transactions",
      );
      if (bulkIndex !== -1) return pass("search/update or bulk update path used");

      const searchIndex = actions.findIndex(
        (action) => action.type === "search_transactions",
      );
      const updateIndex = actions.findIndex(
        (action) => action.type === "update_transaction",
      );
      return searchIndex !== -1 && updateIndex !== -1 && searchIndex < updateIndex
        ? pass("search happens before transaction update")
        : fail(
            "search/update or bulk update path used",
            `search index ${searchIndex}, update index ${updateIndex}`,
          );
    },
  };
}

export function assertAccount(
  name: string,
  type?: string,
  balance?: number,
): AgentEvalAssertion {
  return {
    name: `account exists: ${name}`,
    check: ({ snapshot }) => {
      const account = snapshot.accounts.find(
        (item) => normalizeAgentText(item.name) === normalizeAgentText(name),
      );
      if (!account) return fail(`account exists: ${name}`, "account not found");
      if (type && account.type !== type) {
        return fail(`account exists: ${name}`, `type was ${account.type}`);
      }
      if (
        balance !== undefined &&
        !agentNumberEquals(account.current_balance, balance)
      ) {
        return fail(
          `account exists: ${name}`,
          `balance was ${account.current_balance}`,
        );
      }
      return pass(`account exists: ${name}`);
    },
  };
}

export function assertCategory(name: string, type: string): AgentEvalAssertion {
  return {
    name: `category exists: ${name}`,
    check: ({ snapshot }) => {
      const category = snapshot.categories.find(
        (item) =>
          normalizeAgentText(item.name) === normalizeAgentText(name) &&
          item.type === type,
      );
      return category
        ? pass(`category exists: ${name}`)
        : fail(`category exists: ${name}`, "category not found");
    },
  };
}

export function assertSubcategory(
  name: string,
  categoryName?: string,
  monthlyGoal?: number | null,
): AgentEvalAssertion {
  return {
    name: `subcategory exists: ${name}`,
    check: ({ snapshot }) => {
      const subcategory = snapshot.subcategories.find(
        (item) => normalizeAgentText(item.name) === normalizeAgentText(name),
      );
      if (!subcategory) {
        return fail(`subcategory exists: ${name}`, "subcategory not found");
      }
      if (
        categoryName &&
        normalizeAgentText(subcategory.category_name) !==
          normalizeAgentText(categoryName)
      ) {
        return fail(
          `subcategory exists: ${name}`,
          `category was ${subcategory.category_name}`,
        );
      }
      if (
        monthlyGoal !== undefined &&
        (subcategory.monthly_goal === null ||
          !agentNumberEquals(subcategory.monthly_goal, monthlyGoal ?? 0))
      ) {
        return fail(
          `subcategory exists: ${name}`,
          `monthly goal was ${subcategory.monthly_goal}`,
        );
      }
      return pass(`subcategory exists: ${name}`);
    },
  };
}

export function assertGoal(
  subcategoryName: string,
  amount: number,
  period: GoalPeriod,
): AgentEvalAssertion {
  return {
    name: `goal exists: ${subcategoryName}`,
    check: ({ snapshot }) => {
      const goal = snapshot.goals.find(
        (item) =>
          normalizeAgentText(item.subcategory_name) ===
          normalizeAgentText(subcategoryName),
      );
      if (!goal) return fail(`goal exists: ${subcategoryName}`, "goal not found");
      if (!agentNumberEquals(goal.amount, amount)) {
        return fail(
          `goal exists: ${subcategoryName}`,
          `amount was ${goal.amount}`,
        );
      }
      if (goal.period !== period) {
        return fail(
          `goal exists: ${subcategoryName}`,
          `period was ${goal.period}`,
        );
      }
      return pass(`goal exists: ${subcategoryName}`);
    },
  };
}

export function assertTransaction(expected: {
  account: string;
  date?: string;
  nameIncludes: string;
  amount?: number;
  subcategory?: string;
  commentIncludes?: string;
}): AgentEvalAssertion {
  return {
    name: `transaction exists: ${expected.nameIncludes}`,
    check: ({ snapshot }) => {
      const transaction = snapshot.transactions.find((item) => {
        if (normalizeAgentText(item.account_name) !== normalizeAgentText(expected.account)) {
          return false;
        }
        if (!agentTextIncludes(item.name, expected.nameIncludes)) return false;
        if (expected.date && item.date !== expected.date) return false;
        if (
          expected.amount !== undefined &&
          !agentNumberEquals(
            item.amount,
            normalizedAgentAmount(expected.amount, item),
          )
        ) {
          return false;
        }
        if (
          expected.subcategory &&
          normalizeAgentText(item.subcategory_name ?? "") !==
            normalizeAgentText(expected.subcategory)
        ) {
          return false;
        }
        if (
          expected.commentIncludes &&
          !agentTextIncludes(item.comment, expected.commentIncludes)
        ) {
          return false;
        }
        return true;
      });
      return transaction
        ? pass(`transaction exists: ${expected.nameIncludes}`)
        : fail(
            `transaction exists: ${expected.nameIncludes}`,
            "transaction not found",
          );
    },
  };
}

export function assertMatchingTransactionsSubcategory(expected: {
  account: string;
  nameIncludes: string;
  subcategory: string;
  count: number;
}): AgentEvalAssertion {
  return {
    name: `all ${expected.nameIncludes} transactions are ${expected.subcategory}`,
    check: ({ snapshot }) => {
      const matches = snapshot.transactions.filter(
        (item) =>
          normalizeAgentText(item.account_name) === normalizeAgentText(expected.account) &&
          agentTextIncludes(item.name, expected.nameIncludes),
      );
      if (matches.length !== expected.count) {
        return fail(
          `all ${expected.nameIncludes} transactions are ${expected.subcategory}`,
          `found ${matches.length}, expected ${expected.count}`,
        );
      }
      const mismatches = matches.filter(
        (item) =>
          item.subcategory_name === null ||
          normalizeAgentText(item.subcategory_name) !==
            normalizeAgentText(expected.subcategory),
      );
      return mismatches.length === 0
        ? pass(`all ${expected.nameIncludes} transactions are ${expected.subcategory}`)
        : fail(
            `all ${expected.nameIncludes} transactions are ${expected.subcategory}`,
            `mismatched ids: ${mismatches.map((item) => item.id).join(", ")}`,
          );
    },
  };
}

export function assertNoDeletedRows(): AgentEvalAssertion {
  return {
    name: "no rows were soft-deleted",
    check: ({ snapshot }) => {
      const total = Object.values(snapshot.deletedRows).reduce(
        (sum, value) => sum + value,
        0,
      );
      return total === 0
        ? pass("no rows were soft-deleted")
        : fail("no rows were soft-deleted", `${total} deleted rows found`);
    },
  };
}

export function assertStreamLifecycle(): AgentEvalAssertion {
  return {
    name: "stream lifecycle completed",
    check: ({ streamEvents }) => {
      const types = streamEvents.map((event) => event.type);
      const required = ["started", "thinking", "actions_planned", "final"];
      const missing = required.filter(
        (type) => !types.includes(type as ChatStreamEvent["type"]),
      );
      const diagnosticEvents = types.filter((type) =>
        ["reasoning_delta", "reasoning_details", "response_delta"].includes(type),
      );
      return missing.length === 0 && diagnosticEvents.length === 0
        ? pass("stream lifecycle completed")
        : fail(
            "stream lifecycle completed",
            [
              missing.length > 0 ? `missing ${missing.join(", ")}` : "",
              diagnosticEvents.length > 0
                ? `diagnostic events ${diagnosticEvents.join(", ")}`
                : "",
            ]
              .filter(Boolean)
              .join("; "),
          );
    },
  };
}

function countSoftDeletedRows(db: Database.Database, table: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE deleted_at IS NOT NULL`,
    )
    .get() as { count: number };
  return row.count;
}

export function softDeletedRowCounts(
  db: Database.Database,
): AgentSnapshot["deletedRows"] {
  return {
    accounts: countSoftDeletedRows(db, "accounts"),
    categories: countSoftDeletedRows(db, "categories"),
    subcategories: countSoftDeletedRows(db, "subcategories"),
    transactions: countSoftDeletedRows(db, "transactions"),
    goals: countSoftDeletedRows(db, "spending_goals"),
  };
}

export function readAgentSnapshot(db: Database.Database): AgentSnapshot {
  return {
    accounts: db
      .prepare(
        `
          SELECT a.*, COALESCE(SUM(t.amount), 0) AS current_balance
          FROM accounts a
          LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
          WHERE a.deleted_at IS NULL
          GROUP BY a.id
          ORDER BY a.name
        `,
      )
      .all() as AgentSnapshotAccount[],
    categories: db
      .prepare(
        "SELECT id, name, type, is_system, deleted_at FROM categories WHERE deleted_at IS NULL ORDER BY name",
      )
      .all() as AgentSnapshotCategory[],
    subcategories: db
      .prepare(
        `
          SELECT s.id, s.name, s.monthly_goal, c.name AS category_name,
                 c.type AS category_type, s.deleted_at
          FROM subcategories s
          JOIN categories c ON c.id = s.category_id
          WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL
          ORDER BY s.name
        `,
      )
      .all() as AgentSnapshotSubcategory[],
    transactions: db
      .prepare(
        `
          SELECT t.id, t.date, t.name, t.amount, a.name AS account_name,
                 a.type AS account_type, t.kind,
                 s.name AS subcategory_name, c.name AS category_name,
                 c.type AS category_type, t.comment, t.deleted_at
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id
          LEFT JOIN subcategories s ON s.id = t.subcategory_id
          LEFT JOIN categories c ON c.id = s.category_id
          WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
          ORDER BY t.date, t.name
        `,
      )
      .all() as AgentSnapshotTransaction[],
    goals: db
      .prepare(
        `
          SELECT g.id, g.amount, g.period, g.start_date, g.end_date,
                 s.name AS subcategory_name, c.name AS category_name, g.deleted_at
          FROM spending_goals g
          JOIN subcategories s ON s.id = g.subcategory_id
          JOIN categories c ON c.id = s.category_id
          WHERE g.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL
          ORDER BY s.name
        `,
      )
      .all() as AgentSnapshotGoal[],
    deletedRows: softDeletedRowCounts(db),
  };
}

function findSeedItem<T extends { name: string }>(items: T[], name: string): T {
  const item = items.find(
    (candidate) => normalizeAgentText(candidate.name) === normalizeAgentText(name),
  );
  if (!item) throw new Error(`Seed item "${name}" was not created`);
  return item;
}

export function seedAgentScenario(
  services: AgentEvalServices,
  seed?: AgentEvalSeed,
): void {
  const accounts = new Map<string, Account>();
  const subcategories = new Map<string, Subcategory>();

  for (const account of seed?.accounts ?? []) {
    accounts.set(account.name, services.createAccount(account));
  }

  for (const categorySeed of seed?.categories ?? []) {
    const category = services.createCategory({
      name: categorySeed.name,
      type: categorySeed.type,
    });
    for (const subcategorySeed of categorySeed.subcategories) {
      const subcategory = services.createSubcategory({
        name: subcategorySeed.name,
        category_id: category.id,
        monthly_goal: subcategorySeed.monthly_goal ?? null,
      });
      subcategories.set(subcategory.name, subcategory);
    }
  }

  for (const transaction of seed?.transactions ?? []) {
    services.createTransaction({
      account_id: findSeedItem([...accounts.values()], transaction.account).id,
      date: transaction.date,
      name: transaction.name,
      amount: transaction.amount,
      subcategory_id: transaction.subcategory
        ? findSeedItem([...subcategories.values()], transaction.subcategory).id
        : null,
      comment: transaction.comment ?? null,
    });
  }

  for (const goal of seed?.goals ?? []) {
    services.createSpendingGoal({
      subcategory_id: findSeedItem([...subcategories.values()], goal.subcategory).id,
      amount: goal.amount,
      period: goal.period,
      start_date: goal.start_date,
      end_date: goal.end_date ?? null,
    });
  }
}

export function assertAllowedChatStreamEvents(
  events: readonly ChatStreamEvent[],
): AgentEvalAssertionResult {
  const allowed = new Set<ChatStreamEvent["type"]>([
    "started",
    "thinking",
    "actions_planned",
    "action_started",
    "action_finished",
    "final",
    "error",
  ]);
  const invalid = events
    .map((event) => event.type)
    .filter((type) => !allowed.has(type));
  return invalid.length === 0
    ? pass("chat stream uses only retained events")
    : fail(
        "chat stream uses only retained events",
        `invalid events: ${invalid.join(", ")}`,
      );
}

export function assertOrderedChatStreamLifecycle(
  events: readonly ChatStreamEvent[],
): AgentEvalAssertionResult {
  const phases: readonly (readonly ChatStreamEvent["type"][])[] = [
    ["started"],
    ["thinking"],
    ["actions_planned", "action_started"],
    ["action_finished"],
    ["final"],
  ];
  let previous = -1;
  for (const phase of phases) {
    const positions = phase
      .map((type) => events.findIndex((event) => event.type === type))
      .filter((index) => index !== -1);
    if (positions.length === 0) continue;
    const first = Math.min(...positions);
    if (first < previous) {
      return fail(
        "chat stream lifecycle order",
        `${phase.join(" or ")} appeared before the previous lifecycle event`,
      );
    }
    previous = Math.max(...positions);
  }
  return pass("chat stream lifecycle order");
}
