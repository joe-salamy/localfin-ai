import { tool } from "langchain";
import { z } from "zod";
import type { AIAction, ChatStreamEmitter, ExecutedAction } from "./types.js";
import { executeAction } from "./action-executor.js";

const accountTypeSchema = z.enum(["asset", "liability"]);
const categoryTypeSchema = z.enum(["income", "expense"]);
const transactionKindSchema = z.enum([
  "income",
  "expense",
  "transfer",
  "adjustment",
]);
const goalPeriodSchema = z.enum(["weekly", "monthly", "quarterly", "annual"]);
const tagTypeSchema = z.enum([
  "custom",
  "trip",
  "event",
  "person",
  "reimbursable",
  "tax",
]);

const tagObjectSchema = z.object({
  name: z.string(),
  type: tagTypeSchema.optional(),
});

export interface AssistantToolRuntime {
  actions: ExecutedAction[];
  emit?: ChatStreamEmitter;
}

function createSerialQueue() {
  let chain: Promise<void> = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function defineFinanceTool(options: {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  runtime: AssistantToolRuntime;
  enqueue: <R>(work: () => Promise<R> | R) => Promise<R>;
}) {
  return tool(
    async (rawInput: unknown) =>
      options.enqueue(async () => {
        const action: AIAction = {
          type: options.name,
          input:
            rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
              ? (rawInput as Record<string, unknown>)
              : {},
        };
        const index = options.runtime.actions.length;
        await options.runtime.emit?.({
          type: "action_started",
          index,
          action,
        });
        const executed = executeAction(action);
        options.runtime.actions.push(executed);
        await options.runtime.emit?.({
          type: "action_finished",
          index,
          action: executed,
        });
        if (executed.status === "error") {
          return JSON.stringify({
            ok: false,
            error: executed.error ?? "Tool failed",
          });
        }
        return JSON.stringify({ ok: true, result: executed.result ?? null });
      }),
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
    },
  );
}

