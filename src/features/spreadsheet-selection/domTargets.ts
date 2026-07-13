export function isNativeEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement) {
    return true;
  }
  if (
    typeof HTMLTextAreaElement !== "undefined" &&
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }
  if (typeof HTMLSelectElement !== "undefined" && target instanceof HTMLSelectElement) {
    return true;
  }
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    target.isContentEditable
  );
}

export function hasSelectedInputText(target: EventTarget | null): boolean {
  if (
    !(
      (typeof HTMLInputElement !== "undefined" &&
        target instanceof HTMLInputElement) ||
      (typeof HTMLTextAreaElement !== "undefined" &&
        target instanceof HTMLTextAreaElement)
    )
  ) {
    return false;
  }

  return (
    typeof target.selectionStart === "number" &&
    typeof target.selectionEnd === "number" &&
    target.selectionStart !== target.selectionEnd
  );
}
