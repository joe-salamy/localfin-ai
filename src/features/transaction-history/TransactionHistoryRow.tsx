import { forwardRef, type KeyboardEventHandler, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TransactionHistoryRowProps {
  selected: boolean;
  focused: boolean;
  flagged: boolean;
  suspectSeverity: "low" | "medium" | "high" | null;
  title?: string;
  onFocus(): void;
  onKeyDown?: KeyboardEventHandler<HTMLTableRowElement>;
  children: ReactNode;
}

export const TransactionHistoryRow = forwardRef<
  HTMLTableRowElement,
  TransactionHistoryRowProps
>(function TransactionHistoryRow(
  {
    selected,
    focused,
    flagged,
    suspectSeverity,
    title,
    onFocus,
    onKeyDown,
    children,
  },
  ref,
) {
  return (
    <tr
      ref={ref}
      tabIndex={0}
      onFocus={onFocus}
      title={title}
      onKeyDown={onKeyDown}
      className={cn(
        "outline-none hover:bg-secondary/30 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-secondary/20",
        focused && "bg-secondary/30",
        suspectSeverity === "low" &&
          "bg-amber-500/10 hover:bg-amber-500/15 focus-visible:bg-amber-500/15",
        suspectSeverity === "medium" &&
          "bg-amber-500/20 hover:bg-amber-500/25 focus-visible:bg-amber-500/25",
        suspectSeverity === "high" &&
          "bg-red-500/25 hover:bg-red-500/30 focus-visible:bg-red-500/30",
        flagged &&
          "bg-red-500/25 hover:bg-red-500/30 focus-visible:bg-red-500/30",
      )}
    >
      {children}
    </tr>
  );
});
