import type { CommandId } from './commands';
import { useShortcuts } from './hooks';
import { displayShortcut } from './normalize';
import { cn } from '@/lib/utils';

export function ShortcutHint({
  commandId,
  className,
}: {
  commandId: CommandId;
  className?: string;
}) {
  const { getShortcut, showShortcutHints } = useShortcuts();
  if (!showShortcutHints) return null;

  const binding = getShortcut(commandId);
  if (!binding) return null;

  return (
    <kbd
      className={cn(
        'ml-1.5 rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground',
        className,
      )}
    >
      {displayShortcut(binding)}
    </kbd>
  );
}
