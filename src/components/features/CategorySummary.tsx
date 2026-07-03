import { useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { CategorySummary as CategorySummaryType } from "@/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { formatCurrency, cn } from "@/lib/utils";
import { useAmountGradient } from "@/features/display-settings/hooks";
import {
  categoryDifferenceScaleValue,
  scaleValueColorClass,
} from "@/lib/financialColorScale";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";

interface CategorySummaryProps {
  categories: CategorySummaryType[];
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

const categorySummaryColumnDefs = [
  { id: "expander", defaultWidth: 48 },
  { id: "category", defaultWidth: 180 },
  { id: "type", defaultWidth: 96 },
  { id: "total", defaultWidth: 128 },
  { id: "goal", defaultWidth: 128 },
  { id: "difference", defaultWidth: 128 },
] satisfies readonly ResizableColumnDef[];

const subcategorySummaryColumnDefs = [
  { id: "subcategory", defaultWidth: 200 },
  { id: "total", defaultWidth: 128 },
  { id: "goal", defaultWidth: 128 },
  { id: "difference", defaultWidth: 128 },
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

export function CategorySummaryTable({ categories }: CategorySummaryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const getSummaryGradientStyle = useAmountGradient(
    categories.flatMap((category) =>
      category.difference == null
        ? []
        : [
            categoryDifferenceScaleValue(
              category.difference,
              category.category_type,
            ),
          ],
    ),
  );
  const categoryColumns = useResizableColumns(
    "dashboard.category-summary",
    categorySummaryColumnDefs,
  );
  const subcategoryColumns = useResizableColumns(
    "dashboard.category-summary.subcategories",
    subcategorySummaryColumnDefs,
  );

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table
        className="w-full"
        style={{ minWidth: categoryColumns.totalWidth, tableLayout: "fixed" }}
      >
        <colgroup>
          {categoryColumns.columns.map((column) => (
            <col
              key={column.id}
              style={categoryColumns.getColStyle(column.id)}
            />
          ))}
        </colgroup>
        <thead className="bg-secondary/50">
          <tr>
            <th
              className={cn(headerClass, "relative w-8")}
              style={categoryColumns.getHeaderStyle("expander")}
            >
              <ResizeHandle layout={categoryColumns} columnId="expander" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={categoryColumns.getHeaderStyle("category")}
            >
              Category
              <ResizeHandle layout={categoryColumns} columnId="category" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={categoryColumns.getHeaderStyle("type")}
            >
              Type
              <ResizeHandle layout={categoryColumns} columnId="type" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={categoryColumns.getHeaderStyle("total")}
            >
              Total
              <ResizeHandle layout={categoryColumns} columnId="total" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={categoryColumns.getHeaderStyle("goal")}
            >
              Goal
              <ResizeHandle layout={categoryColumns} columnId="goal" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={categoryColumns.getHeaderStyle("difference")}
            >
              Difference
              <ResizeHandle layout={categoryColumns} columnId="difference" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((c) => {
            const isOpen = expanded.has(c.category_id);
            return (
              <CategoryRow
                key={c.category_id}
                category={c}
                isOpen={isOpen}
                onToggle={() => toggle(c.category_id)}
                getSummaryGradientStyle={getSummaryGradientStyle}
                subcategoryColumns={subcategoryColumns}
              />
            );
          })}
          {categories.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-2 py-4 text-center text-sm text-muted-foreground"
              >
                No category data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DifferenceCell({
  value,
  categoryType,
  getGradientStyle,
}: {
  value: number | null;
  categoryType: CategorySummaryType["category_type"];
  getGradientStyle: (amount: number) => CSSProperties | undefined;
}) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const scaleValue = categoryDifferenceScaleValue(value, categoryType);
  return (
    <span
      className={cn("font-mono tabular-nums", scaleValueColorClass(scaleValue))}
      style={getGradientStyle(scaleValue)}
    >
      {formatCurrency(value)}
    </span>
  );
}

function CategoryRow({
  category,
  isOpen,
  onToggle,
  getSummaryGradientStyle,
  subcategoryColumns,
}: {
  category: CategorySummaryType;
  isOpen: boolean;
  onToggle: () => void;
  getSummaryGradientStyle: (amount: number) => CSSProperties | undefined;
  subcategoryColumns: ResizableTableLayout;
}) {
  const getSubcategoryGradientStyle = useAmountGradient(
    category.subcategories.flatMap((subcategory) =>
      subcategory.difference == null
        ? []
        : [
            categoryDifferenceScaleValue(
              subcategory.difference,
              category.category_type,
            ),
          ],
    ),
  );

  return (
    <>
      <tr className="hover:bg-secondary/30 cursor-pointer" onClick={onToggle}>
        <td className={cellClass}>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className={cellClass}>
          <EntityLabel
            id={category.category_id}
            name={category.category_name}
            color={category.category_color}
          />
        </td>
        <td className={cellClass}>
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
              category.category_type === "income"
                ? "bg-green-900/40 text-green-400"
                : "bg-red-900/40 text-red-400",
            )}
          >
            {category.category_type}
          </span>
        </td>
        <td className={cn(cellClass, "text-right font-mono tabular-nums")}>
          {formatCurrency(category.total)}
        </td>
        <td
          className={cn(
            cellClass,
            "text-right font-mono tabular-nums text-muted-foreground",
          )}
        >
          {category.goal != null ? formatCurrency(category.goal) : "-"}
        </td>
        <td className={cn(cellClass, "text-right")}>
          <DifferenceCell
            value={category.difference}
            categoryType={category.category_type}
            getGradientStyle={getSummaryGradientStyle}
          />
        </td>
      </tr>
      {isOpen && category.subcategories.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table
                className="w-full"
                style={{
                  minWidth: subcategoryColumns.totalWidth,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {subcategoryColumns.columns.map((column) => (
                    <col
                      key={column.id}
                      style={subcategoryColumns.getColStyle(column.id)}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className={cn(headerClass, "relative")}
                      style={subcategoryColumns.getHeaderStyle("subcategory")}
                    >
                      Subcategory
                      <ResizeHandle
                        layout={subcategoryColumns}
                        columnId="subcategory"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={subcategoryColumns.getHeaderStyle("total")}
                    >
                      Total
                      <ResizeHandle
                        layout={subcategoryColumns}
                        columnId="total"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={subcategoryColumns.getHeaderStyle("goal")}
                    >
                      Goal
                      <ResizeHandle
                        layout={subcategoryColumns}
                        columnId="goal"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={subcategoryColumns.getHeaderStyle("difference")}
                    >
                      Difference
                      <ResizeHandle
                        layout={subcategoryColumns}
                        columnId="difference"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {category.subcategories.map((s) => (
                    <tr
                      key={s.subcategory_id}
                      className="hover:bg-secondary/20"
                    >
                      <td className={cn(cellClass, "text-xs")}>
                        <EntityLabel
                          id={s.subcategory_id}
                          name={s.subcategory_name}
                          color={s.subcategory_color}
                        />
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs",
                        )}
                      >
                        {formatCurrency(s.total)}
                      </td>
                      <td
                        className={cn(
                          cellClass,
                          "text-right font-mono tabular-nums text-xs text-muted-foreground",
                        )}
                      >
                        {s.goal != null ? formatCurrency(s.goal) : "-"}
                      </td>
                      <td className={cn(cellClass, "text-right text-xs")}>
                        <DifferenceCell
                          value={s.difference}
                          categoryType={category.category_type}
                          getGradientStyle={getSubcategoryGradientStyle}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && category.subcategories.length === 0 && (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted-foreground">
            No subcategories.
          </td>
        </tr>
      )}
    </>
  );
}
