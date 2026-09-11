import { HEX_COLOR_PATTERN } from "../validation.js";
export const DEFAULT_ENTITY_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#78716c",
  "#64748b",
  "#6b7280",
] as const;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function normalizeColor(value: unknown): string | null {
  if (value == null || value === "") return null;
  return isHexColor(value) ? value.toLowerCase() : null;
}

export function stableColorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % DEFAULT_ENTITY_COLORS.length;
}

export function resolveEntityColor(id: string, color?: string | null): string {
  return normalizeColor(color) ?? DEFAULT_ENTITY_COLORS[stableColorIndex(id)];
}

