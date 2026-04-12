import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createAccount,
  getAccountsWithBalances,
  getAccountById,
  updateAccount,
  deleteAccount,
  getAccountTransactionCount,
} from '../services/accounts.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const data = getAccountsWithBalances();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const data = getAccountById(req.params.id as string);
    if (!data) {
      res.status(404).json({ success: false, error: 'Account not found' });
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
    const data = createAccount(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const data = updateAccount(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteAccount(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id/transaction-count', (req: Request, res: Response) => {
  try {
    const data = getAccountTransactionCount(req.params.id as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const accountRouter = router;
