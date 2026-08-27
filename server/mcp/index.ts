#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { OperationalError } from "../errors.js";
import {
  createAccount,
  getAccountsWithBalances,
  updateAccount,
} from "../services/accounts.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from "../services/categories.js";
import { createTag, getTags, updateTag } from "../services/tags.js";
import {
  bulkCreateTransactions,
  bulkUpdateTransactions,
  createTransaction,
  deleteTransaction,
  getTransactionsWithDetails,
  restoreTransaction,
  updateTransaction,
} from "../services/transactions.js";
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  updateSpendingGoal,
} from "../services/goals.js";
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
} from "../services/dashboard.js";
import { parseStatement } from "../services/parser.js";
import { accountTypeSchema } from "../../shared/contracts/accounts.js";
import { categoryTypeSchema } from "../../shared/contracts/categories.js";
import { tagTypeSchema } from "../../shared/contracts/tags.js";
import { transactionKindSchema } from "../../shared/contracts/transactions.js";
import { goalPeriodSchema } from "../../shared/contracts/goals.js";
import { hexColorSchema, isIsoDate } from "../../shared/validation.js";

// Ensure DB initialized
getDb();

const isoDate = z.string().refine(isIsoDate, "Expected date in YYYY-MM-DD format");
const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const colorSchema = hexColorSchema.nullable().optional();

function handleResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function handleError(error: unknown) {
  const message =
    error instanceof OperationalError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new McpServer({ name: "localfin", version: "0.1.0" });

// Accounts
server.registerTool(
  "localfin_list_accounts",
  {
    title: "List accounts",
    description: "List all accounts with current balances",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      const result = getAccountsWithBalances();
      return handleResult(result);
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_account",
  {
    title: "Create account",
    description: "Create a new finance account",
    inputSchema: z
      .object({
        name: nonEmptyString,
        type: accountTypeSchema,
        initial_balance: finiteNumber.optional(),
        color: colorSchema,
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          name: nonEmptyString,
          type: accountTypeSchema,
          initial_balance: finiteNumber.optional(),
          color: colorSchema,
        })
        .strict()
        .parse(input);
      const result = createAccount(parsed);
      return handleResult(result);
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_account",
  {
    title: "Update account",
    description: "Update an existing account",
    inputSchema: z
      .object({
        id: nonEmptyString,
        name: nonEmptyString.optional(),
        type: accountTypeSchema.optional(),
        initial_balance: finiteNumber.optional(),
        color: hexColorSchema.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          name: nonEmptyString.optional(),
          type: accountTypeSchema.optional(),
          initial_balance: finiteNumber.optional(),
          color: hexColorSchema.nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      const result = updateAccount(id, updates);
      return handleResult(result);
    } catch (error) {
      return handleError(error);
    }
  },
);

// Categories / Subcategories
server.registerTool(
  "localfin_list_categories",
  {
    title: "List categories",
    description: "List all categories",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      return handleResult(getCategories());
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_list_subcategories",
  {
    title: "List subcategories",
    description: "List all subcategories",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      return handleResult(getSubcategories());
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_category",
  {
    title: "Create category",
    description: "Create a category",
    inputSchema: z
      .object({
        name: nonEmptyString,
        type: categoryTypeSchema,
        color: colorSchema,
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          name: nonEmptyString,
          type: categoryTypeSchema,
          color: colorSchema,
        })
        .strict()
        .parse(input);
      return handleResult(createCategory(parsed));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_category",
  {
    title: "Update category",
    description: "Update a category",
    inputSchema: z
      .object({
        id: nonEmptyString,
        name: nonEmptyString.optional(),
        type: categoryTypeSchema.optional(),
        color: hexColorSchema.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          name: nonEmptyString.optional(),
          type: categoryTypeSchema.optional(),
          color: hexColorSchema.nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      return handleResult(updateCategory(id, updates));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_subcategory",
  {
    title: "Create subcategory",
    description: "Create a subcategory under a category",
    inputSchema: z
      .object({
        name: nonEmptyString,
        category_id: nonEmptyString,
        monthly_goal: finiteNumber.nullable().optional(),
        color: colorSchema,
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          name: nonEmptyString,
          category_id: nonEmptyString,
          monthly_goal: finiteNumber.nullable().optional(),
          color: colorSchema,
        })
        .strict()
        .parse(input);
      return handleResult(createSubcategory(parsed));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_subcategory",
  {
    title: "Update subcategory",
    description: "Update a subcategory",
    inputSchema: z
      .object({
        id: nonEmptyString,
        name: nonEmptyString.optional(),
        category_id: nonEmptyString.optional(),
        monthly_goal: finiteNumber.nullable().optional(),
        color: hexColorSchema.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          name: nonEmptyString.optional(),
          category_id: nonEmptyString.optional(),
          monthly_goal: finiteNumber.nullable().optional(),
          color: hexColorSchema.nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      return handleResult(updateSubcategory(id, updates));
    } catch (error) {
      return handleError(error);
    }
  },
);

// Tags
server.registerTool(
  "localfin_list_tags",
  {
    title: "List tags",
    description: "List all tags",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      return handleResult(getTags());
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_tag",
  {
    title: "Create tag",
    description: "Create a new tag",
    inputSchema: z
      .object({
        name: nonEmptyString,
        type: tagTypeSchema.optional(),
        color: colorSchema,
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          name: nonEmptyString,
          type: tagTypeSchema.optional(),
          color: colorSchema,
        })
        .strict()
        .parse(input);
      return handleResult(createTag(parsed));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_tag",
  {
    title: "Update tag",
    description: "Update a tag",
    inputSchema: z
      .object({
        id: nonEmptyString,
        name: nonEmptyString.optional(),
        type: tagTypeSchema.optional(),
        color: hexColorSchema.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          name: nonEmptyString.optional(),
          type: tagTypeSchema.optional(),
          color: hexColorSchema.nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      return handleResult(updateTag(id, updates));
    } catch (error) {
      return handleError(error);
    }
  },
);

// Transactions
server.registerTool(
  "localfin_search_transactions",
  {
    title: "Search transactions",
    description:
      "Search transactions with rich query: quoted phrases, (parens), AND/OR/NOT, |, -term, fields name:/comment:/account:/category:/subcategory:/tag:/tags:, amount>20, date>=2026-01-01",
    inputSchema: z
      .object({
        searchQuery: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
        accountId: nonEmptyString.optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          searchQuery: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          offset: z.number().int().min(0).optional(),
          accountId: nonEmptyString.optional(),
        })
        .strict()
        .parse(input);
      const result = getTransactionsWithDetails({
        searchQuery: parsed.searchQuery?.trim() ? parsed.searchQuery : undefined,
        limit: parsed.limit ?? 500,
        offset: parsed.offset,
        accountId: parsed.accountId,
      });
      return handleResult(result);
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_transaction",
  {
    title: "Create transaction",
    description: "Create a single transaction",
    inputSchema: z
      .object({
        account_id: nonEmptyString,
        date: isoDate,
        name: nonEmptyString,
        amount: finiteNumber,
        kind: transactionKindSchema.optional(),
        subcategory_id: nonEmptyString.nullable().optional(),
        tag_ids: z.array(nonEmptyString).max(50).optional(),
        comment: z.string().nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          account_id: nonEmptyString,
          date: isoDate,
          name: nonEmptyString,
          amount: finiteNumber,
          kind: transactionKindSchema.optional(),
          subcategory_id: nonEmptyString.nullable().optional(),
          tag_ids: z.array(nonEmptyString).max(50).optional(),
          comment: z.string().nullable().optional(),
        })
        .strict()
        .parse(input);
      return handleResult(createTransaction(parsed));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_bulk_create_transactions",
  {
    title: "Bulk create transactions",
    description: "Bulk create up to 500 transactions",
    inputSchema: z
      .object({
        transactions: z
          .array(
            z.object({
              account_id: nonEmptyString,
              date: isoDate,
              name: nonEmptyString,
              amount: finiteNumber,
              kind: transactionKindSchema.optional(),
              subcategory_id: nonEmptyString.nullable().optional(),
              tag_ids: z.array(nonEmptyString).max(50).optional(),
              comment: z.string().nullable().optional(),
            }),
          )
          .min(1)
          .max(500),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          transactions: z
            .array(
              z.object({
                account_id: nonEmptyString,
                date: isoDate,
                name: nonEmptyString,
                amount: finiteNumber,
                kind: transactionKindSchema.optional(),
                subcategory_id: nonEmptyString.nullable().optional(),
                tag_ids: z.array(nonEmptyString).max(50).optional(),
                comment: z.string().nullable().optional(),
              }),
            )
            .min(1)
            .max(500),
        })
        .strict()
        .parse(input);
      return handleResult(bulkCreateTransactions(parsed.transactions));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_transaction",
  {
    title: "Update transaction",
    description: "Update a transaction by id",
    inputSchema: z
      .object({
        id: nonEmptyString,
        date: isoDate.optional(),
        name: nonEmptyString.optional(),
        amount: finiteNumber.optional(),
        kind: transactionKindSchema.optional(),
        subcategory_id: nonEmptyString.nullable().optional(),
        tag_ids: z.array(nonEmptyString).max(50).optional(),
        comment: z.string().nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          date: isoDate.optional(),
          name: nonEmptyString.optional(),
          amount: finiteNumber.optional(),
          kind: transactionKindSchema.optional(),
          subcategory_id: nonEmptyString.nullable().optional(),
          tag_ids: z.array(nonEmptyString).max(50).optional(),
          comment: z.string().nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      return handleResult(updateTransaction(id, updates));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_bulk_update_transactions",
  {
    title: "Bulk update transactions",
    description: "Bulk update transactions by ids",
    inputSchema: z
      .object({
        ids: z.array(nonEmptyString).min(1).max(500),
        updates: z
          .object({
            kind: transactionKindSchema.optional(),
            subcategory_id: nonEmptyString.nullable().optional(),
            add_tag_ids: z.array(nonEmptyString).max(50).optional(),
            remove_tag_ids: z.array(nonEmptyString).max(50).optional(),
          })
          .refine(
            (value) => Object.keys(value).length > 0,
            "At least one update field is required",
          ),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          ids: z.array(nonEmptyString).min(1).max(500),
          updates: z
            .object({
              kind: transactionKindSchema.optional(),
              subcategory_id: nonEmptyString.nullable().optional(),
              add_tag_ids: z.array(nonEmptyString).max(50).optional(),
              remove_tag_ids: z.array(nonEmptyString).max(50).optional(),
            })
            .refine(
              (value) => Object.keys(value).length > 0,
              "At least one update field is required",
            ),
        })
        .strict()
        .parse(input);
      bulkUpdateTransactions(parsed.ids, parsed.updates);
      return handleResult({ success: true, updatedIds: parsed.ids });
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_delete_transaction",
  {
    title: "Delete transaction",
    description: "Soft-delete a transaction",
    inputSchema: z.object({ id: nonEmptyString }).strict(),
  },
  async (input) => {
    try {
      const parsed = z.object({ id: nonEmptyString }).strict().parse(input);
      deleteTransaction(parsed.id);
      return handleResult({ success: true });
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_restore_transaction",
  {
    title: "Restore transaction",
    description: "Restore a soft-deleted transaction",
    inputSchema: z.object({ id: nonEmptyString }).strict(),
  },
  async (input) => {
    try {
      const parsed = z.object({ id: nonEmptyString }).strict().parse(input);
      return handleResult(restoreTransaction(parsed.id));
    } catch (error) {
      return handleError(error);
    }
  },
);

// Goals
server.registerTool(
  "localfin_list_goals",
  {
    title: "List goals",
    description: "List spending goals with details",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      return handleResult(getSpendingGoalsWithDetails());
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_create_goal",
  {
    title: "Create goal",
    description: "Create a spending goal",
    inputSchema: z
      .object({
        subcategory_id: nonEmptyString,
        amount: finiteNumber.positive(),
        period: goalPeriodSchema,
        start_date: isoDate,
        end_date: isoDate.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          subcategory_id: nonEmptyString,
          amount: finiteNumber.positive(),
          period: goalPeriodSchema,
          start_date: isoDate,
          end_date: isoDate.nullable().optional(),
        })
        .strict()
        .parse(input);
      return handleResult(createSpendingGoal(parsed));
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "localfin_update_goal",
  {
    title: "Update goal",
    description: "Update a spending goal",
    inputSchema: z
      .object({
        id: nonEmptyString,
        amount: finiteNumber.positive().optional(),
        period: goalPeriodSchema.optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.nullable().optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          id: nonEmptyString,
          amount: finiteNumber.positive().optional(),
          period: goalPeriodSchema.optional(),
          start_date: isoDate.optional(),
          end_date: isoDate.nullable().optional(),
        })
        .strict()
        .parse(input);
      const { id, ...updates } = parsed;
      return handleResult(updateSpendingGoal(id, updates));
    } catch (error) {
      return handleError(error);
    }
  },
);

// Dashboard
server.registerTool(
  "localfin_dashboard",
  {
    title: "Dashboard",
    description:
      "Get dashboard metrics/account summary/category summary for a date range",
    inputSchema: z
      .object({
        startDate: isoDate,
        endDate: isoDate,
        tagIds: z.array(nonEmptyString).optional(),
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          startDate: isoDate,
          endDate: isoDate,
          tagIds: z.array(nonEmptyString).optional(),
        })
        .strict()
        .parse(input);
      const metrics = getDashboardMetrics(
        parsed.startDate,
        parsed.endDate,
        parsed.tagIds,
      );
      const accountSummary = getAccountSummary(parsed.startDate, parsed.endDate);
      const categorySummary = getCategorySummary(
        parsed.startDate,
        parsed.endDate,
        parsed.tagIds,
      );
      return handleResult({ metrics, accountSummary, categorySummary });
    } catch (error) {
      return handleError(error);
    }
  },
);

// Parser
server.registerTool(
  "localfin_parse_statement",
  {
    title: "Parse statement",
    description:
      "Parse raw statement text into transactions (deterministic, no AI categorization). Returns EnrichedTransaction[] with subcategory_id null unless exact name lookup matched.",
    inputSchema: z
      .object({
        text: nonEmptyString,
        accountId: nonEmptyString,
      })
      .strict(),
  },
  async (input) => {
    try {
      const parsed = z
        .object({
          text: nonEmptyString,
          accountId: nonEmptyString,
        })
        .strict()
        .parse(input);
      const result = await parseStatement(parsed.text, parsed.accountId);
      return handleResult(result);
    } catch (error) {
      return handleError(error);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { server };

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("server/mcp/index.ts") ||
    process.argv[1].endsWith("server/mcp/index.js") ||
    process.argv[1].endsWith("mcp/index.ts"));

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server failed to start", error);
    process.exit(1);
  });
}
