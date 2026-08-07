import { tool } from "langchain";
import { z } from "zod";
import type { ChatActionResult } from "../../../shared/contracts/index.js";
import type { ChatStreamEmitter } from "../../../shared/contracts/parsing-ai.js";
import { financeToolDefinitions } from "./tool-definitions.js";
import type { FinanceToolName } from "./tool-definitions.js";
import { executeFinanceAction } from "./action-executor.js";

export interface AssistantToolRuntime {
  actions: ChatActionResult[];
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
type FinanceToolInput<Name extends FinanceToolName> = z.output<
  (typeof financeToolDefinitions)[Name]["schema"]
>;
type FinanceToolAction<Name extends FinanceToolName> = {
  type: Name;
  input: FinanceToolInput<Name>;
};


function defineFinanceTool<Name extends FinanceToolName>(options: {
  name: Name;
  runtime: AssistantToolRuntime;
  enqueue: <R>(work: () => Promise<R> | R) => Promise<R>;
}) {
  const definition = financeToolDefinitions[options.name];
  return tool(
    async (rawInput: FinanceToolInput<Name>) =>
      options.enqueue(async () => {
        const action: FinanceToolAction<Name> = {
          type: options.name,
          input: rawInput,
        };
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
      description: definition.description,
      schema: definition.schema,
    },
  );
}

export function createAssistantTools(runtime: AssistantToolRuntime) {
  const enqueue = createSerialQueue();
  const define = <Name extends FinanceToolName>(name: Name) =>
    defineFinanceTool({ name, runtime, enqueue });

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
