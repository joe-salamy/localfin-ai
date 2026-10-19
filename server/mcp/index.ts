#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { OperationalError, publicErrorMessage } from "../errors.js";
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
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
} from "../services/dashboard.js";
import { parseStatement } from "../services/parser.js";
import { SEARCH_QUERY_HELP } from "../services/transaction-search.js";
import { MAX_REPORT_SPAN_DAYS, isWithinReportSpan } from "../../shared/validation.js";
import {
  accountInput,
  bulkTransactionIds,
  bulkTransactionUpdateFields,
  categoryInput,
  idWithUpdate,
  nonEmptyUpdate,
  parseStatementInput,
  subcategoryInput,
  tagInput,
  transactionInput,
  transactionUpdateInput,
} from "../input-schemas.js";
import { isoDateString as isoDate, nonEmptyString } from "../routes/validation.js";

function handleResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function handleError(error: unknown) {
  if (error instanceof OperationalError) return err(error.message);
  if (error instanceof z.ZodError) return err(error.issues.map((i) => i.message).join("; "));
  return err(publicErrorMessage(error));
}
function err(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
function defineTool<T>(name: string, meta: { title: string; description: string }, schema: z.ZodType<T>, fn: (input: T) => unknown) {
  server.registerTool(name, { ...meta, inputSchema: schema }, async (input) => {
    try {
      return handleResult(await fn(schema.parse(input)));
    } catch (error) {
      return handleError(error);
    }
  });
}

const server = new McpServer({ name: "localfin", version: "0.1.0" });

// Accounts
export const localfinListAccountsInputSchema = z.object({}).strict();
defineTool("localfin_list_accounts", { title: "List accounts", description: "List all accounts with current balances" }, localfinListAccountsInputSchema, () => getAccountsWithBalances());

export const localfinCreateAccountInputSchema = accountInput.strict();
defineTool("localfin_create_account", { title: "Create account", description: "Create a new finance account" }, localfinCreateAccountInputSchema, (input) => createAccount(input));

export const localfinUpdateAccountInputSchema = idWithUpdate(accountInput.partial().shape);
defineTool("localfin_update_account", { title: "Update account", description: "Update an existing account" }, localfinUpdateAccountInputSchema, (input) => {
  const { id, ...updates } = input;
  return updateAccount(id, updates);
});

// Categories / Subcategories
export const localfinListCategoriesInputSchema = z.object({}).strict();
defineTool("localfin_list_categories", { title: "List categories", description: "List all categories" }, localfinListCategoriesInputSchema, () => getCategories());

export const localfinListSubcategoriesInputSchema = z.object({}).strict();
defineTool("localfin_list_subcategories", { title: "List subcategories", description: "List all subcategories" }, localfinListSubcategoriesInputSchema, () => getSubcategories());

export const localfinCreateCategoryInputSchema = categoryInput.strict();
defineTool("localfin_create_category", { title: "Create category", description: "Create a category" }, localfinCreateCategoryInputSchema, (input) => createCategory(input));

export const localfinUpdateCategoryInputSchema = idWithUpdate(categoryInput.partial().shape);
defineTool("localfin_update_category", { title: "Update category", description: "Update a category" }, localfinUpdateCategoryInputSchema, (input) => {
  const { id, ...updates } = input;
  return updateCategory(id, updates);
});

export const localfinCreateSubcategoryInputSchema = subcategoryInput.strict();
defineTool("localfin_create_subcategory", { title: "Create subcategory", description: "Create a subcategory under a category" }, localfinCreateSubcategoryInputSchema, (input) => createSubcategory(input));

export const localfinUpdateSubcategoryInputSchema = idWithUpdate(subcategoryInput.partial().shape);
defineTool("localfin_update_subcategory", { title: "Update subcategory", description: "Update a subcategory" }, localfinUpdateSubcategoryInputSchema, (input) => {
  const { id, ...updates } = input;
  return updateSubcategory(id, updates);
});

// Tags
export const localfinListTagsInputSchema = z.object({}).strict();
defineTool("localfin_list_tags", { title: "List tags", description: "List all tags" }, localfinListTagsInputSchema, () => getTags());

export const localfinCreateTagInputSchema = tagInput.strict();
defineTool("localfin_create_tag", { title: "Create tag", description: "Create a new tag" }, localfinCreateTagInputSchema, (input) => createTag(input));

export const localfinUpdateTagInputSchema = idWithUpdate(tagInput.partial().shape);
defineTool("localfin_update_tag", { title: "Update tag", description: "Update a tag" }, localfinUpdateTagInputSchema, (input) => {
  const { id, ...updates } = input;
  return updateTag(id, updates);
});

// Transactions
export const localfinSearchTransactionsInputSchema = z
  .object({
    searchQuery: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
    accountId: nonEmptyString.optional(),
  })
  .strict();
defineTool("localfin_search_transactions", { title: "Search transactions", description: `Search transactions. ${SEARCH_QUERY_HELP}` }, localfinSearchTransactionsInputSchema, (input) => getTransactionsWithDetails({
    searchQuery: input.searchQuery?.trim() ? input.searchQuery : undefined,
    limit: input.limit ?? 500,
    offset: input.offset,
    accountId: input.accountId,
  }));

export const localfinCreateTransactionInputSchema = transactionInput.strict();
defineTool("localfin_create_transaction", { title: "Create transaction", description: "Create a single transaction" }, localfinCreateTransactionInputSchema, (input) => createTransaction(input));

export const localfinBulkCreateTransactionsInputSchema = z
  .object({ transactions: z.array(transactionInput).min(1).max(500) })
  .strict();
defineTool("localfin_bulk_create_transactions", { title: "Bulk create transactions", description: "Bulk create up to 500 transactions" }, localfinBulkCreateTransactionsInputSchema, (input) => bulkCreateTransactions(input.transactions));

export const localfinUpdateTransactionInputSchema = idWithUpdate(transactionUpdateInput.shape);
defineTool("localfin_update_transaction", { title: "Update transaction", description: "Update a transaction by id" }, localfinUpdateTransactionInputSchema, (input) => {
  const { id, ...updates } = input;
  return updateTransaction(id, updates);
});

export const localfinBulkUpdateTransactionsInputSchema = z
  .object({
    ids: bulkTransactionIds,
    updates: nonEmptyUpdate(bulkTransactionUpdateFields.shape),
  })
  .strict();
defineTool("localfin_bulk_update_transactions", { title: "Bulk update transactions", description: "Bulk update transactions by ids" }, localfinBulkUpdateTransactionsInputSchema, (input) => {
  const updatedIds = bulkUpdateTransactions(input.ids, input.updates);
  return { success: true, updatedIds };
});

export const localfinDeleteTransactionInputSchema = z.object({ id: nonEmptyString }).strict();
defineTool("localfin_delete_transaction", { title: "Delete transaction", description: "Soft-delete a transaction" }, localfinDeleteTransactionInputSchema, (input) => {
  deleteTransaction(input.id);
  return { success: true };
});

export const localfinRestoreTransactionInputSchema = z.object({ id: nonEmptyString }).strict();
defineTool("localfin_restore_transaction", { title: "Restore transaction", description: "Restore a soft-deleted transaction" }, localfinRestoreTransactionInputSchema, (input) => restoreTransaction(input.id));

// Dashboard
export const localfinDashboardInputSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    tagIds: z.array(nonEmptyString).optional(),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, "startDate must be on or before endDate")
  .refine(
    (v) => isWithinReportSpan(v.startDate, v.endDate),
    `Date range must not exceed ${MAX_REPORT_SPAN_DAYS} days`,
  );
