/**
 * Redacts credential-shaped values from provider error text before it is
 * logged, stored, or returned. Matches snake_case/camelCase/kebab variants of
 * secret/token/password/credential/api-key/authorization keys in JSON, query
 * strings, and Bearer headers. Keys are matched by name anywhere in the key
 * (e.g. client_secret, clientSecret, access_token, PLAID-SECRET, api_key).
 */
const SECRET_KEY_PATTERN =
  /(?:[A-Za-z0-9_-]*(?:secret|token|password|passwd|credential|api[_-]?key|authorization|auth)[A-Za-z0-9_-]*)/;

const JSON_SECRET_VALUE_PATTERN = new RegExp(
  `("${SECRET_KEY_PATTERN.source}"\\s*:\\s*")[^"]+(")`,
  "gi",
);
const QUERY_SECRET_VALUE_PATTERN = new RegExp(
  `(${SECRET_KEY_PATTERN.source}=)[^&\\s"]+`,
  "gi",
);
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

function redactString(value: string): string {
  return value
    .replace(JSON_SECRET_VALUE_PATTERN, "$1[REDACTED]$2")
    .replace(QUERY_SECRET_VALUE_PATTERN, "$1[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]");
}

/** Recursively redacts credential-shaped values; always returns a string. */
export function redactSecrets(value: unknown): string {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => redactSecrets(item)));
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : redactSecrets(item);
  }
  return JSON.stringify(redacted);
}
