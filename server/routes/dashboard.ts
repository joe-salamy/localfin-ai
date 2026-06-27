import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
  getTagSummary,
} from '../services/dashboard.js';
import {
  prepareNetWorthData,
  prepareSankeyData,
} from '../services/charts.js';
import { isoDateString, parseRequest } from './validation.js';
import { z } from 'zod';

const optionalQueryStringArray = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}, z.array(z.string().trim().min(1)).optional());

const router = Router();
const dateRangeQueryShape = {
  startDate: isoDateString,
  endDate: isoDateString,
};
const dateRangeQuerySchema = z.object(dateRangeQueryShape)
  .refine((value) => value.startDate <= value.endDate, 'startDate must be on or before endDate');
const transactionReportQuerySchema = z.object({
  ...dateRangeQueryShape,
  tagIds: optionalQueryStringArray,
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
    const query = parseRequest(transactionReportQuerySchema, req.query, res);
    if (!query) return;
    const data = getCategorySummary(query.startDate, query.endDate, query.tagIds);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/metrics', (req: Request, res: Response) => {
  try {
    const query = parseRequest(transactionReportQuerySchema, req.query, res);
    if (!query) return;
    const data = getDashboardMetrics(query.startDate, query.endDate, query.tagIds);
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
    const query = parseRequest(transactionReportQuerySchema, req.query, res);
    if (!query) return;
    const data = prepareSankeyData(query.startDate, query.endDate, query.tagIds);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/tag-summary', (req: Request, res: Response) => {
  try {
    const query = parseRequest(transactionReportQuerySchema, req.query, res);
    if (!query) return;
    const data = getTagSummary(query.startDate, query.endDate, query.tagIds);
    res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

export const dashboardRouter = router;
