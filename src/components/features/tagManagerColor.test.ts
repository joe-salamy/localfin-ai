import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ENTITY_COLORS } from "../../lib/colors";
import {
  DEFAULT_NEW_TAG_COLOR,
  resolveNewTagCreateColor,
} from "./tagManagerColor";

test("new tag creation persists the visible default red instead of Auto", () => {
  assert.equal(DEFAULT_ENTITY_COLORS[0], "#ef4444");
  assert.equal(DEFAULT_NEW_TAG_COLOR, DEFAULT_ENTITY_COLORS[0]);
  assert.equal(resolveNewTagCreateColor(null), "#ef4444");
  assert.notEqual(resolveNewTagCreateColor(null), null);
});

test("new tag creation preserves a selected concrete color", () => {
  assert.equal(resolveNewTagCreateColor("#3b82f6"), "#3b82f6");
});
