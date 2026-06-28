import { format, parseISO } from "date-fns";
import { WalletCards } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EntityLabel } from "@/components/ui/EntityLabel";
import { DISPLAY_DATE_FORMAT } from "@/config/constants";
import { useRecentActivity } from "@/hooks/useTransactions";
import { cn, formatCurrency } from "@/lib/utils";
import { useAmountGradient } from "@/features/display-settings/hooks";
import {
  useResizableColumns,
  type ResizableColumnDef,
} from "@/features/table-layout/useResizableColumns";
import {
  accountChangeScaleValue,
  scaleValueColorClass,
} from "@/lib/financialColorScale";

const RECENT_ACTIVITY_COLUMNS: ResizableColumnDef[] = [
  { id: "account", defaultWidth: 180 },
  { id: "date", defaultWidth: 112 },
  { id: "latestTransaction", defaultWidth: 240 },
  { id: "amount", defaultWidth: 112 },
  { id: "currentBalance", defaultWidth: 128 },
];

export function RecentAccountTransactionsTable() {
  const { recentActivity, isLoading } = useRecentActivity();
  const getGradientStyle = useAmountGradient(
    recentActivity.flatMap((activity) =>
      activity.last_transaction_amount == null
        ? []
        : [
            accountChangeScaleValue(
              activity.last_transaction_amount,
              activity.account_type,
            ),
          ],
    ),
  );

  const {
    columns,
    totalWidth,
    getColStyle,
    getHeaderStyle,
    getResizeHandleProps,
  } = useResizableColumns(
    "transaction-input.recent-activity",
    RECENT_ACTIVITY_COLUMNS,
  );

  return (
    <Card className="p-3">
      <CardHeader className="mb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <WalletCards className="h-4 w-4" />
          Latest Transactions by Account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-border">
          <table
            className="w-full text-xs"
            style={{ minWidth: totalWidth, tableLayout: "fixed" }}
          >
            <colgroup>
              {columns.map((column) => (
                <col key={column.id} style={getColStyle(column.id)} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-card text-left text-muted-foreground">
                <th
                  className="relative px-2 py-1.5"
                  style={getHeaderStyle("account")}
                >
                  Account
                  <span
                    {...getResizeHandleProps("account")}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  />
                </th>
                <th
                  className="relative px-2 py-1.5"
                  style={getHeaderStyle("date")}
                >
                  Date
                  <span
                    {...getResizeHandleProps("date")}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  />
                </th>
                <th
                  className="relative px-2 py-1.5"
                  style={getHeaderStyle("latestTransaction")}
                >
                  Latest Transaction
                  <span
                    {...getResizeHandleProps("latestTransaction")}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  />
                </th>
                <th
                  className="relative px-2 py-1.5 text-right"
                  style={getHeaderStyle("amount")}
                >
                  Amount
                  <span
                    {...getResizeHandleProps("amount")}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  />
                </th>
                <th
                  className="relative px-2 py-1.5 text-right"
                  style={getHeaderStyle("currentBalance")}
                >
                  Current Balance
                  <span
                    {...getResizeHandleProps("currentBalance")}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-ring/40"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-4 text-center text-muted-foreground"
                  >
                    Loading account balances...
                  </td>
                </tr>
              )}
              {!isLoading && recentActivity.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-4 text-center text-muted-foreground"
                  >
                    No active accounts found.
                  </td>
                </tr>
              )}
              {!isLoading &&
                recentActivity.map((activity) => {
                  const transactionScaleValue =
                    activity.last_transaction_amount == null
                      ? null
                      : accountChangeScaleValue(
                          activity.last_transaction_amount,
                          activity.account_type,
                        );
                  return (
                    <tr
                      key={activity.account_id}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        <EntityLabel
                          id={activity.account_id}
                          name={activity.account_name}
                          color={activity.account_color}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {activity.last_transaction_date
                          ? format(
                              parseISO(activity.last_transaction_date),
                              DISPLAY_DATE_FORMAT,
                            )
                          : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-foreground">
                        {activity.last_transaction_name ?? "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        {activity.last_transaction_amount == null ? (
                          "-"
                        ) : (
                          <span
                            className={cn(
                              transactionScaleValue != null &&
                                scaleValueColorClass(transactionScaleValue),
                            )}
                            style={
                              transactionScaleValue == null
                                ? undefined
                                : getGradientStyle(transactionScaleValue)
                            }
                          >
                            {formatCurrency(activity.last_transaction_amount)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-foreground">
                        {formatCurrency(activity.current_balance)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
