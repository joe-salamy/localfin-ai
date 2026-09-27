// UTC calendar math for ISO YYYY-MM-DD planning ranges.
// Native Date only: parsing and formatting pin UTC so bucketing and goal
// periods stay deterministic regardless of server timezone.

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addMonthsUtc(date: Date, amount: number): Date {
  const day = date.getUTCDate();
  const base = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1),
  );
  const daysInTarget = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  base.setUTCDate(Math.min(day, daysInTarget));
  return base;
}

export function differenceInCalendarDaysUtc(later: Date, earlier: Date): number {
  const startOf = (date: Date): number =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((startOf(later) - startOf(earlier)) / 86_400_000);
}

// Local-time stamps for file names and log partitions, which follow the
// user's calendar day rather than UTC.
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** HHMMSS in local time. */
export function localTimeCompact(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
