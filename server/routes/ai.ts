import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { categorizeTransactions } from '../services/ai.js';
import { chatWithAssistant, streamChatWithAssistant } from '../services/ai-chat.js';
import { saveAICorrection, getAICorrections } from '../services/ai-corrections.js';
import { finiteNumber, nonEmptyString, parseRequest } from './validation.js';
import { HTTP_HEADERS } from '../config/app.js';

const router = Router();
const categorizeSchema = z.object({
  transactions: z.array(z.object({
    name: nonEmptyString,
    account_id: nonEmptyString,
    account_name: nonEmptyString,
    amount: finiteNumber,
  })).min(1).max(500),
  conversationId: nonEmptyString.optional(),
});
const correctionSchema = z.object({
  transaction_name: nonEmptyString,
  account_id: nonEmptyString,
  ai_suggested_subcategory_id: nonEmptyString.nullable().optional(),
  user_corrected_subcategory_id: nonEmptyString,
});
const chatSchema = z.object({
  conversationId: nonEmptyString,
  message: nonEmptyString.max(10_000),
  currentPage: z.string().optional(),
});

router.post('/categorize', async (req: Request, res: Response) => {
  try {
    const body = parseRequest(categorizeSchema, req.body, res);
    if (!body) return;
    const data = await categorizeTransactions(body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/corrections', (req: Request, res: Response) => {
  try {
    const body = parseRequest(correctionSchema, req.body, res);
    if (!body) return;
    const data = saveAICorrection(body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const body = parseRequest(chatSchema, req.body, res);
    if (!body) return;
    const data = await chatWithAssistant(body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/chat/stream', async (req: Request, res: Response) => {
  try {
    const body = parseRequest(chatSchema, req.body, res);
    if (!body) return;

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
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (!res.headersSent) {
      res.status(400).json({ success: false, error: message });
      return;
    }
    res.write('event: error\n');
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }
});

router.get('/corrections', (_req: Request, res: Response) => {
  try {
    const data = getAICorrections();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const aiRouter = router;
