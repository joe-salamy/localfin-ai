import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
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
  getSuspectTransactionFindings,
  runSuspectTransactionScan,
  updateSuspectTransactionFindingStatus,
} from "../services/suspect-transactions.js";
import {
  finiteNumber,
  idParamSchema,
  isoDateString,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

const optionalQueryBoolean = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean().optional());
const optionalQueryStringArray = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}, z.array(nonEmptyString).optional());

const router = Router();
const transactionFiltersSchema = z.object({
  accountId: nonEmptyString.optional(),
  accountIds: optionalQueryStringArray,
  categoryIds: optionalQueryStringArray,
  subcategoryId: nonEmptyString.optional(),
  subcategoryIds: optionalQueryStringArray,
  tagIds: optionalQueryStringArray,
  kind: z.enum(["income", "expense", "transfer", "adjustment"]).optional(),
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
  kind: z.enum(["income", "expense", "transfer", "adjustment"]).optional(),
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
    kind: z.enum(["income", "expense", "transfer", "adjustment"]).optional(),
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
      kind: z.enum(["income", "expense", "transfer", "adjustment"]).optional(),
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
const suspectReasonSchema = z.enum([
  "exact_duplicate",
  "near_duplicate",
  "large_amount_outlier",
  "merchant_amount_outlier",
  "rapid_small_charge_cluster",
  "missing_category",
  "unmatched_transfer_like",
  "flagged_word",
]);
const suspectScanSchema = z.object({
  filters: transactionFiltersSchema.optional(),
  flaggedWords: z.array(z.string()).max(100).optional(),
});
const suspectFindingFiltersSchema = z.object({
  status: z.enum(["open", "dismissed", "resolved"]).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  reason: suspectReasonSchema.optional(),
  runId: nonEmptyString.optional(),
});
const suspectFindingStatusSchema = z.object({
  status: z.enum(["open", "dismissed", "resolved"]),
});

router.get("/", (req: Request, res: Response) => {
  try {
    const filters = parseRequest(transactionFiltersSchema, req.query, res);
    if (!filters) return;
    const data = getTransactionsWithDetails(filters);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.get("/recent-activity", (_req: Request, res: Response) => {
  try {
    const data = getRecentActivityByAccount();
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

// Bulk routes BEFORE /:id to avoid "bulk" matching as an id
router.post("/bulk", (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkCreateSchema, req.body, res);
    if (!body) return;
    const data = bulkCreateTransactions(body.transactions);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.put("/bulk", (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkUpdateSchema, req.body, res);
    if (!body) return;
    bulkUpdateTransactions(body.ids, body.updates);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.delete("/bulk", (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkDeleteSchema, req.body, res);
    if (!body) return;
    bulkDeleteTransactions(body.ids);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/bulk/restore", (req: Request, res: Response) => {
  try {
    const body = parseRequest(bulkRestoreSchema, req.body, res);
    if (!body) return;
    const data = bulkRestoreTransactions(body.ids);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/check-duplicates", (req: Request, res: Response) => {
  try {
    const body = parseRequest(duplicateCheckSchema, req.body, res);
    if (!body) return;
    const data = checkDuplicates(body.transactions);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/check-transfer", (req: Request, res: Response) => {
  try {
    const body = parseRequest(transferCheckSchema, req.body, res);
    if (!body) return;
    const data = checkTransferMatch(
      body.amount,
      body.account_id ?? (body.accountId as string),
      body.date,
    );
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/suspect-scan", (req: Request, res: Response) => {
  try {
    const body = parseRequest(suspectScanSchema, req.body, res);
    if (!body) return;
    const data = runSuspectTransactionScan(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.get("/suspect-findings", (req: Request, res: Response) => {
  try {
    const filters = parseRequest(suspectFindingFiltersSchema, req.query, res);
    if (!filters) return;
    const data = getSuspectTransactionFindings(filters);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.put("/suspect-findings/:id", (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(suspectFindingStatusSchema, req.body, res);
    if (!params || !body) return;
    const data = updateSuspectTransactionFindingStatus(params.id, body.status);
    if (!data) {
      res
        .status(404)
        .json({ success: false, error: "Suspect finding not found" });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.get("/:id", (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    const data = getTransactionById(params.id);
    if (!data) {
      res.status(404).json({ success: false, error: "Transaction not found" });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/", (req: Request, res: Response) => {
  try {
    const body = parseRequest(createTransactionSchema, req.body, res);
    if (!body) return;
    const data = createTransaction(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.put("/:id", (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateTransactionSchema, req.body, res);
    if (!params || !body) return;
    const data = updateTransaction(params.id, body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.post("/:id/restore", (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    const data = restoreTransaction(params.id);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    if (!params) return;
    deleteTransaction(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: message });
  }
});

export const transactionRouter = router;
