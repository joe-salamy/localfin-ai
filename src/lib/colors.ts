export const DEFAULT_ENTITY_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#78716c',
  '#64748b',
  '#6b7280',
] as const;

export const DEFAULT_AMOUNT_GRADIENT_SETTINGS = {
  amountGradientEnabled: false,
  negativeColor: '#dc2626',
  neutralColor: '#ffffff',
  positiveColor: '#16a34a',
} as const;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function normalizeColor(value: unknown): string | null {
  if (value == null || value === '') return null;
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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.slice(1);
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function mixChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

export function mixHexColors(startHex: string, endHex: string, ratio: number): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  const mixed = start.map((channel, index) =>
    mixChannel(channel, end[index] ?? channel, clampedRatio),
  );

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function amountGradientColor(
  amount: number,
  maxAbsAmount: number,
  negativeColor: string,
  neutralColor: string,
  positiveColor: string,
): string | null {
  if (amount === 0 || maxAbsAmount <= 0) return neutralColor;

  const ratio = Math.log1p(Math.abs(amount)) / Math.log1p(maxAbsAmount);

  if (amount < 0) {
    return mixHexColors(neutralColor, negativeColor, ratio);
  }

  return mixHexColors(neutralColor, positiveColor, ratio);
}

