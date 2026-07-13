import type { ResizableColumnDef } from "@/features/table-layout/useResizableColumns";

export const transactionHistoryColumns = [
  { id: "select", label: "", defaultWidth: 48 },
  { id: "date", label: "Date", defaultWidth: 128, sortable: true },
  { id: "account", label: "Account", defaultWidth: 160 },
  { id: "name", label: "Name", defaultWidth: 220, sortable: true },
  {
    id: "amount",
    label: "Amount",
    defaultWidth: 112,
    sortable: true,
    align: "right",
  },
  {
    id: "balance",
    label: "Balance",
    defaultWidth: 112,
    sortable: true,
    align: "right",
  },
  { id: "category", label: "Category", defaultWidth: 160 },
  { id: "kind", label: "Type", defaultWidth: 112 },
  { id: "subcategory", label: "Subcategory", defaultWidth: 180 },
  { id: "tags", label: "Tags", defaultWidth: 200 },
  { id: "actions", label: "Actions", defaultWidth: 96 },
] satisfies readonly (ResizableColumnDef & {
  label: string;
  sortable?: boolean;
  align?: "right";
})[];
