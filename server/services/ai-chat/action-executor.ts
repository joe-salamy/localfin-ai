import {
  createAccount,
  getAccounts,
  updateAccount,
} from "../accounts.js";
import {
  createCategory,
  createSubcategory,
  getCategories,
  getSubcategories,
  updateCategory,
  updateSubcategory,
} from "../categories.js";
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  updateSpendingGoal,
} from "../goals.js";
import {
  bulkUpdateTransactions,
  createTransaction,
  getTransactionById,
  getTransactionsWithDetails,
  updateTransaction,
} from "../transactions.js";
import {
  createTag,
  getTags,
  resolveOrCreateTagsByName,
  updateTag,
} from "../tags.js";
import { getDb } from "../../db/index.js";
import { calculateExpression } from "./calculator.js";
import type {
  ChatActionResult,
  CreateTransactionData,
  PlannedChatAction,
  Tag,
  TagType,
} from "../../../shared/contracts/index.js";
import {
  DEFAULT_BULK_TRANSACTION_LIMIT,
  MAX_BULK_TRANSACTION_LIMIT,
} from "./constants.js";
import {
  findByName,
  resolveGoal,
  resolveRequestedAccount,
  resolveRequestedCategory,
  resolveRequestedSubcategory,
  resolveRequestedTag,
  resolveSubcategory,
  resolveTag,
  subcategoriesForKind,
} from "./entity-resolution.js";
import {
  categoryTypeForSubcategory,
  transactionSearchFilters,
} from "./transaction-action-input.js";
import {
  parseFinanceAction,
  type FinanceAction,
  type FinanceActionFor,
  type FinanceToolName,
} from "./tool-definitions.js";

function hasAnyField(input: object, fields: readonly string[]): boolean {
  return fields.some((field) =>
    Object.prototype.hasOwnProperty.call(input, field),
  );
}

function normalizeComment(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}


function resolveTagNames(
  names: string[] | undefined,
  tags: Tag[],
  actionType: string,
  createMissing: boolean,
): string[] {
  return (names ?? []).map((name) => {
    const id = resolveTag({ name }, tags);
    if (id) return id;
    if (createMissing) {
      return resolveOrCreateTagsByName([{ name }])[0]?.id ?? "";
    }
    throw new Error(`${actionType} references an unknown tag "${name}"`);
  });
}

function resolveExistingTagIds(
  input: {
    add_tag_ids?: string[];
    add_tag_names?: string[];
    tag_ids?: string[];
    tag_names?: string[];
  },
  tags: Tag[],
  actionType: string,
  idField: "tag_ids" | "add_tag_ids",
  nameField: "tag_names" | "add_tag_names",
): string[] {
  const ids = input[idField] ?? [];
  return [
    ...ids,
    ...resolveTagNames(input[nameField], tags, actionType, true),
  ].filter(Boolean);
}

function explicitTagIds(
  input: {
    tag_ids?: string[];
    tag_names?: string[];
    tags?: Array<{ name: string; type?: TagType }>;
  },
  tags: Tag[],
  actionType: string,
): string[] {
  const names = resolveTagNames(input.tag_names, tags, actionType, true);
  const objects = resolveOrCreateTagsByName(input.tags ?? []).map(
    (tag) => tag.id,
  );
  return [...new Set([...(input.tag_ids ?? []), ...names, ...objects])];
}

function existingTagIds(
  input: {
    remove_tag_ids?: string[];
    remove_tag_names?: string[];
  },
  tags: Tag[],
  actionType: string,
): string[] {
  return [
    ...(input.remove_tag_ids ?? []),
    ...resolveTagNames(input.remove_tag_names, tags, actionType, false),
  ];
}

function assertNoOverlappingTagEdits(
  addTagIds: string[],
  removeTagIds: string[],
): void {
  const addTagSet = new Set(addTagIds);
  for (const tagId of removeTagIds) {
    if (addTagSet.has(tagId)) {
      throw new Error("Cannot add and remove the same tag in one bulk update");
    }
  }
}


function assertDateRange(
  startDate: string,
  endDate: string | null | undefined,
  actionType: string,
): void {
  if (endDate && startDate > endDate) {
    throw new Error(`${actionType} requires start_date on or before end_date`);
  }
}

export function executeAction(action: PlannedChatAction): ChatActionResult {
  try {
    return executeFinanceAction(parseFinanceAction(action));
  } catch (error) {
    return {
      ...action,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown action error",
    };
  }
}

