import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { accountTypeSchema } from "../../shared/contracts/accounts.js";
import type { ChatStreamEvent } from "../../shared/contracts/parsing-ai.js";
import { HTTP_HEADERS } from "../config/app.js";
import { NotFoundError, publicErrorMessage } from "../errors.js";
import { categorizeTransactions } from "../services/ai.js";
import {
  chatWithAssistant,
  executePendingApprovals,
  listPendingApprovals,
  normalizeMaxAssistantTurns,
  rejectPendingApprovals,
  serializeConversation,
  streamChatWithAssistant,
} from "../services/ai-chat.js";
import {
  createAgentConversation,
  getAgentConversation,
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
        account_type: accountTypeSchema.optional(),
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
  requestId: nonEmptyString.optional(),
});
const createConversationSchema = z.object({
  currentPage: z.string().optional(),
});
const conversationParamsSchema = z.object({
  id: nonEmptyString,
});
const confirmSchema = z.object({
  conversationId: nonEmptyString,
  requestId: nonEmptyString,
  approve: z.boolean(),
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
router.get(
  "/conversations/:id/pending-approvals",
  (req: Request, res: Response) => {
    const params = parseRequest(conversationParamsSchema, req.params);
    if (!getAgentConversation(params.id)) {
      throw new NotFoundError("Assistant conversation not found.");
    }
    res.json({ success: true, data: listPendingApprovals(params.id) });
  },
);

router.post("/chat", async (req: Request, res: Response) => {
  const body = parseRequest(chatSchema, req.body);
  const data = await chatWithAssistant(body);
  res.json({ success: true, data });
});

router.post("/chat/confirm", (req: Request, res: Response) => {
  const body = parseRequest(confirmSchema, req.body);

  const data = serializeConversation(body.conversationId, () =>
    body.approve
      ? executePendingApprovals(body.conversationId, body.requestId)
      : rejectPendingApprovals(body.conversationId, body.requestId),
  );
  data
    .then((result) => {
      res.json({ success: true, data: result });
    })
    .catch((error: unknown) => {
      res.status(400).json({
        success: false,
        error: publicErrorMessage(error),
      });
    });
});


router.post(
  "/chat/stream",
  async (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    // `req` close fires as soon as the body is consumed, so it cannot be used
    // for disconnect detection; `aborted` covers request interruption and
    // `res` close (guarded by writableEnded) covers client disconnect.
    const onResponseClose = () => {
      if (!res.writableEnded) abort();
    };
    req.on("aborted", abort);
    res.on("close", onResponseClose);

    // Writes after the client disconnects must not throw into the runner.
    const safeEmit = (event: ChatStreamEvent) => {
      try {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Socket is gone; the abort signal stops the runner.
      }
    };

    try {
      const body = parseRequest(chatSchema, req.body);
      res.setHeader(HTTP_HEADERS.contentType, HTTP_HEADERS.sseContentType);
      res.setHeader(HTTP_HEADERS.cacheControl, HTTP_HEADERS.sseCacheControl);
      res.setHeader(HTTP_HEADERS.connection, HTTP_HEADERS.sseConnection);
      res.flushHeaders();

      await streamChatWithAssistant(body, safeEmit, {
        signal: controller.signal,
      });
      res.end();
    } catch (error) {
      const aborted =
        error instanceof Error && error.name === "AbortError";
      if (!res.headersSent) {
        if (aborted) {
          res.end();
          return;
        }
        next(error);
        return;
      }
      if (aborted) {
        res.end();
        return;
      }
      try {
        res.write("event: error\n");
        res.write(
          `data: ${JSON.stringify({ type: "error", message: publicErrorMessage(error) })}\n\n`,
        );
      } catch {
        // Socket is gone; nothing left to do.
      }
      res.end();
    } finally {
      req.removeListener("aborted", abort);
      res.removeListener("close", onResponseClose);
    }
  },
);

export const aiRouter = router;
