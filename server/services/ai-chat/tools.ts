import { tool } from "langchain";
import { z } from "zod";
import type {
  ChatActionResult,
  PlannedChatAction,
} from "../../../shared/contracts/index.js";
import type { ChatStreamEmitter } from "../../../shared/contracts/parsing-ai.js";
import { financeToolDefinitions } from "./tool-definitions.js";
import type { FinanceToolName } from "./tool-definitions.js";
import { getActionReceipt } from "./idempotency.js";
import { dedupeActions, isReadOnlyTool } from "./approvals.js";
import { executeFinanceAction } from "./action-executor.js";

export interface AssistantToolRuntime {
  actions: ChatActionResult[];
  emit?: ChatStreamEmitter;
  conversationId: string;
  requestId?: string;
  signal?: AbortSignal;
  /** Mutating tool calls are buffered here for user approval instead of executing. */
  pendingApprovals: PlannedChatAction[];
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
type FinanceToolInput<Name extends FinanceToolName> = z.output<
  (typeof financeToolDefinitions)[Name]["schema"]
>;
type FinanceToolAction<Name extends FinanceToolName> = {
  type: Name;
  input: FinanceToolInput<Name>;
};

const PENDING_APPROVAL_MESSAGE =
  "This action requires your approval and was NOT executed. Do not retry it and do not work around it; finish your turn and summarize the proposed plan for the user.";

function toolResult(executed: ChatActionResult): string {
  if (executed.status === "error") {
    return JSON.stringify({
      ok: false,
      error: executed.error ?? "Tool failed",
    });
  }
  return JSON.stringify({ ok: true, result: executed.result ?? null });
}

function defineFinanceTool<Name extends FinanceToolName>(options: {
  name: Name;
  runtime: AssistantToolRuntime;
  enqueue: <R>(work: () => Promise<R> | R) => Promise<R>;
  actionIndexFor?: (action: PlannedChatAction) => number;
}) {
  const definition = financeToolDefinitions[options.name];
  return tool(
    async (rawInput: FinanceToolInput<Name>) =>
      options.enqueue(async () => {
        const action: FinanceToolAction<Name> = {
          type: options.name,
          input: rawInput,
        };

        if (isReadOnlyTool(options.name)) {
          const index = options.runtime.actions.length;
          await options.runtime.emit?.({
            type: "action_started",
            index,
            action,
          });
          const executed = executeFinanceAction(action);
          options.runtime.actions.push(executed);
          await options.runtime.emit?.({
            type: "action_finished",
            index,
            action: executed,
          });
          return toolResult(executed);
        }

        if (options.runtime.signal?.aborted) {
          return JSON.stringify({ ok: false, error: "Request cancelled" });
        }

        const pendingAction = action as PlannedChatAction;
        const deduped = dedupeActions([
          ...options.runtime.pendingApprovals,
          pendingAction,
        ]);
        const index =
          options.actionIndexFor?.(pendingAction) ??
          deduped.findIndex(
            (candidate) =>
              candidate.type === pendingAction.type &&
              JSON.stringify(candidate.input) ===
                JSON.stringify(pendingAction.input),
          );

        if (options.runtime.requestId) {
          const receipt = getActionReceipt(
            options.runtime.conversationId,
            options.runtime.requestId,
            index,
          );
          if (
            receipt &&
            receipt.type === pendingAction.type &&
            JSON.stringify(receipt.input) ===
              JSON.stringify(pendingAction.input)
          ) {
            options.runtime.actions.push(receipt);
            await options.runtime.emit?.({
              type: "action_started",
              index,
              action: pendingAction,
            });
            await options.runtime.emit?.({
              type: "action_finished",
              index,
              action: receipt,
            });
            return toolResult(receipt);
          }
        }

        const alreadyPending = options.runtime.pendingApprovals.some(
          (candidate) =>
            candidate.type === pendingAction.type &&
            JSON.stringify(candidate.input) ===
              JSON.stringify(pendingAction.input),
        );
        if (alreadyPending) {
          return JSON.stringify({
            ok: false,
            pending: true,
            message: PENDING_APPROVAL_MESSAGE,
          });
        }

        options.runtime.pendingApprovals.push(pendingAction);
        return JSON.stringify({
          ok: false,
          pending: true,
          message: PENDING_APPROVAL_MESSAGE,
        });
      }),
    {
      name: options.name,
      description: definition.description,
      schema: definition.schema,
    },
  );
}

export function createAssistantTools(runtime: AssistantToolRuntime) {
  const enqueue = createSerialQueue();
  const actionIndexes = new Map<string, number>();
  let nextActionIndex = runtime.pendingApprovals.length;
  for (const [index, action] of runtime.pendingApprovals.entries()) {
    actionIndexes.set(`${action.type}:${JSON.stringify(action.input)}`, index);
  }
  const actionIndexFor = (action: PlannedChatAction): number => {
    const key = `${action.type}:${JSON.stringify(action.input)}`;
    const existing = actionIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = nextActionIndex;
    nextActionIndex += 1;
    actionIndexes.set(key, index);
    return index;
  };
  const define = <Name extends FinanceToolName>(name: Name) =>
    defineFinanceTool({ name, runtime, enqueue, actionIndexFor });

  return [
    define("calculate"),
    define("create_account"),
    define("update_account"),
    define("create_category"),
    define("update_category"),
    define("create_subcategory"),
    define("update_subcategory"),
    define("create_tag"),
    define("update_tag"),
    define("create_transaction"),
    define("search_transactions"),
    define("update_transaction"),
    define("bulk_update_transactions"),
    define("create_goal"),
    define("update_goal"),
  ];
}
