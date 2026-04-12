import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createTransaction,
  getTransactionsWithDetails,
  getTransactionById,
  getRecentActivityByAccount,
  updateTransaction,
  bulkUpdateTransactions,
  deleteTransaction,
  bulkDeleteTransactions,
  bulkCreateTransactions,
  checkDuplicates,
  checkTransferMatch,
} from '../services/transactions.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const filters: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        filters[key] = value;
      }
    }
    const data = getTransactionsWithDetails(filters);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/recent-activity', (_req: Request, res: Response) => {
  try {
    const data = getRecentActivityByAccount();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

// Bulk routes BEFORE /:id to avoid "bulk" matching as an id
router.post('/bulk', (req: Request, res: Response) => {
  try {
    const data = bulkCreateTransactions(req.body.transactions);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/bulk', (req: Request, res: Response) => {
  try {
    bulkUpdateTransactions(req.body.ids, req.body.updates);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/bulk', (req: Request, res: Response) => {
  try {
    bulkDeleteTransactions(req.body.ids);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/check-duplicates', (req: Request, res: Response) => {
  try {
    const data = checkDuplicates(req.body.transactions);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/check-transfer', (req: Request, res: Response) => {
  try {
    const data = checkTransferMatch(req.body.amount, req.body.accountId, req.body.date);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const data = getTransactionById(req.params.id as string);
    if (!data) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const data = createTransaction(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const data = updateTransaction(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteTransaction(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const transactionRouter = router;
