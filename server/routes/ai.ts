import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { categorizeTransactions } from '../services/ai.js';
import { saveAICorrection, getAICorrections } from '../services/ai-corrections.js';
import { finiteNumber, nonEmptyString, parseRequest } from './validation.js';

const router = Router();
const categorizeSchema = z.object({
  transactions: z.array(z.object({
    name: nonEmptyString,
    account_id: nonEmptyString,
    account_name: nonEmptyString,
    amount: finiteNumber,
  })).min(1).max(500),
});
const correctionSchema = z.object({
  transaction_name: nonEmptyString,
  account_id: nonEmptyString,
  ai_suggested_subcategory_id: nonEmptyString.nullable().optional(),
  user_corrected_subcategory_id: nonEmptyString,
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
