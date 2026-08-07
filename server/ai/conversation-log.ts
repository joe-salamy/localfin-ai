import { appendFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OPENROUTER_CONFIG } from "../config/app.js";

function safeLogId(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, OPENROUTER_CONFIG.maxLogIdLength) || crypto.randomUUID()
  );
}

const conversationLogFiles = new Map<string, string>();

export function sortableTimestamp(date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: OPENROUTER_CONFIG.logFileTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-${parts.fractionalSecond}PT`;
}

async function resolveConversationLogFile(
  conversationId: string,
): Promise<string> {
  const safeConversationId = safeLogId(conversationId);
  const cachedFileName = conversationLogFiles.get(safeConversationId);
  if (cachedFileName) return cachedFileName;

  const fileSuffix = `-${safeConversationId}.jsonl`;
  const existingFileName = (await readdir(OPENROUTER_CONFIG.logDirectory))
    .filter((name) => name.endsWith(fileSuffix))
    .sort()[0];
  const fileName =
    existingFileName ?? `${sortableTimestamp()}-${safeConversationId}.jsonl`;

  conversationLogFiles.set(safeConversationId, fileName);
  return fileName;
}

export async function appendConversationLog(
  conversationId: string,
  event: Record<string, unknown>,
): Promise<string> {
  await mkdir(OPENROUTER_CONFIG.logDirectory, { recursive: true });
  const fileName = await resolveConversationLogFile(conversationId);
  const logFile = path.join(OPENROUTER_CONFIG.logDirectory, fileName);
  await appendFile(logFile, `${JSON.stringify(event)}\n`, "utf8");
  return logFile;
}
