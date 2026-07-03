import { useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type {
  AccountSummary as AccountSummaryType,
  NetWorthSummary,
} from "@/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { formatCurrency, cn } from "@/lib/utils";
import { DISPLAY_DATE_FORMAT } from "@/config/constants";
import { useAmountGradient } from "@/features/display-settings/hooks";
import {
  accountChangeScaleValue,
  scaleValueColorClass,
} from "@/lib/financialColorScale";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";

interface AccountSummaryProps {
  accounts: AccountSummaryType[];
  netWorth: NetWorthSummary;
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

const accountSummaryColumnDefs = [
  { id: "expander", defaultWidth: 48 },
  { id: "account", defaultWidth: 180 },
  { id: "type", defaultWidth: 96 },
  { id: "starting", defaultWidth: 128 },
  { id: "change", defaultWidth: 128 },
  { id: "ending", defaultWidth: 128 },
] satisfies readonly ResizableColumnDef[];

const accountTransactionColumnDefs = [
  { id: "date", defaultWidth: 112 },
  { id: "name", defaultWidth: 220 },
  { id: "amount", defaultWidth: 112 },
  { id: "balance", defaultWidth: 112 },
  { id: "category", defaultWidth: 180 },
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

export function AccountSummaryTable({
  accounts,
  netWorth,
}: AccountSummaryProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const getSummaryGradientStyle = useAmountGradient(
    accounts.map((account) =>
      accountChangeScaleValue(account.total_change, account.account_type),
    ),
  );
  const accountColumns = useResizableColumns(
    "dashboard.account-summary",
    accountSummaryColumnDefs,
  );
  const transactionColumns = useResizableColumns(
    "dashboard.account-summary.transactions",
    accountTransactionColumnDefs,
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
        style={{ minWidth: accountColumns.totalWidth, tableLayout: "fixed" }}
      >
        <colgroup>
          {accountColumns.columns.map((column) => (
            <col
              key={column.id}
              style={accountColumns.getColStyle(column.id)}
            />
          ))}
        </colgroup>
        <thead className="bg-secondary/50">
          <tr>
            <th
              className={cn(headerClass, "relative w-8")}
              style={accountColumns.getHeaderStyle("expander")}
            >
              <ResizeHandle layout={accountColumns} columnId="expander" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={accountColumns.getHeaderStyle("account")}
            >
              Account
              <ResizeHandle layout={accountColumns} columnId="account" />
            </th>
            <th
              className={cn(headerClass, "relative")}
              style={accountColumns.getHeaderStyle("type")}
            >
              Type
              <ResizeHandle layout={accountColumns} columnId="type" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={accountColumns.getHeaderStyle("starting")}
            >
              Starting
              <ResizeHandle layout={accountColumns} columnId="starting" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={accountColumns.getHeaderStyle("change")}
            >
              Change
              <ResizeHandle layout={accountColumns} columnId="change" />
            </th>
            <th
              className={cn(headerClass, "relative text-right")}
              style={accountColumns.getHeaderStyle("ending")}
            >
              Ending
              <ResizeHandle layout={accountColumns} columnId="ending" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((a) => {
            const isOpen = expanded.has(a.account_id);
            return (
              <AccountRow
                key={a.account_id}
                account={a}
                isOpen={isOpen}
                onToggle={() => toggle(a.account_id)}
                getSummaryGradientStyle={getSummaryGradientStyle}
                transactionColumns={transactionColumns}
              />
            );
          })}
          <tr className="bg-secondary/30 font-semibold">
            <td className={cellClass} />
            <td className={cellClass} colSpan={2}>
              Net Worth
            </td>
            <td className={cn(cellClass, "text-right text-green-400")}>
              {formatCurrency(netWorth.total_assets)}
              <span className="text-xs text-muted-foreground ml-1">assets</span>
            </td>
            <td className={cn(cellClass, "text-right text-red-400")}>
              {formatCurrency(netWorth.total_liabilities)}
              <span className="text-xs text-muted-foreground ml-1">liab.</span>
            </td>
            <td
              className={cn(
                cellClass,
                "text-right",
                netWorth.net_worth >= 0 ? "text-green-400" : "text-red-400",
              )}
            >
              {formatCurrency(netWorth.net_worth)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AccountRow({
  account,
  isOpen,
  onToggle,
  getSummaryGradientStyle,
  transactionColumns,
}: {
  account: AccountSummaryType;
  isOpen: boolean;
  onToggle: () => void;
  getSummaryGradientStyle: (amount: number) => CSSProperties | undefined;
  transactionColumns: ResizableTableLayout;
}) {
  const getGradientStyle = useAmountGradient(
    account.transactions.map((transaction) =>
      accountChangeScaleValue(transaction.amount, account.account_type),
    ),
  );
  const changeScaleValue = accountChangeScaleValue(
    account.total_change,
    account.account_type,
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
            id={account.account_id}
            name={account.account_name}
            color={account.account_color}
          />
        </td>
        <td className={cellClass}>
          <span
            className={cn(
              "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
              account.account_type === "asset"
                ? "bg-green-900/40 text-green-400"
                : "bg-red-900/40 text-red-400",
            )}
          >
            {account.account_type}
          </span>
        </td>
        <td className={cn(cellClass, "text-right font-mono tabular-nums")}>
          {formatCurrency(account.starting_balance)}
        </td>
        <td
          className={cn(
            cellClass,
            "text-right font-mono tabular-nums",
            scaleValueColorClass(changeScaleValue),
          )}
          style={getSummaryGradientStyle(changeScaleValue)}
        >
          {formatCurrency(account.total_change)}
        </td>
        <td className={cn(cellClass, "text-right font-mono tabular-nums")}>
          {formatCurrency(account.ending_balance)}
        </td>
      </tr>
      {isOpen && account.transactions.length > 0 && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-secondary/20 px-6 py-2">
              <table
                className="w-full"
                style={{
                  minWidth: transactionColumns.totalWidth,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {transactionColumns.columns.map((column) => (
                    <col
                      key={column.id}
                      style={transactionColumns.getColStyle(column.id)}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className={cn(headerClass, "relative")}
                      style={transactionColumns.getHeaderStyle("date")}
                    >
                      Date
                      <ResizeHandle
                        layout={transactionColumns}
                        columnId="date"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative")}
                      style={transactionColumns.getHeaderStyle("name")}
                    >
                      Name
                      <ResizeHandle
                        layout={transactionColumns}
                        columnId="name"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={transactionColumns.getHeaderStyle("amount")}
                    >
                      Amount
                      <ResizeHandle
                        layout={transactionColumns}
                        columnId="amount"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative text-right")}
                      style={transactionColumns.getHeaderStyle("balance")}
                    >
                      Balance
                      <ResizeHandle
                        layout={transactionColumns}
                        columnId="balance"
                      />
                    </th>
                    <th
                      className={cn(headerClass, "relative")}
                      style={transactionColumns.getHeaderStyle("category")}
                    >
                      Category
                      <ResizeHandle
                        layout={transactionColumns}
                        columnId="category"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {account.transactions.map((t) => {
                    const amountScaleValue = accountChangeScaleValue(
                      t.amount,
                      account.account_type,
                    );
                    return (
                      <tr key={t.id} className="hover:bg-secondary/20">
                        <td className={cn(cellClass, "text-xs")}>
                          {format(parseISO(t.date), DISPLAY_DATE_FORMAT)}
                        </td>
                        <td className={cn(cellClass, "text-xs")}>{t.name}</td>
                        <td
                          className={cn(
                            cellClass,
                            "text-right font-mono tabular-nums text-xs",
                            scaleValueColorClass(amountScaleValue),
                          )}
                          style={getGradientStyle(amountScaleValue)}
                        >
                          {formatCurrency(t.amount)}
                        </td>
                        <td
                          className={cn(
                            cellClass,
                            "text-right font-mono tabular-nums text-xs",
                          )}
                        >
                          {formatCurrency(t.running_balance)}
                        </td>
                        <td
                          className={cn(
                            cellClass,
                            "text-xs text-muted-foreground",
                          )}
                        >
                          {t.category_name && t.subcategory_name ? (
                            <span className="inline-flex items-center gap-1">
                              <EntityLabel
                                id={t.category_name}
                                name={t.category_name}
                                color={t.category_color}
                              />
                              <span>&gt;</span>
                              <EntityLabel
                                id={t.subcategory_name}
                                name={t.subcategory_name}
                                color={t.subcategory_color}
                              />
                            </span>
                          ) : (
                            <EntityLabel
                              id={t.subcategory_name}
                              name={t.subcategory_name}
                              color={t.subcategory_color}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {isOpen && account.transactions.length === 0 && (
        <tr>
          <td colSpan={6} className="px-6 py-2 text-xs text-muted-foreground">
            No transactions in this period.
          </td>
        </tr>
      )}
    </>
  );
}
