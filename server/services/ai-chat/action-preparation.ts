import type { AIAction, PlanningContext, ToolLoopState } from "./types.js";
import { cloneAction, normalizeCreateTransactionAction } from "./transaction-action-normalization.js";
import { createGoalActionForMissingGoal, inferredCreateTransactionFromAddPrompt, inferredSubcategoryMoveAction, skippedDuplicateCategoryAction, subcategoryGoalUpdateAction, visibleFailureFromMessage } from "./action-inference.js";
import { searchActionForTransactionUpdate, shouldInsertSearchBeforeUpdate } from "./search-update-repair.js";

export function prepareActionsForExecution(
  actions: AIAction[],
  message: string,
  assistantMessage: string,
  context: PlanningContext,
  previousTurns: ToolLoopState[] = [],
): AIAction[] {
  const prepared = actions.map((action) =>
    createGoalActionForMissingGoal(
      action.type === "create_transaction"
        ? normalizeCreateTransactionAction(action, message, context)
        : cloneAction(action),
      message,
      context,
    ),
  );

  const skippedDuplicate = skippedDuplicateCategoryAction(
    prepared,
    message,
    assistantMessage,
    context,
  );
  if (skippedDuplicate) prepared.unshift(skippedDuplicate);

  const inferredMove = inferredSubcategoryMoveAction(
    prepared,
    message,
    context,
  );
  if (inferredMove) prepared.push(inferredMove);

  const visibleFailure = visibleFailureFromMessage(
    prepared,
    message,
    assistantMessage,
  );
  if (visibleFailure) return [visibleFailure];

  const inferredCreate = inferredCreateTransactionFromAddPrompt(
    prepared,
    message,
    context,
  );
  if (inferredCreate) prepared.push(inferredCreate);

  const withSearches: AIAction[] = [];
  for (const action of prepared) {
    if (
      action.type === "update_transaction" &&
      shouldInsertSearchBeforeUpdate(
        withSearches,
        withSearches.length,
        previousTurns,
      )
    ) {
      const searchAction = searchActionForTransactionUpdate(action, context);
      if (searchAction) withSearches.push(searchAction);
    }
    withSearches.push(action);
    const goalUpdate = subcategoryGoalUpdateAction(action, message, context);
    if (goalUpdate) withSearches.push(goalUpdate);
  }

  return withSearches;
}

export * from "./transaction-action-input.js";
export * from "./transaction-action-normalization.js";
export * from "./action-inference.js";
export * from "./search-update-repair.js";
