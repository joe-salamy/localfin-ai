import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  getSpendingGoalById,
  updateSpendingGoal,
  deleteSpendingGoal,
  getSpendingProgress,
} from '../services/goals.js';
import { finiteNumber, idParamSchema, isoDateString, nonEmptyString, parseRequest } from './validation.js';

const router = Router();
const goalPeriodSchema = z.enum(['weekly', 'monthly', 'quarterly', 'annual']);
const createGoalSchema = z.object({
  subcategory_id: nonEmptyString,
  amount: finiteNumber.positive(),
  period: goalPeriodSchema,
  start_date: isoDateString,
  end_date: isoDateString.nullable().optional(),
}).refine((value) => !value.end_date || value.start_date <= value.end_date, 'start_date must be on or before end_date');
const updateGoalSchema = z.object({
  amount: finiteNumber.positive().optional(),
  period: goalPeriodSchema.optional(),
  start_date: isoDateString.optional(),
  end_date: isoDateString.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one update field is required');
const progressQuerySchema = z.object({
  referenceDate: isoDateString.optional(),
});

router.get('/', (_req: Request, res: Response) => {
  try {
    const data = getSpendingGoalsWithDetails();
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
    const data = getSpendingGoalById(params.id);
    if (!data) {
      res.status(404).json({ success: false, error: 'Spending goal not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/:id/progress', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const query = parseRequest(progressQuerySchema, req.query, res);
    if (!params || !query) return;
    const data = getSpendingProgress(params.id, query.referenceDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const body = parseRequest(createGoalSchema, req.body, res);
    if (!body) return;
    const data = createSpendingGoal(body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const params = parseRequest(idParamSchema, req.params, res);
    const body = parseRequest(updateGoalSchema, req.body, res);
    if (!params || !body) return;
    const data = updateSpendingGoal(params.id, body);
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
    deleteSpendingGoal(params.id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const goalRouter = router;
