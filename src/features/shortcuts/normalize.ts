import type { CommandScope, ShortcutBinding } from './commands';

interface KeyboardLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ShortcutParts {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface ShortcutValidation {
  ok: boolean;
  message?: string;
}

const keyAliases = new Map<string, string>([
  [' ', 'Space'],
  ['Spacebar', 'Space'],
  ['Esc', 'Escape'],
  ['Del', 'Delete'],
  ['Up', 'ArrowUp'],
  ['Down', 'ArrowDown'],
  ['Left', 'ArrowLeft'],
  ['Right', 'ArrowRight'],
  ['Comma', ','],
  ['Period', '.'],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
]);

const reservedShortcuts = new Set([
  'Ctrl+R',
  'Meta+R',
  'Ctrl+L',
  'Meta+L',
  'Ctrl+T',
  'Meta+T',
  'Ctrl+W',
  'Meta+W',
  'Ctrl+P',
  'Meta+P',
  'Ctrl+F',
  'Meta+F',
  'Ctrl+S',
  'Meta+S',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'F5',
  'Ctrl+F5',
  'Meta+Q',
]);

const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS']);
const navigationKeys = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function normalizeBaseKey(key: string, code?: string): string {
  const aliased = keyAliases.get(key) ?? keyAliases.get(code ?? '') ?? key;
  if (aliased.length === 1 && /[a-z]/i.test(aliased)) {
    return aliased.toUpperCase();
  }
  return aliased;
}

export function normalizeShortcutParts(parts: ShortcutParts): string {
  const modifiers = [
    parts.ctrl ? 'Ctrl' : null,
    parts.alt ? 'Alt' : null,
    parts.shift ? 'Shift' : null,
    parts.meta ? 'Meta' : null,
  ].filter((part): part is string => part !== null);

  return [...modifiers, normalizeBaseKey(parts.key)].join('+');
}

export function normalizeKeyboardEvent(event: KeyboardLike): ShortcutBinding | null {
  if (modifierKeys.has(event.key)) return null;

  const key = normalizeBaseKey(event.key, event.code);
  if (!key) return null;

  return {
    key: normalizeShortcutParts({
      key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    }),
  };
}

export function parseShortcut(value: string): ShortcutBinding | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const key = parts.pop();
  if (!key) return null;

  const normalizedModifiers = new Set(parts.map((part) => part.toLowerCase()));
  return {
    key: normalizeShortcutParts({
      key: normalizeBaseKey(key),
      ctrl: normalizedModifiers.has('ctrl') || normalizedModifiers.has('control'),
      alt: normalizedModifiers.has('alt') || normalizedModifiers.has('option'),
      shift: normalizedModifiers.has('shift'),
      meta: normalizedModifiers.has('meta') || normalizedModifiers.has('cmd') || normalizedModifiers.has('command'),
    }),
  };
}

export function isSingleCharacterShortcut(binding: ShortcutBinding): boolean {
  const parts = binding.key.split('+');
  return parts.length === 1 && parts[0] !== undefined && parts[0].length === 1;
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { isContentEditable?: boolean; tagName?: string };
  if (candidate.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(candidate.tagName ?? '');
}

export function validateShortcut(
  binding: ShortcutBinding | null,
  scope: CommandScope,
): ShortcutValidation {
  if (!binding) {
    return { ok: false, message: 'Press a key combination.' };
  }

  const keyParts = binding.key.split('+');
  const key = keyParts[keyParts.length - 1] ?? '';
  if (!key || modifierKeys.has(key)) {
    return { ok: false, message: 'Shortcut must include a non-modifier key.' };
  }

  if (reservedShortcuts.has(binding.key)) {
    return { ok: false, message: `${displayShortcut(binding)} is reserved by browsers, operating systems, or assistive technology.` };
  }

  if (isSingleCharacterShortcut(binding) && scope === 'global') {
    return { ok: false, message: 'Global shortcuts must include a modifier key.' };
  }

  if (key === 'Tab') {
    return { ok: false, message: 'Tab is reserved for focus navigation.' };
  }

  return { ok: true };
}

export function displayShortcut(binding: ShortcutBinding | null): string {
  if (!binding) return 'Unassigned';

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return binding.key
    .split('+')
    .map((part) => {
      if (!isMac) return part;
      if (part === 'Ctrl') return '⌃';
      if (part === 'Alt') return '⌥';
      if (part === 'Shift') return '⇧';
      if (part === 'Meta') return '⌘';
      if (part === 'ArrowUp') return '↑';
      if (part === 'ArrowDown') return '↓';
      if (part === 'ArrowLeft') return '←';
      if (part === 'ArrowRight') return '→';
      return part;
    })
    .join(isMac ? '' : '+');
}

export function ariaKeyShortcut(binding: ShortcutBinding | null): string | undefined {
  if (!binding) return undefined;
  return binding.key.replace(/Ctrl/g, 'Control');
}

export function isNavigationKey(binding: ShortcutBinding): boolean {
  const key = binding.key.split('+').at(-1);
  return key !== undefined && navigationKeys.has(key);
}
