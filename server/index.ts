import dotenv from "dotenv";
import { createApp } from "./app.js";
import { getDb } from "./db/index.js";
import { SERVER_CONFIG } from "./config/app.js";

dotenv.config();

// Initialize database at startup
try {
  getDb();
} catch (error) {
  console.error(`Database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const PORT = SERVER_CONFIG.port;

// Local-first app: the unauthenticated API deliberately binds to loopback
// only. Serving it on other interfaces would expose every financial record
// to the network; that requires real auth first.
createApp().listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
