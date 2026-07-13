import express from "express";
import type { ErrorRequestHandler } from "express";
import cors from "cors";
import { accountRouter } from "./routes/accounts.js";
import { categoryRouter, subcategoryRouter } from "./routes/categories.js";
import { tagRouter } from "./routes/tags.js";
import { transactionRouter } from "./routes/transactions.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { goalRouter } from "./routes/goals.js";
import { aiRouter } from "./routes/ai.js";
import { parserRouter } from "./routes/parser.js";
import { accountLinkingRouter } from "./routes/account-linking.js";
import { API_ROUTES, ENV_KEYS, SERVER_CONFIG } from "./config/app.js";
import { ForbiddenError, OperationalError } from "./errors.js";

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
  const allowedOrigins = new Set(
    (process.env[ENV_KEYS.corsOrigin] ?? SERVER_CONFIG.defaultCorsOrigins)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new ForbiddenError("Origin not allowed by CORS"));
      },
    }),
  );
  app.use(express.json({ limit: SERVER_CONFIG.jsonLimit }));

  app.get(API_ROUTES.health, (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use(API_ROUTES.accounts, accountRouter);
  app.use(API_ROUTES.categories, categoryRouter);
  app.use(API_ROUTES.subcategories, subcategoryRouter);
  app.use(API_ROUTES.tags, tagRouter);
  app.use(API_ROUTES.transactions, transactionRouter);
  app.use(API_ROUTES.dashboard, dashboardRouter);
  app.use(API_ROUTES.goals, goalRouter);
  app.use(API_ROUTES.ai, aiRouter);
  app.use(API_ROUTES.parser, parserRouter);
  app.use(API_ROUTES.accountLinking, accountLinkingRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Route not found" });
  });
  app.use(errorHandler);
  return app;
}
