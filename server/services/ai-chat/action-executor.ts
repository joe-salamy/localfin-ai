import { createAccount, getAccounts, updateAccount } from "../accounts.js";
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
import { calculateExpression } from "./calculator.js";
import type { CreateTransactionData,
Tag,
TagType, } from "../../../shared/contracts/index.js"
import type { AIAction, ExecutedAction } from "./types.js";
import {
  DEFAULT_BULK_TRANSACTION_LIMIT,
  MAX_BULK_TRANSACTION_LIMIT,
} from "./constants.js";
import {
  asNullableString,
  asNumber,
  asString,
  assertDateRange,
  hasAnyField,
  optionalAccountType,
  optionalCategoryType,
  optionalGoalPeriod,
  optionalIsoDate,
  optionalNullableIsoDate,
  optionalNonnegativeNumber,
  normalizeStringList,
  optionalTagType,
  optionalPositiveNumber,
  optionalTransactionKind,
  requireAccountType,
  requireCategoryType,
  requireGoalPeriod,
  requireIsoDate,
  requirePositiveNumber,
} from "./input-validators.js";
import {
  findByName,
  resolveAccount,
  resolveGoal,
  resolveRequestedAccount,
  resolveRequestedCategory,
  resolveRequestedSubcategory,
  resolveSubcategory,
  resolveTag,
} from "./entity-resolution.js";
import {
  categoryTypeForSubcategory,
  transactionSearchFilters,
} from "./transaction-action-input.js";

function tagObjectRequests(
  value: unknown,
  actionType: string,
): Array<{ name: string; type?: TagType }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const name = asString(record.name);
      if (!name) return undefined;
      const type = optionalTagType(record.type, actionType);
      return {
        name,
        ...(type ? { type } : {}),
      };
    })
    .filter((item): item is { name: string; type?: TagType } => Boolean(item));
}

function resolveExistingTagIds(
  input: Record<string, unknown>,
  tags: Tag[],
  actionType: string,
  idFields: string[],
  nameFields: string[],
): string[] {
  const ids = idFields.flatMap((field) => normalizeStringList(input[field]));
  const names = nameFields.flatMap((field) =>
    normalizeStringList(input[field]),
  );
  const resolvedNames = names.map(
    (name) =>
      resolveTag({ tag_name: name, tag_type: input.tag_type }, tags) ??
      resolveOrCreateTagsByName([
        { name, type: optionalTagType(input.tag_type, actionType) },
      ])[0]?.id,
  );
  return [...ids, ...resolvedNames].filter((id): id is string => Boolean(id));
}

function explicitTagIds(
  input: Record<string, unknown>,
  tags: Tag[],
  actionType: string,
  idFields: string[],
  nameFields: string[],
): string[] {
  const ids = resolveExistingTagIds(
    input,
    tags,
    actionType,
    idFields,
    nameFields,
  );
  const objects = tagObjectRequests(input.tags, actionType);
  const objectIds =
    objects.length > 0
      ? resolveOrCreateTagsByName(objects).map((tag) => tag.id)
      : [];
  return [...ids, ...objectIds];
}

