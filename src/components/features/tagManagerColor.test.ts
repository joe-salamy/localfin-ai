
import { expect, test } from "vitest"
import { DEFAULT_ENTITY_COLORS } from "../../lib/colors";
import {
  DEFAULT_NEW_TAG_COLOR,
  resolveNewTagCreateColor,
} from "./tagManagerColor";

test("new tag creation persists the visible default red instead of Auto", () => {
  expect(DEFAULT_ENTITY_COLORS[0]).toBe("#ef4444");
  expect(DEFAULT_NEW_TAG_COLOR).toBe(DEFAULT_ENTITY_COLORS[0]);
  expect(resolveNewTagCreateColor(null)).toBe("#ef4444");
  expect(resolveNewTagCreateColor(null)).not.toBe(null);
});

test("new tag creation preserves a selected concrete color", () => {
  expect(resolveNewTagCreateColor("#3b82f6")).toBe("#3b82f6");
});
