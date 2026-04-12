import { Router } from 'express';
import type { Request, Response } from 'express';
import { categorizeTransactions } from '../services/ai.js';
import { saveAICorrection, getAICorrections } from '../services/ai-corrections.js';

const router = Router();

router.post('/categorize', async (req: Request, res: Response) => {
  try {
    const data = await categorizeTransactions(req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/corrections', (req: Request, res: Response) => {
  try {
    const data = saveAICorrection(req.body);
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
