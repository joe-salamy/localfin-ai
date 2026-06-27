import { streamOpenRouter } from "../../ai/openrouter.js";
import { AI_MODELS } from "../../config/ai-models.js";
import { getAccounts } from "../accounts.js";
import { getCategories, getSubcategories } from "../categories.js";
import { getSpendingGoalsWithDetails } from "../goals.js";
import { getTransactionsWithDetails } from "../transactions.js";
import { getTags } from "../tags.js";
import { getRecentAgentMessagesForPrompt } from "../agent-conversations.js";
import type {
  AIAction,
  AIChatResponse,
  AssistantContext,
  ChatRequest,
  ChatStreamEmitter,
  ExecutedAction,
  PlanningContext,
  ToolLoopState,
} from "./types.js";
import { asString } from "./input-validators.js";

export function compactContext(): AssistantContext {
  const accounts = getAccounts();
  const categories = getCategories();
  const subcategories = getSubcategories();
  const goals = getSpendingGoalsWithDetails();
  const tags = getTags();

  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
    })),
    subcategories: subcategories.map((s) => ({
      id: s.id,
      name: s.name,
      category_id: s.category_id,
      category_name: categories.find(
        (category) => category.id === s.category_id,
      )?.name,
      category_type: categories.find(
        (category) => category.id === s.category_id,
      )?.type,
      monthly_goal: s.monthly_goal,
    })),
    tags: tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      type: tag.type,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      subcategory_id: g.subcategory_id,
      subcategory_name: g.subcategory_name,
      amount: g.amount,
      period: g.period,
      start_date: g.start_date,
      end_date: g.end_date,
    })),
  };
}

export function parseChatResponse(parsed: unknown): AIChatResponse {
  if (!parsed || typeof parsed !== "object") {
    return {
      message: "I could not parse the assistant response.",
      actions: [],
    };
  }

  const record = parsed as Record<string, unknown>;
  const actions = Array.isArray(record.actions)
    ? record.actions
        .filter(
          (action): action is Record<string, unknown> =>
            action !== null && typeof action === "object",
        )
        .map((action) => ({
          type: asString(action.type) ?? "unknown",
          input:
            action.input && typeof action.input === "object"
              ? (action.input as Record<string, unknown>)
              : {},
        }))
    : [];

  return {
    message: asString(record.message) ?? "Done.",
    actions,
  };
}

export function assistantSystemMessage(): string {
  return `You are LocalFin AI, a local-first personal finance assistant.

Return ONLY JSON: { "message": "short user-facing response", "actions": [{ "type": "...", "input": { ... } }] }.

You may answer questions using the provided context. You may directly perform create/update actions by returning actions. Never delete anything. If a user asks to delete, explain that deletion is not available from chat.

Amount conventions:
- Amounts are account-balance deltas. Spending, purchases, bills, charges, rides, meals, groceries, fuel, hotels, flights, and subscriptions decrease asset accounts but increase liability accounts.
- Deposits, payroll, reimbursements, refunds, interest, and income increase asset accounts but decrease liability accounts.
- Use the user's explicit + and - signs as clues, but choose kind from the transaction meaning; saved amounts are normalized by account type and kind.
- Transaction kind is separate from amount sign: use kind "income", "expense", "transfer", or "adjustment" when creating or updating transactions. Transfers are money moving between owned accounts, have no subcategory, and still affect account balances. Adjustments reconcile account balances or current values, have no subcategory, and still affect account balances.

Failure conventions:
- If the user asks you to create or update something but it cannot be done because a referenced account/category/subcategory is missing, a date is invalid, or a name conflicts, still return the attempted action so validation can fail visibly.
- If the user asks to delete, return no delete action and explain deletion is unavailable.
- User-provided names are not IDs. For account/category/subcategory references, use ids only when they are present in the provided context. If the user provided a name, use account_name, category_name, subcategory_name, or current_name so the app can resolve it.
- The account/category/subcategory lists are already in context. Do not invent ids, and do not treat a user phrase as an id unless it exactly matches an id in context.
- After a failed action, inspect previousTurns action errors and return only the remaining corrective actions. Do not repeat actions that already succeeded.

Allowed action types:
- create_account: { name, type: "asset"|"liability", initial_balance? }
- update_account: { id? or current_name, name?, type: "asset"|"liability"?, initial_balance? }
- create_category: { name, type: "income"|"expense" }
- update_category: { id? or current_name, name?, type? }
- create_subcategory: { name, category_id? or category_name, monthly_goal? }
- update_subcategory: { id? or current_name, name?, category_id? or category_name, monthly_goal? }
- create_tag: { name, type?: "custom"|"trip"|"event"|"person"|"reimbursable"|"tax", color? }
- update_tag: { id? or current_name, name?, type?: "custom"|"trip"|"event"|"person"|"reimbursable"|"tax", color? }
- create_transaction: { account_id? or account_name, date: "YYYY-MM-DD", name, amount, kind?: "income"|"expense"|"transfer"|"adjustment", subcategory_id? or subcategory_name?, comment?, tag_ids? or tag_names? or tags?: [{ name, type?: "custom"|"trip"|"event"|"person"|"reimbursable"|"tax" }] }
- search_transactions: { searchQuery, account_id? or account_name?, kind?: "income"|"expense"|"transfer"|"adjustment", needsCategory?, subcategory_id? or subcategory_name?, tag_id? or tag_name? or tag_ids? or tag_names?, startDate?, endDate?, limit? }
- update_transaction: { id, date?, name?, amount?, kind?: "income"|"expense"|"transfer"|"adjustment", subcategory_id? or subcategory_name?, comment?, tag_ids? or tag_names? or tags?, add_tag_ids? or add_tag_names?, remove_tag_ids? or remove_tag_names? }
- bulk_update_transactions: { searchQuery, account_id? or account_name?, kind?: "income"|"expense"|"transfer"|"adjustment", needsCategory?, subcategory_id? or subcategory_name?, tag_id? or tag_name? or tag_ids? or tag_names?, startDate?, endDate?, limit?, updates: { kind?: "income"|"expense"|"transfer"|"adjustment", subcategory_id? or subcategory_name?, add_tag_ids? or add_tag_names?, remove_tag_ids? or remove_tag_names? } }
- create_goal: { subcategory_id? or subcategory_name, amount, period: "weekly"|"monthly"|"quarterly"|"annual", start_date: "YYYY-MM-DD", end_date? }
- update_goal: { id? or subcategory_id? or subcategory_name, amount?, period?, start_date?, end_date? }


Tag rules:
- Tags are explicit-only. Use tag fields only when the user says tag/tagged or explicitly names a tag command such as "tag it as Cabo Trip", "add tag Reimbursable", "remove tag Tax", or "for Cabo Trip trip".
- Do not infer tags from merchants, locations, categories, transaction names, or words like hotel/trip/event/person unless the user explicitly asks for a tag.
- Prefer existing tag ids from context. If the user explicitly asks for a tag that does not exist, pass tag_names or tags with the requested name/type so the tool can create it. Default tag type is "custom" unless the user's explicit wording specifies trip/event/person/reimbursable/tax.
Transaction search supports grep-like logic in searchQuery: quoted phrases, parentheses, AND, OR, NOT, |, -term, and fields name:, comment:, account:, category:, subcategory:, tag:, tags:, amount/date comparisons such as amount>20 and date>=2026-01-01. Examples: "coffee AND NOT starbucks", "(uber OR lyft) AND amount>20", "account:checking AND category:food AND tag:reimbursable AND date>=2026-01-01". Any request phrased as find/search/use criteria and then update must include search_transactions followed by update_transaction. Use search_transactions before update_transaction when the user describes a transaction but does not provide its id.
For requests to update all/every matching transaction, prefer bulk_update_transactions over search_transactions plus many update_transaction actions. For multiple independent criteria, return one bulk_update_transactions action per criterion.

Use today's date ${new Date().toISOString().slice(0, 10)} when the user says today.`;
}

