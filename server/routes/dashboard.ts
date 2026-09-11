import { Router } from "express";
import type { Request, Response } from "express";
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
  getTagSummary,
} from "../services/dashboard.js";
import { prepareNetWorthData, prepareSankeyData } from "../services/charts.js";
import {
  isoDateString,
  optionalQueryStringArray,
  parseRequest,
} from "./validation.js";
import { z } from "zod";


const router = Router();
const dateRangeQueryShape = {
  startDate: isoDateString,
  endDate: isoDateString,
};
// Date spans beyond this would generate unbounded per-day balance points and
// SQLite work for the net-worth chart.
const MAX_REPORT_SPAN_DAYS = 3660;

const maxSpanRefine = (value: { startDate: string; endDate: string }) => {
  const spanDays =
    (Date.parse(`${value.endDate}T00:00:00Z`) -
      Date.parse(`${value.startDate}T00:00:00Z`)) /
    86_400_000;
  return spanDays <= MAX_REPORT_SPAN_DAYS;
};

const dateRangeQuerySchema = z
  .object(dateRangeQueryShape)
  .refine(
    (value) => value.startDate <= value.endDate,
    "startDate must be on or before endDate",
  )
  .refine(maxSpanRefine, `Date range must not exceed ${MAX_REPORT_SPAN_DAYS} days`);
const transactionReportQuerySchema = dateRangeQuerySchema.safeExtend({
  tagIds: optionalQueryStringArray,
});
function withDateRange(handler: (startDate: string, endDate: string, tagIds?: string[]) => unknown) {
  return (req: Request, res: Response) => {
    const query = parseRequest(transactionReportQuerySchema, req.query);
    res.json({ success: true, data: handler(query.startDate, query.endDate, query.tagIds) });
  };
}

router.get("/account-summary", withDateRange((startDate, endDate) => getAccountSummary(startDate, endDate)));

router.get("/category-summary", withDateRange((startDate, endDate, tagIds) => getCategorySummary(startDate, endDate, tagIds)));

router.get("/metrics", withDateRange((startDate, endDate, tagIds) => getDashboardMetrics(startDate, endDate, tagIds)));

router.get("/charts/net-worth", withDateRange((startDate, endDate) => prepareNetWorthData(startDate, endDate)));

router.get("/charts/sankey", withDateRange((startDate, endDate, tagIds) => prepareSankeyData(startDate, endDate, tagIds)));

router.get("/tag-summary", withDateRange((startDate, endDate, tagIds) => getTagSummary(startDate, endDate, tagIds)));

export const dashboardRouter = router;
