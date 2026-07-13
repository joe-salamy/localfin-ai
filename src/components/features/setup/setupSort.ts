export type SortDirection = "asc" | "desc";

export interface SortConfig<TKey extends string> {
  key: TKey;
  direction: SortDirection;
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

export function applySortDirection(
  value: number,
  direction: SortDirection,
): number {
  return direction === "asc" ? value : -value;
}

export function nextSort<TKey extends string>(
  current: SortConfig<TKey>,
  key: TKey,
): SortConfig<TKey> {
  if (current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}
