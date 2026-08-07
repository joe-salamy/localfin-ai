import type {
  AccountType,
  CategoryType,
  GoalPeriod,
  TagType,
} from "../../../shared/contracts/index.js";

export type {
  ChatActionResult,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  PlannedChatAction,
} from "../../../shared/contracts/index.js";
export type { ChatStreamEmitter } from "../../../shared/contracts/parsing-ai.js";

export interface AssistantContext {
  accounts: Array<{
    id: string;
    name: string;
    type: AccountType;
  }>;
  categories: Array<{
    id: string;
    name: string;
    type: CategoryType;
  }>;
  subcategories: Array<{
    id: string;
    name: string;
    category_id: string;
    category_name: string | undefined;
    category_type: CategoryType | undefined;
    monthly_goal: number | null;
  }>;
  tags: Array<{
    id: string;
    name: string;
    type: TagType;
  }>;
  goals: Array<{
    id: string;
    subcategory_id: string;
    subcategory_name: string;
    amount: number;
    period: GoalPeriod;
    start_date: string;
    end_date: string | null;
  }>;
}
