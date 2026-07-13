import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { NotFoundError } from "../errors.js";
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  getSpendingGoalById,
  updateSpendingGoal,
  deleteSpendingGoal,
  getSpendingProgress,
} from "../services/goals.js";
import {
  finiteNumber,
  idParamSchema,
  isoDateString,
  nonEmptyString,
  parseRequest,
} from "./validation.js";

const router = Router();
const goalPeriodSchema = z.enum(["weekly", "monthly", "quarterly", "annual"]);
const createGoalSchema = z
  .object({
    subcategory_id: nonEmptyString,
    amount: finiteNumber.positive(),
    period: goalPeriodSchema,
    start_date: isoDateString,
    end_date: isoDateString.nullable().optional(),
  })
  .refine(
    (value) => !value.end_date || value.start_date <= value.end_date,
    "start_date must be on or before end_date",
  );
const updateGoalSchema = z
  .object({
    amount: finiteNumber.positive().optional(),
    period: goalPeriodSchema.optional(),
    start_date: isoDateString.optional(),
    end_date: isoDateString.nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one update field is required",
  );
const progressQuerySchema = z.object({
  referenceDate: isoDateString.optional(),
});

router.get("/", (_req: Request, res: Response) => {
  const data = getSpendingGoalsWithDetails();
  res.json({ success: true, data });
});

router.get("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  const data = getSpendingGoalById(params.id);
  if (!data) throw new NotFoundError("Spending goal not found");
  res.json({ success: true, data });
});

router.get("/:id/progress", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const query = parseRequest(progressQuerySchema, req.query);

  const data = getSpendingProgress(params.id, query.referenceDate);
  res.json({ success: true, data });
});

router.post("/", (req: Request, res: Response) => {
  const body = parseRequest(createGoalSchema, req.body);

  const data = createSpendingGoal(body);
  res.status(201).json({ success: true, data });
});

router.put("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);
  const body = parseRequest(updateGoalSchema, req.body);

  const data = updateSpendingGoal(params.id, body);
  res.json({ success: true, data });
});

router.delete("/:id", (req: Request, res: Response) => {
  const params = parseRequest(idParamSchema, req.params);

  deleteSpendingGoal(params.id);
  res.json({ success: true });
});

export const goalRouter = router;
