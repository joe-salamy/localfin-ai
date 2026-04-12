import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AccountSummary,
  CategorySummary,
  DashboardMetrics,
  NetWorthDataPoint,
  SankeyData,
} from '@/types/index';

export function useDashboard(startDate: string, endDate: string) {
  const dateParams = `?startDate=${startDate}&endDate=${endDate}`;

  const accountSummaryQuery = useQuery({
    queryKey: queryKeys.dashboard.accountSummary(startDate, endDate),
    queryFn: () =>
      apiGet<AccountSummary[]>(`/dashboard/account-summary${dateParams}`),
    select: (res) => res.data ?? [],
  });

  const categorySummaryQuery = useQuery({
    queryKey: queryKeys.dashboard.categorySummary(startDate, endDate),
    queryFn: () =>
      apiGet<CategorySummary[]>(`/dashboard/category-summary${dateParams}`),
    select: (res) => res.data ?? [],
  });

  const metricsQuery = useQuery({
    queryKey: queryKeys.dashboard.metrics(startDate, endDate),
    queryFn: () =>
      apiGet<DashboardMetrics>(`/dashboard/metrics${dateParams}`),
    select: (res) => res.data,
  });

  const netWorthChartQuery = useQuery({
    queryKey: queryKeys.dashboard.netWorthChart(startDate, endDate),
    queryFn: () =>
      apiGet<NetWorthDataPoint[]>(`/dashboard/charts/net-worth${dateParams}`),
    select: (res) => res.data ?? [],
  });

  const sankeyChartQuery = useQuery({
    queryKey: queryKeys.dashboard.sankeyChart(startDate, endDate),
    queryFn: () =>
      apiGet<SankeyData>(`/dashboard/charts/sankey${dateParams}`),
    select: (res) => res.data,
  });

  return {
    accountSummary: accountSummaryQuery.data ?? [],
    categorySummary: categorySummaryQuery.data ?? [],
    metrics: metricsQuery.data,
    netWorthChart: netWorthChartQuery.data ?? [],
    sankeyChart: sankeyChartQuery.data,
    isLoading:
      accountSummaryQuery.isLoading ||
      categorySummaryQuery.isLoading ||
      metricsQuery.isLoading ||
      netWorthChartQuery.isLoading ||
      sankeyChartQuery.isLoading,
  };
}
