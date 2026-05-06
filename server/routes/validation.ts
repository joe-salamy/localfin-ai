import type { Response } from 'express';
import { z } from 'zod';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const nonEmptyString = z.string().trim().min(1);
export const isoDateString = z.string().refine(isRealIsoDate, 'Expected date in YYYY-MM-DD format');
export const finiteNumber = z.number().finite();
export const idParamSchema = z.object({ id: nonEmptyString });

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown, res: Response): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  res.status(400).json({
    success: false,
    error: result.error.issues.map((issue) => issue.message).join('; '),
  });
  return null;
}
