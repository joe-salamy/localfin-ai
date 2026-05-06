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
import { isoDateString, parseRequest } from './validation.js';
import { z } from 'zod';

const router = Router();
const dateRangeQuerySchema = z.object({
  startDate: isoDateString,
  endDate: isoDateString,
}).refine((value) => value.startDate <= value.endDate, 'startDate must be on or before endDate');

router.get('/account-summary', (req: Request, res: Response) => {
  try {
    const query = parseRequest(dateRangeQuerySchema, req.query, res);
    if (!query) return;
    const data = getAccountSummary(query.startDate, query.endDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/category-summary', (req: Request, res: Response) => {
  try {
    const query = parseRequest(dateRangeQuerySchema, req.query, res);
    if (!query) return;
    const data = getCategorySummary(query.startDate, query.endDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/metrics', (req: Request, res: Response) => {
  try {
    const query = parseRequest(dateRangeQuerySchema, req.query, res);
    if (!query) return;
    const data = getDashboardMetrics(query.startDate, query.endDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/charts/net-worth', (req: Request, res: Response) => {
  try {
    const query = parseRequest(dateRangeQuerySchema, req.query, res);
    if (!query) return;
    const data = prepareNetWorthData(query.startDate, query.endDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/charts/sankey', (req: Request, res: Response) => {
  try {
    const query = parseRequest(dateRangeQuerySchema, req.query, res);
    if (!query) return;
    const data = prepareSankeyData(query.startDate, query.endDate);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const dashboardRouter = router;
