// Request schemas shared by the REST routes and the MCP tools, so both entry
// points accept exactly the same inputs.
import { z } from "zod";
import { accountTypeSchema } from "../shared/contracts/accounts.js";
import { categoryTypeSchema } from "../shared/contracts/categories.js";
import { tagTypeSchema } from "../shared/contracts/tags.js";
import { transactionKindSchema } from "../shared/contracts/transactions.js";
import {
  colorSchemaOptional,
  finiteNumber,
  isoDateString,
  nonEmptyString,
  optionalQueryStringArray,
} from "./routes/validation.js";

export const accountInput = z.object({
  name: nonEmptyString,
  type: accountTypeSchema,
  initial_balance: finiteNumber.optional(),
  color: colorSchemaOptional,
});

export const reconcileAccountInput = z.object({
  date: isoDateString,
  target_balance: finiteNumber,
  name: nonEmptyString.optional(),
});

export const categoryInput = z.object({
  name: nonEmptyString,
  type: categoryTypeSchema,
  color: colorSchemaOptional,
});

export const subcategoryInput = z.object({
  name: nonEmptyString,
  category_id: nonEmptyString,
  monthly_goal: finiteNumber.nonnegative().nullable().optional(),
  color: colorSchemaOptional,
});

export const tagInput = z.object({
  name: nonEmptyString,
  type: tagTypeSchema.optional(),
  color: colorSchemaOptional,
});

const tagIds = z.array(nonEmptyString).max(50);

export const transactionInput = z.object({
  account_id: nonEmptyString,
  date: isoDateString,
  name: nonEmptyString,
  amount: finiteNumber,
  kind: transactionKindSchema.optional(),
  subcategory_id: nonEmptyString.nullable().optional(),
  tag_ids: tagIds.optional(),
  comment: z.string().nullable().optional(),
  ai_suggested: z.boolean().optional(),
});

/** Fields editable on an existing transaction (the account is fixed). */
export const transactionUpdateInput = transactionInput.omit({ account_id: true }).partial();

export const bulkTransactionIds = z.array(nonEmptyString).min(1).max(500);

export const bulkTransactionUpdateFields = z.object({
  kind: transactionKindSchema.optional(),
  subcategory_id: nonEmptyString.nullable().optional(),
  add_tag_ids: tagIds.optional(),
  remove_tag_ids: tagIds.optional(),
  ai_suggested: z.boolean().optional(),
});

export const parseStatementInput = z.object({
  text: nonEmptyString.max(500_000),
  accountId: nonEmptyString,
});

const optionalQueryBoolean = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean().optional());

export const transactionFiltersInput = z.object({
  accountId: nonEmptyString.optional(),
  accountIds: optionalQueryStringArray,
  categoryIds: optionalQueryStringArray,
  subcategoryId: nonEmptyString.optional(),
  subcategoryIds: optionalQueryStringArray,
  tagIds: optionalQueryStringArray,
  kind: transactionKindSchema.optional(),
  needsCategory: optionalQueryBoolean,
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/** Update body: every field optional, but at least one must be present. */
export function nonEmptyUpdate<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .refine((v) => Object.keys(v).length > 0, "At least one update field is required");
}

/** MCP update tool: `{id, ...fields}` with at least one field besides the id. */
export function idWithUpdate<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ id: nonEmptyString, ...shape })
    .strict()
    .refine((v) => Object.keys(v).length > 1, "At least one update field is required");
}
