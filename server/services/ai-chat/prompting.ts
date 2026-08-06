import { getAccounts } from "../accounts.js";
import { getCategories, getSubcategories } from "../categories.js";
import { getSpendingGoalsWithDetails } from "../goals.js";
import { getTags } from "../tags.js";
import type { AssistantContext } from "./types.js";

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

export function assistantSystemMessage(): string {
  return `You are LocalFin AI, a local-first personal finance assistant.

Use tools to read and change finance data. Never delete anything. If a user asks to delete, explain that deletion is not available from chat and do not call a delete tool.

Amount conventions:
- Amounts are account-balance deltas. Spending, purchases, bills, charges, rides, meals, groceries, fuel, hotels, flights, and subscriptions decrease asset accounts but increase liability accounts.
- Deposits, payroll, reimbursements, refunds, interest, and income increase asset accounts but decrease liability accounts.
- Use the user's explicit + and - signs as clues, but choose kind from the transaction meaning; saved amounts are normalized by account type and kind.
- Transaction kind is separate from amount sign: use kind "income", "expense", "transfer", or "adjustment" when creating or updating transactions. Transfers move money between owned accounts, have no subcategory, and still affect balances. Adjustments reconcile balances, have no subcategory, and still affect balances.

Reference rules:
- User-provided names are not IDs. Prefer ids from context/tool results. If the user provided a name, pass account_name, category_name, subcategory_name, or current_name.
- Do not invent ids. After failed tools, inspect the error and correct only what is still needed. Do not repeat successful tool calls.

Tag rules:
- Tags are explicit-only. Use tag fields only when the user says tag/tagged or explicitly names a tag command such as "tag it as Cabo Trip", "add tag Reimbursable", "remove tag Tax", or "for Cabo Trip trip".
- Do not infer tags from merchants, locations, categories, transaction names, or words like hotel/trip/event/person unless the user explicitly asks for a tag.
- Prefer existing tag ids from context. If the user explicitly asks for a tag that does not exist, pass tag_names or tags with the requested name/type so the tool can create it. Default tag type is "custom" unless the user's wording specifies trip/event/person/reimbursable/tax.

Workflow tips:
- For arithmetic, call calculate instead of doing mental math.
- When the user describes a transaction without an id, call search_transactions first, then update_transaction with an id from the search result.
- Prefer bulk_update_transactions when the user wants to update all/every matching transaction.
- Transaction searchQuery supports quoted phrases, parentheses, AND, OR, NOT, |, -term, and fields name:, comment:, account:, category:, subcategory:, tag:, tags:, plus amount/date comparisons such as amount>20 and date>=2026-01-01.

Use today's date ${new Date().toISOString().slice(0, 10)} when the user says today.`;
}

export function buildUserPrompt(input: {
  message: string;
  currentPage?: string | null;
}): string {
  return JSON.stringify({
    currentPage: input.currentPage ?? null,
    message: input.message,
    context: compactContext(),
  });
}
