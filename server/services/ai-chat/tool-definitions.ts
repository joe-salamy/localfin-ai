import { z } from "zod";
import {
  accountTypeSchema,
  categoryTypeSchema,
  goalPeriodSchema,
  tagTypeSchema,
  transactionKindSchema,
  type PlannedChatAction,
  type ChatActionResult,
} from "../../../shared/contracts/index.js";
import { hexColorSchema, isIsoDate } from "../../../shared/validation.js";

const trimmedString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const positiveNumber = finiteNumber.positive();
const nonnegativeNumber = finiteNumber.nonnegative();
const isoDate = trimmedString.refine(isIsoDate, "Expected date in YYYY-MM-DD format");
const nullableComment = z.string().trim().nullable().optional();
const optionalTagIds = z.array(trimmedString).max(50).optional();
const tagObjectSchema = z.strictObject({
  name: trimmedString,
  type: tagTypeSchema.optional(),
});
const optionalTags = z.array(tagObjectSchema).max(50).optional();
const optionalColor = hexColorSchema.nullable().optional();

const calculateSchema = z.strictObject({
  expression: trimmedString.describe("A pure arithmetic expression."),
});
const createAccountSchema = z.strictObject({
  name: trimmedString,
  type: accountTypeSchema,
  initial_balance: finiteNumber.optional(),
});
const updateAccountSchema = z.strictObject({
  id: trimmedString.optional(),
  current_name: trimmedString.optional(),
  name: trimmedString.optional(),
  type: accountTypeSchema.optional(),
  initial_balance: finiteNumber.optional(),
});
const createCategorySchema = z.strictObject({
  name: trimmedString,
  type: categoryTypeSchema,
});
const updateCategorySchema = z.strictObject({
  id: trimmedString.optional(),
  current_name: trimmedString.optional(),
  name: trimmedString.optional(),
  type: categoryTypeSchema.optional(),
});
const createSubcategorySchema = z.strictObject({
  name: trimmedString,
  category_id: trimmedString.optional(),
  category_name: trimmedString.optional(),
  monthly_goal: nonnegativeNumber.nullable().optional(),
});
const updateSubcategorySchema = z.strictObject({
  id: trimmedString.optional(),
  current_name: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  name: trimmedString.optional(),
  category_id: trimmedString.optional(),
  category_name: trimmedString.optional(),
  monthly_goal: nonnegativeNumber.nullable().optional(),
});
const createTagSchema = z.strictObject({
  name: trimmedString,
  type: tagTypeSchema.optional(),
  color: optionalColor,
});
const updateTagSchema = z.strictObject({
  id: trimmedString.optional(),
  current_name: trimmedString.optional(),
  name: trimmedString.optional(),
  type: tagTypeSchema.optional(),
  color: optionalColor,
});
const createTransactionSchema = z.strictObject({
  account_id: trimmedString.optional(),
  account_name: trimmedString.optional(),
  date: isoDate,
  name: trimmedString,
  amount: finiteNumber,
  kind: transactionKindSchema.optional(),
  subcategory_id: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  comment: nullableComment,
  tag_ids: optionalTagIds,
  tag_names: z.array(trimmedString).max(50).optional(),
  tags: optionalTags,
});
const transactionSearchSchema = z.strictObject({
  searchQuery: trimmedString,
  account_id: trimmedString.optional(),
  account_name: trimmedString.optional(),
  kind: transactionKindSchema.optional(),
  needsCategory: z.boolean().optional(),
  subcategory_id: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  tag_id: trimmedString.optional(),
  tag_name: trimmedString.optional(),
  tag_ids: optionalTagIds,
  tag_names: z.array(trimmedString).max(50).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  limit: z.number().finite().int().positive().optional(),
});
const updateTransactionSchema = z.strictObject({
  id: trimmedString,
  date: isoDate.optional(),
  name: trimmedString.optional(),
  amount: finiteNumber.optional(),
  kind: transactionKindSchema.optional(),
  subcategory_id: trimmedString.nullable().optional(),
  subcategory_name: trimmedString.optional(),
  comment: nullableComment,
  tag_ids: optionalTagIds,
  tag_names: z.array(trimmedString).max(50).optional(),
  tags: optionalTags,
  add_tag_ids: optionalTagIds,
  add_tag_names: z.array(trimmedString).max(50).optional(),
  remove_tag_ids: optionalTagIds,
  remove_tag_names: z.array(trimmedString).max(50).optional(),
});
const bulkUpdateTransactionSchema = z.strictObject({
  searchQuery: trimmedString,
  account_id: trimmedString.optional(),
  account_name: trimmedString.optional(),
  kind: transactionKindSchema.optional(),
  needsCategory: z.boolean().optional(),
  subcategory_id: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  tag_id: trimmedString.optional(),
  tag_name: trimmedString.optional(),
  tag_ids: optionalTagIds,
  tag_names: z.array(trimmedString).max(50).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  limit: z.number().finite().int().positive().optional(),
  updates: z.strictObject({
    kind: transactionKindSchema.optional(),
    subcategory_id: trimmedString.nullable().optional(),
    subcategory_name: trimmedString.optional(),
    comment: nullableComment,
    add_tag_ids: optionalTagIds,
    add_tag_names: z.array(trimmedString).max(50).optional(),
    remove_tag_ids: optionalTagIds,
    remove_tag_names: z.array(trimmedString).max(50).optional(),
  }),
});
const createGoalSchema = z.strictObject({
  subcategory_id: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  amount: positiveNumber,
  period: goalPeriodSchema,
  start_date: isoDate,
  end_date: isoDate.nullable().optional(),
});
const updateGoalSchema = z.strictObject({
  id: trimmedString.optional(),
  subcategory_id: trimmedString.optional(),
  subcategory_name: trimmedString.optional(),
  amount: positiveNumber.optional(),
  period: goalPeriodSchema.optional(),
  start_date: isoDate.optional(),
  end_date: isoDate.nullable().optional(),
});

