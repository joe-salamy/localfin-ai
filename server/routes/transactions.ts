import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
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
import { finiteNumber, idParamSchema, isoDateString, nonEmptyString, parseRequest } from './validation.js';

const router = Router();
const transactionFiltersSchema = z.object({
  accountId: nonEmptyString.optional(),
  subcategoryId: nonEmptyString.optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  searchQuery: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
const createTransactionSchema = z.object({
  account_id: nonEmptyString,
  date: isoDateString,
  name: nonEmptyString,
  amount: finiteNumber,
  subcategory_id: nonEmptyString.nullable().optional(),
  comment: z.string().nullable().optional(),
  ai_suggested: z.boolean().optional(),
  user_corrected: z.boolean().optional(),
});
const updateTransactionSchema = z.object({
  date: isoDateString.optional(),
  name: nonEmptyString.optional(),
  amount: finiteNumber.optional(),
  subcategory_id: nonEmptyString.nullable().optional(),
  comment: z.string().nullable().optional(),
  ai_suggested: z.boolean().optional(),
  user_corrected: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');
const bulkCreateSchema = z.object({
  transactions: z.array(createTransactionSchema).min(1).max(500),
});
const bulkUpdateSchema = z.object({
  ids: z.array(nonEmptyString).min(1).max(500),
  updates: z.object({ subcategory_id: nonEmptyString.nullable().optional() })
    .refine((value) => Object.keys(value).length > 0, 'At least one update field is required'),
});
const bulkDeleteSchema = z.object({
  ids: z.array(nonEmptyString).min(1).max(500),
});
const duplicateCheckSchema = z.object({
  transactions: z.array(z.object({
    date: isoDateString,
    name: nonEmptyString,
    amount: finiteNumber,
    account_id: nonEmptyString,
  })).min(1).max(500),
});
const transferCheckSchema = z.object({
  amount: finiteNumber,
  date: isoDateString,
  account_id: nonEmptyString.optional(),
  accountId: nonEmptyString.optional(),
}).refine((value) => value.account_id || value.accountId, 'account_id is required');

router.get('/', (req: Request, res: Response) => {
  try {
    const filters = parseRequest(transactionFiltersSchema, req.query, res);
    if (!filters) return;
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
    const body = parseRequest(bulkCreateSchema, req.body, res);
    if (!body) return;
    const data = bulkCreateTransactions(body.transactions);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/bulk', (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkUpdateSchema, req.body, res);
    if (!body) return;
    bulkUpdateTransactions(body.ids, body.updates);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/bulk', (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkDeleteSchema, req.body, res);
    if (!body) return;
    bulkDeleteTransactions(body.ids);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/check-duplicates', (req: Request, res: Response) => {
  try {
    const body = parseRequest(duplicateCheckSchema, req.body, res);
    if (!body) return;
    const data = checkDuplicates(body.transactions);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/check-transfer', (req: Request, res: Response) => {
  try {
    const body = parseRequest(transferCheckSchema, req.body, res);
    if (!body) return;
    const data = checkTransferMatch(body.amount, body.account_id ?? body.accountId as string, body.date);
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
    const data = getTransactionById(params.id);
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
    const body = parseRequest(createTransactionSchema, req.body, res);
    if (!body) return;
    const data = createTransaction(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateTransactionSchema, req.body, res);
    if (!params || !body) return;
    const data = updateTransaction(params.id, body);
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
    deleteTransaction(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const transactionRouter = router;
