import dotenv from "dotenv";
import { createApp } from "./app.js";
import { getDb } from "./db/index.js";
import { SERVER_CONFIG } from "./config/app.js";

dotenv.config();

// Initialize database at startup
getDb();

const PORT = SERVER_CONFIG.port;

// Local-first app: the unauthenticated API deliberately binds to loopback
// only. Serving it on other interfaces would expose every financial record
// (and paid LLM endpoints) to the network; that requires real auth first.
createApp().listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
