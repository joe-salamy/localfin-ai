import express from 'express';
import type { ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getDb } from './db/index.js';
import { accountRouter } from './routes/accounts.js';
import { categoryRouter, subcategoryRouter } from './routes/categories.js';
import { transactionRouter } from './routes/transactions.js';
import { dashboardRouter } from './routes/dashboard.js';
import { goalRouter } from './routes/goals.js';
import { aiRouter } from './routes/ai.js';
import { parserRouter } from './routes/parser.js';
import { API_ROUTES, ENV_KEYS, SERVER_CONFIG } from './config/app.js';

dotenv.config();

// Initialize database at startup
getDb();

const app = express();
const PORT = SERVER_CONFIG.port;
const allowedOrigins = new Set(
  (process.env[ENV_KEYS.corsOrigin] ?? SERVER_CONFIG.defaultCorsOrigins)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  },
}));
app.use(express.json({ limit: SERVER_CONFIG.jsonLimit }));

app.get(API_ROUTES.health, (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use(API_ROUTES.accounts, accountRouter);
app.use(API_ROUTES.categories, categoryRouter);
app.use(API_ROUTES.subcategories, subcategoryRouter);
app.use(API_ROUTES.transactions, transactionRouter);
app.use(API_ROUTES.dashboard, dashboardRouter);
app.use(API_ROUTES.goals, goalRouter);
app.use(API_ROUTES.ai, aiRouter);
app.use(API_ROUTES.parser, parserRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(message === 'Origin not allowed by CORS' ? 403 : 500).json({ success: false, error: message });
};

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
