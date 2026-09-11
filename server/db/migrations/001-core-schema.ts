import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { DATABASE_CONFIG } from "../../config/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function up(database: Database.Database): void {
  database.exec(
    fs.readFileSync(
      path.resolve(__dirname, "..", DATABASE_CONFIG.baselineSchemaFileName),
      "utf8",
    ),
  );
}
