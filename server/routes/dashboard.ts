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
const dateRangeQuerySchema = z
  .object(dateRangeQueryShape)
  .refine(
    (value) => value.startDate <= value.endDate,
    "startDate must be on or before endDate",
  );
const transactionReportQuerySchema = dateRangeQuerySchema.extend({
  tagIds: optionalQueryStringArray,
});

router.get("/account-summary", (req: Request, res: Response) => {
  const query = parseRequest(dateRangeQuerySchema, req.query);

  const data = getAccountSummary(query.startDate, query.endDate);
  res.json({ success: true, data });
});

router.get("/category-summary", (req: Request, res: Response) => {
  const query = parseRequest(transactionReportQuerySchema, req.query);

  const data = getCategorySummary(
    query.startDate,
    query.endDate,
    query.tagIds,
  );
  res.json({ success: true, data });
});

router.get("/metrics", (req: Request, res: Response) => {
  const query = parseRequest(transactionReportQuerySchema, req.query);

  const data = getDashboardMetrics(
    query.startDate,
    query.endDate,
    query.tagIds,
  );
  res.json({ success: true, data });
});

router.get("/charts/net-worth", (req: Request, res: Response) => {
  const query = parseRequest(dateRangeQuerySchema, req.query);

  const data = prepareNetWorthData(query.startDate, query.endDate);
  res.json({ success: true, data });
});

router.get("/charts/sankey", (req: Request, res: Response) => {
  const query = parseRequest(transactionReportQuerySchema, req.query);

  const data = prepareSankeyData(
    query.startDate,
    query.endDate,
    query.tagIds,
  );
  res.json({ success: true, data });
});

router.get("/tag-summary", (req: Request, res: Response) => {
  const query = parseRequest(transactionReportQuerySchema, req.query);

  const data = getTagSummary(query.startDate, query.endDate, query.tagIds);
  res.json({ success: true, data });
});

export const dashboardRouter = router;
