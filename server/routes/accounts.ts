import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createAccount,
  getAccountsWithBalances,
  getAccountById,
  updateAccount,
  deleteAccount,
  getAccountTransactionCount,
} from '../services/accounts.js';
import { finiteNumber, idParamSchema, nonEmptyString, parseRequest } from './validation.js';

const router = Router();
const accountTypeSchema = z.enum(['asset', 'liability']);
const createAccountSchema = z.object({
  name: nonEmptyString,
  type: accountTypeSchema,
  initial_balance: finiteNumber.optional(),
});
const updateAccountSchema = z.object({
  name: nonEmptyString.optional(),
  type: accountTypeSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');

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
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    const data = getAccountById(params.id);
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
    const body = parseRequest(createAccountSchema, req.body, res);
    if (!body) return;
    const data = createAccount(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateAccountSchema, req.body, res);
    if (!params || !body) return;
    const data = updateAccount(params.id, body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    deleteAccount(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id/transaction-count', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    const data = getAccountTransactionCount(params.id);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const accountRouter = router;
