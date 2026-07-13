import type { CreateTagData, Tag } from "@shared/contracts";

export interface TagPickerCreateOptions {
  onUndo?: (tag: Tag) => void;
  onRedo?: (tag: Tag) => void;
}

interface TagPickerValueRef {
  current: string[];
}

function createTagPickerCreateOptions(
  valueRef: TagPickerValueRef,
  onChange: (tagIds: string[]) => void,
): Required<TagPickerCreateOptions> {
  return {
    onUndo: (tag) => {
      const latestValue = valueRef.current;
      if (latestValue.includes(tag.id))
        onChange(latestValue.filter((id) => id !== tag.id));
    },
    onRedo: (tag) => {
      const latestValue = valueRef.current;
      if (!latestValue.includes(tag.id)) onChange([...latestValue, tag.id]);
    },
  };
}

export async function createTagWithControlledSelection({
  data,
  valueRef,
  onChange,
  onCreateTag,
}: {
  data: CreateTagData;
  valueRef: TagPickerValueRef;
  onChange: (tagIds: string[]) => void;
  onCreateTag: (
    data: CreateTagData,
    options: Required<TagPickerCreateOptions>,
  ) => Promise<Tag>;
}): Promise<Tag> {
  const createOptions = createTagPickerCreateOptions(valueRef, onChange);
  const tag = await onCreateTag(data, createOptions);
  createOptions.onRedo(tag);
  return tag;
}
