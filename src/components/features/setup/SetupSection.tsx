import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import type { SortConfig } from "./setupSort";

export function SortHeader<TKey extends string>({
  label,
  sortKey,
  sort,
  align = "left",
  onSort,
}: {
  label: string;
  sortKey: TKey;
  sort: SortConfig<TKey>;
  align?: "left" | "right";
  onSort: (key: TKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${
        align === "right" ? "justify-end" : ""
      }`}
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  );
}

export function CollapsibleSection({
  title,
  count,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4"
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-lg font-semibold text-foreground">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({count})
          </span>
        </span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && <CardContent className="px-4 pb-4">{children}</CardContent>}
    </Card>
  );
}