export function executeFinanceAction<Name extends FinanceToolName>(
  action: FinanceActionFor<Name>,
): ChatActionResult;
export function executeFinanceAction(
  action: FinanceAction,
): ChatActionResult;
export function executeFinanceAction(action: FinanceAction): ChatActionResult {
  try {
    const accounts = getAccounts();
    const categories = getCategories();
    const subcategories = getSubcategories();
    const goals = getSpendingGoalsWithDetails();
    const tags = getTags();
    switch (action.type) {
      case "calculate": {
        const calculateInput = action.input;
        return {
          ...action,
          status: "success",
          result: {
            expression: calculateInput.expression,
            result: calculateExpression(calculateInput.expression),
          },
        };
      }

      case "create_account": {
        const createAccountInput = action.input;
        return {
          ...action,
          status: "success",
          result: createAccount({
            name: createAccountInput.name,
            type: createAccountInput.type,
            initial_balance: createAccountInput.initial_balance,
          }),
        };
      }

      case "update_account": {
        const input = action.input;
        const id = resolveRequestedAccount(
          { id: input.id, name: input.current_name },
          accounts,
          action.type,
        );
        if (!id) {
          throw new Error(
            "update_account requires id or existing account name",
          );
        }
        if (!hasAnyField(input, ["name", "type", "initial_balance"])) {
          throw new Error(
            "update_account requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateAccount(id, {
            name: input.name,
            type: input.type,
            initial_balance: input.initial_balance,
          }),
        };
      }

      case "create_category": {
        const createCategoryInput = action.input;
        return {
          ...action,
          status: "success",
          result: createCategory({
            name: createCategoryInput.name,
            type: createCategoryInput.type,
          }),
        };
      }

      case "update_category": {
        const input = action.input;
        const id =
          input.id ?? findByName(categories, input.current_name)?.id;
        if (!id) throw new Error("update_category requires id or current_name");
        if (!hasAnyField(input, ["name", "type"])) {
          throw new Error(
            "update_category requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateCategory(id, {
            name: input.name,
            type: input.type,
          }),
        };
      }

      case "create_subcategory": {
        const input = action.input;
        const categoryId = resolveRequestedCategory(
          { id: input.category_id, name: input.category_name },
          categories,
          action.type,
        );
        if (!categoryId) {
          throw new Error(
            "create_subcategory requires name and category_id or category_name",
          );
        }
        return {
          ...action,
          status: "success",
          result: createSubcategory({
            name: input.name,
            category_id: categoryId,
            monthly_goal: input.monthly_goal ?? null,
          }),
        };
      }

      case "update_subcategory": {
        const input = action.input;
        const id =
          input.id ??
          resolveSubcategory(
            {
              name: input.current_name ?? input.subcategory_name,
            },
            subcategories,
          );
        if (!id) {
          throw new Error("update_subcategory requires id or current_name");
        }
        if (
          !hasAnyField(input, [
            "name",
            "category_id",
            "category_name",
            "monthly_goal",
          ])
        ) {
          throw new Error(
            "update_subcategory requires at least one field to update",
          );
        }
        return {
          ...action,
          status: "success",
          result: updateSubcategory(id, {
            name: input.name,
            category_id: resolveRequestedCategory(
              { id: input.category_id, name: input.category_name },
              categories,
              action.type,
            ),
            monthly_goal: input.monthly_goal,
          }),
        };
      }

      case "create_tag": {
        const createTagInput = action.input;
        return {
          ...action,
          status: "success",
          result: createTag({
            name: createTagInput.name,
            type: createTagInput.type,
            color: createTagInput.color ?? null,
          }),
        };
      }

      case "update_tag": {
        const input = action.input;
        const id = resolveRequestedTag(
          { id: input.id, name: input.current_name },
          tags,
          action.type,
        );
        if (!id) throw new Error("update_tag requires id or current_name");
        if (!hasAnyField(input, ["name", "type", "color"])) {
          throw new Error("update_tag requires at least one field to update");
        }
        return {
          ...action,
          status: "success",
          result: updateTag(id, {
            name: input.name,
            type: input.type,
            color: input.color,
          }),
        };
      }

      case "create_transaction": {
        const input = action.input;
        const accountId = resolveRequestedAccount(
          { id: input.account_id, name: input.account_name },
          accounts,
          action.type,
        );
        const subcategoryId =
          input.subcategory_id === undefined
            ? resolveRequestedSubcategory(
                { name: input.subcategory_name },
                subcategoriesForKind(subcategories, categories, input.kind),
                action.type,
              )
            : input.subcategory_id;
        const kind =
          input.kind ??
          categoryTypeForSubcategory(input, categories, subcategories);
        if (!accountId) {
          throw new Error(
            "create_transaction requires account, date, name, and amount",
          );
        }
        const result = getDb().transaction(() => {
          const data: CreateTransactionData = {
            account_id: accountId,
            date: input.date,
            name: input.name,
            amount: input.amount,
            kind,
            subcategory_id: subcategoryId ?? null,
            comment: normalizeComment(input.comment) ?? null,
            tag_ids: explicitTagIds(input, tags, action.type),
          };
          return createTransaction(data);
        })();
        return {
          ...action,
          status: "success",
          result,
        };
      }

      case "search_transactions": {
        const input = action.input;
        const transactions = getTransactionsWithDetails(
          transactionSearchFilters(
            input,
            accounts,
            subcategories,
            tags,
            action.type,
            25,
            100,
          ),
        );
        return {
          ...action,
          status: "success",
          result: transactions.map((transaction) => ({
            id: transaction.id,
            date: transaction.date,
            name: transaction.name,
            amount: transaction.amount,
            kind: transaction.kind,
            account_id: transaction.account_id,
            account_name: transaction.account_name,
            category_name: transaction.category_name,
            subcategory_name: transaction.subcategory_name,
            tags: transaction.tags.map((tag) => ({
              id: tag.id,
              name: tag.name,
              type: tag.type,
            })),
            comment: transaction.comment,
          })),
        };
      }

      case "bulk_update_transactions": {
        const input = action.input;
        const filters = transactionSearchFilters(
          input,
          accounts,
          subcategories,
          tags,
          action.type,
          DEFAULT_BULK_TRANSACTION_LIMIT,
          MAX_BULK_TRANSACTION_LIMIT,
        );
        const updateInput = input.updates;
        const hasSubcategoryUpdate = hasAnyField(updateInput, [
          "subcategory_id",
          "subcategory_name",
        ]);
        const hasKindUpdate = hasAnyField(updateInput, ["kind"]);
        const hasCommentUpdate = hasAnyField(updateInput, ["comment"]);
        const addTagIds = resolveExistingTagIds(
          updateInput,
          tags,
          action.type,
          "add_tag_ids",
          "add_tag_names",
        );
        const removeTagIds = existingTagIds(
          updateInput,
          tags,
          action.type,
        );
        if (
          !hasKindUpdate &&
          !hasSubcategoryUpdate &&
          !hasCommentUpdate &&
          !hasAnyField(updateInput, ["add_tag_ids", "add_tag_names", "remove_tag_ids", "remove_tag_names"])
        ) {
          throw new Error(`${action.type} requires at least one update field`);
        }
        assertNoOverlappingTagEdits(addTagIds, removeTagIds);

        const filtersResult = getTransactionsWithDetails(filters);
        const transactionIds = filtersResult.map(
          (transaction) => transaction.id,
        );
        const subcategoryId = hasSubcategoryUpdate
          ? updateInput.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(
                { id: updateInput.subcategory_id ?? undefined, name: updateInput.subcategory_name },
                subcategoriesForKind(subcategories, categories, updateInput.kind),
                action.type,
              )
          : undefined;

        if (hasCommentUpdate) {
          const updateAll = getDb().transaction(() => {
            for (const transaction of filtersResult) {
              const currentIds = transaction.tags.map((tag) => tag.id);
              const nextTagIds = new Set(currentIds);
              for (const tagId of addTagIds) nextTagIds.add(tagId);
              for (const tagId of removeTagIds) nextTagIds.delete(tagId);
              updateTransaction(transaction.id, {
                ...(hasKindUpdate ? { kind: updateInput.kind } : {}),
                ...(hasSubcategoryUpdate
                  ? { subcategory_id: subcategoryId }
                  : {}),
                comment: normalizeComment(updateInput.comment) ?? null,
                ...(addTagIds.length > 0 || removeTagIds.length > 0
                  ? { tag_ids: Array.from(nextTagIds) }
                  : {}),
              });
            }
          });
          updateAll();
        } else {
          bulkUpdateTransactions(transactionIds, {
            ...(hasKindUpdate ? { kind: updateInput.kind } : {}),
            ...(hasSubcategoryUpdate ? { subcategory_id: subcategoryId } : {}),
            ...(addTagIds.length > 0 ? { add_tag_ids: addTagIds } : {}),
            ...(removeTagIds.length > 0
              ? { remove_tag_ids: removeTagIds }
              : {}),
          });
        }

        return {
          ...action,
          status: "success",
          result: {
            matched_count: transactionIds.length,
            updated_count: transactionIds.length,
            transaction_ids: transactionIds,
          },
        };
      }

      case "update_transaction": {
        const input = action.input;
        const hasReplacementTags = hasAnyField(input, [
          "tag_ids",
          "tag_names",
          "tags",
        ]);
        const hasAddTags = hasAnyField(input, ["add_tag_ids", "add_tag_names"]);
        const hasRemoveTags = hasAnyField(input, [
          "remove_tag_ids",
          "remove_tag_names",
        ]);
        if (
          !hasAnyField(input, [
            "date",
            "name",
            "amount",
            "kind",
            "subcategory_id",
            "subcategory_name",
            "comment",
          ]) &&
          !hasReplacementTags &&
          !hasAddTags &&
          !hasRemoveTags
        ) {
          throw new Error(
            "update_transaction requires at least one field to update",
          );
        }

        const existingTransaction = getTransactionById(input.id);
        if (!existingTransaction) {
          throw new Error(`Transaction with id "${input.id}" not found`);
        }
        const subcategoryId =
          input.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(
                { id: input.subcategory_id ?? undefined, name: input.subcategory_name },
                subcategoriesForKind(
                  subcategories,
                  categories,
                  input.kind ?? existingTransaction.kind,
                ),
                action.type,
              );
        const replacementTagIds = hasReplacementTags
          ? explicitTagIds(input, tags, action.type)
          : undefined;
        const addTagIds = hasAddTags
          ? resolveExistingTagIds(
              input,
              tags,
              action.type,
              "add_tag_ids",
              "add_tag_names",
            )
          : [];
        const removeTagIds = hasRemoveTags
          ? existingTagIds(input, tags, action.type)
          : [];
        const nextTagIds =
          replacementTagIds ??
          (hasAddTags || hasRemoveTags
            ? Array.from(
                new Set([
                  ...existingTransaction.tags.map((tag) => tag.id),
                  ...addTagIds,
                ]),
              ).filter((tagId) => !removeTagIds.includes(tagId))
            : undefined);

        return {
          ...action,
          status: "success",
          result: updateTransaction(input.id, {
            date: input.date,
            name: input.name,
            amount: input.amount,
            kind: input.kind,
            subcategory_id: subcategoryId,
            comment: normalizeComment(input.comment),
            ...(nextTagIds ? { tag_ids: nextTagIds } : {}),
          }),
        };
      }

      case "create_goal": {
        const input = action.input;
        const subcategoryId = resolveRequestedSubcategory(
          { id: input.subcategory_id, name: input.subcategory_name },
          subcategories,
          action.type,
        );
        if (!subcategoryId) throw new Error("create_goal requires subcategory");
        assertDateRange(input.start_date, input.end_date, action.type);
        return {
          ...action,
          status: "success",
          result: createSpendingGoal({
            subcategory_id: subcategoryId,
            amount: input.amount,
            period: input.period,
            start_date: input.start_date,
            end_date: input.end_date ?? null,
          }),
        };
      }

      case "update_goal": {
        const input = action.input;
        const id = resolveGoal(input, goals, subcategories);
        if (!id) throw new Error("update_goal requires id or subcategory");
        if (
          !hasAnyField(input, ["amount", "period", "start_date", "end_date"])
        ) {
          throw new Error("update_goal requires at least one field to update");
        }
        const existingGoal = goals.find((goal) => goal.id === id);
        assertDateRange(
          input.start_date ?? existingGoal?.start_date ?? "",
          input.end_date !== undefined
            ? input.end_date
            : existingGoal?.end_date,
          action.type,
        );
        return {
          ...action,
          status: "success",
          result: updateSpendingGoal(id, {
            amount: input.amount,
            period: input.period,
            start_date: input.start_date,
            end_date: input.end_date,
          }),
        };
      }
    }
  } catch (error) {
    return {
      ...action,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown action error",
    };
  }
}
