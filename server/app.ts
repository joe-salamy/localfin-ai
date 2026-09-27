import express from "express";
import type { ErrorRequestHandler } from "express";
import { accountRouter } from "./routes/accounts.js";
import { categoryRouter, subcategoryRouter } from "./routes/categories.js";
import { tagRouter } from "./routes/tags.js";
import { transactionRouter } from "./routes/transactions.js";
import { suspectRouter } from "./routes/suspect.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { parserRouter } from "./routes/parser.js";
import { openApiRouter } from "./routes/openapi.js";
import { auditLog } from "./middleware/audit-log.js";
import { API_ROUTES, SERVER_CONFIG } from "./config/app.js";
import { OperationalError } from "./errors.js";

function hasExpressBodyErrorType(
  error: unknown,
  type: "entity.parse.failed" | "entity.too.large",
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === type
  );
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof OperationalError) {
    res
      .status(error.statusCode)
      .json({ success: false, error: error.message });
    return;
  }

  if (hasExpressBodyErrorType(error, "entity.parse.failed")) {
    res.status(400).json({ success: false, error: "Invalid JSON body" });
    return;
  }

  if (hasExpressBodyErrorType(error, "entity.too.large")) {
    res.status(413).json({ success: false, error: "Request body too large" });
    return;
  }

  console.error(`Unhandled ${req.method} ${req.path}`, error);
  res.status(500).json({ success: false, error: "Internal server error" });
};

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: SERVER_CONFIG.jsonLimit }));
  app.use(auditLog);

  app.get(API_ROUTES.health, (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
  app.use(API_ROUTES.openapi, openApiRouter);
  app.use(API_ROUTES.openapiJson, openApiRouter);

  app.use(API_ROUTES.accounts, accountRouter);
  app.use(API_ROUTES.categories, categoryRouter);
  app.use(API_ROUTES.subcategories, subcategoryRouter);
  app.use(API_ROUTES.tags, tagRouter);
  app.use(API_ROUTES.transactions, suspectRouter);
  app.use(API_ROUTES.transactions, transactionRouter);
  app.use(API_ROUTES.dashboard, dashboardRouter);
  app.use(API_ROUTES.parser, parserRouter);
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Route not found" });
  });
  app.use(errorHandler);
  return app;
}
