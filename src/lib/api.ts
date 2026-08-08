import { z } from "zod";
import type { ApiResponse } from "@shared/contracts";
import {
  API_BASE_PATH,
  INVALID_SERVER_RESPONSE_MESSAGE,
  SERVER_UNREACHABLE_MESSAGE,
  SSE_ACCEPT_HEADER,
} from "@/config/constants";

function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}


function invalidServerResponse(): Error {
  return new Error(INVALID_SERVER_RESPONSE_MESSAGE);
}

export async function api<T>(
  path: string,
  options?: RequestInit,
  dataSchema?: z.ZodType<T>,
): Promise<ApiResponse<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_PATH}${path}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
  } catch {
    throw new Error(SERVER_UNREACHABLE_MESSAGE);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw invalidServerResponse();
  }

  const record = responseRecord(parsed);
  if (!record || typeof record.success !== "boolean") {
    throw invalidServerResponse();
  }

  if (!res.ok || !record.success) {
    if (typeof record.error !== "string") throw invalidServerResponse();
    throw new Error(record.error);
  }

  if (dataSchema) {
    const result = dataSchema.safeParse(record.data);
    if (!result.success) throw invalidServerResponse();
    return { success: true, data: result.data };
  }

  return parsed as ApiResponse<T>;
}

export const apiGet = <T>(path: string, dataSchema?: z.ZodType<T>) =>
  api<T>(path, undefined, dataSchema);
export const apiPost = <T>(
  path: string,
  body: unknown,
  dataSchema?: z.ZodType<T>,
) => api<T>(path, { method: "POST", body: JSON.stringify(body) }, dataSchema);
export const apiConfirmChat = <T>(
  body: { conversationId: string; requestId: string; approve: boolean },
  dataSchema?: z.ZodType<T>,
) => apiPost<T>("/ai/chat/confirm", body, dataSchema);
export const apiPut = <T>(
  path: string,
  body: unknown,
  dataSchema?: z.ZodType<T>,
) => api<T>(path, { method: "PUT", body: JSON.stringify(body) }, dataSchema);
export const apiDelete = <T>(
  path: string,
  body?: unknown,
  dataSchema?: z.ZodType<T>,
) =>
  api<T>(
    path,
    {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    dataSchema,
  );

export async function apiStream<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
  eventSchema?: z.ZodType<TEvent>,
): Promise<void> {
  const res = await fetch(`${API_BASE_PATH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: SSE_ACCEPT_HEADER },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw invalidServerResponse();
    }
    const record = responseRecord(parsed);
    if (!record || record.success !== false || typeof record.error !== "string") {
      throw invalidServerResponse();
    }
    throw new Error(record.error);
  }

  if (!res.body) throw invalidServerResponse();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBlock = (block: string): void => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw invalidServerResponse();
    }
    if (eventSchema) {
      const result = eventSchema.safeParse(event);
      if (!result.success) throw invalidServerResponse();
      onEvent(result.data);
      return;
    }
    onEvent(event as TEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(
        buffer[boundary] === "\r" ? boundary + 4 : boundary + 2,
      );
      processBlock(block);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (done) break;
  }

  if (buffer.trim()) processBlock(buffer);
}
