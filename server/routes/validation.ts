import { z } from "zod";
import { BadRequestError } from "../errors.js";
import { hexColorSchema, isIsoDate } from "../../shared/validation.js";

export const nonEmptyString = z.string().trim().min(1);
export const isoDateString = z
  .string()
  .refine(isIsoDate, "Expected date in YYYY-MM-DD format");
export const finiteNumber = z.number().finite();
export const idParamSchema = z.object({ id: nonEmptyString });
export const colorSchema = hexColorSchema.nullable();
export const colorSchemaOptional = colorSchema.optional();
export function nonEmptyUpdate<T extends z.ZodRawShape>(shape: T) { return z.object(shape).refine((v) => Object.keys(v).length > 0, "At least one update field is required"); }
export const optionalQueryStringArray = z.preprocess(
  (value) => {
    if (value === undefined || value === "") return undefined;
    const values = Array.isArray(value) ? value : [value];
    const normalized = values
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  },
  z.array(nonEmptyString).optional(),
);

export function parseRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new BadRequestError(
    result.error.issues.map((issue) => issue.message).join("; "),
  );
}
