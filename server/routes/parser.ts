import { Router } from 'express';
import type { Request, Response } from 'express';
import { parseStatement } from '../services/parser.js';

const router = Router();

router.post('/parse-statement', async (req: Request, res: Response) => {
  try {
    const { text, accountId } = req.body as { text?: string; accountId?: string };

    if (!text || typeof text !== 'string') {
      res.status(400).json({ success: false, error: 'Missing or invalid "text" field' });
      return;
    }

    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ success: false, error: 'Missing or invalid "accountId" field' });
      return;
    }

    const data = await parseStatement(text, accountId);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

export const parserRouter = router;