export const financeToolDefinitions = {
  calculate: {
    description:
      "Evaluate a pure arithmetic expression. Supports + - * / % ^ parentheses and scientific numbers. No variables or functions.",
    schema: calculateSchema,
  },
  create_account: {
    description: "Create a finance account.",
    schema: createAccountSchema,
  },
  update_account: {
    description: "Update an existing account by id or current_name.",
    schema: updateAccountSchema,
  },
  create_category: {
    description: "Create an income or expense category.",
    schema: createCategorySchema,
  },
  update_category: {
    description: "Update a category by id or current_name.",
    schema: updateCategorySchema,
  },
  create_subcategory: {
    description: "Create a subcategory under a category.",
    schema: createSubcategorySchema,
  },
  update_subcategory: {
    description: "Update a subcategory by id or current_name.",
    schema: updateSubcategorySchema,
  },
  create_tag: {
    description: "Create a tag only when the user explicitly asks for one.",
    schema: createTagSchema,
  },
  update_tag: {
    description: "Update a tag by id or current_name.",
    schema: updateTagSchema,
  },
  create_transaction: {
    description:
      "Create a transaction. Amounts are account-balance deltas; kind is income|expense|transfer|adjustment.",
    schema: createTransactionSchema,
  },
  search_transactions: {
    description:
      "Search transactions before updating when the user describes matches instead of giving an id. searchQuery supports quoted phrases, AND/OR/NOT, and fields like name:, account:, amount>20, date>=YYYY-MM-DD.",
    schema: transactionSearchSchema,
  },
  update_transaction: {
    description: "Update one transaction by id. Search first when the id is unknown.",
    schema: updateTransactionSchema,
  },
  bulk_update_transactions: {
    description: "Update all transactions matching a search in one step.",
    schema: bulkUpdateTransactionSchema,
  },
  create_goal: {
    description: "Create a spending goal for a subcategory.",
    schema: createGoalSchema,
  },
  update_goal: {
    description: "Update a spending goal by id or subcategory.",
    schema: updateGoalSchema,
  },
} as const;

export type FinanceToolName = keyof typeof financeToolDefinitions;
export type FinanceToolDefinition =
  (typeof financeToolDefinitions)[FinanceToolName];
export type FinanceActionFor<Name extends FinanceToolName> = {
  type: Name;
  input: z.output<(typeof financeToolDefinitions)[Name]["schema"]>;
};
export type FinanceAction = {
  [Name in FinanceToolName]: FinanceActionFor<Name>;
}[FinanceToolName];

export function parseFinanceAction(action: PlannedChatAction): FinanceAction {
  const definition =
    financeToolDefinitions[action.type as FinanceToolName] as
      | FinanceToolDefinition
      | undefined;
  if (!definition) {
    throw new Error(`Unsupported action "${action.type}"`);
  }

  const parsed = definition.schema.safeParse(action.input);
  if (!parsed.success) {
    throw new Error(
      `Invalid ${action.type} input: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  return {
    type: action.type as FinanceToolName,
    input: parsed.data,
  } as FinanceAction;
}

export type FinanceToolResult = ChatActionResult;
