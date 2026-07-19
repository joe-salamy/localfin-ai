import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function CollapsibleCard({
  title,
  count,
  open,
  onOpenChange,
  children,
  contentClassName,
}: {
  title: ReactNode;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="flex items-center text-lg font-semibold text-foreground">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({count})
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown size={18} aria-hidden="true" />
        ) : (
          <ChevronRight size={18} aria-hidden="true" />
        )}
      </button>
      {open && (
        <CardContent className={cn("mt-2", contentClassName)}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}
