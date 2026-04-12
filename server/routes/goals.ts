import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSpendingGoal,
  getSpendingGoalsWithDetails,
  getSpendingGoalById,
  updateSpendingGoal,
  deleteSpendingGoal,
  getSpendingProgress,
} from '../services/goals.js';

const router = Router();

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
    const data = getSpendingGoalById(req.params.id as string);
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
    const { referenceDate } = req.query as { referenceDate?: string };
    const data = getSpendingProgress(req.params.id as string, referenceDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const data = createSpendingGoal(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const data = updateSpendingGoal(req.params.id as string, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteSpendingGoal(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const goalRouter = router;