export function planningContext(): PlanningContext {
  return {
    accounts: getAccounts(),
    categories: getCategories(),
    subcategories: getSubcategories(),
    goals: getSpendingGoalsWithDetails(),
    tags: getTags(),
    recentTransactions: getTransactionsWithDetails({ limit: 25 }),
  };
}

export function compactExecutedAction(action: ExecutedAction): ExecutedAction {
  if (action.type !== "search_transactions") return action;
  const result = Array.isArray(action.result)
    ? action.result.slice(0, 50)
    : action.result;
  return { ...action, result };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function actionKey(action: AIAction): string {
  return `${action.type}:${stableJson(action.input)}`;
}

export function successfulActionKeys(
  previousTurns: ToolLoopState[],
): Set<string> {
  return new Set(
    previousTurns.flatMap((turn) =>
      turn.actions
        .filter((action) => action.status === "success")
        .map(actionKey),
    ),
  );
}

export function removePreviouslySuccessfulActions(
  actions: AIAction[],
  previousTurns: ToolLoopState[],
): AIAction[] {
  const successfulKeys = successfulActionKeys(previousTurns);
  if (successfulKeys.size === 0) return actions;
  return actions.filter((action) => !successfulKeys.has(actionKey(action)));
}

export function assistantUserContent(
  request: ChatRequest,
  conversationHistory: ReturnType<typeof getRecentAgentMessagesForPrompt>,
  previousTurns: ToolLoopState[],
): string {
  return JSON.stringify({
    currentPage: request.currentPage ?? null,
    history: conversationHistory,
    message: request.message,
    context: compactContext(),
    ...(previousTurns.length > 0
      ? {
          instruction:
            "Continue from the prior tool results. Return only the next needed JSON response.",
          previousTurns: previousTurns.map((turn) => ({
            turn: turn.turn,
            assistantMessage: turn.assistantMessage,
            actions: turn.actions.map(compactExecutedAction),
          })),
        }
      : {}),
  });
}

export async function planAssistantActions(
  request: ChatRequest,
  requestId: string,
  turn: number,
  conversationHistory: ReturnType<typeof getRecentAgentMessagesForPrompt>,
  previousTurns: ToolLoopState[],
  emit?: ChatStreamEmitter,
): Promise<{ parsed: AIChatResponse; logFile: string }> {
  const response = await streamOpenRouter(
    [
      { role: "system", content: assistantSystemMessage() },
      {
        role: "user",
        content: assistantUserContent(
          request,
          conversationHistory,
          previousTurns,
        ),
      },
    ],
    {
      conversationId: request.conversationId,
      requestId,
      operation: turn === 1 ? "assistant.chat" : "assistant.chat.follow_up",
      model: AI_MODELS.assistantChat,
      metadata: { currentPage: request.currentPage ?? null, turn },
    },
    async (event) => {
      switch (event.type) {
        case "reasoning_delta":
          await emit?.({ type: "reasoning_delta", message: event.reasoning });
          return;
        case "reasoning_details":
          await emit?.({ type: "reasoning_details", details: event.details });
          return;
        case "content_delta":
          await emit?.({ type: "response_delta", content: event.content });
          return;
        default:
          return;
      }
    },
  );

  return {
    parsed: parseChatResponse(response.parsedContent),
    logFile: response.logFile,
  };
}
