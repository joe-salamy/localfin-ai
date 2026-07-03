export interface FieldEditDoubleClickEvent {
  defaultPrevented?: boolean;
  target: EventTarget | null;
}

const ignoredFieldEditDoubleClickTargetSelector =
  'button, a, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [data-field-edit-double-click-ignore="true"]';

export function shouldHandleFieldEditDoubleClick(
  event: FieldEditDoubleClickEvent,
): boolean {
  if (event.defaultPrevented) return false;

  if (
    typeof Element !== "undefined" &&
    event.target instanceof Element &&
    event.target.closest(ignoredFieldEditDoubleClickTargetSelector)
  ) {
    return false;
  }

  return true;
}
