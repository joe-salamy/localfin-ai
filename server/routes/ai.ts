import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { HTTP_HEADERS } from "../config/app.js";
import { publicErrorMessage } from "../errors.js";
import { categorizeTransactions } from "../services/ai.js";
import {
  chatWithAssistant,
  normalizeMaxAssistantTurns,
  streamChatWithAssistant,
} from "../services/ai-chat.js";
import {
  createAgentConversation,
  getAgentMessages,
  listAgentConversations,
  softDeleteAgentConversation,
} from "../services/agent-conversations.js";
import {
  finiteNumber,
  isoDateString,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

const router = Router();
const categorizeSchema = z.object({
  transactions: z
    .array(
      z.object({
        name: nonEmptyString,
        account_id: nonEmptyString,
        account_name: nonEmptyString,
        account_type: z.enum(["asset", "liability"]).optional(),
        amount: finiteNumber,
        date: isoDateString.optional(),
      }),
    )
    .min(1)
    .max(500),
  conversationId: nonEmptyString.optional(),
});
const maxAssistantTurnsSchema = z.preprocess(
  normalizeMaxAssistantTurns,
  z.number().int().min(1).max(10),
);

export const chatSchema = z.object({
  conversationId: nonEmptyString,
  message: nonEmptyString.max(10_000),
  currentPage: z.string().optional(),
  maxAssistantTurns: maxAssistantTurnsSchema.optional(),
});
const createConversationSchema = z.object({
  currentPage: z.string().optional(),
});
const conversationParamsSchema = z.object({
  id: nonEmptyString,
});

router.post("/categorize", async (req: Request, res: Response) => {
  const body = parseRequest(categorizeSchema, req.body);
  const data = await categorizeTransactions(body);
  res.json({ success: true, data });
});

router.get("/conversations", (_req: Request, res: Response) => {
  res.json({ success: true, data: listAgentConversations() });
});

router.post("/conversations", (req: Request, res: Response) => {
  const body = parseRequest(createConversationSchema, req.body);
  const data = createAgentConversation({
    currentPage: body.currentPage ?? null,
  });
  res.status(201).json({ success: true, data });
});

router.get("/conversations/:id/messages", (req: Request, res: Response) => {
  const params = parseRequest(conversationParamsSchema, req.params);
  const data = getAgentMessages(params.id);
  res.json({ success: true, data });
});

router.delete("/conversations/:id", (req: Request, res: Response) => {
  const params = parseRequest(conversationParamsSchema, req.params);
  softDeleteAgentConversation(params.id);
  res.json({ success: true, data: { id: params.id } });
});

router.post("/chat", async (req: Request, res: Response) => {
  const body = parseRequest(chatSchema, req.body);
  const data = await chatWithAssistant(body);
  res.json({ success: true, data });
});

router.post(
  "/chat/stream",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseRequest(chatSchema, req.body);
      res.setHeader(HTTP_HEADERS.contentType, HTTP_HEADERS.sseContentType);
      res.setHeader(HTTP_HEADERS.cacheControl, HTTP_HEADERS.sseCacheControl);
      res.setHeader(HTTP_HEADERS.connection, HTTP_HEADERS.sseConnection);
      res.flushHeaders();

      await streamChatWithAssistant(body, (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.write("event: error\n");
      res.write(
        `data: ${JSON.stringify({ type: "error", message: publicErrorMessage(error) })}\n\n`,
      );
      res.end();
    }
  },
);

export const aiRouter = router;
