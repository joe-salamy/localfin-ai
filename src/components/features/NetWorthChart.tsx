import { useMemo } from "react";
import type { NetWorthDataPoint } from "@/types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface NetWorthChartProps {
  data: NetWorthDataPoint[];
}

export function NetWorthChart({ data }: NetWorthChartProps) {
  const accountKeys = useMemo(() => {
    if (data.length === 0) return [];
    const skip = new Set([
      "date",
      "formattedDate",
      "netWorth",
      "accountColors",
    ]);
    return Object.keys(data[0]).filter((k) => !skip.has(k));
  }, [data]);
  const accountColors = data[0]?.accountColors ?? {};

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No chart data available.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart
        data={data}
        margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
        <XAxis
          dataKey="formattedDate"
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          tickLine={{ stroke: "#555" }}
        />
        <YAxis
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          tickLine={{ stroke: "#555" }}
          tickFormatter={(v: number) => formatCurrency(v)}
          width={90}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f1f1f",
            border: "1px solid #333",
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: "#ddd" }}
          formatter={(value) => formatCurrency(Number(value))}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "#ccc" }} />
        <Line
          type="monotone"
          dataKey="netWorth"
          stroke="#ffffff"
          strokeWidth={2}
          dot={false}
          name="Net Worth"
        />
        {accountKeys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={accountColors[key] ?? "#6b7280"}
            strokeWidth={1}
            dot={false}
            name={key}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
