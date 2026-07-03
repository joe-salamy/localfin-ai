import { DEFAULT_ENTITY_COLORS } from "../../lib/colors";

export const DEFAULT_NEW_TAG_COLOR = DEFAULT_ENTITY_COLORS[0];

export function resolveNewTagCreateColor(color: string | null): string {
  return color ?? DEFAULT_NEW_TAG_COLOR;
}
