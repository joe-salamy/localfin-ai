import { appendFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AI_MODELS, ENV_KEYS, OPENROUTER_CONFIG, type AIModel } from '../config/app.js';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterReasoningDetail {
  id?: string | null;
  type?: string;
  format?: string;
  index?: number;
  text?: string;
  summary?: string;
  data?: string;
  signature?: string | null;
  [key: string]: unknown;
}

interface OpenRouterResponse {
  choices: { message: { content: string; reasoning_details?: OpenRouterReasoningDetail[]; reasoning?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
}

interface OpenRouterStreamChunk {
  choices?: {
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_details?: OpenRouterReasoningDetail[];
    };
    finish_reason?: string | null;
  }[];
  usage?: OpenRouterResponse['usage'];
  error?: { message?: string; code?: string | number };
}

interface OpenRouterLogOptions {
  conversationId?: string;
  requestId?: string;
  operation?: string;
  model?: AIModel;
  metadata?: Record<string, unknown>;
}

export interface OpenRouterCallResult {
  content: string;
  parsedContent: unknown;
  conversationId: string;
  requestId: string;
  logFile: string;
  usage?: OpenRouterResponse['usage'];
  reasoning?: string;
  reasoningDetails?: OpenRouterReasoningDetail[];
}

export type OpenRouterStreamEvent =
  | { type: 'content_delta'; content: string }
  | { type: 'reasoning_delta'; reasoning: string }
  | { type: 'reasoning_details'; details: OpenRouterReasoningDetail[] };

type OpenRouterStreamEmitter = (event: OpenRouterStreamEvent) => void | Promise<void>;

function safeLogId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, OPENROUTER_CONFIG.maxLogIdLength) || crypto.randomUUID();
}

const conversationLogFiles = new Map<string, string>();