function existingTagIds(
  input: Record<string, unknown>,
  tags: Tag[],
  actionType: string,
  idFields: string[],
  nameFields: string[],
): string[] {
  const ids = idFields.flatMap((field) => normalizeStringList(input[field]));
  const names = nameFields.flatMap((field) =>
    normalizeStringList(input[field]),
  );
  const resolvedNames = names.map((name) => {
    const id = resolveTag({ tag_name: name, tag_type: input.tag_type }, tags);
    if (!id)
      throw new Error(`${actionType} references an unknown tag "${name}"`);
    return id;
  });
  return [...ids, ...resolvedNames];
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

export function executeAction(action: AIAction): ExecutedAction {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const tags = getTags();
  const input = action.input;

  try {
    switch (action.type) {
      case "report_failure": {
        throw new Error(
          asString(input.reason) ?? "Assistant reported an action failure",
        );
      }
      case "calculate": {
        const expression = asString(input.expression);
        if (!expression) throw new Error("calculate requires expression");
        return {
          ...action,
          status: "success",
          result: {
            expression,
            result: calculateExpression(expression),
          },
        };
      }
      case "create_account": {
        const name = asString(input.name);
        const type = requireAccountType(input.type, action.type);
        if (!name) throw new Error("create_account requires name");
        return {
          ...action,
          status: "success",
          result: createAccount({
            name,
            type,
            initial_balance: asNumber(input.initial_balance),
          }),
        };
      }
      case "update_account": {
        const id = asString(input.id) ?? resolveAccount(input, accounts);
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
            name: asString(input.name),
            type: optionalAccountType(input.type, action.type),
            initial_balance: asNumber(input.initial_balance),
          }),
        };
      }
      case "create_category": {
        const name = asString(input.name);
        const type = requireCategoryType(input.type, action.type);
        if (!name) throw new Error("create_category requires name");
        return {
          ...action,
          status: "success",
          result: createCategory({ name, type }),
        };
      }
      case "update_category": {
        const id =
          asString(input.id) ??
          findByName(categories, asString(input.current_name))?.id;
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
            name: asString(input.name),
            type: optionalCategoryType(input.type, action.type),
          }),
        };
      }
      case "create_subcategory": {
        const name = asString(input.name);
        const categoryId = resolveRequestedCategory(
          input,
          categories,
          action.type,
        );
        if (!name || !categoryId) {
          throw new Error(
            "create_subcategory requires name and category_id or category_name",
          );
        }
        return {
          ...action,
          status: "success",
          result: createSubcategory({
            name,
            category_id: categoryId,
            monthly_goal:
              optionalNonnegativeNumber(
                input.monthly_goal,
                "monthly_goal",
                action.type,
              ) ?? null,
          }),
        };
      }
      case "update_subcategory": {
        const id =
          asString(input.id) ??
          resolveSubcategory(
            {
              ...input,
              current_name:
                asString(input.current_name) ??
                asString(input.subcategory_name) ??
                asString(input.name),
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
            name: asString(input.name),
            category_id: resolveRequestedCategory(
              input,
              categories,
              action.type,
            ),
            monthly_goal: optionalNonnegativeNumber(
              input.monthly_goal,
              "monthly_goal",
              action.type,
            ),
          }),
        };
      }
      case "create_tag": {
        const name = asString(input.name);
        if (!name) throw new Error("create_tag requires name");
        return {
          ...action,
          status: "success",
          result: createTag({
            name,
            type: optionalTagType(input.type, action.type),
            color: asNullableString(input.color) ?? null,
          }),
        };
      }
      case "update_tag": {
        const id =
          asString(input.id) ??
          resolveTag(
            {
              tag_name:
                asString(input.current_name) ??
                asString(input.tag_name) ??
                asString(input.name),
              tag_type:
                asString(input.current_type) ?? asString(input.tag_type),
            },
            tags,
          );
        if (!id) throw new Error("update_tag requires id or current_name");
        if (!hasAnyField(input, ["name", "type", "color"])) {
          throw new Error("update_tag requires at least one field to update");
        }
        return {
          ...action,
          status: "success",
          result: updateTag(id, {
            name: asString(input.name),
            type: optionalTagType(input.type, action.type),
            color: asNullableString(input.color),
          }),
        };
      }
      case "create_transaction": {
        const accountId = resolveRequestedAccount(input, accounts, action.type);
        const date = requireIsoDate(input.date, "date", action.type);
        const name = asString(input.name);
        const amount = asNumber(input.amount);
        if (!accountId || !name || amount === undefined) {
          throw new Error(
            "create_transaction requires account, date, name, and amount",
          );
        }
        const subcategoryId =
          resolveRequestedSubcategory(input, subcategories, action.type) ??
          null;
        const kind =
          optionalTransactionKind(input.kind, action.type) ??
          categoryTypeForSubcategory(input, categories, subcategories) ??
          undefined;
        const data: CreateTransactionData = {
          account_id: accountId,
          date,
          name,
          amount,
          kind,
          subcategory_id: subcategoryId,
          comment: asNullableString(input.comment) ?? null,
          tag_ids: explicitTagIds(
            input,
            tags,
            action.type,
            ["tag_ids", "tag_id"],
            ["tag_names", "tag_name"],
          ),
        };
        return {
          ...action,
          status: "success",
          result: createTransaction(data),
        };
      }
      case "search_transactions": {
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
        const filters = transactionSearchFilters(
          input,
          accounts,
          subcategories,
          tags,
          action.type,
          DEFAULT_BULK_TRANSACTION_LIMIT,
          MAX_BULK_TRANSACTION_LIMIT,
        );
        const updateInput =
          input.updates && typeof input.updates === "object"
            ? (input.updates as Record<string, unknown>)
            : input;
        const hasSubcategoryUpdate = hasAnyField(updateInput, [
          "subcategory_id",
          "subcategory_name",
        ]);
        const hasKindUpdate = hasAnyField(updateInput, ["kind"]);
        const hasCommentUpdate = hasAnyField(updateInput, ["comment"]);
        if (
          !hasKindUpdate &&
          !hasSubcategoryUpdate &&
          !hasCommentUpdate &&
          !hasAnyField(updateInput, [
            "add_tag_ids",
            "add_tag_id",
            "add_tag_names",
            "add_tag_name",
            "remove_tag_ids",
            "remove_tag_id",
            "remove_tag_names",
            "remove_tag_name",
          ])
        ) {
          throw new Error(`${action.type} requires at least one update field`);
        }
        const filtersResult = getTransactionsWithDetails(filters);
        const transactionIds = filtersResult.map(
          (transaction) => transaction.id,
        );
        const kind = hasKindUpdate
          ? optionalTransactionKind(updateInput.kind, action.type)
          : undefined;
        const subcategoryId = hasSubcategoryUpdate
          ? updateInput.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(
                updateInput,
                subcategories,
                action.type,
              )
          : undefined;
        const addTagIds = resolveExistingTagIds(
          updateInput,
          tags,
          action.type,
          ["add_tag_ids", "add_tag_id"],
          ["add_tag_names", "add_tag_name"],
        );
        const removeTagIds = existingTagIds(
          updateInput,
          tags,
          action.type,
          ["remove_tag_ids", "remove_tag_id"],
          ["remove_tag_names", "remove_tag_name"],
        );
        assertNoOverlappingTagEdits(addTagIds, removeTagIds);

        if (hasCommentUpdate) {
          for (const transaction of filtersResult) {
            const currentIds = transaction.tags.map((tag) => tag.id);
            const nextTagIds = new Set(currentIds);
            for (const tagId of addTagIds) nextTagIds.add(tagId);
            for (const tagId of removeTagIds) nextTagIds.delete(tagId);
            updateTransaction(transaction.id, {
              ...(hasKindUpdate ? { kind } : {}),
              ...(hasSubcategoryUpdate
                ? { subcategory_id: subcategoryId }
                : {}),
              comment: asNullableString(updateInput.comment) ?? null,
              ...(addTagIds.length > 0 || removeTagIds.length > 0
                ? { tag_ids: Array.from(nextTagIds) }
                : {}),
            });
          }
        } else {
          bulkUpdateTransactions(transactionIds, {
            ...(hasKindUpdate ? { kind } : {}),
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
        const id = asString(input.id);
        if (!id) throw new Error("update_transaction requires id");
        const hasReplacementTags = hasAnyField(input, [
          "tag_ids",
          "tag_id",
          "tag_names",
          "tag_name",
          "tags",
        ]);
        const hasAddTags = hasAnyField(input, [
          "add_tag_ids",
          "add_tag_id",
          "add_tag_names",
          "add_tag_name",
        ]);
        const hasRemoveTags = hasAnyField(input, [
          "remove_tag_ids",
          "remove_tag_id",
          "remove_tag_names",
          "remove_tag_name",
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
        const subcategoryId =
          input.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(input, subcategories, action.type);
        const date = optionalIsoDate(input.date, "date", action.type);
        const name = asString(input.name);
        const amount = asNumber(input.amount);
        const kind = optionalTransactionKind(input.kind, action.type);
        const comment = asNullableString(input.comment);
        const existingTransaction = getTransactionById(id);
        if (!existingTransaction) {
          throw new Error(`Transaction with id "${id}" not found`);
        }
        const replacementTagIds = hasReplacementTags
          ? explicitTagIds(
              input,
              tags,
              action.type,
              ["tag_ids", "tag_id"],
              ["tag_names", "tag_name"],
            )
          : undefined;
        const addTagIds = hasAddTags
          ? resolveExistingTagIds(
              input,
              tags,
              action.type,
              ["add_tag_ids", "add_tag_id"],
              ["add_tag_names", "add_tag_name"],
            )
          : [];
        const removeTagIds = hasRemoveTags
          ? existingTagIds(
              input,
              tags,
              action.type,
              ["remove_tag_ids", "remove_tag_id"],
              ["remove_tag_names", "remove_tag_name"],
            )
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
          result: updateTransaction(id, {
            date,
            name,
            amount,
            kind,
            subcategory_id: subcategoryId,
            comment,
            ...(nextTagIds ? { tag_ids: nextTagIds } : {}),
          }),
        };
      }
      case "create_goal": {
        const subcategoryId = resolveRequestedSubcategory(
          input,
          subcategories,
          action.type,
        );
        const amount = requirePositiveNumber(
          input.amount,
          "amount",
          action.type,
        );
        const period = requireGoalPeriod(input.period, action.type);
        const startDate = requireIsoDate(
          input.start_date,
          "start_date",
          action.type,
        );
        const endDate =
          optionalNullableIsoDate(input.end_date, "end_date", action.type) ??
          null;
        if (!subcategoryId) throw new Error("create_goal requires subcategory");
        assertDateRange(startDate, endDate, action.type);
        return {
          ...action,
          status: "success",
          result: createSpendingGoal({
            subcategory_id: subcategoryId,
            amount,
            period,
            start_date: startDate,
            end_date: endDate,
          }),
        };
      }
      case "update_goal": {
        const id = resolveGoal(input, goals, subcategories);
        if (!id) throw new Error("update_goal requires id or subcategory");
        if (
          !hasAnyField(input, ["amount", "period", "start_date", "end_date"])
        ) {
          throw new Error("update_goal requires at least one field to update");
        }
        const startDate = optionalIsoDate(
          input.start_date,
          "start_date",
          action.type,
        );
        const endDate = optionalNullableIsoDate(
          input.end_date,
          "end_date",
          action.type,
        );
        const existingGoal = goals.find((goal) => goal.id === id);
        assertDateRange(
          startDate ?? existingGoal?.start_date ?? "",
          endDate !== undefined ? endDate : existingGoal?.end_date,
          action.type,
        );
        return {
          ...action,
          status: "success",
          result: updateSpendingGoal(id, {
            amount: optionalPositiveNumber(input.amount, "amount", action.type),
            period: optionalGoalPeriod(input.period, action.type),
            start_date: startDate,
            end_date: endDate,
          }),
        };
      }
      default:
        throw new Error(`Unsupported action "${action.type}"`);
    }
  } catch (error) {
    return {
      ...action,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown action error",
    };
  }
}
