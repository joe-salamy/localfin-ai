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

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (
    method === "GET" ||
    req.path === "/api/health" ||
    req.path === "/api/openapi.json" ||
    req.path === "/api/openapi" ||
    req.path.startsWith("/api/openapi/")
  ) {
    next();
    return;
  }
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    next();
    return;
  }

  const start = Date.now();
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ??
    crypto.randomUUID();
  // Capture body snapshot (express.json already parsed it)
  const capturedBody = (req as unknown as { body?: unknown }).body;

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      durationMs,
      requestId,
      bodyRedacted: bodyRedacted(capturedBody),
    };
    const line = `${JSON.stringify(entry)}\n`;
    const datePart = timestamp.slice(0, 10);
    const fileName = `audit-${datePart}.jsonl`;
    const filePath = path.resolve(process.cwd(), "logs", "jsonl", fileName);
    // Avoid blocking request; log async and swallow errors.
    fs.promises
      .mkdir(path.dirname(filePath), { recursive: true })
      .then(() => fs.promises.appendFile(filePath, line, "utf8"))
      .catch((error) => {
        console.error("auditLog append failed", error);
      });
  });

  next();
}
