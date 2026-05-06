import { appendFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AI_MODELS, ENV_KEYS, OPENROUTER_CONFIG, type AIModel } from '../config/app.js';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices: { message: { content: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
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
}

function safeLogId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, OPENROUTER_CONFIG.maxLogIdLength) || crypto.randomUUID();
}

const conversationLogFiles = new Map<string, string>();

function sortableTimestamp(date = new Date()): string {
  return date.toISOString().replace('T', '_').replace(/[:.]/g, '-');
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