export function createAssistantTools(runtime: AssistantToolRuntime) {
  const enqueue = createSerialQueue();
  const define = (
    name: string,
    description: string,
    schema: z.ZodTypeAny,
  ) => defineFinanceTool({ name, description, schema, runtime, enqueue });

  return [
    define(
      "calculate",
      "Evaluate a pure arithmetic expression. Supports + - * / % ^ parentheses and scientific numbers. No variables or functions.",
      z.object({ expression: z.string() }),
    ),
    define(
      "create_account",
      "Create a finance account.",
      z.object({
        name: z.string(),
        type: accountTypeSchema,
        initial_balance: z.number().optional(),
      }),
    ),
    define(
      "update_account",
      "Update an existing account by id or current_name.",
      z.object({
        id: z.string().optional(),
        current_name: z.string().optional(),
        name: z.string().optional(),
        type: accountTypeSchema.optional(),
        initial_balance: z.number().optional(),
      }),
    ),
    define(
      "create_category",
      "Create an income or expense category.",
      z.object({
        name: z.string(),
        type: categoryTypeSchema,
      }),
    ),
    define(
      "update_category",
      "Update a category by id or current_name.",
      z.object({
        id: z.string().optional(),
        current_name: z.string().optional(),
        name: z.string().optional(),
        type: categoryTypeSchema.optional(),
      }),
    ),
    define(
      "create_subcategory",
      "Create a subcategory under a category.",
      z.object({
        name: z.string(),
        category_id: z.string().optional(),
        category_name: z.string().optional(),
        monthly_goal: z.number().nullable().optional(),
      }),
    ),
    define(
      "update_subcategory",
      "Update a subcategory by id or current_name.",
      z.object({
        id: z.string().optional(),
        current_name: z.string().optional(),
        subcategory_name: z.string().optional(),
        name: z.string().optional(),
        category_id: z.string().optional(),
        category_name: z.string().optional(),
        monthly_goal: z.number().nullable().optional(),
      }),
    ),
    define(
      "create_tag",
      "Create a tag. Only when the user explicitly asks for a tag.",
      z.object({
        name: z.string(),
        type: tagTypeSchema.optional(),
        color: z.string().nullable().optional(),
      }),
    ),
    define(
      "update_tag",
      "Update a tag by id or current_name.",
      z.object({
        id: z.string().optional(),
        current_name: z.string().optional(),
        name: z.string().optional(),
        type: tagTypeSchema.optional(),
        color: z.string().nullable().optional(),
      }),
    ),
    define(
      "create_transaction",
      "Create a transaction. Amounts are account-balance deltas; kind is income|expense|transfer|adjustment.",
      z.object({
        account_id: z.string().optional(),
        account_name: z.string().optional(),
        date: z.string(),
        name: z.string(),
        amount: z.number(),
        kind: transactionKindSchema.optional(),
        subcategory_id: z.string().optional(),
        subcategory_name: z.string().optional(),
        comment: z.string().nullable().optional(),
        tag_ids: z.array(z.string()).optional(),
        tag_names: z.array(z.string()).optional(),
        tags: z.array(tagObjectSchema).optional(),
      }),
    ),
    define(
      "search_transactions",
      "Search transactions before updating when the user describes matches instead of giving an id. searchQuery supports quoted phrases, AND/OR/NOT, and fields like name:, account:, amount>20, date>=YYYY-MM-DD.",
      z.object({
        searchQuery: z.string(),
        account_id: z.string().optional(),
        account_name: z.string().optional(),
        kind: transactionKindSchema.optional(),
        needsCategory: z.boolean().optional(),
        subcategory_id: z.string().optional(),
        subcategory_name: z.string().optional(),
        tag_id: z.string().optional(),
        tag_name: z.string().optional(),
        tag_ids: z.array(z.string()).optional(),
        tag_names: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
    ),
    define(
      "update_transaction",
      "Update one transaction by id. Search first when the id is unknown.",
      z.object({
        id: z.string(),
        date: z.string().optional(),
        name: z.string().optional(),
        amount: z.number().optional(),
        kind: transactionKindSchema.optional(),
        subcategory_id: z.string().nullable().optional(),
        subcategory_name: z.string().optional(),
        comment: z.string().nullable().optional(),
        tag_ids: z.array(z.string()).optional(),
        tag_names: z.array(z.string()).optional(),
        tags: z.array(tagObjectSchema).optional(),
        add_tag_ids: z.array(z.string()).optional(),
        add_tag_names: z.array(z.string()).optional(),
        remove_tag_ids: z.array(z.string()).optional(),
        remove_tag_names: z.array(z.string()).optional(),
      }),
    ),
    define(
      "bulk_update_transactions",
      "Update all transactions matching a search in one step.",
      z.object({
        searchQuery: z.string(),
        account_id: z.string().optional(),
        account_name: z.string().optional(),
        kind: transactionKindSchema.optional(),
        needsCategory: z.boolean().optional(),
        subcategory_id: z.string().optional(),
        subcategory_name: z.string().optional(),
        tag_id: z.string().optional(),
        tag_name: z.string().optional(),
        tag_ids: z.array(z.string()).optional(),
        tag_names: z.array(z.string()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().int().positive().optional(),
        updates: z
          .object({
            kind: transactionKindSchema.optional(),
            subcategory_id: z.string().nullable().optional(),
            subcategory_name: z.string().optional(),
            comment: z.string().nullable().optional(),
            add_tag_ids: z.array(z.string()).optional(),
            add_tag_names: z.array(z.string()).optional(),
            remove_tag_ids: z.array(z.string()).optional(),
            remove_tag_names: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    ),
    define(
      "create_goal",
      "Create a spending goal for a subcategory.",
      z.object({
        subcategory_id: z.string().optional(),
        subcategory_name: z.string().optional(),
        amount: z.number(),
        period: goalPeriodSchema,
        start_date: z.string(),
        end_date: z.string().nullable().optional(),
      }),
    ),
    define(
      "update_goal",
      "Update a spending goal by id or subcategory.",
      z.object({
        id: z.string().optional(),
        subcategory_id: z.string().optional(),
        subcategory_name: z.string().optional(),
        amount: z.number().optional(),
        period: goalPeriodSchema.optional(),
        start_date: z.string().optional(),
        end_date: z.string().nullable().optional(),
      }),
    ),
  ];
}
