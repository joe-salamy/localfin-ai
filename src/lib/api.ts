import {
  API_BASE_PATH,
  INVALID_SERVER_RESPONSE_MESSAGE,
  SERVER_UNREACHABLE_MESSAGE,
  SSE_ACCEPT_HEADER,
} from '@/config/constants';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return typeof value === 'object' && value !== null && 'success' in value;
}

function fallbackErrorMessage(status: number): string {
  if (status >= 500) {
    return SERVER_UNREACHABLE_MESSAGE;
  }

  return `LocalFin server request failed with status ${status}.`;
}

export async function api<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  let res: Response;

  try {
    res = await fetch(`${API_BASE_PATH}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  } catch {
    throw new Error(SERVER_UNREACHABLE_MESSAGE);
  }

  const text = await res.text();
  let json: unknown = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const message = res.ok
        ? INVALID_SERVER_RESPONSE_MESSAGE
        : fallbackErrorMessage(res.status);
      throw new Error(message);
    }
  }

  if (!isApiResponse<T>(json)) {
    if (!res.ok) {
      throw new Error(fallbackErrorMessage(res.status));
    }
    throw new Error(INVALID_SERVER_RESPONSE_MESSAGE);
  }

  if (!res.ok || !json.success) {
    throw new Error(json.error || fallbackErrorMessage(res.status));
  }

  return json;
}

// Convenience methods
export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const apiDelete = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });

export async function apiStream<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE_PATH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: SSE_ACCEPT_HEADER },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed with status ${res.status}`;
    if (text) {
      try {
        const json = JSON.parse(text) as { error?: unknown };
        if (typeof json.error === 'string') {
          message = json.error;
        }
      } catch {
        // Keep the raw response text when the server did not return JSON.
      }
    }
    throw new Error(message);
  }

  if (!res.body) {
    throw new Error('Streaming response body is unavailable.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (!data) return;
    onEvent(JSON.parse(data) as TEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(buffer[boundary] === '\r' ? boundary + 4 : boundary + 2);
      processBlock(block);
      boundary = buffer.search(/\r?\n\r?\n/);
    }

    if (done) break;
  }

  if (buffer.trim()) {
    processBlock(buffer);
  }
}
