
import { expect, test } from "vitest"
import {
  createTagWithControlledSelection,
  type TagPickerCreateOptions,
} from "./tagPickerCreateSelection";
import type { CreateTagData, Tag } from "@shared/contracts";

function tag(id: string): Tag {
  return {
    id,
    name: "Road Trip",
    type: "trip",
    color: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    deleted_at: null,
  };
}

test("created tag undo and redo callbacks mutate the latest controlled tag ids", async () => {
  const created = tag("tag-created");
  let controlledValue = ["tag-kept"];
  const valueRef = { current: controlledValue };
  const changes: string[][] = [];
  let receivedData: CreateTagData | undefined;
  let receivedOptions: TagPickerCreateOptions | undefined;

  const setControlledValue = (nextValue: string[]) => {
    controlledValue = nextValue;
    valueRef.current = nextValue;
  };

  const onChange = (nextValue: string[]) => {
    changes.push(nextValue);
    setControlledValue(nextValue);
  };

  const result = await createTagWithControlledSelection({
    data: { name: "Road Trip" },
    valueRef,
    onChange,
    onCreateTag: async (data, options) => {
      receivedData = data;
      receivedOptions = options;
      return created;
    },
  });

  expect(result).toBe(created);
  expect(receivedData).toEqual({ name: "Road Trip" });
  const onUndo = receivedOptions?.onUndo;
  const onRedo = receivedOptions?.onRedo;
  expect(onUndo, "onCreateTag receives an undo callback").toBeTypeOf("function");
  expect(onRedo, "onCreateTag receives a redo callback").toBeTypeOf("function");
  expect(controlledValue).toEqual(["tag-kept", "tag-created"]);

  setControlledValue(["tag-kept", "tag-created", "tag-added-after-create"]);
  onUndo!(created);
  expect(controlledValue).toEqual(["tag-kept", "tag-added-after-create"]);

  setControlledValue(["tag-added-after-create"]);
  onRedo!(created);
  expect(controlledValue).toEqual(["tag-added-after-create", "tag-created"]);
  expect(changes).toEqual([
    ["tag-kept", "tag-created"],
    ["tag-kept", "tag-added-after-create"],
    ["tag-added-after-create", "tag-created"],
  ]);
});
