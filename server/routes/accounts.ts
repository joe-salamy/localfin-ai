import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError } from "../errors.js";
import {
  createAccount,
  getAccountsWithBalances,
  getAccountById,
  updateAccount,
  reconcileAccount,
  deleteAccount,
  restoreAccount,
  getAccountTransactionCount,
} from "../services/accounts.js";
import {
  finiteNumber,
  idParamSchema,
  isoDateString,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

const router = Router();
const accountTypeSchema = z.enum(["asset", "liability"]);
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();
const createAccountSchema = z.object({
  name: nonEmptyString,
  type: accountTypeSchema,
  initial_balance: finiteNumber.optional(),
  color: colorSchema.optional(),
});
const updateAccountSchema = z
  .object({
    name: nonEmptyString.optional(),
    type: accountTypeSchema.optional(),
    initial_balance: finiteNumber.optional(),
    color: colorSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );
const reconcileAccountSchema = z.object({
  date: isoDateString,
  target_balance: finiteNumber,
  name: nonEmptyString.optional(),
});

router.get("/", (_req: Request, res: Response) => {
  const data = getAccountsWithBalances();
  res.json({ success: true, data });
});

router.get("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = getAccountById(params.id);
  if (!data) throw new NotFoundError("Account not found");
  res.json({ success: true, data });
});

router.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createAccountSchema, req.body);

  const data = createAccount(body);
  res.status(201).json({ success: true, data });
});

router.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateAccountSchema, req.body);

  const data = updateAccount(params.id, body);
  res.json({ success: true, data });
});

router.post("/:id/reconcile", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(reconcileAccountSchema, req.body);

  const data = reconcileAccount(params.id, body);
  res.status(data.transaction ? 201 : 200).json({ success: true, data });
});

router.post("/:id/restore", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = restoreAccount(params.id);
  res.json({ success: true, data });
});

router.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteAccount(params.id);
  res.json({ success: true });
});

router.get("/:id/transaction-count", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = getAccountTransactionCount(params.id);
  res.json({ success: true, data });
});

export const accountRouter = router;
