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

dotenv.config();

// Initialize database at startup
getDb();

const app = express();
const PORT = 3001;
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
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
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.use('/api/accounts', accountRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/subcategories', subcategoryRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/goals', goalRouter);
app.use('/api/ai', aiRouter);
app.use('/api/parser', parserRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(message === 'Origin not allowed by CORS' ? 403 : 500).json({ success: false, error: message });
};

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
