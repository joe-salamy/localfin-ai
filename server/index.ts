import dotenv from 'dotenv';
import { createApp } from './app.js';
import { getDb } from './db/index.js';
import { SERVER_CONFIG } from './config/app.js';

dotenv.config();

// Initialize database at startup
getDb();

const PORT = SERVER_CONFIG.port;

createApp().listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