export function sortableTimestamp(date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: OPENROUTER_CONFIG.logFileTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}-${parts.fractionalSecond}PT`;
}

async function resolveConversationLogFile(conversationId: string): Promise<string> {
  const safeConversationId = safeLogId(conversationId);
  const cachedFileName = conversationLogFiles.get(safeConversationId);
  if (cachedFileName) return cachedFileName;

  const fileSuffix = `-${safeConversationId}.jsonl`;
  const existingFileName = (await readdir(OPENROUTER_CONFIG.logDirectory))
    .filter((name) => name.endsWith(fileSuffix))
    .sort()[0];
  const fileName = existingFileName ?? `${sortableTimestamp()}-${safeConversationId}.jsonl`;

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
  await appendFile(logFile, `${JSON.stringify(event)}\n`, 'utf8');
  return logFile;
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function parseSseDataBlocks(buffer: string): { blocks: string[]; remaining: string } {
  const blocks: string[] = [];
  let remaining = buffer;
  let boundary = remaining.search(/\r?\n\r?\n/);

  while (boundary !== -1) {
    const block = remaining.slice(0, boundary);
    const offset = remaining[boundary] === '\r' ? boundary + 4 : boundary + 2;
    remaining = remaining.slice(offset);
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (data) blocks.push(data);
    boundary = remaining.search(/\r?\n\r?\n/);
  }

  return { blocks, remaining };
}

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  options: OpenRouterLogOptions = {},
): Promise<OpenRouterCallResult> {
  const apiKey = process.env[ENV_KEYS.openRouterApiKey];
  if (!apiKey || apiKey === OPENROUTER_CONFIG.apiKeyPlaceholder) {
    throw new Error(`${ENV_KEYS.openRouterApiKey} not configured. Set it in .env file.`);
  }

  const conversationId = safeLogId(options.conversationId ?? crypto.randomUUID());
  const requestId = options.requestId ?? crypto.randomUUID();
  const operation = options.operation ?? OPENROUTER_CONFIG.defaultOperation;
  const model = options.model ?? AI_MODELS.transactionCategorization;
  const startedAt = new Date();
  const body = {
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  try {
    const response = await fetch(OPENROUTER_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      const error = `OpenRouter API error: ${response.status} ${err}`;
      const logFile = await appendConversationLog(conversationId, {
        timestamp: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: 'error',
        provider: OPENROUTER_CONFIG.providerName,
        operation,
        model,
        conversationId,
        requestId,
        request: body,
        responseStatus: response.status,
        error,
        metadata: options.metadata ?? {},
      });
      void logFile;
      throw new Error(error);
    }

    const data = await response.json() as OpenRouterResponse;
    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error('OpenRouter API returned an empty response');
    }

    const parsedContent = parseJsonContent(content);
    const logFile = await appendConversationLog(conversationId, {
      timestamp: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: 'success',
      provider: OPENROUTER_CONFIG.providerName,
      operation,
      model,
      conversationId,
      requestId,
      request: body,
      rawResponse: data,
      responseText: content,
      parsedResponse: parsedContent,
      usage: data.usage ?? null,
      metadata: options.metadata ?? {},
    });

    return {
      content,
      parsedContent,
      conversationId,
      requestId,
      logFile,
      usage: data.usage,
      reasoning: data.choices[0]?.message.reasoning,
      reasoningDetails: data.choices[0]?.message.reasoning_details,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('OpenRouter API error:')) {
      await appendConversationLog(conversationId, {
        timestamp: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: 'error',
        provider: OPENROUTER_CONFIG.providerName,
        operation,
        model,
        conversationId,
        requestId,
        request: body,
        error: error.message,
        metadata: options.metadata ?? {},
      });
    }
    throw error;
  }
}

export async function streamOpenRouter(
  messages: OpenRouterMessage[],
  options: OpenRouterLogOptions = {},
  emit?: OpenRouterStreamEmitter,
): Promise<OpenRouterCallResult> {
  const apiKey = process.env[ENV_KEYS.openRouterApiKey];
  if (!apiKey || apiKey === OPENROUTER_CONFIG.apiKeyPlaceholder) {
    throw new Error(`${ENV_KEYS.openRouterApiKey} not configured. Set it in .env file.`);
  }

  const conversationId = safeLogId(options.conversationId ?? crypto.randomUUID());
  const requestId = options.requestId ?? crypto.randomUUID();
  const operation = options.operation ?? OPENROUTER_CONFIG.defaultOperation;
  const model = options.model ?? AI_MODELS.transactionCategorization;
  const startedAt = new Date();
  const body = {
    model,
    messages,
    temperature: 0,
    response_format: { type: 'json_object' },
    reasoning: {},
    stream: true,
    stream_options: { include_usage: true },
  };

  const chunks: OpenRouterStreamChunk[] = [];
  const reasoningDetails: OpenRouterReasoningDetail[] = [];
  let content = '';
  let reasoning = '';
  let usage: OpenRouterResponse['usage'] | undefined;

  try {
    const response = await fetch(OPENROUTER_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      const error = `OpenRouter API error: ${response.status} ${err}`;
      await appendConversationLog(conversationId, {
        timestamp: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: 'error',
        provider: OPENROUTER_CONFIG.providerName,
        operation,
        model,
        conversationId,
        requestId,
        request: body,
        responseStatus: response.status,
        error,
        metadata: options.metadata ?? {},
      });
      throw new Error(error);
    }

    if (!response.body) {
      throw new Error('OpenRouter streaming response body is unavailable.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processDataBlock = async (block: string) => {
      if (block === '[DONE]') return;
      const chunk = JSON.parse(block) as OpenRouterStreamChunk;
      chunks.push(chunk);

      if (chunk.error) {
        throw new Error(chunk.error.message ?? `OpenRouter stream error: ${chunk.error.code ?? 'unknown'}`);
      }

      if (chunk.usage) usage = chunk.usage;

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) return;

      if (delta.reasoning) {
        reasoning += delta.reasoning;
        await emit?.({ type: 'reasoning_delta', reasoning: delta.reasoning });
      }

      if (delta.reasoning_details && delta.reasoning_details.length > 0) {
        reasoningDetails.push(...delta.reasoning_details);
        await emit?.({ type: 'reasoning_details', details: delta.reasoning_details });
      }

      if (delta.content) {
        content += delta.content;
        await emit?.({ type: 'content_delta', content: delta.content });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const parsed = parseSseDataBlocks(buffer);
      buffer = parsed.remaining;

      for (const block of parsed.blocks) {
        await processDataBlock(block);
      }

      if (done) break;
    }

    if (buffer.trim()) {
      const parsed = parseSseDataBlocks(`${buffer}\n\n`);
      for (const block of parsed.blocks) {
        await processDataBlock(block);
      }
    }

    if (!content) {
      throw new Error('OpenRouter API returned an empty response');
    }

    const parsedContent = parseJsonContent(content);
    const logFile = await appendConversationLog(conversationId, {
      timestamp: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status: 'success',
      provider: OPENROUTER_CONFIG.providerName,
      operation,
      model,
      conversationId,
      requestId,
      request: body,
      streamChunks: chunks,
      responseText: content,
      reasoning: reasoning || null,
      reasoningDetails,
      parsedResponse: parsedContent,
      usage: usage ?? null,
      metadata: options.metadata ?? {},
    });

    return {
      content,
      parsedContent,
      conversationId,
      requestId,
      logFile,
      usage,
      reasoning,
      reasoningDetails,
    };
  } catch (error) {
    if (error instanceof Error && !error.message.startsWith('OpenRouter API error:')) {
      await appendConversationLog(conversationId, {
        timestamp: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: 'error',
        provider: OPENROUTER_CONFIG.providerName,
        operation,
        model,
        conversationId,
        requestId,
        request: body,
        partialResponseText: content,
        partialReasoning: reasoning || null,
        partialReasoningDetails: reasoningDetails,
        streamChunks: chunks,
        error: error.message,
        metadata: options.metadata ?? {},
      });
    }
    throw error;
  }
}
