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
  createTransaction,
  getTransactionsWithDetails,
  updateTransaction,
} from "../transactions.js";
import type { CreateTransactionData } from "../../../src/types/index.js";
import type { AIAction, ExecutedAction } from "./types.js";
import { DEFAULT_BULK_TRANSACTION_LIMIT, MAX_BULK_TRANSACTION_LIMIT } from "./constants.js";
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
} from "./entity-resolution.js";
import {
  categoryTypeForSubcategory,
  transactionSearchFilters,
  transactionUpdateInput,
} from "./action-preparation.js";

export function executeAction(action: AIAction): ExecutedAction {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const input = action.input;

  try {
    switch (action.type) {
      case "report_failure": {
        throw new Error(
          asString(input.reason) ?? "Assistant reported an action failure",
        );
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
        if (!id)
          throw new Error(
            "update_account requires id or existing account name",
          );
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
        if (!name || !categoryId)
          throw new Error(
            "create_subcategory requires name and category_id or category_name",
          );
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
        if (!id)
          throw new Error("update_subcategory requires id or current_name");
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
            comment: transaction.comment,
          })),
        };
      }
      case "bulk_update_transactions": {
        const filters = transactionSearchFilters(
          input,
          accounts,
          subcategories,
          action.type,
          DEFAULT_BULK_TRANSACTION_LIMIT,
          MAX_BULK_TRANSACTION_LIMIT,
        );
        const updates = transactionUpdateInput(
          input,
          subcategories,
          action.type,
        );
        const transactions = getTransactionsWithDetails(filters);
        const transactionIds = transactions.map((transaction) => transaction.id);
        let updatedCount = 0;

        for (const transaction of transactions) {
          updateTransaction(transaction.id, updates);
          updatedCount += 1;
        }

        return {
          ...action,
          status: "success",
          result: {
            matched_count: transactionIds.length,
            updated_count: updatedCount,
            transaction_ids: transactionIds,
          },
        };
      }
      case "update_transaction": {
        const id = asString(input.id);
        if (!id) throw new Error("update_transaction requires id");
        if (
          !hasAnyField(input, [
            "date",
            "name",
            "amount",
            "kind",
            "subcategory_id",
            "subcategory_name",
            "comment",
          ])
        ) {
          throw new Error(
            "update_transaction requires at least one field to update",
          );
        }
        const subcategoryId =
          input.subcategory_id === null
            ? null
            : resolveRequestedSubcategory(input, subcategories, action.type);
        return {
          ...action,
          status: "success",
          result: updateTransaction(id, {
            date: optionalIsoDate(input.date, "date", action.type),
            name: asString(input.name),
            amount: asNumber(input.amount),
            kind: optionalTransactionKind(input.kind, action.type),
            subcategory_id: subcategoryId,
            comment: asNullableString(input.comment),
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
