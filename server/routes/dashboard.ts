import { Router } from "express";
import type { Request, Response } from "express";
import {
  getAccountSummary,
  getCategorySummary,
  getDashboardMetrics,
  getTagSummary,
} from "../services/dashboard.js";
import { prepareNetWorthData, prepareSankeyData } from "../services/charts.js";
import { z } from "zod";
import { MAX_REPORT_SPAN_DAYS, isWithinReportSpan } from "../../shared/validation.js";
import {
  isoDateString,
  optionalQueryStringArray,
  parseRequest,
} from "./validation.js";

const router = Router();

const dateRangeShape = { startDate: isoDateString, endDate: isoDateString };

function refineDateRange(
  value: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
): void {
  if (value.startDate > value.endDate) {
    ctx.addIssue({ code: "custom", message: "startDate must be on or before endDate" });
  } else if (!isWithinReportSpan(value.startDate, value.endDate)) {
    ctx.addIssue({ code: "custom", message: `Date range must not exceed ${MAX_REPORT_SPAN_DAYS} days` });
  }
}

// Strict so a filter an endpoint does not support (e.g. tagIds on the
// net-worth chart) is rejected instead of silently ignored.
const dateRangeQuerySchema = z.strictObject(dateRangeShape).superRefine(refineDateRange);
const taggedDateRangeQuerySchema = z
  .strictObject({ ...dateRangeShape, tagIds: optionalQueryStringArray })
  .superRefine(refineDateRange);

function withDateRange(handler: (startDate: string, endDate: string) => unknown) {
  return (req: Request, res: Response) => {
    const query = parseRequest(dateRangeQuerySchema, req.query);
    res.json({ success: true, data: handler(query.startDate, query.endDate) });
  };
}

function withTaggedDateRange(handler: (startDate: string, endDate: string, tagIds?: string[]) => unknown) {
  return (req: Request, res: Response) => {
    const query = parseRequest(taggedDateRangeQuerySchema, req.query);
    res.json({ success: true, data: handler(query.startDate, query.endDate, query.tagIds) });
  };
}

router.get("/account-summary", withDateRange(getAccountSummary));

router.get("/category-summary", withTaggedDateRange(getCategorySummary));

router.get("/metrics", withTaggedDateRange(getDashboardMetrics));

router.get("/charts/net-worth", withDateRange(prepareNetWorthData));

router.get("/charts/sankey", withTaggedDateRange(prepareSankeyData));

router.get("/tag-summary", withTaggedDateRange(getTagSummary));

export const dashboardRouter = router;
