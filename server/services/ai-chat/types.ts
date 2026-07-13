import type { OpenRouterReasoningDetail } from "../../ai/openrouter.js";
import type { Account,
AccountType,
Category,
CategoryType,
GoalPeriod,
SpendingGoalWithDetails,
Subcategory,
Tag,
TagType,
TransactionWithDetails, } from "../../../shared/contracts/index.js"

export interface ChatRequest {
  conversationId: string;
  message: string;
  currentPage?: string;
  maxAssistantTurns?: number;
}

export interface AIAction {
  type: string;
  input: Record<string, unknown>;
}

export interface AIChatResponse {
  message: string;
  actions?: AIAction[];
}

export interface ExecutedAction {
  type: string;
  input: Record<string, unknown>;
  status: "success" | "error";
  result?: unknown;
  error?: string;
}

export interface PlanningContext {
  accounts: Account[];
  categories: Category[];
  subcategories: Subcategory[];
  goals: SpendingGoalWithDetails[];
  tags: Tag[];
  recentTransactions: TransactionWithDetails[];
}

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

export interface SearchActionResult {
  action: AIAction;
  executedAction: ExecutedAction;
}

export interface ToolLoopState {
  turn: number;
  assistantMessage: string;
  actions: ExecutedAction[];
}

export interface ChatResult {
  conversationId: string;
  requestId: string;
  message: string;
  actions: ExecutedAction[];
  logFile: string;
}

export type ChatStreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "thinking"; message: string }
  | { type: "reasoning_delta"; message: string }
  | { type: "reasoning_details"; details: OpenRouterReasoningDetail[] }
  | { type: "response_delta"; content: string }
  | { type: "actions_planned"; actions: AIAction[] }
  | { type: "action_started"; index: number; action: AIAction }
  | { type: "action_finished"; index: number; action: ExecutedAction }
  | { type: "final"; data: ChatResult };

export type ChatStreamEmitter = (
  event: ChatStreamEvent,
) => void | Promise<void>;
