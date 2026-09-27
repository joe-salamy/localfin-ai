import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError } from "../errors.js";
import {
  createTransaction,
  getTransactionsWithDetails,
  getTransactionById,
  getRecentActivityByAccount,
  updateTransaction,
  bulkUpdateTransactions,
  deleteTransaction,
  bulkDeleteTransactions,
  restoreTransaction,
  bulkRestoreTransactions,
  bulkCreateTransactions,
  checkDuplicates,
  checkTransferMatch,
} from "../services/transactions.js";
import {
  bulkTransactionIds,
  bulkTransactionUpdateFields,
  nonEmptyUpdate,
  transactionFiltersInput,
  transactionInput,
  transactionUpdateInput,
} from "../input-schemas.js";
import {
  finiteNumber,
  idParamSchema,
  isoDateString,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

const router = Router();
const updateTransactionSchema = nonEmptyUpdate(transactionUpdateInput.shape);
const bulkCreateSchema = z.object({
  transactions: z.array(transactionInput).min(1).max(500),
});
const bulkUpdateSchema = z.object({
  ids: bulkTransactionIds,
  updates: nonEmptyUpdate(bulkTransactionUpdateFields.shape),
});
const bulkIdsSchema = z.object({ ids: bulkTransactionIds });
const duplicateCheckSchema = z.object({
  transactions: z
    .array(
      z.object({
        date: isoDateString,
        name: nonEmptyString,
        amount: finiteNumber,
        account_id: nonEmptyString,
      }),
    )
    .min(1)
    .max(500),
});
const transferCheckSchema = z.object({
  amount: finiteNumber,
  date: isoDateString,
  account_id: nonEmptyString,
});

// Bounded server-side default so omitted `limit` never triggers a full-table
// scan; `offset` without `limit` now paginates instead of being ignored.
const DEFAULT_LIST_LIMIT = 500;

router.get("/", (req: Request, res: Response) => {
  const filters = parseRequest(transactionFiltersInput, req.query);

  const data = getTransactionsWithDetails({
    ...filters,
    limit: filters.limit ?? DEFAULT_LIST_LIMIT,
  });
  res.json({ success: true, data });
});

router.get("/recent-activity", (_req: Request, res: Response) => {
  const data = getRecentActivityByAccount();
  res.json({ success: true, data });
});

// Bulk routes BEFORE /:id to avoid "bulk" matching as an id
router.post("/bulk", (req: Request, res: Response) => {
  const body = parseRequest(bulkCreateSchema, req.body);

  const data = bulkCreateTransactions(body.transactions);
  res.status(201).json({ success: true, data });
});

router.put("/bulk", (req: Request, res: Response) => {
  const body = parseRequest(bulkUpdateSchema, req.body);

  const updatedIds = bulkUpdateTransactions(body.ids, body.updates);
  res.json({ success: true, data: { updatedIds } });
});

router.delete("/bulk", (req: Request, res: Response) => {
  const body = parseRequest(bulkIdsSchema, req.body);

  const deletedIds = bulkDeleteTransactions(body.ids);
  res.json({ success: true, data: { deletedIds } });
});

router.post("/bulk/restore", (req: Request, res: Response) => {
  const body = parseRequest(bulkIdsSchema, req.body);

  const data = bulkRestoreTransactions(body.ids);
  res.json({ success: true, data });
});

router.post("/check-duplicates", (req: Request, res: Response) => {
  const body = parseRequest(duplicateCheckSchema, req.body);

  const data = checkDuplicates(body.transactions);
  res.json({ success: true, data });
});

router.post("/check-transfer", (req: Request, res: Response) => {
  const body = parseRequest(transferCheckSchema, req.body);

  const data = checkTransferMatch(
    body.amount,
    body.account_id,
    body.date,
  );
  res.json({ success: true, data });
});

router.get("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = getTransactionById(params.id);
  if (!data) throw new NotFoundError("Transaction not found");
  res.json({ success: true, data });
});

router.post("/", (req: Request, res: Response) => {
  const body = parseRequest(transactionInput, req.body);

  const data = createTransaction(body);
  res.status(201).json({ success: true, data });
});

router.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateTransactionSchema, req.body);

  const data = updateTransaction(params.id, body);
  res.json({ success: true, data });
});

router.post("/:id/restore", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = restoreTransaction(params.id);
  res.json({ success: true, data });
});

router.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteTransaction(params.id);
  res.json({ success: true });
});

export const transactionRouter = router;
