import type { CommandId } from "./commands";
import { useShortcuts } from "./hooks";
import { displayShortcutList } from "./normalize";
import { cn } from "@/lib/utils";

export function ShortcutHint({
  commandId,
  className,
}: {
  commandId: CommandId;
  className?: string;
}) {
  const { getShortcuts, showShortcutHints } = useShortcuts();
  if (!showShortcutHints) return null;

  const bindings = getShortcuts(commandId);
  if (bindings.length === 0) return null;

  return (
    <kbd
      className={cn(
        "ml-1.5 rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground",
        className,
      )}
    >
      {displayShortcutList(bindings)}
    </kbd>
  );
}
