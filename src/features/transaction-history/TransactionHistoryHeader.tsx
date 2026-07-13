import { ArrowDown, ArrowUp } from "lucide-react";

export function SortIcon({
  column,
  sortColumn,
  sortDirection,
}: {
  column: string;
  sortColumn: string;
  sortDirection: "asc" | "desc";
}) {
  if (column !== sortColumn) return null;
  return sortDirection === "asc" ? (
    <ArrowUp className="inline h-3 w-3 ml-0.5" />
  ) : (
    <ArrowDown className="inline h-3 w-3 ml-0.5" />
  );
}
