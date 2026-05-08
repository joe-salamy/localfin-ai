import { useMemo } from 'react';
import type { NetWorthDataPoint } from '@/types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface NetWorthChartProps {
  data: NetWorthDataPoint[];
}

export function NetWorthChart({ data }: NetWorthChartProps) {
  const accountKeys = useMemo(() => {
    if (data.length === 0) return [];
    const skip = new Set(['date', 'formattedDate', 'netWorth', 'accountColors']);
    return Object.keys(data[0]).filter((k) => !skip.has(k));
  }, [data]);
  const accountColors = data[0]?.accountColors ?? {};

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No chart data available.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
        <XAxis
          dataKey="formattedDate"
          tick={{ fill: '#b3b3b3', fontSize: 11, fontWeight: 600 }}
          tickLine={{ stroke: '#4d4d4d' }}
        />
        <YAxis
          tick={{ fill: '#b3b3b3', fontSize: 11, fontWeight: 600 }}
          tickLine={{ stroke: '#4d4d4d' }}
          tickFormatter={(v: number) => formatCurrency(v)}
          width={90}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#181818', border: '0', borderRadius: 8, boxShadow: 'rgba(0,0,0,0.5) 0px 8px 24px', fontSize: 12 }}
          labelStyle={{ color: '#ffffff', fontWeight: 700 }}
          formatter={(value) => formatCurrency(Number(value))}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#b3b3b3', fontWeight: 700 }} />
        <Line
          type="monotone"
          dataKey="netWorth"
          stroke="#1ed760"
          strokeWidth={3}
          dot={false}
          name="Net Worth"
        />
        {accountKeys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={accountColors[key] ?? '#6b7280'}
            strokeWidth={1}
            dot={false}
            name={key}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
