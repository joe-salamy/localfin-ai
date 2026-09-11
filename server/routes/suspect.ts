import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  suspectFindingStatusSchema as sharedSuspectFindingStatusSchema,
  suspectReasonCodeSchema,
  suspectSeveritySchema,
} from "../../shared/contracts/transactions.js";
import { NotFoundError } from "../errors.js";
import {
  getSuspectTransactionFindings,
  runSuspectTransactionScan,
  updateSuspectTransactionFindingStatus,
} from "../services/suspect-transactions.js";
import {
  idParamSchema,
  nonEmptyString,
  parseRequest,
} from "./validation.js";
import { transactionFiltersSchema } from "./transactions.js";

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
const suspectStatusBodySchema = z.object({
  status: sharedSuspectFindingStatusSchema,
});

export const suspectRouter = Router();

suspectRouter.post("/suspect-scan", (req: Request, res: Response) => {
  const body = parseRequest(suspectScanSchema, req.body);

  const data = runSuspectTransactionScan(body);
  res.status(201).json({ success: true, data });
});

suspectRouter.get("/suspect-findings", (req: Request, res: Response) => {
  const filters = parseRequest(suspectFindingFiltersSchema, req.query);

  const data = getSuspectTransactionFindings(filters);
  res.json({ success: true, data });
});

suspectRouter.put("/suspect-findings/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(suspectStatusBodySchema, req.body);

  const data = updateSuspectTransactionFindingStatus(params.id, body.status);
  if (!data) throw new NotFoundError("Suspect finding not found");
  res.json({ success: true, data });
});
