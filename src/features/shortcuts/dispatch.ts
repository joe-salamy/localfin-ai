import type { ShortcutBinding } from "./commands";

const UNMODIFIED_NATIVE_CONTROL_KEYS: Record<string, true> = {
  Enter: true,
  Space: true,
  Delete: true,
  Backspace: true,
  ArrowUp: true,
  ArrowDown: true,
  ArrowLeft: true,
  ArrowRight: true,
  Home: true,
  End: true,
  Escape: true,
};

export function shouldSkipShortcutDispatch(
  event: Pick<KeyboardEvent, "defaultPrevented" | "target">,
  binding: ShortcutBinding,
): boolean {
  if (event.defaultPrevented) return true;
  if (!(event.target instanceof Element)) return false;
  if (!UNMODIFIED_NATIVE_CONTROL_KEYS[binding.key]) return false;

  return Boolean(
    event.target.closest(
      'button, a, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"]',
    ),
  );
}
