import { useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { TagChip } from "@/components/features/TagPicker";
import { cn, formatCurrency } from "@/lib/utils";
import type { TagSummary as TagSummaryType } from "@/types";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";

interface TagSummaryTableProps {
  tags: TagSummaryType[];
}

const headerClass =
  "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider";
const cellClass = "px-2 py-1.5 text-sm whitespace-nowrap";

interface ResizableTableLayout {
  columns: readonly { id: string }[];
  totalWidth: number;
  getColStyle: (columnId: string) => CSSProperties;
  getHeaderStyle: (columnId: string) => CSSProperties;
  getResizeHandleProps: (columnId: string) => HTMLAttributes<HTMLSpanElement>;
}

const resizeHandleClass =
  "absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40";

const tagSummaryColumnDefs = [
  { id: "expander", defaultWidth: 48 },
  { id: "tag", defaultWidth: 180 },
  { id: "type", defaultWidth: 112 },
  { id: "spend", defaultWidth: 128 },
  { id: "income", defaultWidth: 128 },
  { id: "net", defaultWidth: 128 },
  { id: "count", defaultWidth: 96 },
] satisfies readonly ResizableColumnDef[];

const tagCategoryColumnDefs = [
  { id: "category", defaultWidth: 200 },
  { id: "spend", defaultWidth: 128 },
  { id: "income", defaultWidth: 128 },
  { id: "net", defaultWidth: 128 },
  { id: "count", defaultWidth: 96 },
] satisfies readonly ResizableColumnDef[];

function ResizeHandle({
  layout,
  columnId,
}: {
  layout: ResizableTableLayout;
  columnId: string;
}) {
  return (
    <span
      {...layout.getResizeHandleProps(columnId)}
      className={resizeHandleClass}
    />
  );
}

export function TagSummaryTable({ tags }: TagSummaryTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tagColumns = useResizableColumns(
    "dashboard.tag-summary",
    tagSummaryColumnDefs,
  );
  const categoryColumns = useResizableColumns(
    "dashboard.tag-summary.categories",
    tagCategoryColumnDefs,
  );

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table
        className="w-full"
        style={{ minWidth: tagColumns.totalWidth, tableLayout: "fixed" }}
      >
        <colgroup>
          {tagColumns.columns.map((column) => (
            <col key={column.id} style={tagColumns.getColStyle(column.id)} />
          ))}
        </colgroup>
        <thead className="bg-secondary/50">
          <tr>
            <th
              className={cn(headerClass, "relative w-8")}
              style={tagColumns.getHeaderStyle("expander")}
            >
              <ResizeHandle layout={tagColumns} columnId="expander" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={tagColumns.getHeaderStyle("tag")}
            >
              Tag
              <ResizeHandle layout={tagColumns} columnId="tag" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={tagColumns.getHeaderStyle("type")}
            >
              Type
              <ResizeHandle layout={tagColumns} columnId="type" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={tagColumns.getHeaderStyle("spend")}
            >
              Spend
              <ResizeHandle layout={tagColumns} columnId="spend" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={tagColumns.getHeaderStyle("income")}
            >
              Income
              <ResizeHandle layout={tagColumns} columnId="income" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={tagColumns.getHeaderStyle("net")}
            >
              Net
              <ResizeHandle layout={tagColumns} columnId="net" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={tagColumns.getHeaderStyle("count")}
            >
              Count
              <ResizeHandle layout={tagColumns} columnId="count" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tags.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-2 py-4 text-center text-sm text-muted-foreground"
              >
                No tag data.
              </td>
            </tr>
          )}
          {tags.map((tag) => {
            const isOpen = expanded.has(tag.tag_id);
            const chipTag = {
              id: tag.tag_id,
              name: tag.tag_name,
              type: tag.tag_type,
              color: tag.tag_color,
            };
            return (
              <TagSummaryRow
                key={tag.tag_id}
                tag={tag}
                chipTag={chipTag}
                isOpen={isOpen}
                onToggle={() => toggle(tag.tag_id)}
                categoryColumns={categoryColumns}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TagSummaryRow({
  tag,
  chipTag,
  isOpen,
  onToggle,
  categoryColumns,
}: {
  tag: TagSummaryType;
  chipTag: {
    id: string;
    name: string;
    type: TagSummaryType["tag_type"];
    color: string | null;
  };
  isOpen: boolean;
  onToggle: () => void;
  categoryColumns: ResizableTableLayout;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-secondary/30" onClick={onToggle}>
        <td className={cellClass}>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className={cellClass}>
          <TagChip tag={chipTag} />
        </td>
        <td className={cellClass}>
          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
            {tag.tag_type}
          </span>
        </td>
        <td
          className={cn(
            cellClass,
            "text-right font-mono tabular-nums text-expense",
          )}
        >
          {formatCurrency(tag.expense_total)}
        </td>
        <td
          className={cn(
            cellClass,
            "text-right font-mono tabular-nums text-income",
          )}
        >
          {formatCurrency(tag.income_total)}
        </td>
        <td
          className={cn(
            cellClass,
            "text-right font-mono tabular-nums",
            tag.net_total >= 0 ? "text-income" : "text-expense",
          )}
        >
          {formatCurrency(tag.net_total)}
        </td>
        <td className={cn(cellClass, "text-right font-mono tabular-nums")}>
          {tag.transaction_count}
        </td>
      </tr>
      {isOpen && tag.categories.length > 0 && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table
                className="w-full"
                style={{
                  minWidth: categoryColumns.totalWidth,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {categoryColumns.columns.map((column) => (
                    <col
                      key={column.id}
                      style={categoryColumns.getColStyle(column.id)}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className={cn(headerClass, "relative")}
                      style={categoryColumns.getHeaderStyle("category")}
                    >
                      Category
                      <ResizeHandle
                        layout={categoryColumns}
                        columnId="category"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={categoryColumns.getHeaderStyle("spend")}
                    >
                      Spend
                      <ResizeHandle layout={categoryColumns} columnId="spend" />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={categoryColumns.getHeaderStyle("income")}
                    >
                      Income
                      <ResizeHandle
                        layout={categoryColumns}
                        columnId="income"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={categoryColumns.getHeaderStyle("net")}
                    >
                      Net
                      <ResizeHandle layout={categoryColumns} columnId="net" />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={categoryColumns.getHeaderStyle("count")}
                    >
                      Count
                      <ResizeHandle layout={categoryColumns} columnId="count" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {tag.categories.map((category) => (
                    <tr
                      key={category.category_id ?? "uncategorized"}
                      className="hover:bg-secondary/20"
                    >
                      <td className={cn(cellClass, "text-xs")}>
                        <EntityLabel
                          id={category.category_id ?? "uncategorized"}
                          name={category.category_name ?? "Uncategorized"}
                          color={category.category_color}
                        />
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs text-expense",
                        )}
                      >
                        {formatCurrency(category.expense_total)}
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs text-income",
                        )}
                      >
                        {formatCurrency(category.income_total)}
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs",
                          category.net_total >= 0
                            ? "text-income"
                            : "text-expense",
                        )}
                      >
                        {formatCurrency(category.net_total)}
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs",
                        )}
                      >
                        {category.transaction_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && tag.categories.length === 0 && (
        <tr>
          <td colSpan={7} className="px-6 py-2 text-xs text-muted-foreground">
            No categories.
          </td>
        </tr>
      )}
    </>
  );
}
