import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TransactionDraftRowProps {
  duplicate: boolean;
  children: ReactNode;
}

export function TransactionDraftRow({
  duplicate,
  children,
}: TransactionDraftRowProps) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0",
        duplicate && "bg-yellow-500/10",
      )}
    >
      {children}
    </tr>
  );
}
