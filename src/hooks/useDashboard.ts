import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AccountSummaryResponse,
  CategorySummary,
  DashboardMetrics,
  NetWorthDataPoint,
  NetWorthSummary,
  SankeyData,
  TagSummary,
} from "@/types/index";

const EMPTY_NET_WORTH: NetWorthSummary = {
  total_assets: 0,
  total_liabilities: 0,
  net_worth: 0,
};

export function useDashboard(
  startDate: string,
  endDate: string,
  filters?: { tagIds?: string[] },
) {
  const dateParams = `?startDate=${startDate}&endDate=${endDate}`;
  const transactionReportQuery = buildDashboardQueryString(
    startDate,
    endDate,
    filters,
  );
  const transactionReportFilters = filters?.tagIds?.length
    ? { tagIds: filters.tagIds }
    : undefined;

  const accountSummaryQuery = useQuery({
    queryKey: queryKeys.dashboard.accountSummary(startDate, endDate),
    queryFn: () =>
      apiGet<AccountSummaryResponse>(`/dashboard/account-summary${dateParams}`),
    select: (res) => res.data ?? { accounts: [], netWorth: EMPTY_NET_WORTH },
  });

  const categorySummaryQuery = useQuery({
    queryKey: queryKeys.dashboard.categorySummary(
      startDate,
      endDate,
      transactionReportFilters,
    ),
    queryFn: () =>
      apiGet<CategorySummary[]>(
        `/dashboard/category-summary${transactionReportQuery}`,
      ),
    select: (res) => res.data ?? [],
  });

  const metricsQuery = useQuery({
    queryKey: queryKeys.dashboard.metrics(
      startDate,
      endDate,
      transactionReportFilters,
    ),
    queryFn: () =>
      apiGet<DashboardMetrics>(`/dashboard/metrics${transactionReportQuery}`),
    select: (res) => res.data,
  });

  const netWorthChartQuery = useQuery({
    queryKey: queryKeys.dashboard.netWorthChart(startDate, endDate),
    queryFn: () =>
      apiGet<NetWorthDataPoint[]>(`/dashboard/charts/net-worth${dateParams}`),
    select: (res) => res.data ?? [],
  });

  const sankeyChartQuery = useQuery({
    queryKey: queryKeys.dashboard.sankeyChart(
      startDate,
      endDate,
      transactionReportFilters,
    ),
    queryFn: () =>
      apiGet<SankeyData>(`/dashboard/charts/sankey${transactionReportQuery}`),
    select: (res) => res.data,
  });

  const tagSummaryQuery = useQuery({
    queryKey: queryKeys.dashboard.tagSummary(
      startDate,
      endDate,
      transactionReportFilters,
    ),
    queryFn: () =>
      apiGet<TagSummary[]>(`/dashboard/tag-summary${transactionReportQuery}`),
    select: (res) => res.data ?? [],
  });

  return {
    accountSummary: accountSummaryQuery.data?.accounts ?? [],
    netWorth: accountSummaryQuery.data?.netWorth ?? EMPTY_NET_WORTH,
    categorySummary: categorySummaryQuery.data ?? [],
    tagSummary: tagSummaryQuery.data ?? [],
    metrics: metricsQuery.data,
    netWorthChart: netWorthChartQuery.data ?? [],
    sankeyChart: sankeyChartQuery.data,
    isLoading:
      accountSummaryQuery.isLoading ||
      categorySummaryQuery.isLoading ||
      tagSummaryQuery.isLoading ||
      metricsQuery.isLoading ||
      netWorthChartQuery.isLoading ||
      sankeyChartQuery.isLoading,
  };
}

function buildDashboardQueryString(
  startDate: string,
  endDate: string,
  filters?: { tagIds?: string[] },
): string {
  const params = new URLSearchParams({ startDate, endDate });
  filters?.tagIds?.forEach((tagId) => params.append("tagIds", tagId));
  return `?${params.toString()}`;
}
