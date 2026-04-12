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
