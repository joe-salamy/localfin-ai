import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

const REDACT_PATTERN = /(secret|key|token|plaid|akoya)/i;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      if (REDACT_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactValue(val);
      }
    }
    return out;
  }
  return value;
}

function bodyRedacted(body: unknown): unknown {
  if (body === undefined || body === null) return body;
  try {
    return redactValue(body);
  } catch {
    return "[REDACTED]";
  }
}

function appendAudit(entry: { timestamp: string } & Record<string, unknown>): void {
  const line = `${JSON.stringify(entry)}\n`;
  const datePart = entry.timestamp.slice(0, 10);
  const baseDir = process.env.LOCALFIN_DATA_DIR?.trim() ? path.resolve(process.env.LOCALFIN_DATA_DIR) : process.cwd();
  const filePath = path.resolve(baseDir, "logs", "jsonl", `audit-${datePart}.jsonl`);
  fs.promises
    .mkdir(path.dirname(filePath), { recursive: true })
    .then(() => fs.promises.appendFile(filePath, line, "utf8"))
    .catch((error) => {
      console.error("auditLog append failed", error);
    });
}

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const start = Date.now();
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ??
    crypto.randomUUID();
  // Capture body snapshot (express.json already parsed it)
  const capturedBody = (req as unknown as { body?: unknown }).body;

  res.on("finish", () => {
    appendAudit({
      timestamp: new Date().toISOString(),
      method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      requestId,
      bodyRedacted: bodyRedacted(capturedBody),
    });
  });

  next();
}
