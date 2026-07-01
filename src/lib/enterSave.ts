interface EnterSaveKeyboardEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
  target: EventTarget | null;
  preventDefault: () => void;
}

const ignoredEnterSaveTargetSelector =
  'button, a, [role="button"], [role="link"], [data-enter-save-ignore="true"]';

export function shouldHandleEnterSave(event: EnterSaveKeyboardEvent): boolean {
  if (event.key !== "Enter") return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false;
  if (event.nativeEvent?.isComposing) return false;

  const target = event.target;
  if (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(ignoredEnterSaveTargetSelector)
  ) {
    return false;
  }

  return true;
}

export function handleEnterSave(
  event: EnterSaveKeyboardEvent,
  save: () => void,
): boolean {
  if (!shouldHandleEnterSave(event)) return false;

  event.preventDefault();
  save();
  return true;
}
