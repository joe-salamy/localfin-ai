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
  runSuspectTransactionScan,
  getSuspectTransactionFindings,
  updateSuspectTransactionFindingStatus,
} from "../services/suspect-transactions.js";
import {
  finiteNumber,
  idParamSchema,
  isoDateString,
  nonEmptyString,
  optionalQueryStringArray,
  parseRequest,
} from "./validation.js";
import {
  suspectFindingStatusSchema as sharedSuspectFindingStatusSchema,
  suspectReasonCodeSchema,
  suspectSeveritySchema,
  transactionKindSchema,
} from "../../shared/contracts/transactions.js";

const optionalQueryBoolean = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean().optional());

const router = Router();
const transactionFiltersSchema = z.object({
  accountId: nonEmptyString.optional(),
  accountIds: optionalQueryStringArray,
  categoryIds: optionalQueryStringArray,
  subcategoryId: nonEmptyString.optional(),
  subcategoryIds: optionalQueryStringArray,
  tagIds: optionalQueryStringArray,
  kind: transactionKindSchema.optional(),
  needsCategory: optionalQueryBoolean,
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
  kind: transactionKindSchema.optional(),
  subcategory_id: nonEmptyString.nullable().optional(),
  tag_ids: z.array(nonEmptyString).max(50).optional(),
  comment: z.string().nullable().optional(),
  ai_suggested: z.boolean().optional(),
});
const updateTransactionSchema = z
  .object({
    date: isoDateString.optional(),
    name: nonEmptyString.optional(),
    amount: finiteNumber.optional(),
  kind: transactionKindSchema.optional(),
    subcategory_id: nonEmptyString.nullable().optional(),
    tag_ids: z.array(nonEmptyString).max(50).optional(),
    comment: z.string().nullable().optional(),
    ai_suggested: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );
const bulkCreateSchema = z.object({
  transactions: z.array(createTransactionSchema).min(1).max(500),
});
const bulkUpdateSchema = z.object({
  ids: z.array(nonEmptyString).min(1).max(500),
  updates: z
    .object({
      kind: transactionKindSchema.optional(),
      subcategory_id: nonEmptyString.nullable().optional(),
      add_tag_ids: z.array(nonEmptyString).max(50).optional(),
      remove_tag_ids: z.array(nonEmptyString).max(50).optional(),
    })
    .refine(
      (value) => Object.keys(value).length > 0,
      "At least one update field is required",
    ),
});
const bulkDeleteSchema = z.object({
  ids: z.array(nonEmptyString).min(1).max(500),
});
const bulkRestoreSchema = z.object({
  ids: z.array(nonEmptyString).min(1).max(500),
});
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
const transferCheckSchema = z
  .object({
    amount: finiteNumber,
    date: isoDateString,
    account_id: nonEmptyString.optional(),
    accountId: nonEmptyString.optional(),
  })
  .refine(
    (value) => value.account_id || value.accountId,
    "account_id is required",
  );
const suspectScanSchema = z.object({
  filters: transactionFiltersSchema.optional(),
  flaggedWords: z.array(nonEmptyString).max(100).optional(),
});
const suspectReasonSchema = suspectReasonCodeSchema;
const suspectFindingFiltersSchema = z.object({
  status: sharedSuspectFindingStatusSchema.optional(),
  severity: suspectSeveritySchema.optional(),
  reason: suspectReasonSchema.optional(),
  runId: nonEmptyString.optional(),
});
const suspectFindingStatusSchema = z.object({
  status: sharedSuspectFindingStatusSchema,
});

router.get("/", (req: Request, res: Response) => {
  const filters = parseRequest(transactionFiltersSchema, req.query);

  const data = getTransactionsWithDetails(filters);
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

  bulkUpdateTransactions(body.ids, body.updates);
  res.json({ success: true });
});

router.delete("/bulk", (req: Request, res: Response) => {
  const body = parseRequest(bulkDeleteSchema, req.body);

  bulkDeleteTransactions(body.ids);
  res.json({ success: true });
});

router.post("/bulk/restore", (req: Request, res: Response) => {
  const body = parseRequest(bulkRestoreSchema, req.body);

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
    body.account_id ?? (body.accountId as string),
    body.date,
  );
  res.json({ success: true, data });
});

router.post("/suspect-scan", (req: Request, res: Response) => {
  const body = parseRequest(suspectScanSchema, req.body);

  const data = runSuspectTransactionScan(body);
  res.status(201).json({ success: true, data });
});

router.get("/suspect-findings", (req: Request, res: Response) => {
  const filters = parseRequest(suspectFindingFiltersSchema, req.query);

  const data = getSuspectTransactionFindings(filters);
  res.json({ success: true, data });
});

router.put("/suspect-findings/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(suspectFindingStatusSchema, req.body);

  const data = updateSuspectTransactionFindingStatus(params.id, body.status);
  if (!data) throw new NotFoundError("Suspect finding not found");
  res.json({ success: true, data });
});

router.get("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = getTransactionById(params.id);
  if (!data) throw new NotFoundError("Transaction not found");
  res.json({ success: true, data });
});

router.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createTransactionSchema, req.body);

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
