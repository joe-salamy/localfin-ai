import { z } from "zod";
import { transactionKindSchema, type TransactionKind } from "./transactions.js";

export interface ParsedTransaction {
  date: string;
  name: string;
  amount: number;
  needsReview: boolean;
  confidence: number;
  originalLine: string;
}

export interface EnrichedTransaction extends ParsedTransaction {
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  categorizationSource: "lookup" | "ai" | "none";
  isDuplicate: boolean;
}

export interface TransactionForCategorization {
  name: string;
  account_name: string;
  amount: number;
}

export interface CategorizationResult {
  subcategory_id: string;
  subcategory_name: string;
  category_name: string;
}

export interface CategorizeResult {
  transaction_name: string;
  kind: TransactionKind;
  subcategory_id: string | null;
  subcategory_name: string | null;
  category_name: string | null;
  source: "lookup" | "transfer" | "ai" | "none";
}

export interface ParseStatementResult {
  transactions: EnrichedTransaction[];
  summary: {
    total: number;
    duplicates: number;
    fromLookup: number;
    fromAI: number;
    uncategorized: number;
    needsReview: number;
  };
  format: string | null;
  parseSuccessRate: number;
  errors: string[];
}

export interface ChatRequest {
  conversationId: string;
  message: string;
  currentPage?: string;
  maxAssistantTurns?: number;
}

export interface ChatActionResult {
  type: string;
  input: Record<string, unknown>;
  status: "success" | "error";
  result?: unknown;
  error?: string;
}

export interface ChatResult {
  conversationId: string;
  requestId: string;
  message: string;
  actions: ChatActionResult[];
  logFile: string;
}

export interface AgentConversation {
  id: string;
  title: string;
  current_page: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  request_id: string | null;
  actions: ChatActionResult[] | null;
  log_file: string | null;
  status: "success" | "partial" | "error";
  created_at: string;
}

export type PlannedChatAction = Omit<
  ChatActionResult,
  "status" | "result" | "error"
>;

export type ChatStreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "thinking"; message: string }
  | { type: "actions_planned"; actions: PlannedChatAction[] }
  | { type: "action_started"; index: number; action: PlannedChatAction }
  | { type: "action_finished"; index: number; action: ChatActionResult }
  | { type: "final"; data: ChatResult }
  | { type: "error"; message: string };

export type ChatStreamEmitter = (
  event: ChatStreamEvent,
) => void | Promise<void>;


const parsedTransactionSchema = z.object({
  date: z.string(),
  name: z.string(),
  amount: z.number(),
  needsReview: z.boolean(),
  confidence: z.number(),
  originalLine: z.string(),
});

export const enrichedTransactionSchema: z.ZodType<EnrichedTransaction> =
  parsedTransactionSchema.extend({
    kind: transactionKindSchema,
    subcategory_id: z.string().nullable(),
    subcategory_name: z.string().nullable(),
    category_name: z.string().nullable(),
    categorizationSource: z.enum(["lookup", "ai", "none"]),
    isDuplicate: z.boolean(),
  });

export const categorizeResultSchema: z.ZodType<CategorizeResult> = z.object({
  transaction_name: z.string(),
  kind: transactionKindSchema,
  subcategory_id: z.string().nullable(),
  subcategory_name: z.string().nullable(),
  category_name: z.string().nullable(),
  source: z.enum(["lookup", "transfer", "ai", "none"]),
});

export const parseStatementResultSchema: z.ZodType<ParseStatementResult> =
  z.object({
    transactions: z.array(enrichedTransactionSchema),
    summary: z.object({
      total: z.number(),
      duplicates: z.number(),
      fromLookup: z.number(),
      fromAI: z.number(),
      uncategorized: z.number(),
      needsReview: z.number(),
    }),
    format: z.string().nullable(),
    parseSuccessRate: z.number(),
    errors: z.array(z.string()),
  });

export const chatActionResultSchema: z.ZodType<ChatActionResult> = z.object({
  type: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["success", "error"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const plannedChatActionSchema: z.ZodType<PlannedChatAction> = z.object({
  type: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const chatResultSchema: z.ZodType<ChatResult> = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  message: z.string(),
  actions: z.array(chatActionResultSchema),
  logFile: z.string(),
});

export const agentConversationSchema: z.ZodType<AgentConversation> = z.object({
  id: z.string(),
  title: z.string(),
  current_page: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

export const agentMessageSchema: z.ZodType<AgentMessage> = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  request_id: z.string().nullable(),
  actions: z.array(chatActionResultSchema).nullable(),
  log_file: z.string().nullable(),
  status: z.enum(["success", "partial", "error"]),
  created_at: z.string(),
});

export const chatStreamEventSchema: z.ZodType<ChatStreamEvent> =
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("started"),
      conversationId: z.string(),
      requestId: z.string(),
    }),
    z.object({ type: z.literal("thinking"), message: z.string() }),
    z.object({ type: z.literal("actions_planned"), actions: z.array(plannedChatActionSchema) }),
    z.object({
      type: z.literal("action_started"),
      index: z.number(),
      action: plannedChatActionSchema,
    }),
    z.object({
      type: z.literal("action_finished"),
      index: z.number(),
      action: chatActionResultSchema,
    }),
    z.object({ type: z.literal("final"), data: chatResultSchema }),
    z.object({ type: z.literal("error"), message: z.string() }),
  ]);
