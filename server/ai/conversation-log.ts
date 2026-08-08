import { appendFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { OPENROUTER_CONFIG } from "../config/app.js";

// Cap on cached (conversationId -> log file) entries; beyond it the cache is
// dropped wholesale and filenames are re-resolved on demand.
const MAX_CACHED_LOG_FILES = 2_000;

/**
 * Stable, collision-free filesystem key for a conversation id: hashing the
 * full id means ids that share sanitized prefixes never share a log file.
 */
function logIdHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

const conversationLogFiles = new Map<string, Promise<string>>();

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

function resolveConversationLogFile(
  conversationId: string,
): Promise<string> {
  // Single-flight: concurrent first appends for the same conversation share
  // one filename resolution instead of racing to create different files.
  const cached = conversationLogFiles.get(conversationId);
  if (cached) return cached;

  const resolution = (async () => {
    const fileSuffix = `-${logIdHash(conversationId)}.jsonl`;
    const existingFileName = (await readdir(OPENROUTER_CONFIG.logDirectory))
      .filter((name) => name.endsWith(fileSuffix))
      .sort()[0];
    return (
      existingFileName ??
      `${sortableTimestamp()}-${logIdHash(conversationId)}.jsonl`
    );
  })();

  conversationLogFiles.set(conversationId, resolution);
  void resolution.finally(() => {
    if (conversationLogFiles.get(conversationId) === resolution) {
      conversationLogFiles.delete(conversationId);
    }
    if (conversationLogFiles.size > MAX_CACHED_LOG_FILES) {
      conversationLogFiles.clear();
    }
  });
  return resolution;
}

export async function appendConversationLog(
  conversationId: string,
  event: Record<string, unknown>,
): Promise<string> {
  await mkdir(OPENROUTER_CONFIG.logDirectory, { recursive: true });
  const fileName = await resolveConversationLogFile(conversationId);
  const logFile = path.join(OPENROUTER_CONFIG.logDirectory, fileName);
  await appendFile(logFile, `${JSON.stringify(event)}\n`, "utf8");
  // Return the basename: absolute server paths leak the deployment layout.
  return fileName;
}