defineTool("localfin_dashboard", { title: "Dashboard", description: "Get dashboard metrics/account summary/category summary for a date range" }, localfinDashboardInputSchema, (input) => {
  const metrics = getDashboardMetrics(input.startDate, input.endDate, input.tagIds);
  const accountSummary = getAccountSummary(input.startDate, input.endDate);
  const categorySummary = getCategorySummary(input.startDate, input.endDate, input.tagIds);
  return { metrics, accountSummary, categorySummary };
});

// Parser
export const localfinParseStatementInputSchema = parseStatementInput.strict();
defineTool("localfin_parse_statement", { title: "Parse statement", description: "Parse bank CSV text into transactions (deterministic, no AI categorization; format reports chase|usbank|discover|fidelity). Rows are signed for the account and uncategorized; apply exact lookup then the OMP categorization skill afterwards." }, localfinParseStatementInputSchema, (input) => parseStatement(input.text, input.accountId));

async function main(): Promise<void> {
  // Open (and migrate) the DB before accepting requests. stdout carries the
  // JSON-RPC stream, so all diagnostics go to stderr.
  getDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { server };

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("server/mcp/index.ts") ||
    process.argv[1].endsWith("mcp/index.ts"));

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server failed to start", error);
    process.exit(1);
  });
}
