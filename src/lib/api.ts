export async function api<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Unknown error');
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
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
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
