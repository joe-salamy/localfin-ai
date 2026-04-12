import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
} from '../services/dashboard.js';
import {
  prepareNetWorthData,
  prepareSankeyData,
} from '../services/charts.js';

const router = Router();

router.get('/account-summary', (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = getAccountSummary(startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/category-summary', (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = getCategorySummary(startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/metrics', (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = getDashboardMetrics(startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/charts/net-worth', (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = prepareNetWorthData(startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/charts/sankey', (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = prepareSankeyData(startDate as string, endDate as string);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const dashboardRouter = router;
