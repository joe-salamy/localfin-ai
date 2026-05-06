interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const SERVER_UNREACHABLE_MESSAGE =
  'Cannot reach the LocalFin server. Start the app with npm run dev and open http://localhost:5173.';

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
    res = await fetch(`/api${path}`, {
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
        ? 'LocalFin server returned an invalid response.'
        : fallbackErrorMessage(res.status);
      throw new Error(message);
    }
  }

  if (!isApiResponse<T>(json)) {
    if (!res.ok) {
      throw new Error(fallbackErrorMessage(res.status));
    }
    throw new Error('LocalFin server returned an invalid response.');
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
