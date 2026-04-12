import express from 'express';
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

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
