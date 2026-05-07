import assert from "node:assert/strict";
import test from "node:test";
import { sortableTimestamp } from "./openrouter.js";

test("sortableTimestamp formats log filenames in Pacific time", () => {
  assert.equal(
    sortableTimestamp(new Date("2026-05-07T04:26:39.486Z")),
    "2026-05-06_21-26-39-486PT",
  );
});
